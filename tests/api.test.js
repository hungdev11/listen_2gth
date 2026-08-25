import { test } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { startServer } from '../server.js';
import * as queue from '../src/queue.js';
import { io as ioClient } from 'socket.io-client';

const TEST_DIR = path.join(process.cwd(), 'tests', 'tmp-api');
let server, baseUrl;

const originalFetch = globalThis.fetch;

test.before(async () => {
  await fs.mkdir(TEST_DIR, { recursive: true });
  process.env.DATA_DIR = TEST_DIR;
  process.env.HOST_PASSWORD = 'secret123';
  process.env.PORT = '0'; // random port
  server = await startServer();
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;
});

test.beforeEach(async () => {
  await fs.rm(TEST_DIR, { recursive: true, force: true });
  await fs.mkdir(TEST_DIR, { recursive: true });
  process.env.DATA_DIR = TEST_DIR;
  globalThis.fetch = async (url, opts) => {
    if (typeof url === 'string' && url.includes('youtube.com/oembed')) {
      return {
        ok: true,
        json: async () => ({ title: 'Mocked Title' }),
        text: async () => JSON.stringify({ title: 'Mocked Title' }),
      };
    }
    return originalFetch(url, opts);
  };
  await queue.init();
});

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

async function request(method, pathname, { body, token } = {}) {
  const url = new URL(pathname, baseUrl);
  const headers = { 'content-type': 'application/json' };
  if (token) headers['authorization'] = `Bearer ${token}`;
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: res.status, body: parsed };
}

test('GET /api/state returns initial snapshot', async () => {
  const { status, body } = await request('GET', '/api/state');
  assert.strictEqual(status, 200);
  assert.deepStrictEqual(body.queue, []);
  assert.strictEqual(body.current, null);
});

test('POST /api/host/login returns token for correct password', async () => {
  const { status, body } = await request('POST', '/api/host/login', { body: { password: 'secret123' } });
  assert.strictEqual(status, 200);
  assert.ok(body.token);
});

test('POST /api/host/login returns 401 for wrong password', async () => {
  const { status } = await request('POST', '/api/host/login', { body: { password: 'wrong' } });
  assert.strictEqual(status, 401);
});

