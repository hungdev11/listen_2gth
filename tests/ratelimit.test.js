import { test } from 'node:test';
import assert from 'node:assert';
import { hit, _resetForTests } from '../src/ratelimit.js';

test.beforeEach(() => {
  _resetForTests();
});

test('hit allows up to limit then rejects', () => {
  const key = 'ip:1.2.3.4';
  for (let i = 0; i < 5; i++) {
    const r = hit(key, 5, 60_000);
    assert.strictEqual(r.ok, true, `hit ${i + 1} should be allowed`);
    assert.strictEqual(r.remaining, 5 - i - 1);
  }
  const r6 = hit(key, 5, 60_000);
  assert.strictEqual(r6.ok, false);
  assert.ok(r6.retryAfterMs > 0);
  assert.ok(r6.retryAfterMs <= 60_000);
});

test('hit is independent per key', () => {
  for (let i = 0; i < 5; i++) hit('a', 5, 60_000);
  assert.strictEqual(hit('a', 5, 60_000).ok, false);
  assert.strictEqual(hit('b', 5, 60_000).ok, true);
});

test('hit window slides: old entries expire', () => {
  // override Date.now to control window
  const realNow = Date.now;
  let now = realNow();
  Date.now = () => now;

  try {
    for (let i = 0; i < 5; i++) hit('c', 5, 60_000);
    assert.strictEqual(hit('c', 5, 60_000).ok, false);
    // jump 61s — window expires
    now += 61_000;
    const r = hit('c', 5, 60_000);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.remaining, 4);
  } finally {
    Date.now = realNow;
  }
});

test('hit returns retryAfterMs when rate-limited', () => {
  for (let i = 0; i < 5; i++) hit('d', 5, 60_000);
  const r = hit('d', 5, 60_000);
  assert.strictEqual(r.ok, false);
  assert.ok(r.retryAfterMs > 0);
  assert.ok(r.retryAfterMs <= 60_000);
});