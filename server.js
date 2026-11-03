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

// Store active chat connections by user to manage resources
const activeChatConnections = new Map();

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
 * Proxies the HLS M3U8 playlist and rewrites internal URLs through our proxy.
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
        return `/api/proxy/stream?url=${encodeURIComponent(absoluteUrl)}`;
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
 * Streams video segments (.ts) or continuous HTTP-FLV streams.
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
 * GET /api/live/chat?user=<username>
 * Server-Sent Events (SSE) stream for real-time live chat messages, likes, and gifts.
 */
app.get('/api/live/chat', async (req, res) => {
  const username = normalizeUsername(req.query.user);
  if (!username) {
    return res.status(400).json({ error: 'Username inválido.' });
  }

  // Setup SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });

  const sendEvent = (eventData) => {
    res.write(`data: ${JSON.stringify(eventData)}\n\n`);
  };

  sendEvent({ type: 'status', message: `Conectando ao chat da live de @${username}...` });

  let conn = null;
  try {
    conn = new TikTokLiveConnection(username, {
      enableExtendedGiftInfo: true
    });

    conn.on('connected', (state) => {
      sendEvent({
        type: 'connected',
        message: `Conectado ao chat ao vivo de @${username}!`,
        roomId: state.roomId
      });
    });

    conn.on('chat', (data) => {
      sendEvent({
        type: 'chat',
        id: data.msgId,
        user: data.uniqueId,
        nickname: data.nickname,
        comment: data.comment,
        avatar: data.profilePictureUrl || '',
        isModerator: !!data.isModerator,
        isSubscriber: !!data.isSubscriber,
        timestamp: Date.now()
      });
    });

    conn.on('gift', (data) => {
      sendEvent({
        type: 'gift',
        user: data.uniqueId,
        nickname: data.nickname,
        giftName: data.giftName,
        repeatCount: data.repeatCount || 1,
        diamondCount: data.diamondCount || 0,
        giftPictureUrl: data.giftPictureUrl || '',
        timestamp: Date.now()
      });
    });

    conn.on('like', (data) => {
      sendEvent({
        type: 'like',
        likeCount: data.likeCount,
        totalLikes: data.totalLikeCount
      });
    });

    conn.on('roomUser', (data) => {
      sendEvent({
        type: 'viewers',
        viewerCount: data.viewerCount
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
      sendEvent({
        type: 'chatError',
        message: err?.message || 'Erro no chat.'
      });
    });

    await conn.connect();
  } catch (err) {
    sendEvent({
      type: 'chatError',
      message: `Não foi possível conectar ao chat em tempo real: ${err.message}`
    });
  }

  // Handle client disconnect
  req.on('close', () => {
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

  // Common VLC paths on Windows
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
