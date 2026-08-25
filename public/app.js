(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const els = {
    connectionStatus: $('connection-status'),
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
    initPlayerIfHost();
  };

  function initPlayerIfHost() {
    if (!state.ytReady || !state.isHost || state.ytPlayer) return;
    state.ytPlayer = new YT.Player('player-container', {
      height: '1',
      width: '1',
      playerVars: {
        autoplay: 0,
        controls: 0,
        disablekb: 1,
        fs: 0,
        modestbranding: 1,
      },
      events: {
        onStateChange: (e) => {
          if (e.data === YT.PlayerState.ENDED) {
            socket.emit('player:ended');
          }
        },
      },
    });
  }

  // === Socket.IO ===
  const socket = io();

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
    if (state.isHost && current && state.ytPlayer && state.ytPlayer.loadVideoById) {
      // host sync: if current video differs, load and play
      const url = state.ytPlayer.getVideoUrl();
      if (!url || !url.includes(current.videoId)) {
        state.ytPlayer.loadVideoById(current.videoId);
        state.ytPlayer.playVideo();
      }
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
    renderQueue();
    renderNowPlaying();
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
        btn.addEventListener('click', () => socket.emit('queue:remove', { id: item.id }));
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
      return;
    }
    const { token } = await res.json();
    state.hostToken = token;
    state.isHost = true;
    els.hostStatus.textContent = 'Authenticated';
    els.hostLoginForm.classList.add('hidden');
    els.hostActions.classList.remove('hidden');
    document.body.classList.add('is-host');
    renderQueue();
    // reconnect socket with token
    socket.disconnect();
    socket.io.opts.auth = { token };
    socket.connect();
    initPlayerIfHost();
  });

  els.btnSkip.addEventListener('click', () => {
    if (!state.isHost) return;
    socket.emit('player:skip');
  });

  els.btnClear.addEventListener('click', () => {
    if (!state.isHost) return;
    if (!confirm('Clear entire queue?')) return;
    socket.emit('queue:clear');
  });
})();