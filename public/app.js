/**
 * TikTok Live Stream Viewer - Client Application
 * Versão robusta: FLV direto via proxy no Render, chat com auto-reconexão
 */

// ── Estado Global ──────────────────────────────────────────────────────────
let currentStreamData = null;
let currentHls = null;
let currentFlvPlayer = null;
let chatEventSource = null;
let chatReconnectTimer = null;
let isAppMode = false;
let isChatHidden = false;
let isVerticalRatio = true;
let isTheaterMode = false;
let playAttemptTimeout = null;
let bufferWarningTimeout = null;
let playerInitializing = false;
let currentEngine = 'flv';
let chatConnectAttempt = 0;

const BACKEND_STORAGE_KEY = 'tiktok_live_viewer_backend_url';
const CHANNELS_KEY = 'tiktok_live_viewer_saved_channels';

function getApiBase() {
  const custom = localStorage.getItem(BACKEND_STORAGE_KEY);
  return custom ? custom.trim().replace(/\/+$/, '') : '';
}

// ── DOM ────────────────────────────────────────────────────────────────────
const bodyEl = document.body;
const searchForm = document.getElementById('search-form');
const usernameInput = document.getElementById('username-input');
const btnSubmit = document.getElementById('btn-submit');
const quickChannelsContainer = document.getElementById('quick-channels');

const btnToggleViewMode = document.getElementById('btn-toggle-viewmode');
const btnSettings = document.getElementById('btn-settings');
const settingsModal = document.getElementById('settings-modal');
const btnCloseSettings = document.getElementById('btn-close-settings');
const backendUrlInput = document.getElementById('backend-url-input');
const btnSaveBackend = document.getElementById('btn-save-backend');
const btnResetBackend = document.getElementById('btn-reset-backend');

const playerContainer = document.getElementById('player-container');
const videoElement = document.getElementById('live-video');
const heartsContainer = document.getElementById('hearts-container');
const playerOverlay = document.getElementById('player-overlay');
const overlaySpinner = document.getElementById('overlay-spinner');
const overlayText = document.getElementById('overlay-text');
const btnRetry = document.getElementById('btn-retry');

const badgeLive = document.getElementById('badge-live');
const liveStatusText = document.getElementById('live-status-text');
const badgeViewers = document.getElementById('badge-viewers');
const viewerCountEl = document.getElementById('viewer-count');

const btnFloatChat = document.getElementById('btn-float-chat');
const btnFloatSound = document.getElementById('btn-float-sound');
const btnFloatRatio = document.getElementById('btn-float-ratio');
const btnFloatLikes = document.getElementById('btn-float-likes');
const btnUnmuteOverlay = document.getElementById('btn-unmute-overlay');

const offlineCard = document.getElementById('offline-card');
const offlineTitle = document.getElementById('offline-title');
const offlineMessage = document.getElementById('offline-message');
const btnCheckLive = document.getElementById('btn-check-live');

const floatingAvatar = document.getElementById('floating-avatar');
const floatingName = document.getElementById('floating-name');
const floatingTitle = document.getElementById('floating-title');

const qualitySelect = document.getElementById('quality-select');
const engineSelect = document.getElementById('engine-select');
const btnToggleRatio = document.getElementById('btn-toggle-ratio');
const btnTheater = document.getElementById('btn-theater');
const btnExternalPlayer = document.getElementById('btn-external-player');

const streamerAvatar = document.getElementById('streamer-avatar');
const streamerName = document.getElementById('streamer-name');
const streamerLink = document.getElementById('streamer-link');
const streamTitle = document.getElementById('stream-title');
const statViewers = document.getElementById('stat-viewers');
const statLikes = document.getElementById('stat-likes');
const statRoom = document.getElementById('stat-room');

const btnCopyM3u8 = document.getElementById('btn-copy-m3u8');
const btnCopyFlv = document.getElementById('btn-copy-flv');
const btnSaveChannel = document.getElementById('btn-save-channel');

const chatColumn = document.getElementById('chat-column');
const chatMessages = document.getElementById('chat-messages');
const chatAutoScroll = document.getElementById('chat-autoscroll');
const btnClearChat = document.getElementById('btn-clear-chat');
const chatStatus = document.getElementById('chat-status');
const likesTicker = document.getElementById('likes-ticker');
const toastEl = document.getElementById('toast');

