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
  app.use(express.static(path.join(__dirname, 'public')));

  app.get('/api/state', (_req, res) => res.json(queue.getSnapshot()));

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
    io.emit('queue:update', { queue: snapshot.queue });
    io.emit('player:state', snapshot.current ? {
      videoId: snapshot.current.videoId,
      title: snapshot.current.title,
      startedAt: snapshot.current.startedAt,
    } : null);
  });

  io.on('connection', (socket) => {
    socket.emit('state:sync', queue.getSnapshot());

    if (isHostSocket(socket)) {
      queue.setHostConnected(true);
      socket.on('disconnect', () => {
        // only set false if no other host sockets remain
        const hostsRemaining = [...io.sockets.sockets.values()].filter((s) => isHostSocket(s));
        if (hostsRemaining.length === 0) queue.setHostConnected(false);
      });
    }

    // === queue events ===
    socket.on('queue:add', async ({ youtubeUrl } = {}) => {
      const result = await queue.addYoutubeUrl(youtubeUrl);
      if (!result.ok) socket.emit('error', { event: 'queue:add', error: result.error });
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

  const port = Number(process.env.PORT) || 3000;
  await new Promise((resolve) => server.listen(port, resolve));
  return server;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  startServer().then((server) => {
    const port = server.address().port;
    console.log(`listen_2gth server running at http://localhost:${port}`);
  }).catch((err) => {
    console.error('Failed to start:', err.message);
    process.exit(1);
  });
}
