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
