const https = require('https');
const http = require('http');

/**
 * Normalizes username from strings like '@usuario', 'usuario', 'https://www.tiktok.com/@usuario/live'
 */
function normalizeUsername(input) {
  if (!input) return '';
  let str = input.trim();
  const urlMatch = str.match(/tiktok\.com\/@([^/?#]+)/i);
  if (urlMatch) return urlMatch[1];
  if (str.startsWith('@')) str = str.substring(1);
  return str.split('/')[0].split('?')[0].trim();
}

/**
 * HTTP GET helper returning body as string
 */
function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
        'Referer': 'https://www.tiktok.com/',
        ...headers
      },
      timeout: 15000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
  });
}

/**
 * Parses stream URLs from TikTok streamData pull_data structure
 */
function parseStreamData(streamDataObj) {
  if (!streamDataObj) return null;
  try {
    // Handle nested pull_data.stream_data
    let raw = streamDataObj;
    if (raw.pull_data?.stream_data) {
      raw = typeof raw.pull_data.stream_data === 'string'
        ? JSON.parse(raw.pull_data.stream_data)
        : raw.pull_data.stream_data;
    }

    const data = raw?.data || {};
    const flvMap = {};
    let hlsMaster = '';

    const qualityOrder = [
      { key: 'origin', label: 'ORIGION' },
      { key: 'uhd', label: 'FULL_HD1' },
      { key: 'hd', label: 'HD1' },
      { key: 'sd', label: 'SD2' },
      { key: 'ld', label: 'SD1' }
    ];

    for (const q of qualityOrder) {
      const qData = data[q.key]?.main;
      if (qData) {
        if (qData.flv && qData.flv.length > 10) flvMap[q.label] = qData.flv;
        if (!hlsMaster && qData.hls && qData.hls.length > 10) hlsMaster = qData.hls;
      }
    }

    if (Object.keys(flvMap).length === 0 && !hlsMaster) return null;
    return { flvMap, hlsMaster };
  } catch (e) {
    return null;
  }
}

/**
 * Method 1: TikTok Web API - api-live/user/room
 * Most reliable, works without login.
 */
async function fetchViaWebApi(cleanUser) {
  // TikTok Web API for live room info
  const url = `https://www.tiktok.com/api/live/detail/?aid=1988&uniqueId=${encodeURIComponent(cleanUser)}`;
  
  try {
    const res = await httpGet(url);
    if (res.status === 200) {
      const json = JSON.parse(res.body);
      if (json?.liveRoomUserInfo?.user) {
        return json;
      }
    }
  } catch (e) {
    // ignore, try next
  }
  return null;
}

/**
 * Method 2: TikTok Webcast API for stream data
 */
async function fetchViaWebcastApi(uniqueId) {
  const url = `https://webcast.tiktok.com/webcast/room/info/?aid=1988&uniqueId=${encodeURIComponent(uniqueId)}&device_platform=web&region=US`;
  
  try {
    const res = await httpGet(url);
    if (res.status === 200) {
      const json = JSON.parse(res.body);
      if (json?.data) return json.data;
    }
  } catch (e) {
    // ignore
  }
  return null;
}

/**
 * Method 3: Scrape TikTok live page HTML for SIGI_STATE data
 * Most robust fallback - gets everything from the page.
 */
async function fetchViaPageScrape(cleanUser) {
  const url = `https://www.tiktok.com/@${cleanUser}/live`;
  
  try {
    const res = await httpGet(url, {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'sec-fetch-site': 'none',
      'sec-fetch-mode': 'navigate',
      'sec-fetch-dest': 'document',
      'Cache-Control': 'max-age=0'
    });

    if (res.status !== 200) return null;
    const html = res.body;

    // Extract SIGI_STATE JSON
    const sigiMatch = html.match(/<script id="SIGI_STATE"[^>]*>([\s\S]*?)<\/script>/);
    if (sigiMatch) {
      try {
        const sigiData = JSON.parse(sigiMatch[1]);
        return { type: 'sigi', data: sigiData };
      } catch {}
    }

    // Extract __NEXT_DATA__
    const nextMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (nextMatch) {
      try {
        const nextData = JSON.parse(nextMatch[1]);
        return { type: 'next', data: nextData };
      } catch {}
    }

    return null;
  } catch (e) {
    return null;
  }
}

/**
 * Extracts stream info from SIGI_STATE data
 */
