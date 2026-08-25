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

export async function clear() {
  ensureInit();
  cache.queue = [];
  cache.current = null;
  await persist().catch((err) => console.error('persist failed', err));
  notify();
}

export async function next() {
  ensureInit();
  if (cache.queue.length === 0) {
    // nothing to play next — stop current playback
    if (cache.current) {
      cache.current = null;
      await persist().catch((err) => console.error('persist failed', err));
      notify();
    }
    return null;
  }
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

export async function setCurrent({ videoId, title, startedAt }) {
  ensureInit();
  cache.current = { videoId, title, startedAt: startedAt ?? Date.now() };
  await persist();
  notify();
}

export function setHostConnected(connected) {
  cache.hostConnected = connected;
  notify();
}
