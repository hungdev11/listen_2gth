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
