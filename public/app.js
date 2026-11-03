/**
 * TikTok Live Stream Viewer - Mobile-Optimized Client Application
 */

// Global State
let currentStreamData = null;
let currentHls = null;
let currentFlvPlayer = null;
let chatEventSource = null;
let isTheaterMode = false;
let isVerticalRatio = true;
let isAppMode = false;
let isChatHidden = false;

// Custom Backend Storage Key (allows 100% free hosting using local PC or free tunnel)
const BACKEND_STORAGE_KEY = 'tiktok_live_viewer_backend_url';

function getApiBaseUrl() {
  const custom = localStorage.getItem(BACKEND_STORAGE_KEY);
  if (custom && custom.trim()) {
    return custom.trim().replace(/\/+$/, '');
  }
  return '';
}

// DOM Elements
const bodyEl = document.body;
const searchForm = document.getElementById('search-form');
const usernameInput = document.getElementById('username-input');
const btnSubmit = document.getElementById('btn-submit');
const quickChannelsContainer = document.getElementById('quick-channels');

const btnToggleViewMode = document.getElementById('btn-toggle-viewmode');
const viewModeIcon = document.getElementById('viewModeIcon');
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

// ========================================================
// Initialization
// ========================================================
document.addEventListener('DOMContentLoaded', () => {
  renderSavedChannels();

  // Auto-detect mobile screen on initial load
  if (window.innerWidth <= 768) {
    // Start in Split mode, user can toggle to TikTok App mode with 1 tap
    bodyEl.className = 'mobile-layout-split';
  }

  searchForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const user = usernameInput.value.trim();
    if (user) loadStreamer(user);
  });

  // Mobile View Mode Toggle
  btnToggleViewMode.addEventListener('click', toggleViewMode);

  // Settings Modal
  btnSettings.addEventListener('click', openSettings);
  btnCloseSettings.addEventListener('click', closeSettings);
  btnSaveBackend.addEventListener('click', saveBackendUrl);
  btnResetBackend.addEventListener('click', resetBackendUrl);

  // Floating Actions
  btnFloatChat.addEventListener('click', toggleChatVisibility);
  btnFloatSound.addEventListener('click', toggleMute);
  btnFloatRatio.addEventListener('click', toggleVideoFit);
  btnFloatLikes.addEventListener('click', (e) => {
    triggerFloatingHeart(e.clientX || window.innerWidth - 60, e.clientY || window.innerHeight - 100);
  });

  // Double Tap on Video for Hearts
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
        showToast('Verificando status de @' + currentStreamData.username + '...');
        loadStreamer(currentStreamData.username);
      }
    });
  }

  // Monitor video playback events to reliably clear loading overlay
  videoElement.addEventListener('playing', () => {
    clearTimeout(playAttemptTimeout);
    showOverlay(false);
    checkMutedState();
  });

  videoElement.addEventListener('loadeddata', () => {
    clearTimeout(playAttemptTimeout);
    showOverlay(false);
  });

  videoElement.addEventListener('waiting', () => {
    // If buffering persists for > 5s, warn user
    clearTimeout(bufferWarningTimeout);
    bufferWarningTimeout = setTimeout(() => {
      if (!videoElement.paused && videoElement.readyState < 3) {
        showToast('Conexão oscilando... tentando estabilizar');
      }
    }, 5000);
  });

  btnCopyM3u8.addEventListener('click', () => copyStreamUrl('m3u8'));
  btnCopyFlv.addEventListener('click', () => copyStreamUrl('flv'));
  btnSaveChannel.addEventListener('click', saveCurrentChannel);
  btnClearChat.addEventListener('click', clearChat);

  btnRetry.addEventListener('click', () => {
    if (currentStreamData?.username) {
      loadStreamer(currentStreamData.username);
    }
  });

  // Check URL query parameters
  const params = new URLSearchParams(window.location.search);
  const initialUser = params.get('user');
  if (initialUser) {
    usernameInput.value = initialUser;
    loadStreamer(initialUser);
  }
});

let playAttemptTimeout = null;
let bufferWarningTimeout = null;