function extractFromSigiState(sigiData, cleanUser) {
  try {
    // Navigate common SIGI_STATE structure
    const liveData = sigiData?.LiveRoom || sigiData?.liveRoom;
    if (!liveData) return null;

    const liveRoomInfo = liveData?.liveRoomInfo;
    if (!liveRoomInfo) return null;

    const roomId = liveRoomInfo.roomId?.toString() || liveRoomInfo.id_str || '';
    const status = liveRoomInfo.status;
    const isLive = status === 2;

    // Stream data
    const streamDataObj = liveRoomInfo.streamData;
    const streamUrl = liveRoomInfo.stream_url;

    let flvMap = {};
    let hlsMaster = '';

    // Try streamData first (richer)
    if (streamDataObj) {
      const parsed = parseStreamData(streamDataObj);
      if (parsed) {
        flvMap = parsed.flvMap;
        hlsMaster = parsed.hlsMaster;
      }
    }

    // Fallback to stream_url
    if (streamUrl && Object.keys(flvMap).length === 0) {
      const flvUrls = streamUrl.flv_pull_url || {};
      const hls = streamUrl.hls_pull_url_map?.FULL_HD1 || streamUrl.hls_pull_url || '';
      for (const [k, v] of Object.entries(flvUrls)) {
        if (v) flvMap[k] = v;
      }
      hlsMaster = hlsMaster || hls;
    }

    const owner = liveRoomInfo.owner || {};
    const stats = liveRoomInfo.liveRoomStats || {};

    return {
      username: cleanUser,
      isLive,
      roomId,
      title: liveRoomInfo.title || 'Live no TikTok',
      owner: {
        id: owner.id || roomId,
        nickname: owner.nickName || owner.nickname || cleanUser,
        displayId: owner.uniqueId || cleanUser,
        avatar: owner.avatarThumb?.urlList?.[0] || owner.avatar_thumb?.url_list?.[0] || ''
      },
      stats: {
        viewerCount: stats.userCount || 0,
        likeCount: stats.likeCount || 0
      },
      streams: {
        hlsMaster,
        flvMap,
        qualities: buildQualities(flvMap, hlsMaster),
        bestFlv: flvMap.FULL_HD1 || flvMap.HD1 || flvMap.ORIGION || Object.values(flvMap)[0] || '',
        bestHls: hlsMaster
      }
    };
  } catch (e) {
    return null;
  }
}

/**
 * Build quality options array
 */
function buildQualities(flvMap, hlsMaster) {
  const qualityLabels = {
    ORIGION: 'Original / Fonte',
    FULL_HD1: '1080p (Full HD)',
    HD1: '720p (HD)',
    SD2: '540p (SD)',
    SD1: '360p (Baixa)'
  };

  const qualities = [];

  if (hlsMaster) {
    qualities.push({ format: 'hls', quality: 'auto', label: 'HLS (Auto / Estável)', url: hlsMaster });
  }

  for (const [key, url] of Object.entries(flvMap)) {
    if (url) {
      qualities.push({
        format: 'flv',
        quality: key,
        label: `FLV - ${qualityLabels[key] || key}`,
        url
      });
    }
  }

  return qualities;
}

/**
 * Main: Resolves room info and stream URLs for a TikTok user without login.
 * Tries multiple methods in order of reliability.
 */
