import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as auth from './src/auth.js';
import * as queue from './src/queue.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function startServer() {
  // fail fast if password not set
  auth.getRequiredPassword();
  await queue.init();

  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, 'public')));

  // GET /api/state — public
  app.get('/api/state', (_req, res) => {
    res.json(queue.getSnapshot());
  });

  // POST /api/host/login
  app.post('/api/host/login', (req, res) => {
    const { password } = req.body || {};
    const result = auth.login(password);
    if (!result.ok) return res.status(401).json({ error: 'Invalid password' });
    res.json({ token: result.token });
  });

  // host token middleware
  function requireHost(req, res, next) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!auth.verifyToken(token)) return res.status(401).json({ error: 'Host auth required' });
    req.hostToken = token;
    next();
  }

  // POST /api/queue (host)
  app.post('/api/queue', requireHost, async (req, res) => {
    const { youtubeUrl } = req.body || {};
    const result = await queue.addYoutubeUrl(youtubeUrl);
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json({ item: result.item });
  });

  // DELETE /api/queue/:id (host)
  app.delete('/api/queue/:id', requireHost, (req, res) => {
    const result = queue.remove(req.params.id);
    if (!result.ok) return res.status(404).json({ error: 'Not found' });
    res.status(204).end();
  });

  // DELETE /api/queue (host) — clear all
  app.delete('/api/queue', requireHost, (_req, res) => {
    queue.clear();
    res.status(204).end();
  });

  const server = http.createServer(app);
  const port = Number(process.env.PORT) || 3000;
  await new Promise((resolve) => server.listen(port, resolve));
  return server;
}

// run directly
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  startServer().then((server) => {
    const port = server.address().port;
    console.log(`listen_2gth server running at http://localhost:${port}`);
    console.log('Host password is set. Open the URL on other devices to join.');
  }).catch((err) => {
    console.error('Failed to start:', err.message);
    process.exit(1);
  });
}