// ========================================================
// Stream Loading & API Call
// ========================================================
async function loadStreamer(username) {
  hideOfflineCard();
  hideUnmuteOverlay();
  showOverlay(true, 'Consultando status da live de @' + username + '...');
  btnSubmit.disabled = true;

  destroyPlayer();
  disconnectChat();

  const apiBase = getApiBaseUrl();

  try {
    const res = await fetch(`${apiBase}/api/live/info?user=${encodeURIComponent(username)}`);
    const json = await res.json();

    if (!json.success || !json.data) {
      throw new Error(json.error || 'Não foi possível carregar a live.');
    }

    currentStreamData = json.data;
    updateUI(currentStreamData);

    addRecentChannel(currentStreamData.username);
    connectChat(currentStreamData.username);

    if (currentStreamData.isLive) {
      hideOfflineCard();
      populateQualitySelector(currentStreamData.streams.qualities);
      initPlayer();
    } else {
      showOfflineCard(currentStreamData.username, currentStreamData.title);
      showOverlay(false);
    }
  } catch (err) {
    console.error('Erro:', err);
    showOverlay(true, 'Erro ao carregar a live: ' + err.message, true);
    showToast('Erro: ' + err.message);
  } finally {
    btnSubmit.disabled = false;
  }
}

// ========================================================
// UI Updates
// ========================================================
function updateUI(data) {
  const displayName = data.owner.nickname || `@${data.username}`;
  streamerName.textContent = displayName;
  streamTitle.textContent = data.title || 'Live sem título';

  floatingName.textContent = displayName;
  floatingTitle.textContent = data.title || 'Ao vivo';

  if (data.owner.avatar) {
    streamerAvatar.src = data.owner.avatar;
    floatingAvatar.src = data.owner.avatar;
  }

  streamerLink.href = `https://www.tiktok.com/@${data.username}/live`;
  streamerLink.classList.remove('hidden');

  statViewers.textContent = `👁️ ${formatNumber(data.stats.viewerCount)}`;
  statRoom.textContent = `🆔 ${data.roomId || '-'}`;

  if (data.isLive) {
    badgeLive.className = 'live-pill online';
    liveStatusText.textContent = 'AO VIVO';
    badgeViewers.classList.remove('hidden');
    viewerCountEl.textContent = formatNumber(data.stats.viewerCount);
  } else {
    badgeLive.className = 'live-pill offline';
    liveStatusText.textContent = 'OFFLINE';
    badgeViewers.classList.add('hidden');
  }

  document.title = `${data.isLive ? '🔴 AO VIVO - ' : ''}@${data.username} | TikTok Live`;
}

// ========================================================
// Video Player (Direct CDN + Proxy Fallback / HLS + FLV)
// ========================================================
function initPlayer() {
  if (!currentStreamData || !currentStreamData.streams) return;
  if (!currentStreamData.isLive) return;

  destroyPlayer();
  showOverlay(true, 'Conectando ao stream ao vivo...');

  const quality = qualitySelect.value;
  const isSafariOrIOS = /^((?!chrome|android).)*safari/i.test(navigator.userAgent) || (/iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream);

  // Auto-detect optimal protocol for the platform if user hasn't explicitly chosen
  if (!engineSelect.dataset.userChanged) {
    engineSelect.value = isSafariOrIOS ? 'hls' : 'flv';
  }

  let preferredEngine = engineSelect.value;

  // Timeout guard: if nothing plays in 6s, attempt fallback protocol
  clearTimeout(playAttemptTimeout);
  playAttemptTimeout = setTimeout(() => {
    if (videoElement.paused || videoElement.readyState < 2) {
      console.warn('Playback timeout on', preferredEngine, 'attempting auto-recovery...');
      showToast('Ajustando formato para acelerar reprodução...');
      if (preferredEngine === 'flv' && (Hls.isSupported() || isSafariOrIOS)) {
        engineSelect.value = 'hls';
        initHlsPlayer(true);
      } else if (preferredEngine === 'hls' && mpegts.isSupported()) {
        engineSelect.value = 'flv';
        initFlvPlayer(null, true);
      } else {
        showOverlay(true, 'O servidor do TikTok está instável. Tente clicar em Tentar Novamente ou mudar o protocolo.', true);
      }
    }
  }, 6000);

  if (preferredEngine === 'flv') {
    initFlvPlayer(quality);
  } else {
    initHlsPlayer();
  }
}