async function getLiveStreamData(username) {
  const cleanUser = normalizeUsername(username);
  if (!cleanUser) throw new Error('Nome de usuário inválido.');

  console.log(`[resolver] Buscando dados de @${cleanUser}...`);

  // ── Method 1: Page scrape (most reliable for stream URLs) ──
  const scraped = await fetchViaPageScrape(cleanUser);
  if (scraped) {
    if (scraped.type === 'sigi') {
      const result = extractFromSigiState(scraped.data, cleanUser);
      if (result) {
        console.log(`[resolver] ✅ Dados obtidos via SIGI_STATE. Live: ${result.isLive}, FLV: ${!!result.streams.bestFlv}, HLS: ${!!result.streams.hlsMaster}`);
        return result;
      }
    }
  }

  // ── Method 2: tiktok-live-connector web client ──
  try {
    const { TikTokLiveConnection } = require('tiktok-live-connector');
    const conn = new TikTokLiveConnection(cleanUser, {});

    let apiLiveRes;
    try {
      apiLiveRes = await conn.webClient.getJsonObjectFromTikTokApi('api-live/user/room/', {
        ...conn.webClient.clientParams,
        uniqueId: cleanUser,
        sourceType: '54'
      });
    } catch (err1) {
      // Retry once
      const conn2 = new TikTokLiveConnection(cleanUser, {});
      apiLiveRes = await conn2.webClient.getJsonObjectFromTikTokApi('api-live/user/room/', {
        ...conn2.webClient.clientParams,
        uniqueId: cleanUser,
        sourceType: '54'
      });
    }

    if (apiLiveRes?.data) {
      const user = apiLiveRes.data?.user || {};
      const liveRoom = apiLiveRes.data?.liveRoom || {};
      const roomId = user.roomId?.toString() || '';
      const isLive = liveRoom.status === 2;

      let flvMap = {};
      let hlsMaster = '';

      if (isLive) {
        const fastStreams = parseStreamData(liveRoom.streamData);
        if (fastStreams) {
          flvMap = fastStreams.flvMap;
          hlsMaster = fastStreams.hlsMaster;
        }

        // Fallback: webcast room/info
        if (Object.keys(flvMap).length === 0 && roomId) {
          try {
            const roomInfoRes = await conn.webClient.getJsonObjectFromWebcastApi('room/info/', {
              ...conn.webClient.clientParams,
              room_id: roomId
            }, false);
            const roomData = roomInfoRes?.data || {};
            const streamUrl = roomData.stream_url || {};
            if (streamUrl.flv_pull_url) {
              for (const [k, v] of Object.entries(streamUrl.flv_pull_url)) {
                if (v) flvMap[k] = v;
              }
            }
            hlsMaster = hlsMaster || streamUrl.hls_pull_url || '';
          } catch (e) {
            console.warn('[resolver] webcast room/info fallback falhou:', e.message);
          }
        }
      }

      const avatar = user.avatarThumb?.url_list?.[0] || liveRoom.coverUrl || '';
      const result = {
        username: cleanUser,
        isLive,
        status: isLive ? 'live' : 'offline',
        roomId,
        title: liveRoom.title || 'Live no TikTok',
        owner: {
          id: user.id || roomId,
          nickname: user.nickname || cleanUser,
          displayId: user.uniqueId || cleanUser,
          avatar
        },
        stats: {
          viewerCount: liveRoom.liveRoomStats?.userCount || 0,
          likeCount: liveRoom.liveRoomStats?.likeCount || 0
        },
        streams: {
          hlsMaster,
          flvMap,
          qualities: buildQualities(flvMap, hlsMaster),
          bestFlv: flvMap.FULL_HD1 || flvMap.HD1 || flvMap.ORIGION || Object.values(flvMap)[0] || '',
          bestHls: hlsMaster
        }
      };

      console.log(`[resolver] ✅ Dados via tiktok-live-connector. Live: ${isLive}, FLV: ${!!result.streams.bestFlv}, HLS: ${!!hlsMaster}`);
      return result;
    }
  } catch (err) {
    console.warn('[resolver] tiktok-live-connector falhou:', err.message);
  }

  // ── Method 3: Direct TikTok API endpoints ──
  try {
    const url = `https://www.tiktok.com/api/live/detail/?aid=1988&uniqueId=${encodeURIComponent(cleanUser)}`;
    const res = await httpGet(url);
    if (res.status === 200) {
      const json = JSON.parse(res.body);
      const userInfo = json?.liveRoomUserInfo?.user || json?.userInfo?.user || {};
      const liveRoom = json?.liveRoomUserInfo?.liveRoom || json?.liveRoom || {};

      const roomId = userInfo.roomId?.toString() || liveRoom.id?.toString() || '';
      const isLive = liveRoom.status === 2 || json?.status === 2;

      let flvMap = {};
      let hlsMaster = '';

      if (isLive) {
        const fastStreams = parseStreamData(liveRoom.streamData);
        if (fastStreams) {
          flvMap = fastStreams.flvMap;
          hlsMaster = fastStreams.hlsMaster;
        }
      }

      if (roomId) {
        return {
          username: cleanUser,
          isLive,
          status: isLive ? 'live' : 'offline',
          roomId,
          title: liveRoom.title || 'Live no TikTok',
          owner: {
            id: userInfo.id || roomId,
            nickname: userInfo.nickName || userInfo.nickname || cleanUser,
            displayId: userInfo.uniqueId || cleanUser,
            avatar: userInfo.avatarThumb?.urlList?.[0] || userInfo.avatarMedium?.urlList?.[0] || ''
          },
          stats: { viewerCount: liveRoom.userCount || 0 },
          streams: {
            hlsMaster,
            flvMap,
            qualities: buildQualities(flvMap, hlsMaster),
            bestFlv: flvMap.FULL_HD1 || flvMap.HD1 || flvMap.ORIGION || Object.values(flvMap)[0] || '',
            bestHls: hlsMaster
          }
        };
      }
    }
  } catch (e) {
    console.warn('[resolver] Direct API fallhou:', e.message);
  }

  throw new Error(`Não foi possível obter dados de @${cleanUser}. Verifique se o username está correto.`);
}

module.exports = { normalizeUsername, getLiveStreamData };
