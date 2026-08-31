import { api } from './api';

/**
 * Shared link-preview cache.
 *
 * A chat can hold the same link in many bubbles, and a re-render must not
 * refetch. Resolved previews and in-flight promises are both kept here, so N
 * bubbles pointing at one URL collapse to a single request.
 */
const resolved = new Map(); // url -> preview | null
const inFlight = new Map(); // url -> Promise
const listeners = new Set();

const MAX = 300;

export function cachedPreview(url) {
  return resolved.get(url);
}

export function hasResolved(url) {
  return resolved.has(url);
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function commit(url, preview) {
  if (resolved.size >= MAX) resolved.delete(resolved.keys().next().value);
  resolved.set(url, preview);
  inFlight.delete(url);
  listeners.forEach((fn) => fn(url, preview));
}

/**
 * Resolves a preview, de-duplicating concurrent callers.
 *
 * A failure is cached as `null` rather than left absent — otherwise every
 * re-render retries a link that is never going to resolve.
 */
export function resolvePreview(url) {
  if (!url) return Promise.resolve(null);
  if (resolved.has(url)) return Promise.resolve(resolved.get(url));
  if (inFlight.has(url)) return inFlight.get(url);

  const request = api
    .get('/links/preview', { params: { url } })
    .then(({ data }) => {
      const preview = data?.preview?.url ? data.preview : null;
      commit(url, preview);
      return preview;
    })
    .catch(() => {
      commit(url, null);
      return null;
    });

  inFlight.set(url, request);
  return request;
}

/** Seeds the cache from a preview that arrived inside a message payload. */
export function seedPreview(preview) {
  if (preview?.url && !resolved.has(preview.url)) resolved.set(preview.url, preview);
}

/** `https://youtu.be/x` → `youtu.be`, for the host line on a card. */
/**
 * True for a link that points back at Chax itself — a shared post, a call link.
 *
 * These get no preview card. There is nothing for one to say: the destination
 * is a client-side route, so there are no OG tags behind it and the card
 * resolves to a bare hostname next to a fallback globe. Sharing a post into a
 * chat looked like sharing a broken link. The plain link says more.
 */
export function isInternalLink(url) {
  if (typeof window === 'undefined') return false;
  try {
    return new URL(url, window.location.origin).origin === window.location.origin;
  } catch {
    return false;
  }
}

export function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/**
 * The site's own icon, guessed from the origin.
 *
 * Used before a preview resolves (and when one never does) so a link bubble
 * still carries its favicon. It is fetched straight from the site, so it costs
 * no round-trip through our server.
 */
export function originFavicon(url) {
  try {
    return new URL(url).origin + '/favicon.ico';
  } catch {
    return null;
  }
}
