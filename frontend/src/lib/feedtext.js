'use client';

/**
 * Splits a caption into the pieces that need to be rendered differently.
 *
 * The chat side of the app has `linkify`, which only ever had to find URLs. A
 * caption also carries hashtags and @handles, and all three have to be found in
 * one pass — running three passes and stitching the results is how you end up
 * linking the "#" inside a URL's fragment.
 *
 * Returns a flat list of { type, value, href } where type is one of
 * 'text' | 'link' | 'tag' | 'mention'.
 */

const TOKEN =
  /(https?:\/\/[^\s<]+|www\.[^\s<]+)|#([\p{L}\p{N}_]{1,60})|@([a-zA-Z0-9_.]{3,24})/gu;

export function parseCaption(text = '') {
  const parts = [];
  let last = 0;
  let match;

  TOKEN.lastIndex = 0;
  while ((match = TOKEN.exec(text)) !== null) {
    const [raw, url, tag, handle] = match;

    /* A handle only counts at a word boundary. Without this, an email address
       turns its domain into a mention and the rest of the line into a link. */
    if (handle && match.index > 0 && /[\w.]/.test(text[match.index - 1])) continue;

    if (match.index > last) parts.push({ type: 'text', value: text.slice(last, match.index) });

    if (url) {
      parts.push({
        type: 'link',
        value: url,
        href: url.startsWith('http') ? url : 'https://' + url,
      });
    } else if (tag) {
      parts.push({ type: 'tag', value: raw, href: '/explore?q=' + encodeURIComponent('#' + tag) });
    } else {
      parts.push({ type: 'mention', value: raw, handle: handle.toLowerCase() });
    }

    last = match.index + raw.length;
  }

  if (last < text.length) parts.push({ type: 'text', value: text.slice(last) });
  return parts;
}

/** Relative timestamps in the compact form a feed uses: 4m, 7h, 3d, 12 Mar. */
export function feedTime(date) {
  if (!date) return '';
  const then = new Date(date);
  const seconds = Math.max(0, (Date.now() - then.getTime()) / 1000);

  if (seconds < 45) return 'now';
  if (seconds < 3600) return Math.round(seconds / 60) + 'm';
  if (seconds < 86_400) return Math.round(seconds / 3600) + 'h';
  if (seconds < 604_800) return Math.round(seconds / 86_400) + 'd';

  const sameYear = then.getFullYear() === new Date().getFullYear();
  return then.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

/** The long form, for a post's detail view. */
export function feedTimeLong(date) {
  if (!date) return '';
  return new Date(date).toLocaleString(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** The first real URL in a caption, or null. Feeds the preview card. */
export function firstLink(text = '') {
  const found = parseCaption(text).find((part) => part.type === 'link');
  return found ? found.href : null;
}