// ── Init ───────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  renderSavedChannels();

  if (window.innerWidth <= 768) {
    bodyEl.className = 'mobile-layout-split';
  }

  searchForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const user = usernameInput.value.trim();
    if (user) loadStreamer(user);
  });

  btnToggleViewMode.addEventListener('click', toggleViewMode);
  btnSettings.addEventListener('click', openSettings);
  btnCloseSettings.addEventListener('click', closeSettings);
  btnSaveBackend.addEventListener('click', saveBackendUrl);
  btnResetBackend.addEventListener('click', resetBackendUrl);

  btnFloatChat.addEventListener('click', toggleChatVisibility);
  btnFloatSound.addEventListener('click', toggleMute);
  btnFloatRatio.addEventListener('click', toggleVideoFit);
  btnFloatLikes.addEventListener('click', (e) => triggerFloatingHeart(
    e.clientX || window.innerWidth - 60, e.clientY || window.innerHeight - 100
  ));

  setupDoubleTap(playerContainer);

  btnToggleRatio.addEventListener('click', toggleAspectRatio);
  if (btnTheater) btnTheater.addEventListener('click', toggleTheaterMode);
  qualitySelect.addEventListener('change', onQualityChange);
  engineSelect.addEventListener('change', () => {
    engineSelect.dataset.userChanged = 'true';
    onEngineChange();
  });
  if (btnExternalPlayer) btnExternalPlayer.addEventListener('click', openInVlc);

  if (btnUnmuteOverlay) {
    btnUnmuteOverlay.addEventListener('click', (e) => {
      e.stopPropagation();
      videoElement.muted = false;
      updateSoundButton();
      hideUnmuteOverlay();
      showToast('Áudio ativado 🔊');
    });
  }

  if (btnCheckLive) {
    btnCheckLive.addEventListener('click', () => {
      if (currentStreamData?.username) {
        showToast('Verificando @' + currentStreamData.username + '...');
        loadStreamer(currentStreamData.username);
      }
    });
  }

  videoElement.addEventListener('playing', onVideoPlaying);
  videoElement.addEventListener('loadeddata', onVideoPlaying);
  videoElement.addEventListener('canplay', onVideoPlaying);

  videoElement.addEventListener('waiting', () => {
    clearTimeout(bufferWarningTimeout);
    bufferWarningTimeout = setTimeout(() => {
      if (videoElement.readyState < 3 && !videoElement.paused) {
        showToast('Buffering... aguardando dados da live');
      }
    }, 5000);
  });

  videoElement.addEventListener('error', (e) => {
    console.warn('[video] Erro no elemento de vídeo:', e);
  });

  btnCopyM3u8.addEventListener('click', () => copyStreamUrl('m3u8'));
  btnCopyFlv.addEventListener('click', () => copyStreamUrl('flv'));
  btnSaveChannel.addEventListener('click', saveCurrentChannel);
  btnClearChat.addEventListener('click', clearChat);

  btnRetry.addEventListener('click', () => {
    if (currentStreamData?.username) loadStreamer(currentStreamData.username);
  });

  const params = new URLSearchParams(window.location.search);
  const initialUser = params.get('user');
  if (initialUser) {
    usernameInput.value = initialUser;
    loadStreamer(initialUser);
  }
});

function onVideoPlaying() {
  clearTimeout(playAttemptTimeout);
  clearTimeout(bufferWarningTimeout);
  showOverlay(false);
  checkMutedState();
  playerInitializing = false;
}

// ── Stream Loading ─────────────────────────────────────────────────────────
async function loadStreamer(username) {
  hideOfflineCard();
  hideUnmuteOverlay();
  showOverlay(true, 'Consultando @' + username + '...');
  btnSubmit.disabled = true;

  destroyPlayer();
  disconnectChat();

  const apiBase = getApiBase();

  try {
    const res = await fetch(`${apiBase}/api/live/info?user=${encodeURIComponent(username)}`);
    if (!res.ok) throw new Error(`Servidor retornou ${res.status}`);
    const json = await res.json();

    if (!json.success || !json.data) {
      throw new Error(json.error || 'Falha ao carregar dados.');
    }

    currentStreamData = json.data;
    updateUI(currentStreamData);
    addRecentChannel(currentStreamData.username);

    if (currentStreamData.isLive) {
      hideOfflineCard();
      populateQualitySelector(currentStreamData.streams?.qualities || []);
      initPlayer();
      connectChat(currentStreamData.username, currentStreamData.roomId);
    } else {
      showOfflineCard(currentStreamData.username, currentStreamData.title);
      showOverlay(false);
      chatMessages.innerHTML = '';
      addSystemNotice('⚪ Canal offline. O chat estará disponível quando a live iniciar.');
    }
  } catch (err) {
    console.error('[loadStreamer] Erro:', err);
    showOverlay(true, 'Erro: ' + err.message, true);
    showToast('Erro: ' + err.message);
  } finally {
    btnSubmit.disabled = false;
  }
}

