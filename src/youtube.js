const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

export function parseUrl(url) {
  if (typeof url !== 'string') return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.replace(/^www\./, '');
  let candidate = null;
  if (host === 'youtu.be') {
    candidate = parsed.pathname.slice(1);
  } else if (host === 'youtube.com' || host === 'm.youtube.com') {
    if (parsed.pathname.startsWith('/watch')) {
      candidate = parsed.searchParams.get('v');
    } else if (parsed.pathname.startsWith('/shorts/') || parsed.pathname.startsWith('/embed/')) {
      candidate = parsed.pathname.split('/')[2];
    }
  }
  if (!candidate || !VIDEO_ID_RE.test(candidate)) return null;
  return { videoId: candidate };
}

export async function fetchTitle(videoId) {
  try {
    const url = `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return 'Unknown title';
    const data = await res.json();
    return data.title || 'Unknown title';
  } catch {
    return 'Unknown title';
  }
}