function initFlvPlayer(selectedQuality = null, useProxy = false) {
  let targetFlvUrl = '';

  if (selectedQuality && currentStreamData.streams.flvMap[selectedQuality]) {
    targetFlvUrl = currentStreamData.streams.flvMap[selectedQuality];
  } else {
    targetFlvUrl = currentStreamData.streams.bestFlv;
  }

  if (!targetFlvUrl) {
    if (currentStreamData.streams.hlsMaster) {
      engineSelect.value = 'hls';
      initHlsPlayer(true);
      return;
    }
    showOverlay(true, 'Nenhum stream FLV disponível no momento.', true);
    return;
  }

  const apiBase = getApiBaseUrl();
  const proxyFlvUrl = `${apiBase}/api/proxy/stream?url=${encodeURIComponent(targetFlvUrl)}`;
  // Try direct TikTok CDN first for maximum speed and zero server lag; fallback to proxy if needed
  const playUrl = useProxy ? proxyFlvUrl : targetFlvUrl;

  if (window.mpegts && mpegts.isSupported()) {
    try {
      currentFlvPlayer = mpegts.createPlayer({
        type: 'flv',
        isLive: true,
        url: playUrl,
        hasAudio: true,
        hasVideo: true,
        cors: true
      }, {
        enableWorker: true,
        lazyLoad: false,
        enableStashBuffer: false,
        stashInitialSize: 64,
        liveBufferLatencyChasing: true,
        autoCleanupSourceBuffer: true
      });

      currentFlvPlayer.attachMediaElement(videoElement);
      currentFlvPlayer.load();

      // Mobile autoplay requirement: start muted
      videoElement.muted = true;
      updateSoundButton();

      currentFlvPlayer.on(mpegts.Events.ERROR, (errType, errDetail) => {
        console.warn('mpegts error:', errType, errDetail);
        if (!useProxy) {
          console.log('Retrying FLV via proxy...');
          destroyPlayer();
          initFlvPlayer(selectedQuality, true);
        } else if (currentStreamData.streams.hlsMaster) {
          console.log('Falling back to HLS...');
          destroyPlayer();
          engineSelect.value = 'hls';
          initHlsPlayer(true);
        }
      });

      currentFlvPlayer.play().then(() => {
        showOverlay(false);
        checkMutedState();
      }).catch((e) => {
        console.log('Autoplay muted play handled:', e);
        showOverlay(false);
        checkMutedState();
      });
    } catch (e) {
      console.error('Erro ao instanciar mpegts:', e);
      if (currentStreamData.streams.hlsMaster) {
        initHlsPlayer(true);
      }
    }
  } else {
    // Platform does not support MSE FLV (e.g. iOS Safari) -> auto use HLS
    engineSelect.value = 'hls';
    initHlsPlayer(true);
  }
}

function initHlsPlayer(useDirect = false) {
  const masterHls = currentStreamData.streams.hlsMaster;
  if (!masterHls) {
    if (currentStreamData.streams.bestFlv && mpegts.isSupported()) {
      engineSelect.value = 'flv';
      initFlvPlayer(null, true);
      return;
    }
    showOverlay(true, 'Nenhum link HLS disponível.', true);
    return;
  }

  const apiBase = getApiBaseUrl();
  const proxyM3u8Url = `${apiBase}/api/proxy/m3u8?url=${encodeURIComponent(masterHls)}`;
  const playUrl = useDirect ? masterHls : proxyM3u8Url;

  const isSafariOrIOS = /^((?!chrome|android).)*safari/i.test(navigator.userAgent) || (/iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream);

  if (window.Hls && Hls.isSupported()) {
    currentHls = new Hls({
      enableWorker: true,
      lowLatencyMode: true,
      backBufferLength: 15,
      maxBufferLength: 8,
      liveSyncDurationCount: 3,
      manifestLoadingMaxRetry: 2,
      levelLoadingMaxRetry: 2
    });

    currentHls.loadSource(playUrl);
    currentHls.attachMedia(videoElement);

    videoElement.muted = true;
    updateSoundButton();

    currentHls.on(Hls.Events.MANIFEST_PARSED, () => {
      videoElement.play().then(() => {
        showOverlay(false);
        checkMutedState();
      }).catch(() => {
        showOverlay(false);
        checkMutedState();
      });
    });

    currentHls.on(Hls.Events.ERROR, (event, data) => {
      if (data.fatal) {
        console.warn('HLS fatal error:', data.type);
        if (!useDirect) {
          destroyPlayer();
          initHlsPlayer(true);
        } else if (currentStreamData.streams.bestFlv && mpegts.isSupported()) {
          destroyPlayer();
          engineSelect.value = 'flv';
          initFlvPlayer(null, true);
        } else {
          destroyPlayer();
          showOverlay(true, 'Não foi possível reproduzir este formato. Tente mudar o protocolo para FLV.', true);
        }
      }
    });
  } else if (videoElement.canPlayType('application/vnd.apple.mpegurl')) {
    // Native iOS Safari
    videoElement.src = masterHls;
    videoElement.muted = true;
    updateSoundButton();
    videoElement.play().then(() => {
      showOverlay(false);
      checkMutedState();
    }).catch(() => {
      showOverlay(false);
      checkMutedState();
    });
  } else {
    engineSelect.value = 'flv';
    initFlvPlayer(null, true);
  }
}