// ── UI ─────────────────────────────────────────────────────────────────────
function updateUI(data) {
  const displayName = data.owner?.nickname || `@${data.username}`;
  streamerName.textContent = displayName;
  streamTitle.textContent = data.title || 'Live sem título';
  floatingName.textContent = displayName;
  floatingTitle.textContent = data.title || 'Ao vivo';

  if (data.owner?.avatar) {
    streamerAvatar.src = data.owner.avatar;
    floatingAvatar.src = data.owner.avatar;
  }

  streamerLink.href = `https://www.tiktok.com/@${data.username}/live`;
  streamerLink.classList.remove('hidden');

  statViewers.textContent = `👁️ ${formatNumber(data.stats?.viewerCount || 0)}`;
  statRoom.textContent = `🆔 ${data.roomId || '-'}`;

  if (data.isLive) {
    badgeLive.className = 'live-pill online';
    liveStatusText.textContent = 'AO VIVO';
    badgeViewers.classList.remove('hidden');
    viewerCountEl.textContent = formatNumber(data.stats?.viewerCount || 0);
  } else {
    badgeLive.className = 'live-pill offline';
    liveStatusText.textContent = 'OFFLINE';
    badgeViewers.classList.add('hidden');
  }

  document.title = `${data.isLive ? '🔴 AO VIVO - ' : ''}@${data.username} | TikTok Live`;
}

// ── Video Player ───────────────────────────────────────────────────────────
function initPlayer() {
  if (!currentStreamData?.streams || !currentStreamData.isLive) return;
  if (playerInitializing) return;
  playerInitializing = true;

  destroyPlayer();
  showOverlay(true, 'Iniciando stream ao vivo...');

  const isSafariOrIOS = /^((?!chrome|android).)*safari/i.test(navigator.userAgent)
    || (/iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream);

  // Determine best engine
  if (!engineSelect.dataset.userChanged) {
    const canFLV = window.mpegts && mpegts.isSupported();
    engineSelect.value = (!isSafariOrIOS && canFLV) ? 'flv' : 'hls';
  }

  currentEngine = engineSelect.value;

  // Fallback timer: if nothing plays in 15s, switch protocol once
  clearTimeout(playAttemptTimeout);
  playAttemptTimeout = setTimeout(() => {
    if (playerInitializing || (videoElement.paused && videoElement.readyState < 2)) {
      console.warn('[player] Timeout! Tentando protocolo alternativo...');
      showToast('Ajustando protocolo...');
      playerInitializing = false;

      if (currentEngine === 'flv') {
        currentEngine = 'hls';
        engineSelect.value = 'hls';
        initHlsPlayer(false);
      } else if (currentEngine === 'hls' && window.mpegts && mpegts.isSupported()) {
        currentEngine = 'flv';
        engineSelect.value = 'flv';
        initFlvPlayer();
      } else {
        showOverlay(true, 'Stream instável. Clique em Tentar Novamente ou troque o protocolo.', true);
      }
    }
  }, 15000);

  if (currentEngine === 'flv') {
    initFlvPlayer();
  } else {
    initHlsPlayer(false);
  }
}

/**
 * FLV Player via mpegts.js
 * Always uses proxy on Render to avoid CORS issues with TikTok CDN auth headers.
 */
