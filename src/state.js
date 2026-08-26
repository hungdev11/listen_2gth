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
    if (err.code === 'ENOENT') return { queue: [], current: null, hostConnected: false };
    throw err;
  }
}

export async function save(state) {
  const dir = dataDir();
  await fs.mkdir(dir, { recursive: true });
  const file = stateFile();
  const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  // Always persist hostConnected=false so a stale "true" from a crashed
  // session can't hide the host login form on next restart.
  const toPersist = { ...state, hostConnected: false };
  await fs.writeFile(tmp, JSON.stringify(toPersist, null, 2));
  await fs.rename(tmp, file);
}

export function newId() {
  return randomUUID().slice(0, 8);
}
