(function () {
  'use strict';

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
    ytLoadFailed: false,
    // Track the videoId the YT player is currently loaded with so we only
    // recreate the player on actual song changes (every state:sync would
    // otherwise trigger a destroy+recreate and the new player never finishes
    // loading before the next snapshot arrives).
    lastPlayerVideoId: null,
  };

  // === YouTube IFrame Player ===
  // The YT IFrame API often gets blocked by ad blockers / privacy extensions
  // (uBlock, Brave shields, Pi-hole, corporate firewalls). Detect that case
  // and surface a clear error to the host instead of failing silently.
  window.onYouTubeIframeAPIReady = function () {
    state.ytReady = true;
    state.ytLoadFailed = false;
    if (state.isHost && state.current && state.current.videoId) {
      ensureHostPlayer(state.current.videoId);
    }
  };

  // If the YT iframe_api script is blocked, `onYouTubeIframeAPIReady` never fires.
  // After 5s with no YT global, show a visible error and offer a fallback
  // iframe-based player (limited — no auto-advance, but at least plays audio).
  setTimeout(() => {
    if (state.ytReady || !state.isHost) return;
    state.ytLoadFailed = true;
    showPlayerError();
    console.error('[player] YouTube iframe_api did not load — likely blocked by ad blocker or network policy');
    // fall back to a plain iframe so audio still plays (no auto-advance though)
    if (state.current && state.current.videoId) {
      loadFallbackIframe(state.current.videoId);
    }
  }, 5000);

  function showPlayerError() {
    const el = document.getElementById('player-error');
    if (el) el.classList.remove('hidden');
  }

  function hidePlayerError() {
    const el = document.getElementById('player-error');
    if (el) el.classList.add('hidden');
  }

  function loadFallbackIframe(videoId) {
    const c = els.playerContainer;
    c.innerHTML = '';
    const iframe = document.createElement('iframe');
    iframe.width = '320';
    iframe.height = '180';
    // youtube-nocookie is less often blocked than youtube.com
    iframe.src = `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&controls=1&modestbranding=1&playsinline=1`;
    iframe.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture');
    iframe.setAttribute('frameborder', '0');
    iframe.setAttribute('allowfullscreen', '');
    c.appendChild(iframe);
    state.ytPlayer = null; // no JS control over fallback
  }

  function ensureHostPlayer(videoId) {
    hidePlayerError();
    // if YT API failed to load, use fallback iframe for this song
    if (state.ytLoadFailed && state.isHost) {
      loadFallbackIframe(videoId);
      return;
    }
    if (!state.ytReady || !state.isHost) return;
    forceLoadHostPlayer(videoId);
  }

  // Force-create a fresh YT player for videoId, bypassing the lastPlayerVideoId
  // gate. Used by the player:state handler which only fires on real song
  // changes from the server (skip / ended / auto-play).
  function forceLoadHostPlayer(videoId) {
    console.info('[player] force-load', videoId, '(was:', state.lastPlayerVideoId, ')');
    // Always destroy the existing player and recreate. loadVideoById on the
    // same YT instance keeps the old audio buffer playing for several
    // seconds (YT internal caching). Destroying + clearing the container
    // guarantees the old stream stops before the new one starts.
    if (state.ytPlayer) {
      try {
        state.ytPlayer.destroy();
      } catch (err) {
        console.warn('[player] destroy failed', err);
      }
      state.ytPlayer = null;
      els.playerContainer.innerHTML = '';
    }
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
          // YT loads duration metadata after the video starts buffering.
          // Poll a few times to capture it then notify server.
          captureDuration();
        },
        onError: (e) => {
          console.error('[player] YT error', e);
        },
        onStateChange: (e) => {
          if (e.data === YT.PlayerState.ENDED) {
            socket.emit('player:ended');
          }
          // onStateChange fires when buffering finishes — re-check duration
          if (e.data === YT.PlayerState.PLAYING) {
            captureDuration();
          }
        },
      },
    });
    state.lastPlayerVideoId = videoId;
  }

  // Poll YT for the current video's duration and send it to the server.
  // YT.Player.getDuration() returns 0 until metadata is loaded; we re-check
  // every second for up to ~10s, then stop.
  let _durationAttempts = 0;
  function captureDuration() {
    if (!state.isHost || !state.ytPlayer) return;
    _durationAttempts = 0;
    const tryOnce = () => {
      if (!state.ytPlayer || !state.ytPlayer.getDuration) return;
      const d = state.ytPlayer.getDuration();
      if (d > 0) {
        socket.emit('player:duration', { duration: d });
        return;
      }
      _durationAttempts++;
      if (_durationAttempts < 10) setTimeout(tryOnce, 1000);
    };
    tryOnce();
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
    const newVideoId = current && current.videoId;
    console.info('[player:state]', newVideoId, 'last=', state.lastPlayerVideoId, 'hasPlayer=', !!state.ytPlayer);
    state.current = current;
    renderNowPlaying();
    if (!state.isHost) return;
    if (newVideoId) {
      // Force reload on player:state because server only sends this when
      // the *current* song changed (skip / ended / auto-play). The
      // lastPlayerVideoId gate in ensureHostPlayer would otherwise keep the
      // old audio if our local cache happened to match.
      console.info('[player:state] force load', newVideoId);
      forceLoadHostPlayer(newVideoId);
    } else if (state.ytPlayer && state.ytPlayer.stopVideo) {
      // no current — stop the host player
      state.ytPlayer.stopVideo();
      state.lastPlayerVideoId = null;
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
      // longer timeout for rate-limit messages
      const isRateLimit = error && /too many/i.test(error);
      setTimeout(() => { els.addError.textContent = ''; }, isRateLimit ? 5000 : 3000);
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
    // Note: don't load/stop the YT player here. The separate player:state
    // event is the authoritative signal for song changes (skip / ended /
    // auto-play) and handles loading the host player. Loading here too
    // causes a destroy+recreate per snapshot → player never finishes
    // initializing → infinite recursion in the logs.
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
      els.hostControls.classList.remove('hidden');
      els.hostLoginForm.classList.add('hidden');
      els.hostActions.classList.remove('hidden');
      els.hostStatus.textContent = 'Authenticated';
    } else if (serverHostConnected) {
      // another host is playing — hide the entire host card from guests
      els.hostControls.classList.add('hidden');
    } else {
      els.hostControls.classList.remove('hidden');
      els.hostActions.classList.add('hidden');
      els.hostLoginForm.classList.remove('hidden');
      els.hostStatus.textContent = 'Not authenticated';
    }
  }

  function renderNowPlaying() {
    if (!state.current) {
      els.nowPlayingTitle.textContent = '—';
      els.nowPlayingStatus.textContent = '';
      return;
    }
    els.nowPlayingTitle.textContent = state.current.title || state.current.videoId;
    els.nowPlayingStatus.textContent = '';
  }

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

  // reload link inside player-error banner
  const reloadLink = document.getElementById('reload-link');
  if (reloadLink) {
    reloadLink.addEventListener('click', (e) => {
      e.preventDefault();
      location.reload();
    });
  }

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
    // reconnect socket with token. In socket.io-client v4 the auth payload
    // must be set on `socket.auth` (the Manager reads this on each connect).
    // Setting `socket.io.opts.auth` after disconnect is unreliable.
    socket.auth = { token };
    if (socket.connected) {
      socket.disconnect();
    }
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