function initFlvPlayer(selectedQuality = null) {
  if (!window.mpegts || !mpegts.isSupported()) {
    console.log('[flv] mpegts não suportado, usando HLS');
    engineSelect.value = 'hls';
    currentEngine = 'hls';
    initHlsPlayer(false);
    return;
  }

  const streams = currentStreamData.streams;
  let flvUrl = '';

  if (selectedQuality && streams.flvMap?.[selectedQuality]) {
    flvUrl = streams.flvMap[selectedQuality];
  } else {
    flvUrl = streams.bestFlv || '';
  }

  if (!flvUrl) {
    console.log('[flv] Sem URL FLV disponível, tentando HLS...');
    if (streams.hlsMaster) {
      engineSelect.value = 'hls';
      currentEngine = 'hls';
      initHlsPlayer(false);
      return;
    }
    playerInitializing = false;
    showOverlay(true, 'Nenhum stream disponível para esta live.', true);
    return;
  }

  // On Render, always proxy FLV through the server to handle CORS + auth
  const apiBase = getApiBase();
  const proxyUrl = `${apiBase}/api/proxy/stream?url=${encodeURIComponent(flvUrl)}`;

  console.log('[flv] Iniciando player FLV via proxy...');

  try {
    if (currentFlvPlayer) {
      try { currentFlvPlayer.destroy(); } catch {}
      currentFlvPlayer = null;
    }
    videoElement.pause();
    videoElement.removeAttribute('src');
    videoElement.load();

    currentFlvPlayer = mpegts.createPlayer({
      type: 'flv',
      isLive: true,
      url: proxyUrl,
      hasAudio: true,
      hasVideo: true,
      cors: true
    }, {
      enableWorker: true,
      lazyLoad: false,
      enableStashBuffer: true,
      stashInitialSize: 384,
      liveBufferLatencyChasing: true,
      liveBufferLatencyMaxLatency: 10,
      liveBufferLatencyMinRemain: 1.5,
      autoCleanupSourceBuffer: true,
      autoCleanupMaxBackwardDuration: 20,
      autoCleanupMinBackwardDuration: 5,
      fixAudioTimestampGap: true
    });

    currentFlvPlayer.attachMediaElement(videoElement);
    currentFlvPlayer.load();

    videoElement.muted = true;
    updateSoundButton();

    currentFlvPlayer.on(mpegts.Events.ERROR, (errType, errDetail, errInfo) => {
      console.warn('[flv] Erro mpegts:', errType, errDetail, errInfo);
      playerInitializing = false;

      // On network error, try HLS as fallback
      if (errType === mpegts.ErrorTypes.NETWORK_ERROR || errType === mpegts.ErrorTypes.IO_ERROR) {
        if (currentStreamData.streams.hlsMaster) {
          console.log('[flv] Fallback para HLS...');
          destroyPlayer();
          engineSelect.value = 'hls';
          currentEngine = 'hls';
          initHlsPlayer(false);
        } else {
          showOverlay(true, 'Erro de rede no stream. Clique em Tentar Novamente.', true);
        }
      }
    });

    currentFlvPlayer.on(mpegts.Events.STATISTICS_INFO, (info) => {
      // Stream is active - clear loading
      if (info.speed > 0 && playerInitializing) {
        clearTimeout(playAttemptTimeout);
      }
    });

    const playPromise = currentFlvPlayer.play();
    if (playPromise && typeof playPromise.then === 'function') {
      playPromise.then(() => {
        showOverlay(false);
        playerInitializing = false;
        checkMutedState();
      }).catch((e) => {
        console.log('[flv] autoplay muted:', e.message);
        showOverlay(false);
        playerInitializing = false;
        checkMutedState();
      });
    }
  } catch (e) {
    console.error('[flv] Erro ao instanciar player:', e);
    playerInitializing = false;
    if (currentStreamData.streams.hlsMaster) {
      engineSelect.value = 'hls';
      currentEngine = 'hls';
      initHlsPlayer(false);
    } else {
      showOverlay(true, 'Erro ao iniciar player. Clique em Tentar Novamente.', true);
    }
  }
}

/**
 * HLS Player via HLS.js (or native Safari)
 */
