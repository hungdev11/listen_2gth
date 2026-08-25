// Simple in-memory sliding-window rate limiter. One bucket per key (typically
// an IP). Window resets after `windowMs` of inactivity.
//
// Not for multi-instance deployments — use Redis or similar in production.

const buckets = new Map();

/**
 * Check (and consume) one hit against the limiter for `key`.
 * @param {string} key   unique identifier (IP address, user id, etc.)
 * @param {number} limit max hits per window
 * @param {number} windowMs window length in milliseconds
 * @returns {{ ok: boolean, retryAfterMs?: number, remaining: number }}
 *   ok=true if the hit is allowed; retryAfterMs is set when ok=false.
 */
export function hit(key, limit = 5, windowMs = 60_000) {
  const now = Date.now();
  const cutoff = now - windowMs;
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { hits: [] };
    buckets.set(key, bucket);
  }
  // drop entries outside the window
  bucket.hits = bucket.hits.filter((t) => t > cutoff);

  if (bucket.hits.length >= limit) {
    const oldest = bucket.hits[0];
    return {
      ok: false,
      retryAfterMs: Math.max(0, oldest + windowMs - now),
      remaining: 0,
    };
  }
  bucket.hits.push(now);
  return { ok: true, remaining: limit - bucket.hits.length };
}

/** Reset all buckets — for tests. */
export function _resetForTests() {
  buckets.clear();
}