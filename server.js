const express = require('express');
const cors = require('cors');
const path = require('path');
const https = require('https');
const http = require('http');
const { Readable } = require('stream');
const { TikTokLiveConnection } = require('tiktok-live-connector');
const { normalizeUsername, getLiveStreamData } = require('./stream-resolver');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const TIKTOK_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Referer': 'https://www.tiktok.com/',
  'Origin': 'https://www.tiktok.com'
};

/**
 * Raw http/https fetch helper (avoids fetch() quirks on some Node versions)
 */
function rawFetch(url, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, {
      headers: { ...TIKTOK_HEADERS, ...extraHeaders },
      timeout: 20000
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks), headers: res.headers }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

/**
 * GET /api/live/info?user=<username>
 */
app.get('/api/live/info', async (req, res) => {
  const rawUser = req.query.user;
  if (!rawUser) {
    return res.status(400).json({ success: false, error: 'Parâmetro "user" obrigatório.' });
  }

  try {
    const data = await getLiveStreamData(rawUser);
    return res.json({ success: true, data });
  } catch (err) {
    console.error(`[live/info] Erro @${rawUser}:`, err.message);
    return res.status(500).json({ success: false, error: err.message || 'Erro ao consultar a live.' });
  }
});

/**
 * GET /api/proxy/m3u8?url=<encoded>
 * Rewrites sub-playlist URLs through the proxy; TS segments point directly to CDN.
 */
app.get('/api/proxy/m3u8', async (req, res) => {
  const targetUrl = req.query.url;
  const proxySegments = req.query.proxySegments === '1';
  if (!targetUrl) return res.status(400).send('URL missing');

  try {
    const fetched = await rawFetch(targetUrl);

    if (fetched.status !== 200) {
      return res.status(fetched.status).send(`CDN retornou ${fetched.status}`);
    }

    const text = fetched.body.toString('utf8');
    const baseUrl = new URL(targetUrl);

    const resolveWithAuth = (rawUri) => {
      try {
        if (rawUri.startsWith('http://') || rawUri.startsWith('https://')) {
          return rawUri;
        }
        // Relative path: resolve against base, copy query params if missing
        const resolved = new URL(rawUri, baseUrl);
        if (!resolved.search && baseUrl.search) {
          resolved.search = baseUrl.search;
        }
        return resolved.toString();
      } catch {
        return rawUri;
      }
    };

    const lines = text.split(/\r?\n/);
    const rewritten = lines.map(line => {
      const trimmed = line.trim();
      if (!trimmed) return line;

      // Handle tags with URI="..."
      if (trimmed.startsWith('#')) {
        if (trimmed.includes('URI="')) {
          return line.replace(/URI="([^"]+)"/g, (_, uri) => {
            const absUri = resolveWithAuth(uri);
            const target = proxySegments
              ? `/api/proxy/stream?url=${encodeURIComponent(absUri)}`
              : absUri;
            return `URI="${target}"`;
          });
        }
        return line;
      }

      const absUrl = resolveWithAuth(trimmed);

      if (absUrl.includes('.m3u8')) {
        const ps = proxySegments ? '&proxySegments=1' : '';
        return `/api/proxy/m3u8?url=${encodeURIComponent(absUrl)}${ps}`;
      } else if (proxySegments) {
        return `/api/proxy/stream?url=${encodeURIComponent(absUrl)}`;
      } else {
        return absUrl;
      }
    });

    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    return res.send(rewritten.join('\n'));
  } catch (err) {
    console.error('[proxy/m3u8] Erro:', err.message);
    return res.status(500).send('Erro proxy M3U8: ' + err.message);
  }
});

/**
 * GET /api/proxy/stream?url=<encoded>
 * Pipes CDN stream bytes to the browser (for FLV/TS that need CORS proxy).
 */
app.get('/api/proxy/stream', (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).send('URL missing');

  const lib = targetUrl.startsWith('https') ? https : http;
  const headers = { ...TIKTOK_HEADERS };
  if (req.headers.range) headers['Range'] = req.headers.range;

  const proxyReq = lib.get(targetUrl, { headers, timeout: 30000 }, (cdnRes) => {
    res.status(cdnRes.statusCode);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Connection', 'keep-alive');

    const ct = cdnRes.headers['content-type'];
    if (ct) {
      res.setHeader('Content-Type', ct);
    } else if (targetUrl.includes('.flv')) {
      res.setHeader('Content-Type', 'video/x-flv');
    } else if (targetUrl.includes('.ts')) {
      res.setHeader('Content-Type', 'video/MP2T');
    }

    if (cdnRes.headers['content-length']) {
      res.setHeader('Content-Length', cdnRes.headers['content-length']);
    }
    if (cdnRes.headers['content-range']) {
      res.setHeader('Content-Range', cdnRes.headers['content-range']);
    }
    if (res.flushHeaders) res.flushHeaders();

    cdnRes.pipe(res);
    req.on('close', () => cdnRes.destroy());
  });

  proxyReq.on('error', (err) => {
    console.error('[proxy/stream] Erro:', err.message);
    if (!res.headersSent) res.status(502).send('Proxy error: ' + err.message);
  });

  proxyReq.on('timeout', () => {
    proxyReq.destroy();
    if (!res.headersSent) res.status(504).send('Proxy timeout');
  });
});

/**
 * GET /api/live/chat?user=<username>&roomId=<roomId>
 * SSE stream for real-time chat, gifts, likes, viewers.
 */