function initHlsPlayer(useDirect = false) {
  const streams = currentStreamData.streams;
  if (!streams.hlsMaster) {
    if (streams.bestFlv && window.mpegts && mpegts.isSupported()) {
      engineSelect.value = 'flv';
      currentEngine = 'flv';
      initFlvPlayer();
      return;
    }
    playerInitializing = false;
    showOverlay(true, 'Nenhum stream HLS disponível.', true);
    return;
  }

  const apiBase = getApiBase();
  const proxyUrl = `${apiBase}/api/proxy/m3u8?url=${encodeURIComponent(streams.hlsMaster)}`;
  const playUrl = useDirect ? streams.hlsMaster : proxyUrl;

  console.log('[hls] Iniciando player HLS:', useDirect ? 'direto' : 'via proxy');

  const isSafariOrIOS = /^((?!chrome|android).)*safari/i.test(navigator.userAgent)
    || (/iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream);

  if (window.Hls && Hls.isSupported()) {
    if (currentHls) {
      try { currentHls.destroy(); } catch {}
      currentHls = null;
    }

    currentHls = new Hls({
      enableWorker: true,
      lowLatencyMode: true,
      backBufferLength: 15,
      maxBufferLength: 15,
      maxMaxBufferLength: 30,
      liveSyncDurationCount: 2,
      liveMaxLatencyDurationCount: 5,
      manifestLoadingMaxRetry: 5,
      levelLoadingMaxRetry: 5,
      fragLoadingMaxRetry: 5,
      manifestLoadingRetryDelay: 1000,
      levelLoadingRetryDelay: 1000,
      fragLoadingRetryDelay: 1000
    });

    currentHls.loadSource(playUrl);
    currentHls.attachMedia(videoElement);

    videoElement.muted = true;
    updateSoundButton();

    currentHls.on(Hls.Events.MANIFEST_PARSED, () => {
      clearTimeout(playAttemptTimeout);
      videoElement.play().then(() => {
        showOverlay(false);
        playerInitializing = false;
        checkMutedState();
      }).catch(() => {
        showOverlay(false);
        playerInitializing = false;
        checkMutedState();
      });
    });

    currentHls.on(Hls.Events.ERROR, (event, data) => {
      if (data.fatal) {
        console.warn('[hls] Erro fatal:', data.type, data.details);
        playerInitializing = false;

        if (!useDirect) {
          // Try direct URL
          destroyPlayer();
          initHlsPlayer(true);
        } else if (streams.bestFlv && window.mpegts && mpegts.isSupported()) {
          // Fallback to FLV
          destroyPlayer();
          engineSelect.value = 'flv';
          currentEngine = 'flv';
          initFlvPlayer();
        } else {
          showOverlay(true, 'Falha no stream HLS. Tente FLV no menu de protocolo.', true);
        }
      }
    });
  } else if (videoElement.canPlayType('application/vnd.apple.mpegurl')) {
    // Native iOS Safari HLS
    videoElement.src = streams.hlsMaster;
    videoElement.muted = true;
    updateSoundButton();
    videoElement.play().then(() => {
      showOverlay(false);
      playerInitializing = false;
      checkMutedState();
    }).catch(() => {
      showOverlay(false);
      playerInitializing = false;
      checkMutedState();
    });
  } else {
    playerInitializing = false;
    showOverlay(true, 'Este navegador não suporta streaming de vídeo.', true);
  }
}

function destroyPlayer() {
  clearTimeout(playAttemptTimeout);
  clearTimeout(bufferWarningTimeout);
  playerInitializing = false;

  if (currentHls) {
    try { currentHls.destroy(); } catch {}
    currentHls = null;
  }

  if (currentFlvPlayer) {
    try { currentFlvPlayer.destroy(); } catch {}
    currentFlvPlayer = null;
  }

  videoElement.pause();
  videoElement.removeAttribute('src');
  videoElement.load();
  hideUnmuteOverlay();
}

// ── Chat via SSE ───────────────────────────────────────────────────────────
function connectChat(username, roomId) {
  disconnectChat();

  chatConnectAttempt++;
  const thisAttempt = chatConnectAttempt;

  chatStatus.textContent = 'Conectando ao chat...';
  chatMessages.innerHTML = '';
  addSystemNotice('🔄 Conectando ao chat ao vivo...');

  const apiBase = getApiBase();
  const roomParam = roomId ? `&roomId=${encodeURIComponent(roomId)}` : '';
  const url = `${apiBase}/api/live/chat?user=${encodeURIComponent(username)}${roomParam}`;

  chatEventSource = new EventSource(url);

  chatEventSource.onopen = () => {
    if (thisAttempt !== chatConnectAttempt) return;
    chatStatus.textContent = 'Conectado';
    console.log('[chat] SSE aberto');
  };

  chatEventSource.onmessage = (event) => {
    if (thisAttempt !== chatConnectAttempt) return;
    try {
      const data = JSON.parse(event.data);
      handleChatMessage(data);
    } catch (e) {
      console.error('[chat] Parse error:', e);
    }
  };

  chatEventSource.onerror = (e) => {
    if (thisAttempt !== chatConnectAttempt) return;
    console.warn('[chat] SSE erro, reconectando em 5s...');
    chatStatus.textContent = 'Reconectando chat...';

    // Auto-reconnect after delay
    clearTimeout(chatReconnectTimer);
    chatReconnectTimer = setTimeout(() => {
      if (currentStreamData?.isLive && thisAttempt === chatConnectAttempt) {
        console.log('[chat] Tentando reconectar...');
        connectChat(username, roomId);
      }
    }, 5000);
  };
}