function destroyPlayer() {
  clearTimeout(playAttemptTimeout);
  clearTimeout(bufferWarningTimeout);
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

function showOfflineCard(username, title) {
  if (offlineTitle) offlineTitle.textContent = `@${username} está OFFLINE`;
  if (offlineMessage) offlineMessage.textContent = title ? `Última live gravada: "${title}"` : 'Este perfil não está transmitindo ao vivo no momento.';
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
  videoElement.pause();
  videoElement.removeAttribute('src');
  videoElement.load();
}

function onEngineChange() {
  initPlayer();
}

function onQualityChange() {
  const selected = qualitySelect.value;
  if (selected.startsWith('flv_')) {
    engineSelect.value = 'flv';
    initFlvPlayer(selected.replace('flv_', ''));
  } else {
    engineSelect.value = 'hls';
    initHlsPlayer();
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

// ========================================================
// Real-Time Live Chat via SSE
// ========================================================
function connectChat(username) {
  disconnectChat();

  chatStatus.textContent = 'Conectando ao chat...';
  chatMessages.innerHTML = '';

  const apiBase = getApiBaseUrl();
  chatEventSource = new EventSource(`${apiBase}/api/live/chat?user=${encodeURIComponent(username)}`);

  chatEventSource.onopen = () => {
    chatStatus.textContent = 'Ao vivo no chat';
  };

  chatEventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleChatMessage(data);
    } catch (e) {
      console.error('Erro no chat:', e);
    }
  };

  chatEventSource.onerror = () => {
    chatStatus.textContent = 'Reconectando chat...';
  };
}

function disconnectChat() {
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
      chatStatus.textContent = 'Ao vivo no chat';
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
      addSystemNotice('⚠️ A transmissão ao vivo foi encerrada.');
      badgeLive.className = 'live-pill offline';
      liveStatusText.textContent = 'ENCERRADA';
      break;

    case 'chatError':
      chatStatus.textContent = data.message;
      break;
  }
}