app.get('/api/live/chat', async (req, res) => {
  const username = normalizeUsername(req.query.user);
  const roomId = req.query.roomId;

  if (!username) {
    return res.status(400).json({ error: 'Username inválido.' });
  }

  // SSE setup - disable all buffering
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
    'Content-Encoding': 'identity',
    'Transfer-Encoding': 'identity',
    'Access-Control-Allow-Origin': '*'
  });

  if (res.socket) {
    res.socket.setNoDelay(true);
    res.socket.setTimeout(0);
    res.socket.setKeepAlive(true, 10000);
  }

  // Force flush headers immediately
  if (res.flushHeaders) res.flushHeaders();
  // Write a comment to trigger immediate flush
  res.write(': connected\n\n');

  const sendEvent = (eventData) => {
    try {
      if (res.writableEnded) return;
      res.write(`data: ${JSON.stringify(eventData)}\n\n`);
      if (res.flush) res.flush();
    } catch (e) {
      // connection closed
    }
  };

  // Heartbeat every 20s
  const pingInterval = setInterval(() => {
    try {
      if (res.writableEnded) {
        clearInterval(pingInterval);
        return;
      }
      res.write(': ping\n\n');
      if (res.flush) res.flush();
    } catch {
      clearInterval(pingInterval);
    }
  }, 20000);

  sendEvent({ type: 'status', message: `Conectando ao chat de @${username}...` });

  let conn = null;
  let connected = false;

  const cleanup = () => {
    clearInterval(pingInterval);
    if (conn) {
      try { conn.disconnect(); } catch {}
      conn = null;
    }
  };

  req.on('close', cleanup);
  req.on('error', cleanup);

  try {
    conn = new TikTokLiveConnection(username, {
      fetchRoomInfoOnConnect: false,
      enableExtendedGiftInfo: false,
      requestPollingIntervalMs: 2000,
      sessionId: undefined
    });

    conn.on('connected', (state) => {
      connected = true;
      console.log(`[chat] ✅ Conectado ao chat de @${username}, roomId=${state?.roomId}`);
      sendEvent({
        type: 'connected',
        message: `✅ Chat ao vivo de @${username} conectado!`,
        roomId: state?.roomId || roomId || ''
      });
    });

    conn.on('chat', (data) => {
      const user = data.user || {};
      const uniqueId = user.uniqueId || data.uniqueId || user.displayId || 'Anônimo';
      const nickname = user.nickname || data.nickname || uniqueId;
      const comment = data.content || data.comment || data.text || '';
      if (!comment) return;

      let avatar = '';
      if (user.profilePicture?.urls?.[0]) avatar = user.profilePicture.urls[0];
      else if (user.avatarThumb?.urls?.[0]) avatar = user.avatarThumb.urls[0];
      else if (data.profilePictureUrl) avatar = data.profilePictureUrl;

      sendEvent({
        type: 'chat',
        user: uniqueId,
        nickname,
        comment,
        avatar,
        isModerator: !!(data.isModerator || user.isModerator),
        isSubscriber: !!(data.isSubscriber || user.isSubscriber),
        timestamp: Date.now()
      });
    });

    conn.on('gift', (data) => {
      const user = data.user || {};
      const uniqueId = user.uniqueId || data.uniqueId || 'Anônimo';
      const nickname = user.nickname || data.nickname || uniqueId;
      const giftName = data.giftDetails?.giftName || data.giftName || data.gift?.name || 'Presente';
      const repeatCount = data.repeatCount || data.groupCount || 1;

      let giftImg = data.giftPictureUrl || '';
      if (data.giftImage?.urls?.[0]) giftImg = data.giftImage.urls[0];
      else if (data.gift?.image?.urlList?.[0]) giftImg = data.gift.image.urlList[0];

      sendEvent({
        type: 'gift',
        user: uniqueId,
        nickname,
        giftName,
        repeatCount,
        diamondCount: data.diamondCount || 0,
        giftPictureUrl: giftImg,
        timestamp: Date.now()
      });
    });

    conn.on('like', (data) => {
      const totalLikes = data.total ? parseInt(data.total, 10) : (data.totalLikes || data.likeCount || 0);
      sendEvent({ type: 'like', likeCount: data.count || 1, totalLikes });
    });

    conn.on('roomUser', (data) => {
      const viewerCount = data.total ? parseInt(data.total, 10) : (data.viewerCount || 0);
      sendEvent({ type: 'viewers', viewerCount });
    });

    conn.on('streamEnd', () => {
      sendEvent({ type: 'streamEnd', message: 'A live foi encerrada.' });
    });

    conn.on('disconnected', () => {
      if (!res.writableEnded) {
        sendEvent({ type: 'chatError', message: 'Chat desconectado.' });
      }
    });

    conn.on('error', (err) => {
      const msg = err?.info || err?.message || 'Erro no chat';
      console.warn(`[chat] ⚠️ Erro @${username}:`, msg);
      sendEvent({ type: 'chatError', message: msg });
    });

    console.log(`[chat] Conectando ao chat de @${username}, roomId=${roomId || 'auto'}...`);
    await conn.connect(roomId ? String(roomId) : undefined);

  } catch (err) {
    console.error(`[chat] ❌ Falha ao conectar @${username}:`, err.message);
    sendEvent({
      type: 'chatError',
      message: `Chat indisponível: ${err.message}. Assistindo sem chat.`
    });
  }
});

/**
 * GET /api/debug?user=<username>
 * Returns raw stream data for debugging
 */
app.get('/api/debug', async (req, res) => {
  const rawUser = req.query.user;
  if (!rawUser) return res.status(400).json({ error: 'user param required' });

  try {
    const data = await getLiveStreamData(rawUser);
    return res.json({ success: true, data });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n=====================================================`);
  console.log(`  TikTok Live Stream Viewer - Sem Login`);
  console.log(`  Servidor: http://localhost:${PORT}`);
  console.log(`=====================================================\n`);
});
