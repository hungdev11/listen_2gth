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