function disconnectChat() {
  chatConnectAttempt++;
  clearTimeout(chatReconnectTimer);
  if (chatEventSource) {
    try { chatEventSource.close(); } catch {}
    chatEventSource = null;
  }
  chatStatus.textContent = 'Desconectado';
}

function handleChatMessage(data) {
  switch (data.type) {
    case 'status':
      chatStatus.textContent = data.message;
      break;
    case 'connected':
      chatStatus.textContent = '💬 Ao vivo';
      addSystemNotice(data.message);
      break;
    case 'chat':
      appendChatComment(data);
      break;
    case 'gift':
      appendGiftNotice(data);
      break;
    case 'like':
      likesTicker.textContent = `❤️ ${formatNumber(data.totalLikes || data.likeCount || 0)}`;
      statLikes.textContent = `❤️ ${formatNumber(data.totalLikes || data.likeCount || 0)}`;
      break;
    case 'viewers':
      viewerCountEl.textContent = formatNumber(data.viewerCount);
      statViewers.textContent = `👁️ ${formatNumber(data.viewerCount)}`;
      break;
    case 'streamEnd':
      addSystemNotice('⚠️ A live foi encerrada.');
      badgeLive.className = 'live-pill offline';
      liveStatusText.textContent = 'ENCERRADA';
      break;
    case 'chatError':
      chatStatus.textContent = '⚠️ Chat: ' + (data.message || 'erro');
      addSystemNotice(`ℹ️ ${data.message}`);
      break;
    case 'disconnected':
      chatStatus.textContent = 'Chat desconectado';
      break;
  }
}

function appendChatComment(msg) {
  if (!msg.comment && !msg.user) return;

  const item = document.createElement('div');
  item.className = 'chat-item';

  const avatar = msg.avatar || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>';

  let badgesHtml = '';
  if (msg.isModerator) badgesHtml += '<span class="chat-badge mod">MOD</span>';
  if (msg.isSubscriber) badgesHtml += '<span class="chat-badge sub">SUB</span>';

  item.innerHTML = `
    <img src="${escapeHtml(avatar)}" alt="" class="chat-avatar" onerror="this.style.opacity='0.3'" />
    <div class="chat-body">
      <span class="chat-meta">
        ${badgesHtml}
        <span class="chat-author">${escapeHtml(msg.nickname || msg.user)}</span>
      </span>
      <span class="chat-text">${escapeHtml(msg.comment)}</span>
    </div>
  `;

  chatMessages.appendChild(item);
  if (chatAutoScroll.checked) chatMessages.scrollTop = chatMessages.scrollHeight;
  if (chatMessages.children.length > 200) chatMessages.removeChild(chatMessages.children[0]);
}

function appendGiftNotice(gift) {
  const item = document.createElement('div');
  item.className = 'chat-event-gift';

  const giftImg = gift.giftPictureUrl
    ? `<img src="${escapeHtml(gift.giftPictureUrl)}" class="chat-gift-img" alt="" />`
    : '';

  item.innerHTML = `
    ${giftImg}
    <div class="chat-event-text">
      <strong>${escapeHtml(gift.nickname || gift.user)}</strong> enviou
      <strong>${escapeHtml(gift.giftName)}</strong> x${gift.repeatCount}!
    </div>
  `;

  chatMessages.appendChild(item);
  if (chatAutoScroll.checked) chatMessages.scrollTop = chatMessages.scrollHeight;
}

function addSystemNotice(text) {
  const item = document.createElement('div');
  item.style.cssText = 'padding:3px 6px;font-size:0.72rem;color:#7d809a;text-align:center;';
  item.textContent = text;
  chatMessages.appendChild(item);
  if (chatAutoScroll.checked) chatMessages.scrollTop = chatMessages.scrollHeight;
}

function clearChat() {
  chatMessages.innerHTML = '';
}

// ── Offline Card ───────────────────────────────────────────────────────────
function showOfflineCard(username, title) {
  if (offlineTitle) offlineTitle.textContent = `@${username} está OFFLINE`;
  if (offlineMessage) offlineMessage.textContent = title
    ? `Última live: "${title}"`
    : 'Canal offline no momento.';
  if (offlineCard) offlineCard.classList.remove('hidden');
}