test('POST /api/queue requires host token', async () => {
  const { status } = await request('POST', '/api/queue', { body: { youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ' } });
  assert.strictEqual(status, 401);
});

test('full host flow: login -> add -> state', async () => {
  const { body: loginBody } = await request('POST', '/api/host/login', { body: { password: 'secret123' } });
  const token = loginBody.token;
  const { status, body } = await request('POST', '/api/queue', {
    token,
    body: { youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ' },
  });
  assert.strictEqual(status, 200);
  assert.strictEqual(body.item.videoId, 'dQw4w9WgXcQ');
  const { body: state } = await request('GET', '/api/state');
  assert.strictEqual(state.queue.length, 1);
});

test('POST /api/queue rejects invalid URL', async () => {
  const { body: loginBody } = await request('POST', '/api/host/login', { body: { password: 'secret123' } });
  const token = loginBody.token;
  const { status, body } = await request('POST', '/api/queue', {
    token,
    body: { youtubeUrl: 'https://example.com' },
  });
  assert.strictEqual(status, 400);
  assert.ok(body.error);
});

test('DELETE /api/queue/:id removes item', async () => {
  const { body: loginBody } = await request('POST', '/api/host/login', { body: { password: 'secret123' } });
  const token = loginBody.token;
  const { body } = await request('POST', '/api/queue', {
    token,
    body: { youtubeUrl: 'https://youtu.be/aaaaaaaaaaa' },
  });
  const { status } = await request('DELETE', `/api/queue/${body.item.id}`, { token });
  assert.strictEqual(status, 204);
  const { body: state } = await request('GET', '/api/state');
  assert.strictEqual(state.queue.length, 0);
});

test('DELETE /api/queue clears all', async () => {
  const { body: loginBody } = await request('POST', '/api/host/login', { body: { password: 'secret123' } });
  const token = loginBody.token;
  await request('POST', '/api/queue', { token, body: { youtubeUrl: 'https://youtu.be/aaaaaaaaaaa' } });
  await request('POST', '/api/queue', { token, body: { youtubeUrl: 'https://youtu.be/bbbbbbbbbbb' } });
  const { status } = await request('DELETE', '/api/queue', { token });
  assert.strictEqual(status, 204);
  const { body: state } = await request('GET', '/api/state');
  assert.strictEqual(state.queue.length, 0);
});

test('WebSocket: user can add via queue:add, receives queue:update', async () => {
  const user = ioClient(baseUrl);
  await new Promise((r) => user.on('connect', r));
  const update = await new Promise((resolve) => {
    user.on('queue:update', resolve);
    user.emit('queue:add', { youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ' });
  });
  assert.strictEqual(update.queue.length, 1);
  assert.strictEqual(update.queue[0].videoId, 'dQw4w9WgXcQ');
  user.disconnect();
});

test('WebSocket: non-host cannot emit player:play', async () => {
  const user = ioClient(baseUrl);
  await new Promise((r) => user.on('connect', r));
  const statePromise = new Promise((resolve) => {
    user.on('player:state', resolve);
    user.emit('player:play', { videoId: 'dQw4w9WgXcQ' });
    setTimeout(resolve, 500); // resolve with null if no event
  });
  const result = await statePromise;
  assert.strictEqual(result ?? null, null); // server should NOT broadcast
  user.disconnect();
});

test('WebSocket: host can emit player:play, all clients receive player:state', async () => {
  const { body: loginBody } = await request('POST', '/api/host/login', { body: { password: 'secret123' } });
  const token = loginBody.token;

  const user = ioClient(baseUrl);
  await new Promise((r) => user.on('connect', r));

  const statePromise = new Promise((resolve) => {
    user.on('player:state', (s) => { if (s) resolve(s); });
    // host emits play (server checks token from socket handshake auth)
  });

  // We need to register the host socket with the token. Simplest: emit from a host socket.
  const host = ioClient(baseUrl, { auth: { token } });
  await new Promise((r) => host.on('connect', r));

  host.emit('player:play', { videoId: 'dQw4w9WgXcQ', title: 'Test Song' });
  const state = await statePromise;
  assert.strictEqual(state.videoId, 'dQw4w9WgXcQ');
  assert.ok(state.startedAt);
  user.disconnect();
  host.disconnect();
});

test('WebSocket: state:sync sent on connect', async () => {
  const user = ioClient(baseUrl);
  const sync = await new Promise((resolve) => {
    user.on('state:sync', resolve);
  });
  assert.ok(Array.isArray(sync.queue));
  assert.strictEqual(typeof sync.hostConnected, 'boolean');
  user.disconnect();
});

test('WebSocket: host can emit player:stop to clear current without affecting queue', async () => {
  const { body: loginBody } = await request('POST', '/api/host/login', { body: { password: 'secret123' } });
  const token = loginBody.token;

  // pre-populate queue + current via REST
  await request('POST', '/api/queue', {
    body: { youtubeUrl: 'https://www.youtube.com/watch?v=AAAAAAAAAAA' },
    token,
  });

  const host = ioClient(baseUrl, { auth: { token } });
  await new Promise((r) => host.on('connect', r));

  // wait for current to exist (auto-played after add)
  await new Promise((resolve) => {
    host.on('player:state', (s) => { if (s) resolve(); });
  });

  // now stop — current should become null but queue stays
  const stopPromise = new Promise((resolve) => {
    host.on('player:state', (s) => { if (s === null) resolve(); });
  });
  host.emit('player:stop');
  await stopPromise;

  const snap = await request('GET', '/api/state');
  assert.strictEqual(snap.body.current, null);
  assert.ok(Array.isArray(snap.body.queue));
  host.disconnect();
});
