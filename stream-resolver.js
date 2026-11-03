const { TikTokLiveConnection } = require('tiktok-live-connector');

/**
 * Normalizes username from strings like '@usuario', 'usuario', 'https://www.tiktok.com/@usuario/live'
 */
function normalizeUsername(input) {
  if (!input) return '';
  let str = input.trim();
  // Check if it's a URL
  const urlMatch = str.match(/tiktok\.com\/@([^/?#]+)/i);
  if (urlMatch) {
    return urlMatch[1];
  }
  // Strip leading @
  if (str.startsWith('@')) {
    str = str.substring(1);
  }
  return str.split('/')[0].split('?')[0];
}

/**
 * Resolves room info and stream URLs for a TikTok user without requiring login.
 */
async function getLiveStreamData(username) {
  const cleanUser = normalizeUsername(username);
  if (!cleanUser) {
    throw new Error('Nome de usuário inválido.');
  }

  const conn = new TikTokLiveConnection(cleanUser, {});

  // 1. Fetch user & room status from TikTok Web API
  const apiLiveRes = await conn.webClient.getJsonObjectFromTikTokApi('api-live/user/room/', {
    ...conn.webClient.clientParams,
    uniqueId: cleanUser,
    sourceType: '54'
  });

  if (apiLiveRes?.statusCode !== 0 && !apiLiveRes?.data?.user) {
    throw new Error(apiLiveRes?.message || 'Falha ao buscar dados do usuário. Verifique o @username.');
  }

  const user = apiLiveRes.data?.user || {};
  const roomId = user.roomId;
  const liveRoomStatus = apiLiveRes.data?.liveRoom?.status;

  if (!roomId) {
    return {
      username: cleanUser,
      isLive: false,
      status: 'offline',
      message: `O canal @${cleanUser} não possui sala ativa no momento.`
    };
  }

  // 2. Fetch detailed room info from Webcast API
  const roomInfoRes = await conn.webClient.getJsonObjectFromWebcastApi('room/info/', {
    ...conn.webClient.clientParams,
    room_id: roomId
  }, false);

  const roomData = roomInfoRes?.data || {};
  const streamUrlObj = roomData.stream_url || {};

  // Status: 2 is LIVE, 4 is OFFLINE
  const isLive = roomData.status === 2 || liveRoomStatus === 2;

  // Process stream URLs
  const flvMap = streamUrlObj.flv_pull_url || {};
  const hlsUrl = streamUrlObj.hls_pull_url || '';
  const rtmpUrl = streamUrlObj.rtmp_pull_url || '';

  // Parse stream_data from pull_data if available
  let rawStreamData = null;
  if (streamUrlObj.pull_data?.stream_data) {
    try {
      rawStreamData = JSON.parse(streamUrlObj.pull_data.stream_data);
    } catch {
      // ignore
    }
  }

  // Format available qualities
  const qualities = [];

  // Add HLS Master
  if (hlsUrl) {
    qualities.push({
      format: 'hls',
      quality: 'auto',
      label: 'HLS (Auto / Recomendado)',
      url: hlsUrl
    });
  }

  // Add FLV streams
  const qualityLabels = {
    ORIGION: 'Original / Fonte',
    FULL_HD1: '1080p (Full HD)',
    HD1: '720p (HD)',
    SD2: '540p (SD)',
    SD1: '360p (Baixa)'
  };

  for (const [key, url] of Object.entries(flvMap)) {
    if (url) {
      qualities.push({
        format: 'flv',
        quality: key,
        label: `FLV - ${qualityLabels[key] || key}`,
        url: url
      });
    }
  }

  return {
    username: cleanUser,
    isLive: isLive,
    status: isLive ? 'live' : 'offline',
    roomId: roomId,
    title: roomData.title || apiLiveRes.data?.liveRoom?.title || 'Live sem título',
    owner: {
      id: roomData.owner?.id_str || user.id,
      nickname: roomData.owner?.nickname || cleanUser,
      displayId: roomData.owner?.display_id || cleanUser,
      avatar: roomData.owner?.avatar_thumb?.url_list?.[0] || '',
      followCount: roomData.owner?.follow_info?.follow_status || 0
    },
    stats: {
      viewerCount: roomData.user_count || 0,
      totalUsers: roomData.total_user || 0
    },
    streams: {
      hlsMaster: hlsUrl,
      flvMap: flvMap,
      rtmp: rtmpUrl,
      qualities: qualities,
      bestFlv: flvMap.FULL_HD1 || flvMap.HD1 || flvMap.ORIGION || Object.values(flvMap)[0] || '',
      bestHls: hlsUrl
    }
  };
}

module.exports = {
  normalizeUsername,
  getLiveStreamData
};
