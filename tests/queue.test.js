import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import path from 'node:path';
import * as queue from '../src/queue.js';

const TEST_DIR = path.join(process.cwd(), 'tests', 'tmp-queue');

const originalFetch = globalThis.fetch;

test.beforeEach(async () => {
  await fs.mkdir(TEST_DIR, { recursive: true });
  process.env.DATA_DIR = TEST_DIR;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ title: 'Mocked Title' }),
  });
  await queue.init();
});

test.afterEach(async () => {
  await fs.rm(TEST_DIR, { recursive: true, force: true });
  delete process.env.DATA_DIR;
  globalThis.fetch = originalFetch;
});

test('addYoutubeUrl returns item with parsed videoId', async () => {
  const result = await queue.addYoutubeUrl('https://youtu.be/dQw4w9WgXcQ');
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.item.videoId, 'dQw4w9WgXcQ');
  assert.strictEqual(result.item.title, 'Mocked Title'); // stubbed fetch
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
