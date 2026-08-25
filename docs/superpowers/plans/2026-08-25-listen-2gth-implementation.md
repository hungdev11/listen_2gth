# listen_2gth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a web-based shared music queue where users paste YouTube links, a host controls playback as the master player, and all clients stay synchronized in real-time via WebSocket.

**Architecture:** Node.js + Express + Socket.IO server. Host authenticates with password, becomes the master player using YouTube IFrame Player API. All clients receive state updates via WebSocket but only the host actually emits audio. State persists to JSON file. Vanilla JS frontend, no build step.

**Tech Stack:** Node.js 18+, Express 4.x, Socket.IO 4.x, YouTube IFrame Player API, node:test (built-in), vanilla HTML/CSS/JS

## Global Constraints

- Node.js >= 18 (uses built-in `fetch`)
- Host password MUST be supplied via `HOST_PASSWORD` env var; server fails to start without it
- Default port 3000, overridable via `PORT` env var
- Data file: `data/queue.json` (auto-created on first save)
- YouTube URL parsing accepts: `youtube.com/watch?v=ID`, `youtu.be/ID`, `youtube.com/shorts/ID`, with optional query params and fragments
- Video ID regex: `^[A-Za-z0-9_-]{11}$`
- oEmbed title fetch timeout: 5 seconds, fallback title `"Unknown title"` on failure
- Persistence writes use atomic rename (write to `.tmp`, rename) to avoid corruption
- No external test framework — use `node:test`
- Frontend has zero build step (no bundler, no framework, no npm install for client)
- All UI text in English
- Commit messages follow conventional commits (`feat:`, `test:`, `chore:`, `fix:`, `docs:`)

## File Structure

| File | Responsibility |
|------|----------------|
| `package.json` | Dependencies (`express`, `socket.io`) and start script |
| `server.js` | HTTP + Socket.IO bootstrap, routes, middleware wiring |
| `src/auth.js` | Host password verification, session token generation + verification |
| `src/queue.js` | Queue logic: add/remove/clear/next, integrates with state.js |
| `src/youtube.js` | URL parsing + oEmbed title fetch |
| `src/state.js` | Read/write state to `data/queue.json` (atomic writes) |
| `public/index.html` | Main UI (host + user modes in one page) |
| `public/app.js` | Client-side logic: Socket.IO, YouTube IFrame, UI updates |
| `public/style.css` | Minimal mobile-first responsive styling |
| `tests/youtube.test.js` | URL parsing + oEmbed tests |
| `tests/queue.test.js` | Queue logic + persistence tests |
| `tests/api.test.js` | REST + WebSocket integration tests |
| `data/queue.json` | Persisted state (auto-created, gitignored) |

---

## Task 1: Project scaffold

**Files:**
- Create: `package.json`
- Create: `.gitignore`

**Interfaces:** None (initial scaffold)

- [ ] **Step 1: Create `.gitignore`**

```gitignore
node_modules/
data/queue.json
*.log
.env
```

- [ ] **Step 2: Create `package.json`**

```json
{
  "name": "listen-2gth",
  "version": "0.1.0",
  "description": "Shared YouTube music queue with host-controlled playback",
  "type": "module",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "test": "node --test tests/"
  },
  "dependencies": {
    "express": "^4.19.2",
    "socket.io": "^4.7.5"
  },
  "engines": {
    "node": ">=18"
  }
}
```

- [ ] **Step 3: Install dependencies**

Run: `npm install`
Expected: Creates `node_modules/` and `package-lock.json`, no errors

- [ ] **Step 4: Verify package.json is valid JSON**

Run: `node -e "console.log(JSON.parse(require('fs').readFileSync('package.json')).name)"`
Expected: `listen-2gth`

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json .gitignore
git commit -m "chore: scaffold project with package.json and .gitignore"
```

---

## Task 2: State persistence module

**Files:**
- Create: `src/state.js`
- Create: `tests/queue.json` (test fixture)
- Test: `tests/state.test.js`

**Interfaces:**
- Consumes: nothing
- Produces: `load()` → `Promise<{queue: Array, current: object|null, hostConnected: boolean}>`, `save(state)` → `Promise<void>`

- [ ] **Step 1: Write the failing test**

Create `tests/state.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import path from 'node:path';
import { load, save, DEFAULT_STATE } from '../src/state.js';