function hideOfflineCard() {
  if (offlineCard) offlineCard.classList.add('hidden');
}

function checkMutedState() {
  if (videoElement.muted) {
    if (btnUnmuteOverlay) btnUnmuteOverlay.classList.remove('hidden');
  } else {
    hideUnmuteOverlay();
  }
}

function hideUnmuteOverlay() {
  if (btnUnmuteOverlay) btnUnmuteOverlay.classList.add('hidden');
}

// ── Quality / Engine ───────────────────────────────────────────────────────
function onEngineChange() {
  currentEngine = engineSelect.value;
  initPlayer();
}

function onQualityChange() {
  const selected = qualitySelect.value;
  if (selected.startsWith('flv_')) {
    engineSelect.value = 'flv';
    currentEngine = 'flv';
    destroyPlayer();
    playerInitializing = true;
    initFlvPlayer(selected.replace('flv_', ''));
  } else {
    engineSelect.value = 'hls';
    currentEngine = 'hls';
    destroyPlayer();
    playerInitializing = true;
    initHlsPlayer(false);
  }
}

function populateQualitySelector(qualities) {
  qualitySelect.innerHTML = '';
  if (!qualities || qualities.length === 0) {
    qualitySelect.innerHTML = '<option value="auto">Auto</option>';
    return;
  }
  qualities.forEach(q => {
    const opt = document.createElement('option');
    opt.value = q.format === 'flv' ? `flv_${q.quality}` : 'auto';
    opt.textContent = q.label;
    qualitySelect.appendChild(opt);
  });
}

// ── Mobile UI ──────────────────────────────────────────────────────────────
function toggleViewMode() {
  isAppMode = !isAppMode;
  bodyEl.className = isAppMode ? 'mobile-layout-app' : 'mobile-layout-split';
  showToast(isAppMode ? 'Modo TikTok App' : 'Modo Dividido');
}

function toggleChatVisibility() {
  isChatHidden = !isChatHidden;
  bodyEl.classList.toggle('chat-hidden', isChatHidden);
  btnFloatChat.style.opacity = isChatHidden ? '0.5' : '1';
  showToast(isChatHidden ? 'Chat ocultado' : 'Chat visível');
}

function toggleMute() {
  videoElement.muted = !videoElement.muted;
  updateSoundButton();
  showToast(videoElement.muted ? 'Áudio desativado' : 'Áudio ativado');
}

function updateSoundButton() {
  btnFloatSound.textContent = videoElement.muted ? '🔇' : '🔊';
}

function toggleVideoFit() {
  const currentFit = videoElement.style.objectFit || 'contain';
  videoElement.style.objectFit = currentFit === 'contain' ? 'cover' : 'contain';
  showToast(currentFit === 'contain' ? 'Tela cheia' : 'Ajustar à tela');
}

function setupDoubleTap(element) {
  let lastTap = 0;
  element.addEventListener('touchend', (e) => {
    const now = Date.now();
    if (now - lastTap < 350 && now - lastTap > 0) {
      const touch = e.changedTouches[0];
      if (touch) triggerFloatingHeart(touch.clientX, touch.clientY);
      e.preventDefault();
    }
    lastTap = now;
  });
}

function triggerFloatingHeart(x, y) {
  const heart = document.createElement('div');
  heart.className = 'floating-heart';
  heart.textContent = ['❤️', '💖', '🔥', '✨', '💜'][Math.floor(Math.random() * 5)];
  heart.style.left = `${x - 14}px`;
  heart.style.top = `${y - 20}px`;
  heartsContainer.appendChild(heart);
  setTimeout(() => heart.remove(), 1400);
}

function toggleAspectRatio() {
  isVerticalRatio = !isVerticalRatio;
  playerContainer.classList.toggle('ratio-9-16', isVerticalRatio);
  playerContainer.classList.toggle('ratio-16-9', !isVerticalRatio);
  showToast(isVerticalRatio ? 'Proporção: Vertical (9:16)' : 'Proporção: Horizontal (16:9)');
}

function toggleTheaterMode() {
  isTheaterMode = !isTheaterMode;
  playerContainer.classList.toggle('theater-mode', isTheaterMode);
  showToast(isTheaterMode ? 'Modo Cinema' : 'Modo Padrão');
}

// ── Settings ───────────────────────────────────────────────────────────────
function openSettings() {
  backendUrlInput.value = localStorage.getItem(BACKEND_STORAGE_KEY) || '';
  settingsModal.classList.remove('hidden');
}