function appendChatComment(msg) {
  const item = document.createElement('div');
  item.className = 'chat-item';

  const avatar = msg.avatar || 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 1 1%22/>';
  
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

  if (chatAutoScroll.checked) {
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  if (chatMessages.children.length > 200) {
    chatMessages.removeChild(chatMessages.children[0]);
  }
}

function appendGiftNotice(gift) {
  const item = document.createElement('div');
  item.className = 'chat-event-gift';

  const giftImg = gift.giftPictureUrl ? `<img src="${escapeHtml(gift.giftPictureUrl)}" class="chat-gift-img" alt="" />` : '';

  item.innerHTML = `
    ${giftImg}
    <div class="chat-event-text">
      <strong>${escapeHtml(gift.nickname || gift.user)}</strong> enviou <strong>${escapeHtml(gift.giftName)}</strong> x${gift.repeatCount}!
    </div>
  `;

  chatMessages.appendChild(item);
  if (chatAutoScroll.checked) {
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }
}

function addSystemNotice(text) {
  const item = document.createElement('div');
  item.style.padding = '3px 6px';
  item.style.fontSize = '0.72rem';
  item.style.color = '#7d809a';
  item.style.textAlign = 'center';
  item.textContent = text;
  chatMessages.appendChild(item);
  if (chatAutoScroll.checked) {
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }
}

function clearChat() {
  chatMessages.innerHTML = '';
}

// ========================================================
// Mobile Modes & Gestures
// ========================================================
function toggleViewMode() {
  isAppMode = !isAppMode;
  if (isAppMode) {
    bodyEl.className = 'mobile-layout-app';
    showToast('Modo TikTok App Ativado');
  } else {
    bodyEl.className = 'mobile-layout-split';
    showToast('Modo Dividido Ativado');
  }
}

function toggleChatVisibility() {
  isChatHidden = !isChatHidden;
  if (isChatHidden) {
    bodyEl.classList.add('chat-hidden');
    btnFloatChat.style.opacity = '0.5';
    showToast('Chat ocultado');
  } else {
    bodyEl.classList.remove('chat-hidden');
    btnFloatChat.style.opacity = '1';
    showToast('Chat visível');
  }
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
  if (currentFit === 'contain') {
    videoElement.style.objectFit = 'cover';
    showToast('Preenchimento: Tela cheia');
  } else {
    videoElement.style.objectFit = 'contain';
    showToast('Preenchimento: Ajustar à tela');
  }
}

function setupDoubleTap(element) {
  let lastTap = 0;
  element.addEventListener('touchend', (e) => {
    const currentTime = new Date().getTime();
    const tapLength = currentTime - lastTap;
    if (tapLength < 350 && tapLength > 0) {
      const touch = e.changedTouches[0];
      if (touch) {
        triggerFloatingHeart(touch.clientX, touch.clientY);
      }
      e.preventDefault();
    }
    lastTap = currentTime;
  });
}

function triggerFloatingHeart(x, y) {
  const heart = document.createElement('div');
  heart.className = 'floating-heart';
  const hearts = ['❤️', '💖', '🔥', '✨', '💜'];
  heart.textContent = hearts[Math.floor(Math.random() * hearts.length)];
  heart.style.left = `${x - 14}px`;
  heart.style.top = `${y - 20}px`;
  heartsContainer.appendChild(heart);

  setTimeout(() => {
    heart.remove();
  }, 1400);
}

function toggleAspectRatio() {
  isVerticalRatio = !isVerticalRatio;
  if (isVerticalRatio) {
    playerContainer.classList.remove('ratio-16-9');
    playerContainer.classList.add('ratio-9-16');
    showToast('Proporção: Vertical (9:16)');
  } else {
    playerContainer.classList.remove('ratio-9-16');
    playerContainer.classList.add('ratio-16-9');
    showToast('Proporção: Horizontal (16:9)');
  }
}

function toggleTheaterMode() {
  isTheaterMode = !isTheaterMode;
  if (isTheaterMode) {
    playerContainer.classList.add('theater-mode');
    showToast('Modo Cinema');
  } else {
    playerContainer.classList.remove('theater-mode');
    showToast('Modo Padrão');
  }
}

// ========================================================
// Settings (Free Backend Hosting Options)
// ========================================================
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
    showToast('Usando servidor padrão (mesmo domínio)');
  }
  closeSettings();
}

function resetBackendUrl() {
  localStorage.removeItem(BACKEND_STORAGE_KEY);
  backendUrlInput.value = '';
  showToast('Restaurado para padrão');
  closeSettings();
}

// ========================================================
// Helpers & Storage
// ========================================================
async function openInVlc() {
  if (!currentStreamData || !currentStreamData.streams) {
    showToast('Nenhuma live carregada.');
    return;
  }
  const streamUrl = currentStreamData.streams.bestFlv || currentStreamData.streams.hlsMaster;
  const apiBase = getApiBaseUrl();

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
  if (!currentStreamData || !currentStreamData.streams) {
    showToast('Nenhuma live carregada.');
    return;
  }
  const url = type === 'm3u8' ? currentStreamData.streams.hlsMaster : currentStreamData.streams.bestFlv;
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

const CHANNELS_STORAGE_KEY = 'tiktok_live_viewer_saved_channels';

function getSavedChannels() {
  try {
    const raw = localStorage.getItem(CHANNELS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : ['loud_coringa', 'nobru', 'cerol'];
  } catch {
    return [];
  }
}

function setSavedChannels(channels) {
  try {
    localStorage.setItem(CHANNELS_STORAGE_KEY, JSON.stringify(channels));
  } catch {}
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
    chip.innerHTML = `
      <span>@${escapeHtml(ch)}</span>
      <span class="chip-del">&times;</span>
    `;
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
  toastTimeout = setTimeout(() => {
    toastEl.classList.add('hidden');
  }, 3200);
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