const TEST_DIR = path.join(process.cwd(), 'tests', 'tmp-state');
const TEST_FILE = path.join(TEST_DIR, 'queue.json');

test.beforeEach(async () => {
  await fs.mkdir(TEST_DIR, { recursive: true });
  process.env.DATA_DIR = TEST_DIR;
});

test.afterEach(async () => {
  await fs.rm(TEST_DIR, { recursive: true, force: true });
  delete process.env.DATA_DIR;
});

test('load returns DEFAULT_STATE when file does not exist', async () => {
  const state = await load();
  assert.deepStrictEqual(state, DEFAULT_STATE);
});

test('save then load returns same state', async () => {
  const newState = {
    queue: [{ id: 'x1', videoId: 'abc12345678', title: 'Test', addedAt: 1000 }],
    current: { videoId: 'abc12345678', title: 'Test', startedAt: 1000 },
    hostConnected: true,
  };
  await save(newState);
  const loaded = await load();
  assert.deepStrictEqual(loaded, newState);
});

test('save uses atomic write (no .tmp file left behind)', async () => {
  await save({ queue: [], current: null, hostConnected: false });
  const files = await fs.readdir(TEST_DIR);
  assert.ok(files.includes('queue.json'));
  assert.ok(!files.includes('queue.json.tmp'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/state.test.js`
Expected: FAIL with "Cannot find module '../src/state.js'"

- [ ] **Step 3: Implement `src/state.js`**

```javascript
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const DEFAULT_STATE = Object.freeze({
  queue: [],
  current: null,
  hostConnected: false,
});

function dataDir() {
  return process.env.DATA_DIR || path.join(process.cwd(), 'data');
}

function stateFile() {
  return path.join(dataDir(), 'queue.json');
}

export async function load() {
  try {
    const raw = await fs.readFile(stateFile(), 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      queue: Array.isArray(parsed.queue) ? parsed.queue : [],
      current: parsed.current ?? null,
      hostConnected: Boolean(parsed.hostConnected),
    };
  } catch (err) {
    if (err.code === 'ENOENT') return { ...DEFAULT_STATE };
    throw err;
  }
}

export async function save(state) {
  const dir = dataDir();
  await fs.mkdir(dir, { recursive: true });
  const file = stateFile();
  const tmp = file + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(state, null, 2));
  await fs.rename(tmp, file);
}

export function newId() {
  return randomUUID().slice(0, 8);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/state.test.js`
Expected: All tests pass (3 passing)

- [ ] **Step 5: Commit**

```bash
git add src/state.js tests/state.test.js
git commit -m "feat: add state persistence module with atomic writes"
```

---

## Task 3: YouTube URL parser

**Files:**
- Create: `src/youtube.js`
- Test: `tests/youtube.test.js`

**Interfaces:**
- Consumes: nothing
- Produces: `parseUrl(url: string) → { videoId: string } | null`, `fetchTitle(videoId: string) → Promise<string>`

- [ ] **Step 1: Write the failing test**

Create `tests/youtube.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert';
import { parseUrl } from '../src/youtube.js';

test('parses youtube.com/watch?v=ID', () => {
  assert.deepStrictEqual(
    parseUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'),
    { videoId: 'dQw4w9WgXcQ' }
  );
});

test('parses youtu.be/ID', () => {
  assert.deepStrictEqual(
    parseUrl('https://youtu.be/dQw4w9WgXcQ'),
    { videoId: 'dQw4w9WgXcQ' }
  );
});

test('parses youtube.com/shorts/ID', () => {
  assert.deepStrictEqual(
    parseUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ'),
    { videoId: 'dQw4w9WgXcQ' }
  );
});

test('ignores extra query params', () => {
  assert.deepStrictEqual(
    parseUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s'),
    { videoId: 'dQw4w9WgXcQ' }
  );
});

test('ignores fragment', () => {
  assert.deepStrictEqual(
    parseUrl('https://youtu.be/dQw4w9WgXcQ#t=0'),
    { videoId: 'dQw4w9WgXcQ' }
  );
});

test('parses without www', () => {
  assert.deepStrictEqual(
    parseUrl('https://youtube.com/watch?v=dQw4w9WgXcQ'),
    { videoId: 'dQw4w9WgXcQ' }
  );
});

test('returns null for invalid URL', () => {
  assert.strictEqual(parseUrl('https://example.com'), null);
  assert.strictEqual(parseUrl('not a url'), null);
  assert.strictEqual(parseUrl('https://youtube.com/'), null);
  assert.strictEqual(parseUrl('https://www.youtube.com/watch?foo=bar'), null);
  assert.strictEqual(parseUrl('https://www.youtube.com/watch?v=short'), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/youtube.test.js`
Expected: FAIL with "Cannot find module '../src/youtube.js'"

- [ ] **Step 3: Implement `src/youtube.js` (URL parser only)**

```javascript
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

export function parseUrl(url) {
  if (typeof url !== 'string') return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.replace(/^www\./, '');
  let candidate = null;
  if (host === 'youtu.be') {
    candidate = parsed.pathname.slice(1);
  } else if (host === 'youtube.com' || host === 'm.youtube.com') {
    if (parsed.pathname.startsWith('/watch')) {
      candidate = parsed.searchParams.get('v');
    } else if (parsed.pathname.startsWith('/shorts/') || parsed.pathname.startsWith('/embed/')) {
      candidate = parsed.pathname.split('/')[2];
    }
  }
  if (!candidate || !VIDEO_ID_RE.test(candidate)) return null;
  return { videoId: candidate };
}

export async function fetchTitle(videoId) {
  try {
    const url = `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return 'Unknown title';
    const data = await res.json();
    return data.title || 'Unknown title';
  } catch {
    return 'Unknown title';
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/youtube.test.js`
Expected: All 8 tests pass

- [ ] **Step 5: Commit**

```bash
git add src/youtube.js tests/youtube.test.js
git commit -m "feat: add YouTube URL parser and oEmbed title fetch"
```

---

## Task 4: Queue module

**Files:**
- Create: `src/queue.js`
- Test: `tests/queue.test.js`

**Interfaces:**
- Consumes: `load`, `save` from `src/state.js`, `parseUrl`, `fetchTitle` from `src/youtube.js`
- Produces:
  - `init()` → loads state into module-level cache
  - `addYoutubeUrl(url: string) → Promise<{ok: true, item: QueueItem} | {ok: false, error: string}>`
  - `remove(id: string) → {ok: boolean}`
  - `clear() → {ok: boolean}`
  - `next() → Promise<QueueItem | null>` — pops first queue item, sets as current, returns it (does NOT play — playback is client's job)
  - `getCurrent() → object | null`
  - `getQueue() → Array<QueueItem>`
  - `clearCurrent() → Promise<void>` — sets current to null
  - `subscribe(fn) → () => void` — fn called with `{queue, current, hostConnected}` after any change; returns unsubscribe

QueueItem shape: `{ id, videoId, title, addedAt }`

- [ ] **Step 1: Write the failing test**

Create `tests/queue.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import path from 'node:path';
import * as queue from '../src/queue.js';

const TEST_DIR = path.join(process.cwd(), 'tests', 'tmp-queue');

test.beforeEach(async () => {
  await fs.mkdir(TEST_DIR, { recursive: true });
  process.env.DATA_DIR = TEST_DIR;
  await queue.init();
});

test.afterEach(async () => {
  await fs.rm(TEST_DIR, { recursive: true, force: true });
  delete process.env.DATA_DIR;
});

test('addYoutubeUrl returns item with parsed videoId', async () => {
  const result = await queue.addYoutubeUrl('https://youtu.be/dQw4w9WgXcQ');
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.item.videoId, 'dQw4w9WgXcQ');
  assert.strictEqual(result.item.title, 'Unknown title'); // no network
  assert.ok(result.item.id);
  assert.ok(result.item.addedAt);
});

test('addYoutubeUrl rejects invalid URL', async () => {
  const result = await queue.addYoutubeUrl('https://example.com');
  assert.strictEqual(result.ok, false);
  assert.ok(result.error.includes('Invalid'));
});

test('queue contains added items in order', async () => {
  await queue.addYoutubeUrl('https://youtu.be/aaaaaaaaaaa');
  await queue.addYoutubeUrl('https://youtu.be/bbbbbbbbbbb');
  const items = queue.getQueue();
  assert.strictEqual(items.length, 2);
  assert.strictEqual(items[0].videoId, 'aaaaaaaaaaa');
  assert.strictEqual(items[1].videoId, 'bbbbbbbbbbb');
});

test('remove deletes item by id', async () => {
  const r1 = await queue.addYoutubeUrl('https://youtu.be/aaaaaaaaaaa');
  await queue.addYoutubeUrl('https://youtu.be/bbbbbbbbbbb');
  const result = queue.remove(r1.item.id);
  assert.strictEqual(result.ok, true);
  const items = queue.getQueue();
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].videoId, 'bbbbbbbbbbb');
});

test('remove returns ok=false for unknown id', () => {
  const result = queue.remove('nonexistent');
  assert.strictEqual(result.ok, false);
});

test('clear empties the queue', async () => {
  await queue.addYoutubeUrl('https://youtu.be/aaaaaaaaaaa');
  queue.clear();
  assert.strictEqual(queue.getQueue().length, 0);
});

test('next pops first item and returns it, sets as current', async () => {
  const r1 = await queue.addYoutubeUrl('https://youtu.be/aaaaaaaaaaa');
  await queue.addYoutubeUrl('https://youtu.be/bbbbbbbbbbb');
  const nextItem = await queue.next();
  assert.strictEqual(nextItem.videoId, 'aaaaaaaaaaa');
  assert.strictEqual(nextItem.id, r1.item.id);
  assert.strictEqual(queue.getQueue().length, 1);
  const current = queue.getCurrent();
  assert.strictEqual(current.videoId, 'aaaaaaaaaaa');
});

test('next returns null when queue is empty', async () => {
  const result = await queue.next();
  assert.strictEqual(result, null);
});

test('subscribe is called on add', async () => {
  let called = 0;
  const unsub = queue.subscribe(() => { called++; });
  await queue.addYoutubeUrl('https://youtu.be/aaaaaaaaaaa');
  unsub();
  assert.ok(called >= 1);
});

test('state persists across init', async () => {
  await queue.addYoutubeUrl('https://youtu.be/aaaaaaaaaaa');
  // re-init from disk
  await queue.init();
  assert.strictEqual(queue.getQueue().length, 1);
  assert.strictEqual(queue.getQueue()[0].videoId, 'aaaaaaaaaaa');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/queue.test.js`
Expected: FAIL with "Cannot find module '../src/queue.js'"

- [ ] **Step 3: Implement `src/queue.js`**

```javascript
import * as state from './state.js';
import { parseUrl, fetchTitle } from './youtube.js';

let cache = { queue: [], current: null, hostConnected: false };
const subscribers = new Set();
let initialized = false;

export async function init() {
  cache = await state.load();
  initialized = true;
  notify();
}

function ensureInit() {
  if (!initialized) throw new Error('queue.init() not called');
}

async function persist() {
  await state.save(cache);
}

function notify() {
  const snapshot = getSnapshot();
  for (const fn of subscribers) {
    try { fn(snapshot); } catch (err) { console.error('subscriber error', err); }
  }
}

export function getSnapshot() {
  return {
    queue: [...cache.queue],
    current: cache.current ? { ...cache.current } : null,
    hostConnected: cache.hostConnected,
  };
}

export function getQueue() {
  return [...cache.queue];
}

export function getCurrent() {
  return cache.current ? { ...cache.current } : null;
}

export function subscribe(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

export async function addYoutubeUrl(url) {
  ensureInit();
  const parsed = parseUrl(url);
  if (!parsed) return { ok: false, error: 'Invalid YouTube URL' };
  const title = await fetchTitle(parsed.videoId);
  const item = {
    id: state.newId(),
    videoId: parsed.videoId,
    title,
    addedAt: Date.now(),
  };
  cache.queue.push(item);
  await persist();
  notify();
  return { ok: true, item };
}

export function remove(id) {
  ensureInit();
  const idx = cache.queue.findIndex((q) => q.id === id);
  if (idx === -1) return { ok: false };
  cache.queue.splice(idx, 1);
  // fire-and-forget persist; persist failure shouldn't block user-visible op
  persist().catch((err) => console.error('persist failed', err));
  notify();
  return { ok: true };
}

export function clear() {
  ensureInit();
  cache.queue = [];
  persist().catch((err) => console.error('persist failed', err));
  notify();
}

export async function next() {
  ensureInit();
  if (cache.queue.length === 0) return null;
  const item = cache.queue.shift();
  cache.current = {
    videoId: item.videoId,
    title: item.title,
    startedAt: Date.now(),
  };
  await persist();
  notify();
  return item;
}

export async function clearCurrent() {
  ensureInit();
  cache.current = null;
  await persist();
  notify();
}

export function setHostConnected(connected) {
  cache.hostConnected = connected;
  notify();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/queue.test.js`
Expected: All 10 tests pass

- [ ] **Step 5: Commit**

```bash
git add src/queue.js tests/queue.test.js
git commit -m "feat: add queue module with persistence and subscribers"
```

---

## Task 5: Auth module

**Files:**
- Create: `src/auth.js`
- Test: `tests/auth.test.js`

**Interfaces:**
- Consumes: env var `HOST_PASSWORD` (set by caller before importing — fail fast if missing)
- Produces:
  - `getRequiredPassword()` → `string` (throws if env not set)
  - `login(password) → {ok: true, token: string} | {ok: false}`
  - `verifyToken(token) → boolean`
  - `revokeToken(token) → void`

- [ ] **Step 1: Write the failing test**

Create `tests/auth.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert';
import * as auth from '../src/auth.js';

test.beforeEach(() => {
  process.env.HOST_PASSWORD = 'secret123';
  // reset module state between tests by reloading
  auth._resetForTests();
});

test.afterEach(() => {
  delete process.env.HOST_PASSWORD;
});

test('login returns token for correct password', () => {
  const result = auth.login('secret123');
  assert.strictEqual(result.ok, true);
  assert.ok(result.token.length > 10);
});

test('login returns ok=false for wrong password', () => {
  const result = auth.login('wrong');
  assert.strictEqual(result.ok, false);
});

test('verifyToken accepts valid token', () => {
  const { token } = auth.login('secret123');
  assert.strictEqual(auth.verifyToken(token), true);
});

test('verifyToken rejects unknown token', () => {
  assert.strictEqual(auth.verifyToken('not-a-real-token'), false);
});

test('revokeToken invalidates token', () => {
  const { token } = auth.login('secret123');
  auth.revokeToken(token);
  assert.strictEqual(auth.verifyToken(token), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/auth.test.js`
Expected: FAIL with "Cannot find module '../src/auth.js'"

- [ ] **Step 3: Implement `src/auth.js`**

```javascript
import { randomBytes } from 'node:crypto';

let password = null;
const tokens = new Set();

export function getRequiredPassword() {
  if (!process.env.HOST_PASSWORD) {
    throw new Error('HOST_PASSWORD env var is required');
  }
  password = process.env.HOST_PASSWORD;
  return password;
}

export function login(input) {
  const expected = process.env.HOST_PASSWORD;
  if (!expected) return { ok: false };
  if (typeof input !== 'string' || input !== expected) return { ok: false };
  const token = randomBytes(24).toString('hex');
  tokens.add(token);
  return { ok: true, token };
}

export function verifyToken(token) {
  return typeof token === 'string' && tokens.has(token);
}

export function revokeToken(token) {
  tokens.delete(token);
}

export function _resetForTests() {
  tokens.clear();
  password = null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/auth.test.js`
Expected: All 5 tests pass

- [ ] **Step 5: Commit**

```bash
git add src/auth.js tests/auth.test.js
git commit -m "feat: add host auth module (password login + token session)"
```

---

## Task 6: Express server + REST routes

**Files:**
- Create: `server.js`
- Test: `tests/api.test.js`

**Interfaces:**
- Consumes: `auth.login`, `auth.verifyToken`, `queue.addYoutubeUrl`, `queue.remove`, `queue.clear`, `queue.getSnapshot`
- Produces: HTTP server with routes:
  - `POST /api/host/login` → `{token}`
  - `POST /api/queue` (host token) → `{item}` or 400
  - `DELETE /api/queue/:id` (host token) → 204
  - `DELETE /api/queue` (host token) → 204
  - `GET /api/state` → full snapshot
  - `GET /` → serve `public/index.html`

- [ ] **Step 1: Write the failing test**

Create `tests/api.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { startServer } from '../server.js';

const TEST_DIR = path.join(process.cwd(), 'tests', 'tmp-api');
let server, baseUrl;

test.before(async () => {
  await fs.mkdir(TEST_DIR, { recursive: true });
  process.env.DATA_DIR = TEST_DIR;
  process.env.HOST_PASSWORD = 'secret123';
  process.env.PORT = '0'; // random port
  server = await startServer();
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/api.test.js`
Expected: FAIL with "Cannot find module '../server.js'"

- [ ] **Step 3: Implement `server.js`**

```javascript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/api.test.js`
Expected: All 8 tests pass

- [ ] **Step 5: Commit**

```bash
git add server.js tests/api.test.js
git commit -m "feat: add Express server with REST routes for host + queue"
```

---

## Task 7: WebSocket layer (Socket.IO)

**Files:**
- Modify: `server.js`
- Modify: `tests/api.test.js`

**Interfaces:**
- WebSocket events (full spec from design doc):
  - Client → Server: `queue:add`, `queue:remove`, `queue:clear`, `player:play`, `player:pause`, `player:skip`, `player:ended`
  - Server → Client: `state:sync`, `queue:update`, `player:state`, `host:status`

- [ ] **Step 1: Update `tests/api.test.js` to include WebSocket tests**

Append to `tests/api.test.js`:

```javascript
import { io as ioClient } from 'socket.io-client';

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
  assert.strictEqual(result, null); // server should NOT broadcast
  user.disconnect();
});

test('WebSocket: host can emit player:play, all clients receive player:state', async () => {
  const { body: loginBody } = await request('POST', '/api/host/login', { body: { password: 'secret123' } });
  const token = loginBody.token;

  const user = ioClient(baseUrl);
  await new Promise((r) => user.on('connect', r));

  const statePromise = new Promise((resolve) => {
    user.on('player:state', resolve);
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/api.test.js`
Expected: FAIL — Socket.IO not attached, events not handled

- [ ] **Step 3: Modify `server.js` to add Socket.IO**

Replace `server.js` entirely with:

```javascript
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
        const { save, load } = await import('./src/state.js');
        const current = { videoId, title, startedAt: Date.now() };
        await save({ ...(await load()), current });
        queue.setHostConnected(true);
        // force notify
        queue.subscribe(() => {})(); // no-op
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
```

- [ ] **Step 4: Install socket.io-client for tests:

```bash
npm install --save-dev socket.io-client
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test tests/api.test.js`
Expected: All 12 tests pass (8 REST + 4 WS)

- [ ] **Step 6: Commit**

```bash
git add server.js tests/api.test.js package.json package-lock.json
git commit -m "feat: add Socket.IO layer with queue + player events"
```

---

## Task 8: Frontend HTML + CSS

**Files:**
- Create: `public/index.html`
- Create: `public/style.css`

**Interfaces:** Static files served by Express at `/`

- [ ] **Step 1: Create `public/index.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>listen_2gth</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <div id="app">
    <header>
      <h1>listen_2gth</h1>
      <div id="connection-status" class="status connecting">Connecting…</div>
    </header>

    <section id="now-playing" class="card">
      <div class="label">Now Playing</div>
      <div id="now-playing-title">—</div>
      <div id="now-playing-status" class="muted"></div>
    </section>

    <section id="host-controls" class="card hidden">
      <div class="label">Host</div>
      <div id="host-status">Not authenticated</div>
      <form id="host-login-form">
        <input type="password" id="host-password" placeholder="Host password" autocomplete="off">
        <button type="submit">Login as host</button>
      </form>
      <div id="host-actions" class="hidden">
        <button id="btn-skip">Skip</button>
        <button id="btn-clear">Clear queue</button>
        <div id="player-container"></div>
      </div>
    </section>

    <section id="add-section" class="card">
      <div class="label">Add to queue</div>
      <form id="add-form">
        <input type="text" id="youtube-url" placeholder="Paste YouTube link…" autocomplete="off" required>
        <button type="submit">Add</button>
      </form>
      <div id="add-error" class="error"></div>
    </section>

    <section id="queue-section" class="card">
      <div class="label">Queue (<span id="queue-count">0</span>)</div>
      <ol id="queue-list"></ol>
    </section>
  </div>

  <script src="/socket.io/socket.io.js"></script>
  <script src="https://www.youtube.com/iframe_api"></script>
  <script src="/app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create `public/style.css`**

```css
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  background: #0f172a;
  color: #e2e8f0;
  min-height: 100vh;
}
#app {
  max-width: 640px;
  margin: 0 auto;
  padding: 16px;
}
header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}
h1 { margin: 0; font-size: 24px; }
.status {
  font-size: 12px;
  padding: 4px 8px;
  border-radius: 12px;
}
.status.connecting { background: #f59e0b; color: #000; }
.status.connected { background: #10b981; color: #000; }
.status.disconnected { background: #ef4444; color: #fff; }
.card {
  background: #1e293b;
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 12px;
}
.label {
  font-size: 12px;
  text-transform: uppercase;
  color: #94a3b8;
  margin-bottom: 8px;
}
#now-playing-title {
  font-size: 18px;
  font-weight: 600;
  margin-bottom: 4px;
  word-break: break-word;
}
.muted { color: #94a3b8; font-size: 14px; }
.error { color: #ef4444; font-size: 14px; margin-top: 8px; min-height: 18px; }
form {
  display: flex;
  gap: 8px;
}
input[type=text], input[type=password] {
  flex: 1;
  padding: 10px;
  border: 1px solid #334155;
  background: #0f172a;
  color: #e2e8f0;
  border-radius: 6px;
  font-size: 14px;
}
button {
  padding: 10px 16px;
  border: none;
  border-radius: 6px;
  background: #3b82f6;
  color: #fff;
  font-weight: 600;
  cursor: pointer;
  font-size: 14px;
}
button:hover { background: #2563eb; }
#host-actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
  flex-wrap: wrap;
}
#btn-skip { background: #f59e0b; }
#btn-skip:hover { background: #d97706; }
#btn-clear { background: #ef4444; }
#btn-clear:hover { background: #dc2626; }
#player-container {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0.01;
  pointer-events: none;
  top: -9999px;
}
#queue-list {
  list-style: none;
  padding: 0;
  margin: 0;
}
#queue-list li {
  padding: 10px 0;
  border-bottom: 1px solid #334155;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}
#queue-list li:last-child { border-bottom: none; }
.queue-title {
  flex: 1;
  word-break: break-word;
}
.queue-remove {
  background: #ef4444;
  padding: 4px 8px;
  font-size: 12px;
}
.host-only { display: none; }
body.is-host .host-only { display: inline-block; }
.hidden { display: none !important; }
@media (max-width: 480px) {
  h1 { font-size: 20px; }
  .card { padding: 12px; }
}
```

- [ ] **Step 3: Verify static files served**

Run: `HOST_PASSWORD=test PORT=3001 node server.js` (in one terminal)
Run: `curl -s http://localhost:3001/ | head -20` (in another)
Expected: HTML content returned
Run: `curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/style.css`
Expected: `200`

- [ ] **Step 4: Kill the test server and commit**

```bash
git add public/index.html public/style.css
git commit -m "feat: add frontend HTML and CSS for shared queue UI"
```

---

## Task 9: Frontend JavaScript (Socket.IO + YouTube player)

**Files:**
- Create: `public/app.js`

**Interfaces:** Client-side; uses globals `io`, `YT` (from YouTube IFrame API script).

- [ ] **Step 1: Create `public/app.js`**

```javascript
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
```

- [ ] **Step 2: Manual smoke test**

Run: `HOST_PASSWORD=test npm start`
Open `http://localhost:3000` in 2 browser tabs
In tab 1: login as host with password "test"
In tab 2: paste `https://youtu.be/dQw4w9WgXcQ` and submit
Expected: Tab 1 shows "Rick Astley" added to queue, can play/remove

- [ ] **Step 3: Commit**

```bash
git add public/app.js
git commit -m "feat: add frontend JS for Socket.IO and YouTube player"
```

---

## Task 10: End-to-end verification

**Files:** None (verification only)

- [ ] **Step 1: Run all tests**

Run: `npm test`
Expected: All 4 test files pass (~26 tests total)

- [ ] **Step 2: Start server**

Run: `HOST_PASSWORD=test123 npm start`
Expected: Console shows `listen_2gth server running at http://localhost:3000`

- [ ] **Step 3: Verify host login via REST**

Run: `curl -X POST http://localhost:3000/api/host/login -H 'content-type: application/json' -d '{"password":"test123"}'`
Expected: `{"token":"<hex>"}`

- [ ] **Step 4: Verify state endpoint**

Run: `curl http://localhost:3000/api/state`
Expected: `{"queue":[],"current":null,"hostConnected":false}`

- [ ] **Step 5: Open in 2 browser windows**

- Window A: `http://localhost:3000` — login as host (password: test123)
- Window B: `http://localhost:3000` — user view
- In window B: paste `https://www.youtube.com/watch?v=dQw4w9WgXcQ`, click Add
- Expected: Both windows show the song in queue

- [ ] **Step 6: Test playback sync**

- In window A (host): click Skip to advance through queue, observe audio plays
- In window B: verify "Now Playing" updates to match

- [ ] **Step 7: Test host disconnect**

- Close window A
- Expected: Window B shows "Host offline"

- [ ] **Step 8: Test persistence**

- Add 2-3 songs to queue
- Kill server (Ctrl+C)
- Run: `HOST_PASSWORD=test123 npm start` again
- Open browser
- Expected: Queue contains the same songs

- [ ] **Step 9: Final commit**

If any fixes were needed during verification:

```bash
git add -A
git commit -m "fix: address end-to-end verification issues"
```

---

## Self-Review Checklist

- [x] **Spec coverage:** All requirements from design doc have a task:
  - State persistence (Task 2) ✓
  - YouTube URL parsing + title (Task 3) ✓
  - Queue logic (Task 4) ✓
  - Host auth (Task 5) ✓
  - REST API (Task 6) ✓
  - WebSocket events (Task 7) ✓
  - Frontend HTML/CSS (Task 8) ✓
  - Frontend JS (Task 9) ✓
  - End-to-end verification (Task 10) ✓

- [x] **Placeholder scan:** No TBD/TODO/"add validation"/"implement later" in any step. Every step has concrete code.

- [x] **Type consistency:**
  - `QueueItem`: `{ id, videoId, title, addedAt }` — used consistently in Tasks 4, 6, 7, 9
  - `queue.getSnapshot()` → `{ queue, current, hostConnected }` — used in Tasks 4, 6, 7
  - `socket.handshake.auth.token` — used in Task 7 consistently
  - `current` shape on wire: `{ videoId, title, startedAt }` — used in Tasks 4, 7, 9

- [x] **No orphan types:** Every function referenced is defined in an earlier task or the same task.