function closeSettings() {
  settingsModal.classList.add('hidden');
}

function saveBackendUrl() {
  const val = backendUrlInput.value.trim();
  if (val) {
    localStorage.setItem(BACKEND_STORAGE_KEY, val);
    showToast('Servidor salvo: ' + val);
  } else {
    localStorage.removeItem(BACKEND_STORAGE_KEY);
    showToast('Usando servidor padrão');
  }
  closeSettings();
}

function resetBackendUrl() {
  localStorage.removeItem(BACKEND_STORAGE_KEY);
  backendUrlInput.value = '';
  showToast('Restaurado para padrão');
  closeSettings();
}

// ── Helpers ────────────────────────────────────────────────────────────────
async function openInVlc() {
  if (!currentStreamData?.streams) {
    showToast('Nenhuma live carregada.');
    return;
  }
  const streamUrl = currentStreamData.streams.bestFlv || currentStreamData.streams.hlsMaster;
  const apiBase = getApiBase();
  showToast('Tentando abrir no VLC...');
  try {
    const res = await fetch(`${apiBase}/api/open-player`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ streamUrl })
    });
    const json = await res.json();
    showToast(json.message || json.error);
  } catch (err) {
    showToast('Erro: ' + err.message);
  }
}

function copyStreamUrl(type) {
  if (!currentStreamData?.streams) {
    showToast('Nenhuma live carregada.');
    return;
  }
  const url = type === 'm3u8'
    ? currentStreamData.streams.hlsMaster
    : currentStreamData.streams.bestFlv;
  if (!url) {
    showToast(`Nenhum link ${type.toUpperCase()} disponível.`);
    return;
  }
  navigator.clipboard.writeText(url).then(() => {
    showToast(`Link ${type.toUpperCase()} copiado!`);
  }).catch(() => {
    prompt(`Copie o link ${type.toUpperCase()}:`, url);
  });
}

function getSavedChannels() {
  try {
    const raw = localStorage.getItem(CHANNELS_KEY);
    return raw ? JSON.parse(raw) : ['loud_coringa', 'nobru', 'cerol'];
  } catch {
    return [];
  }
}

function setSavedChannels(channels) {
  try { localStorage.setItem(CHANNELS_KEY, JSON.stringify(channels)); } catch {}
}

function addRecentChannel(username) {
  const clean = username.toLowerCase().trim();
  const current = getSavedChannels().filter(u => u.toLowerCase() !== clean);
  current.unshift(clean);
  if (current.length > 8) current.pop();
  setSavedChannels(current);
  renderSavedChannels();
}

function saveCurrentChannel() {
  if (!currentStreamData?.username) return;
  addRecentChannel(currentStreamData.username);
  showToast(`Canal @${currentStreamData.username} salvo!`);
}

function renderSavedChannels() {
  const channels = getSavedChannels();
  quickChannelsContainer.innerHTML = '';
  channels.forEach(ch => {
    const chip = document.createElement('div');
    chip.className = 'quick-chip';
    chip.innerHTML = `<span>@${escapeHtml(ch)}</span><span class="chip-del">&times;</span>`;
    chip.querySelector('span:first-child').addEventListener('click', () => {
      usernameInput.value = ch;
      loadStreamer(ch);
    });
    chip.querySelector('.chip-del').addEventListener('click', (e) => {
      e.stopPropagation();
      setSavedChannels(getSavedChannels().filter(c => c !== ch));
      renderSavedChannels();
    });
    quickChannelsContainer.appendChild(chip);
  });
}

function showOverlay(show, message = '', showRetry = false) {
  if (show) {
    overlayText.textContent = message;
    playerOverlay.classList.remove('hidden');
    overlaySpinner.style.display = showRetry ? 'none' : 'block';
    btnRetry.classList.toggle('hidden', !showRetry);
  } else {
    playerOverlay.classList.add('hidden');
  }
}

let toastTimeout = null;
function showToast(message) {
  if (toastTimeout) clearTimeout(toastTimeout);
  toastEl.textContent = message;
  toastEl.classList.remove('hidden');
  toastTimeout = setTimeout(() => toastEl.classList.add('hidden'), 3200);
}

function formatNumber(num) {
  if (!num) return '0';
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + 'M';
  if (num >= 1_000) return (num / 1_000).toFixed(1) + 'k';
  return num.toString();
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
