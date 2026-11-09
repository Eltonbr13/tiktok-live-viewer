const express = require('express');
const cors = require('cors');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const { Readable } = require('stream');
const { TikTokLiveConnection } = require('tiktok-live-connector');
const { normalizeUsername, getLiveStreamData } = require('./stream-resolver');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/**
 * Common request headers for proxying TikTok CDN requests
 */
const TIKTOK_CDN_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Referer': 'https://www.tiktok.com/',
  'Origin': 'https://www.tiktok.com'
};

/**
 * GET /api/live/info?user=<username>
 * Fetches stream info, qualities, title, avatar, room status without login.
 */
app.get('/api/live/info', async (req, res) => {
  const rawUser = req.query.user;
  if (!rawUser) {
    return res.status(400).json({ success: false, error: 'Parâmetro "user" obrigatório.' });
  }

  try {
    const data = await getLiveStreamData(rawUser);
    return res.json({
      success: true,
      data: data
    });
  } catch (err) {
    console.error(`Erro ao buscar dados de @${rawUser}:`, err.message);
    return res.status(500).json({
      success: false,
      error: err.message || 'Erro ao consultar a live no TikTok.'
    });
  }
});

/**
 * GET /api/proxy/m3u8?url=<encoded_url>
 * Proxies the HLS M3U8 playlist. Rewrites sub-playlists through the proxy,
 * but keeps .ts video chunks pointing DIRECTLY to TikTok's CDN.
 * Since TikTok CDN allows Access-Control-Allow-Origin: *, this completely
 * prevents Render server bottlenecking, freezing, and video stuttering.
 */
app.get('/api/proxy/m3u8', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) {
    return res.status(400).send('URL missing');
  }

  try {
    const cdnRes = await fetch(targetUrl, {
      headers: TIKTOK_CDN_HEADERS
    });

    if (!cdnRes.ok) {
      return res.status(cdnRes.status).send(`CDN retornou código ${cdnRes.status}`);
    }

    const text = await cdnRes.text();
    const baseUrl = new URL(targetUrl);
    const lines = text.split(/\r?\n/);

    const rewritten = lines.map(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        return line;
      }
      let absoluteUrl;
      try {
        absoluteUrl = new URL(trimmed, baseUrl).toString();
      } catch {
        absoluteUrl = trimmed;
      }

      if (absoluteUrl.includes('.m3u8')) {
        return `/api/proxy/m3u8?url=${encodeURIComponent(absoluteUrl)}`;
      } else {
        // Direct to CDN for video segments: zero Render CPU load, zero lag, smooth playback!
        return absoluteUrl;
      }
    });

    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    return res.send(rewritten.join('\n'));
  } catch (err) {
    console.error('Erro no proxy M3U8:', err.message);
    return res.status(500).send('Erro no proxy M3U8: ' + err.message);
  }
});

/**
 * GET /api/proxy/stream?url=<encoded_url>
 * Fallback stream proxy for platforms/browsers that require proxied chunks.
 */
app.get('/api/proxy/stream', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) {
    return res.status(400).send('URL missing');
  }

  try {
    const headers = { ...TIKTOK_CDN_HEADERS };
    if (req.headers.range) {
      headers['Range'] = req.headers.range;
    }

    const cdnRes = await fetch(targetUrl, {
      headers: headers
    });

    res.status(cdnRes.status);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Connection', 'keep-alive');

    const contentType = cdnRes.headers.get('content-type');
    if (contentType) {
      res.setHeader('Content-Type', contentType);
    } else if (targetUrl.includes('.flv')) {
      res.setHeader('Content-Type', 'video/x-flv');
    } else if (targetUrl.includes('.ts')) {
      res.setHeader('Content-Type', 'video/MP2T');
    }

    const contentLength = cdnRes.headers.get('content-length');
    if (contentLength) res.setHeader('Content-Length', contentLength);

    const contentRange = cdnRes.headers.get('content-range');
    if (contentRange) res.setHeader('Content-Range', contentRange);

    if (res.flushHeaders) res.flushHeaders();

    if (cdnRes.body) {
      const stream = Readable.fromWeb(cdnRes.body);
      stream.pipe(res);
      req.on('close', () => {
        stream.destroy();
      });
    } else {
      res.end();
    }
  } catch (err) {
    console.error('Erro no proxy de stream:', err.message);
    if (!res.headersSent) {
      res.status(500).send('Erro no proxy de stream: ' + err.message);
    }
  }
});

/**
 * GET /api/live/chat?user=<username>&roomId=<roomId>
 * Server-Sent Events (SSE) stream for real-time live chat messages, likes, and gifts.
 */
