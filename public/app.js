(function () {
  'use strict';

  // === Self-reload if server has been updated since this script was loaded ===
  // Prevents the "I clicked but nothing happens" failure mode where the user's
  // browser has a stale app.js that no longer matches the server logic.
  fetch('/api/version', { cache: 'no-store' })
    .then((r) => r.json())
    .then((d) => {
      const scriptUrl = document.currentScript ? document.currentScript.src : '';
      const m = scriptUrl.match(/[?&]v=(\d+)/);
      const loadedVersion = m ? Number(m[1]) : 0;
      if (loadedVersion !== Number(d.version)) {
        // hard reload bypassing cache
        const u = new URL(location.href);
        u.searchParams.set('v', d.version);
        location.replace(u.toString());
      }
    })
    .catch(() => { /* ignore — offline or dev */ });

  const $ = (id) => document.getElementById(id);
  const els = {
    connectionStatus: $('connection-status'),
    roleBadge: $('role-badge'),
    roleBanner: $('role-banner'),
    roleBannerText: $('role-banner-text'),
    nowPlayingTitle: $('now-playing-title'),
    nowPlayingStatus: $('now-playing-status'),
    hostControls: $('host-controls'),
    hostStatus: $('host-status'),
    hostLoginForm: $('host-login-form'),
    hostPassword: $('host-password'),
    hostActions: $('host-actions'),
    btnSkip: $('btn-skip'),
    btnClear: $('btn-clear'),
    playerContainer: $('player-container'),
    addForm: $('add-form'),
    youtubeUrl: $('youtube-url'),
    addError: $('add-error'),
    queueList: $('queue-list'),
    queueCount: $('queue-count'),
  };

  const state = {
    hostToken: null,
    isHost: false,
    queue: [],
    current: null,
    ytPlayer: null,
    ytReady: false,
  };

  // === YouTube IFrame Player ===
  window.onYouTubeIframeAPIReady = function () {
    state.ytReady = true;
    // don't construct the player here — wait for first song so YT gets a real videoId
    if (state.isHost && state.current && state.current.videoId) {
      ensureHostPlayer(state.current.videoId);
    }
  };

  function ensureHostPlayer(videoId) {
    if (!state.ytReady || !state.isHost) return;
    if (!state.ytPlayer) {
      state.ytPlayer = new YT.Player('player-container', {
        height: '1',
        width: '1',
        videoId,
        playerVars: {
          autoplay: 1,
          controls: 0,
          disablekb: 1,
          fs: 0,
          modestbranding: 1,
          playsinline: 1,
          origin: window.location.origin,
        },
        events: {
          onReady: () => {
            state.ytPlayer.playVideo();
          },
          onStateChange: (e) => {
            if (e.data === YT.PlayerState.ENDED) {
              socket.emit('player:ended');
            }
          },
        },
      });
      return;
    }
    // player exists; load new video if different
    const url = state.ytPlayer.getVideoUrl();
    if (!url || !url.includes(videoId)) {
      state.ytPlayer.loadVideoById(videoId);
      state.ytPlayer.playVideo();
    }
  }

  // === Socket.IO ===
  const socket = io();

  // initial badge render so role is visible immediately
  renderRole(false);

  socket.on('connect', () => {
    els.connectionStatus.textContent = 'Connected';
    els.connectionStatus.className = 'status connected';
  });

  socket.on('disconnect', () => {
    els.connectionStatus.textContent = 'Disconnected';
    els.connectionStatus.className = 'status disconnected';
  });

  socket.on('state:sync', (snapshot) => {
    applySnapshot(snapshot);
  });

  socket.on('queue:update', ({ queue }) => {
    state.queue = queue;
    renderQueue();
  });

  socket.on('player:state', (current) => {
    state.current = current;
    renderNowPlaying();
    if (!state.isHost) return;
    if (current && current.videoId) {
      ensureHostPlayer(current.videoId);
    } else if (state.ytPlayer && state.ytPlayer.stopVideo) {
      // no current — stop the host player
      state.ytPlayer.stopVideo();
    }
  });

  socket.on('host:status', ({ connected }) => {
    if (!connected) {
      els.nowPlayingStatus.textContent = 'Host offline';
    }
  });

  socket.on('error', ({ event, error }) => {
    if (event === 'queue:add') {
      els.addError.textContent = error || 'Failed to add';
      setTimeout(() => { els.addError.textContent = ''; }, 3000);
    }
  });

  // === Rendering ===
  function applySnapshot(snapshot) {
    state.queue = snapshot.queue || [];
    state.current = snapshot.current;
    document.body.classList.toggle('is-host', state.isHost);
    renderRole(snapshot.hostConnected);
    renderQueue();
    renderNowPlaying();
    // sync host player if reconnecting with a song already in progress
    if (state.isHost && state.current && state.current.videoId) {
      ensureHostPlayer(state.current.videoId);
    } else if (state.isHost && state.ytPlayer && state.ytPlayer.stopVideo) {
      state.ytPlayer.stopVideo();
    }
  }

  function renderRole(serverHostConnected) {
    // === header badge ===
    els.roleBadge.classList.remove('role-host', 'role-listener');
    if (state.isHost) {
      els.roleBadge.classList.add('role-host');
      els.roleBadge.textContent = '🎵 HOST';
    } else {
      els.roleBadge.classList.add('role-listener');
      els.roleBadge.textContent = 'Listener';
    }

    // === role banner ===
    els.roleBanner.classList.remove('role-listener', 'role-host', 'role-other-host');
    if (state.isHost) {
      els.roleBanner.classList.add('role-host');
      els.roleBannerText.textContent = '🎵 You are the HOST. Audio plays from this tab — keep it open.';
      els.roleBanner.classList.remove('hidden');
    } else if (serverHostConnected) {
      els.roleBanner.classList.add('role-other-host');
      els.roleBannerText.textContent = '🔵 Another host is playing audio. You can only listen & add songs.';
      els.roleBanner.classList.remove('hidden');
    } else {
      els.roleBanner.classList.add('role-listener');
      els.roleBannerText.textContent = '👤 You are a listener. Log in as host below to control playback.';
      els.roleBanner.classList.remove('hidden');
    }

    // === host card ===
    if (state.isHost) {
      els.hostLoginForm.classList.add('hidden');
      els.hostActions.classList.remove('hidden');
      els.hostStatus.textContent = 'Authenticated';
    } else {
      els.hostActions.classList.add('hidden');
      if (serverHostConnected) {
        els.hostLoginForm.classList.add('hidden');
        els.hostStatus.textContent = 'Another host is already playing';
      } else {
        els.hostLoginForm.classList.remove('hidden');
        els.hostStatus.textContent = 'Not authenticated';
      }
    }
  }

  function renderNowPlaying() {
    if (!state.current) {
      els.nowPlayingTitle.textContent = '—';
      els.nowPlayingStatus.textContent = '';
      return;
    }
    els.nowPlayingTitle.textContent = state.current.title || state.current.videoId;
    const elapsed = Math.max(0, Math.floor((Date.now() - state.current.startedAt) / 1000));
    const m = Math.floor(elapsed / 60);
    const s = elapsed % 60;
    els.nowPlayingStatus.textContent = `Started ${m}:${String(s).padStart(2, '0')} ago`;
  }

  // re-render "x ago" every second
  setInterval(() => { if (state.current) renderNowPlaying(); }, 1000);

  function renderQueue() {
    els.queueCount.textContent = state.queue.length;
    els.queueList.innerHTML = '';
    state.queue.forEach((item) => {
      const li = document.createElement('li');
      const titleSpan = document.createElement('span');
      titleSpan.className = 'queue-title';
      titleSpan.textContent = item.title || item.videoId;
      li.appendChild(titleSpan);

      if (state.isHost) {
        const btn = document.createElement('button');
        btn.className = 'queue-remove host-only';
        btn.textContent = 'Remove';
        btn.addEventListener('click', (e) => {
          flash(e.currentTarget);
          socket.emit('queue:remove', { id: item.id });
        });
        li.appendChild(btn);
      }
      els.queueList.appendChild(li);
    });
  }

  // === User actions ===
  els.addForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const url = els.youtubeUrl.value.trim();
    if (!url) return;
    socket.emit('queue:add', { youtubeUrl: url });
    els.youtubeUrl.value = '';
    els.addError.textContent = '';
  });

  // === Host actions ===
  els.hostLoginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = els.hostPassword.value;
    const res = await fetch('/api/host/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (!res.ok) {
      els.hostStatus.textContent = 'Wrong password';
      console.warn('[host] login failed');
      return;
    }
    const { token } = await res.json();
    state.hostToken = token;
    state.isHost = true;
    els.hostPassword.value = '';
    document.body.classList.add('is-host');
    renderRole(true);
    renderQueue();
    // reconnect socket with token
    socket.disconnect();
    socket.io.opts.auth = { token };
    socket.connect();
    console.info('[host] logged in, socket reconnecting with token');
    // player will be initialized when state:sync arrives with a current song
    if (state.ytReady && state.current && state.current.videoId) {
      ensureHostPlayer(state.current.videoId);
    }
  });

  els.btnSkip.addEventListener('click', (e) => {
    if (!state.isHost) return;
    flash(e.currentTarget);
    socket.emit('player:skip');
  });

  els.btnClear.addEventListener('click', (e) => {
    if (!state.isHost) return;
    if (!confirm('Clear entire queue?')) return;
    flash(e.currentTarget);
    socket.emit('queue:clear');
  });

  function flash(btn) {
    btn.classList.add('clicked');
    setTimeout(() => btn.classList.remove('clicked'), 200);
  }
})();