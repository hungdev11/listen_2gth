import { test, afterEach } from 'node:test';
import assert from 'node:assert';
import { parseUrl, fetchTitle } from '../src/youtube.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

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

test('fetchTitle returns title on ok response', async () => {
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ title: 'X' }),
  });
  assert.strictEqual(await fetchTitle('dQw4w9WgXcQ'), 'X');
});

test('fetchTitle returns "Unknown title" when fetch throws', async () => {
  globalThis.fetch = async () => {
    throw new DOMException('Aborted', 'AbortError');
  };
  assert.strictEqual(await fetchTitle('dQw4w9WgXcQ'), 'Unknown title');
});

test('fetchTitle returns "Unknown title" when response is not ok', async () => {
  globalThis.fetch = async () => ({ ok: false });
  assert.strictEqual(await fetchTitle('dQw4w9WgXcQ'), 'Unknown title');
});

test('fetchTitle returns "Unknown title" when JSON has no title field', async () => {
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({}),
  });
  assert.strictEqual(await fetchTitle('dQw4w9WgXcQ'), 'Unknown title');
});
