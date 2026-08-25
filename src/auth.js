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
