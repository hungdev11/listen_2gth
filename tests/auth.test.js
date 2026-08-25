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
