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
 * Parses stream URLs from streamData object (present in fast room API)
 */
function parseStreamData(streamDataObj) {
  if (!streamDataObj?.pull_data?.stream_data) return null;
  try {
    const parsed = typeof streamDataObj.pull_data.stream_data === 'string'
      ? JSON.parse(streamDataObj.pull_data.stream_data)
      : streamDataObj.pull_data.stream_data;

    const data = parsed?.data || {};
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
        if (qData.flv) flvMap[q.label] = qData.flv;
        if (!hlsMaster && qData.hls) hlsMaster = qData.hls;
      }
    }

    if (!hlsMaster && Object.keys(flvMap).length === 0) return null;
    return { flvMap, hlsMaster };
  } catch (e) {
    return null;
  }
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

  // 1. Fetch user & room status from TikTok Web API (Fast endpoint ~700ms)
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
  const liveRoom = apiLiveRes.data?.liveRoom || {};
  const liveRoomStatus = liveRoom.status;

  if (!roomId) {
    return {
      username: cleanUser,
      isLive: false,
      status: 'offline',
      message: `O canal @${cleanUser} não possui sala ativa no momento.`
    };
  }

  // Status: 2 is LIVE, 4 is OFFLINE
  let isLive = liveRoomStatus === 2;
  let roomData = {};
  let flvMap = {};
  let hlsUrl = '';
  let rtmpUrl = '';

  // 2. Try fast stream resolution directly from liveRoom.streamData
  const fastStreams = parseStreamData(liveRoom.streamData);
  if (fastStreams) {
    flvMap = fastStreams.flvMap;
    hlsUrl = fastStreams.hlsMaster;
  }

  // 3. Fallback to Webcast room/info only if live and streams were not in streamData
  if (isLive && (!hlsUrl || Object.keys(flvMap).length === 0)) {
    try {
      const roomInfoRes = await conn.webClient.getJsonObjectFromWebcastApi('room/info/', {
        ...conn.webClient.clientParams,
        room_id: roomId
      }, false);

      roomData = roomInfoRes?.data || {};
      const streamUrlObj = roomData.stream_url || {};
      if (roomData.status === 2) isLive = true;

      flvMap = streamUrlObj.flv_pull_url || flvMap;
      hlsUrl = streamUrlObj.hls_pull_url || hlsUrl;
      rtmpUrl = streamUrlObj.rtmp_pull_url || '';
    } catch (e) {
      console.warn('Fallback webcast room/info falhou, usando dados do apiLive:', e.message);
    }
  }

  // Format available qualities
  const qualities = [];

  // Add HLS Master
  if (hlsUrl) {
    qualities.push({
      format: 'hls',
      quality: 'auto',
      label: 'HLS (Auto / Estável)',
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

  const avatar = user.avatarThumb?.url_list?.[0]
    || roomData.owner?.avatar_thumb?.url_list?.[0]
    || liveRoom.coverUrl
    || '';

  return {
    username: cleanUser,
    isLive: isLive,
    status: isLive ? 'live' : 'offline',
    roomId: roomId,
    title: liveRoom.title || roomData.title || 'Live sem título',
    owner: {
      id: user.id || roomData.owner?.id_str || roomId,
      nickname: user.nickname || roomData.owner?.nickname || cleanUser,
      displayId: user.uniqueId || roomData.owner?.display_id || cleanUser,
      avatar: avatar,
      followCount: user.followInfo?.followStatus || 0
    },
    stats: {
      viewerCount: liveRoom.liveRoomStats?.userCount || roomData.user_count || 0,
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