app.get('/api/live/chat', async (req, res) => {
  const username = normalizeUsername(req.query.user);
  const roomId = req.query.roomId;

  if (!username) {
    return res.status(400).json({ error: 'Username inválido.' });
  }

  // Setup SSE headers with anti-buffering for Render and proxies
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
    'Content-Encoding': 'none',
    'Access-Control-Allow-Origin': '*'
  });

  if (res.flushHeaders) res.flushHeaders();

  const sendEvent = (eventData) => {
    try {
      res.write(`data: ${JSON.stringify(eventData)}\n\n`);
      if (res.flush) res.flush();
    } catch (e) {
      // ignore
    }
  };

  // Heartbeat ping every 15s to keep SSE connection alive on Render
  const pingInterval = setInterval(() => {
    try {
      res.write(': ping\n\n');
      if (res.flush) res.flush();
    } catch {
      clearInterval(pingInterval);
    }
  }, 15000);

  sendEvent({ type: 'status', message: `Conectando ao chat da live de @${username}...` });

  let conn = null;
  try {
    conn = new TikTokLiveConnection(username, {
      fetchRoomInfoOnConnect: false,
      enableExtendedGiftInfo: false
    });

    conn.on('connected', (state) => {
      sendEvent({
        type: 'connected',
        message: `Conectado ao chat ao vivo de @${username}!`,
        roomId: state?.roomId || roomId || ''
      });
    });

    conn.on('chat', (data) => {
      // Robust mapping supporting v1, v2 and v3 protobuf formats
      const user = data.user || {};
      const uniqueId = user.uniqueId || data.uniqueId || user.displayId || 'Anônimo';
      const nickname = user.nickname || data.nickname || uniqueId;
      const comment = data.content || data.comment || '';

      if (!comment) return;

      let avatar = '';
      if (user.profilePicture?.urls?.[0]) {
        avatar = user.profilePicture.urls[0];
      } else if (user.avatarThumb?.urls?.[0]) {
        avatar = user.avatarThumb.urls[0];
      } else if (data.profilePictureUrl) {
        avatar = data.profilePictureUrl;
      }

      const msgId = data.common?.msgId || data.msgId || (Date.now() + Math.random().toString());

      sendEvent({
        type: 'chat',
        id: msgId,
        user: uniqueId,
        nickname: nickname,
        comment: comment,
        avatar: avatar,
        isModerator: !!(data.isModerator || user.userBadges?.some(b => b.badgeType === 1)),
        isSubscriber: !!(data.isSubscriber || user.userBadges?.some(b => b.badgeType === 2)),
        timestamp: Date.now()
      });
    });

    conn.on('gift', (data) => {
      const user = data.user || {};
      const uniqueId = user.uniqueId || data.uniqueId || 'Anônimo';
      const nickname = user.nickname || data.nickname || uniqueId;
      const giftName = data.giftDetails?.giftName || data.giftName || data.gift?.name || 'Presente';
      const repeatCount = data.repeatCount || data.groupCount || 1;
      const diamondCount = data.diamondCount || data.fanTicketCount || 0;

      let giftImg = data.giftPictureUrl || '';
      if (data.giftImage?.urls?.[0]) {
        giftImg = data.giftImage.urls[0];
      } else if (data.gift?.image?.urlList?.[0]) {
        giftImg = data.gift.image.urlList[0];
      }

      sendEvent({
        type: 'gift',
        user: uniqueId,
        nickname: nickname,
        giftName: giftName,
        repeatCount: repeatCount,
        diamondCount: diamondCount,
        giftPictureUrl: giftImg,
        timestamp: Date.now()
      });
    });

    conn.on('like', (data) => {
      const likeCount = data.count || data.likeCount || 1;
      const totalLikes = data.total ? parseInt(data.total, 10) : (data.totalLikes || 0);
      sendEvent({
        type: 'like',
        likeCount: likeCount,
        totalLikes: totalLikes
      });
    });

    conn.on('roomUser', (data) => {
      const viewerCount = data.total ? parseInt(data.total, 10) : (data.viewerCount || 0);
      sendEvent({
        type: 'viewers',
        viewerCount: viewerCount
      });
    });

    conn.on('streamEnd', () => {
      sendEvent({
        type: 'streamEnd',
        message: 'A transmissão foi encerrada pelo criador.'
      });
    });

    conn.on('disconnected', () => {
      sendEvent({
        type: 'disconnected',
        message: 'Chat desconectado.'
      });
    });

    conn.on('error', (err) => {
      const errMsg = err?.info || err?.exception?.message || err?.message || 'Aviso no chat.';
      sendEvent({
        type: 'chatError',
        message: errMsg
      });
    });

    // Connect using roomId if provided (avoids duplicate fetchRoomId call)
    await conn.connect(roomId ? String(roomId) : undefined);
  } catch (err) {
    console.error(`Erro ao conectar chat de @${username}:`, err.message);
    sendEvent({
      type: 'chatError',
      message: `Não foi possível carregar o chat da live: ${err.message}`
    });
  }

  // Handle client disconnect
  req.on('close', () => {
    clearInterval(pingInterval);
    if (conn) {
      try {
        conn.disconnect();
      } catch {
        // ignore
      }
    }
  });
});

/**
 * POST /api/open-player
 * Attempts to launch local VLC or MPV with the stream URL
 */
app.post('/api/open-player', (req, res) => {
  const { streamUrl } = req.body;
  if (!streamUrl) {
    return res.status(400).json({ success: false, error: 'URL do stream não informada.' });
  }

  const vlcCandidates = [
    'vlc',
    'C:\\Program Files\\VideoLAN\\VLC\\vlc.exe',
    'C:\\Program Files (x86)\\VideoLAN\\VLC\\vlc.exe'
  ];

  let vlcPath = null;
  for (const cand of vlcCandidates) {
    if (cand === 'vlc') continue;
    if (fs.existsSync(cand)) {
      vlcPath = cand;
      break;
    }
  }

  if (vlcPath) {
    try {
      const child = spawn(vlcPath, [
        streamUrl,
        '--http-user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        '--http-referrer=https://www.tiktok.com/'
      ], {
        detached: true,
        stdio: 'ignore'
      });
      child.unref();
      return res.json({ success: true, message: 'VLC iniciado com sucesso!' });
    } catch (e) {
      return res.json({ success: false, error: 'Erro ao abrir VLC: ' + e.message });
    }
  }

  return res.json({
    success: false,
    error: 'VLC não foi encontrado nas pastas padrão. Você pode copiar o link da live e abrir manualmente no VLC (Mídia > Abrir Transmissão de Rede).'
  });
});

app.listen(PORT, () => {
  console.log(`=====================================================`);
  console.log(`  TikTok Live Stream Viewer - 100% Sem Login`);
  console.log(`  Servidor rodando em: http://localhost:${PORT}`);
  console.log(`=====================================================`);
});
