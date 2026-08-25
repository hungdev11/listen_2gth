import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server as IOServer } from 'socket.io';
import * as auth from './src/auth.js';
import * as queue from './src/queue.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function startServer() {
  auth.getRequiredPassword();
  await queue.init();

  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, 'public'), {
    setHeaders: (res, filePath) => {
      // never cache frontend files so updates are picked up immediately
      res.setHeader('Cache-Control', 'no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    },
  }));

  app.get('/api/state', (_req, res) => res.json(queue.getSnapshot()));

app.get('/api/version', (_req, res) => res.json({ version: '6' }));

  app.post('/api/host/login', (req, res) => {
    const result = auth.login(req.body?.password);
    if (!result.ok) return res.status(401).json({ error: 'Invalid password' });
    res.json({ token: result.token });
  });

  function requireHost(req, res, next) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!auth.verifyToken(token)) return res.status(401).json({ error: 'Host auth required' });
    next();
  }

  app.post('/api/queue', requireHost, async (req, res) => {
    const result = await queue.addYoutubeUrl(req.body?.youtubeUrl);
    if (!result.ok) return res.status(400).json({ error: result.error });
    // auto-play if nothing is currently playing
    const snap = queue.getSnapshot();
    if (!snap.current && snap.hostConnected) {
      await queue.next();
    }
    res.json({ item: result.item });
  });

  app.delete('/api/queue/:id', requireHost, (req, res) => {
    const result = queue.remove(req.params.id);
    if (!result.ok) return res.status(404).json({ error: 'Not found' });
    res.status(204).end();
  });

  app.delete('/api/queue', requireHost, (_req, res) => {
    queue.clear();
    res.status(204).end();
  });

  const server = http.createServer(app);
  const io = new IOServer(server);

  // Helper: is this socket a host?
  function isHostSocket(socket) {
    const token = socket.handshake.auth?.token;
    return auth.verifyToken(token);
  }

  // Queue change notifications
  queue.subscribe((snapshot) => {
    io.emit('state:sync', snapshot);
    io.emit('queue:update', { queue: snapshot.queue });
    io.emit('player:state', snapshot.current ? {
      videoId: snapshot.current.videoId,
      title: snapshot.current.title,
      startedAt: snapshot.current.startedAt,
    } : null);
  });

  io.on('connection', (socket) => {
    if (isHostSocket(socket)) {
      queue.setHostConnected(true);
      socket.on('disconnect', () => {
        // only set false if no other host sockets remain
        const hostsRemaining = [...io.sockets.sockets.values()].filter((s) => isHostSocket(s));
        if (hostsRemaining.length === 0) queue.setHostConnected(false);
      });
      // auto-resume: if queue has items but nothing is playing, start the head
      const snap = queue.getSnapshot();
      if (!snap.current && snap.queue.length > 0) {
        queue.next().catch((err) => console.error('auto-resume failed', err));
      }
    }

    // Send initial snapshot to the connecting socket. For hosts, this
    // reflects hostConnected=true (because setHostConnected above triggered
    // notify() with the fresh snapshot).
    socket.emit('state:sync', queue.getSnapshot());

    // === queue events ===
    socket.on('queue:add', async ({ youtubeUrl } = {}) => {
      const result = await queue.addYoutubeUrl(youtubeUrl);
      if (!result.ok) socket.emit('error', { event: 'queue:add', error: result.error });
      // auto-play: if nothing is playing and a host is connected, start the head
      const snap = queue.getSnapshot();
      if (result.ok && !snap.current && snap.hostConnected) {
        await queue.next();
      }
    });

    socket.on('queue:remove', ({ id } = {}) => {
      if (!isHostSocket(socket)) return;
      queue.remove(id);
    });

    socket.on('queue:clear', () => {
      if (!isHostSocket(socket)) return;
      queue.clear();
    });

    // === player events ===
    socket.on('player:play', async ({ videoId, title } = {}) => {
      if (!isHostSocket(socket)) return;
      // If videoId matches queue head, pop it; otherwise treat as ad-hoc play
      if (queue.getQueue().length > 0 && queue.getQueue()[0].videoId === videoId) {
        await queue.next();
      } else {
        // ad-hoc play (e.g. resume after reconnect)
        await queue.setCurrent({ videoId, title });
      }
    });

    socket.on('player:pause', () => {
      // informational only — clients handle pause UI from their own player
    });

    socket.on('player:skip', async () => {
      if (!isHostSocket(socket)) return;
      await queue.next();
    });

    socket.on('player:ended', async () => {
      if (!isHostSocket(socket)) return;
      if (queue.getQueue().length > 0) {
        await queue.next();
      } else {
        await queue.clearCurrent();
      }
    });
  });

  const port = process.env.PORT !== undefined ? Number(process.env.PORT) : 3000;
  const host = process.env.HOST || '0.0.0.0';
  await new Promise((resolve) => server.listen(port, host, resolve));
  return server;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  startServer().then(async (server) => {
    const port = server.address().port;
    console.log(`listen_2gth server running at http://localhost:${port}`);
    // print LAN URLs so the host can share them
    const { networkInterfaces } = await import('node:os');
    for (const [name, addrs] of Object.entries(networkInterfaces())) {
      for (const addr of addrs) {
        if (addr.family === 'IPv4' && !addr.internal) {
          console.log(`  → http://${addr.address}:${port}`);
        }
      }
    }
    console.log('Host password is set. Open the URL on other devices to join.');
  }).catch((err) => {
    console.error('Failed to start:', err.message);
    process.exit(1);
  });
}
