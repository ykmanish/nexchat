import dns from 'node:dns/promises';
import net from 'node:net';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';

/**
 * Fetches Open Graph metadata for a URL so a preview card can be built.
 *
 * The fetch is deliberately paranoid: it is an authenticated user handing us an
 * arbitrary URL, which is a textbook SSRF vector. Every hop is re-checked, the
 * response is size-capped, and only http/https public hosts are reachable.
 */

const MAX_BYTES = 512 * 1024;
const TIMEOUT_MS = 6000;
const CACHE_TTL = 30 * 60 * 1000;

/* A plain bot agent gets a stripped page from a lot of large sites (YouTube
   serves a consent shell with no OG tags at all). Presenting as a normal
   browser is what every link-preview fetcher ends up doing; the oEmbed
   fallback below covers the sites that still refuse. */
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const cache = new Map();

/** Blocks loopback, link-local, and private ranges in both v4 and v6. */
function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    );
  }
  const lower = ip.toLowerCase();
  return (
    lower === '::1' ||
    lower === '::' ||
    lower.startsWith('fc') ||
    lower.startsWith('fd') ||
    lower.startsWith('fe80') ||
    lower.startsWith('::ffff:')
  );
}

async function assertPublicHost(hostname) {
  if (net.isIP(hostname) && isPrivateAddress(hostname)) {
    throw ApiError.badRequest('That address is not reachable', 'BLOCKED_HOST');
  }

  let records;
  try {
    records = await dns.lookup(hostname, { all: true });
  } catch {
    throw ApiError.badRequest('Could not resolve that link', 'DNS_FAILED');
  }

  if (records.some((r) => isPrivateAddress(r.address))) {
    throw ApiError.badRequest('That address is not reachable', 'BLOCKED_HOST');
  }
}

/* ─────────────────────────────── parsing ─────────────────────────────── */

const NAMED = {
  quot: '"', apos: "'", amp: '&', lt: '<', gt: '>', nbsp: ' ',
  mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘',
  ldquo: '“', rdquo: '”', laquo: '«', raquo: '»', middot: '·',
};

function decode(s = '') {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeChar(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, name) => NAMED[name.toLowerCase()] ?? m)
    .replace(/\s+/g, ' ')
    .trim();
}

function safeChar(code) {
  try {
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
  } catch {
    return '';
  }
}

/**
 * Pulls one attribute out of a tag. Written attribute-order-agnostically:
 * `<meta property="og:title" content="x">` and `<meta content="x"
 * property="og:title">` are both common in the wild, and matching only the
 * first order silently loses metadata on a lot of real pages.
 */
function attr(tag, name) {
  const m =
    tag.match(new RegExp(name + '\\s*=\\s*"([^"]*)"', 'i')) ||
    tag.match(new RegExp(name + "\\s*=\\s*'([^']*)'", 'i')) ||
    tag.match(new RegExp(name + '\\s*=\\s*([^\\s">]+)', 'i'));
  return m ? m[1] : null;
}

/** All <meta> tags, keyed by their property/name, first value wins. */
function readMeta(html) {
  const out = new Map();
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    const key = (attr(tag, 'property') || attr(tag, 'name') || attr(tag, 'itemprop') || '').toLowerCase();
    const value = attr(tag, 'content');
    if (key && value && !out.has(key)) out.set(key, decode(value).slice(0, 400));
  }
  return out;
}

/** All <link rel=...> hrefs, grouped by rel. */
function readLinks(html) {
  const out = [];
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    const rel = (attr(tag, 'rel') || '').toLowerCase();
    const href = attr(tag, 'href');
    if (rel && href) out.push({ rel, href, sizes: attr(tag, 'sizes') || '' });
  }
  return out;
}

function absolute(url, base) {
  if (!url) return null;
  try {
    const u = new URL(url, base);
    return ['http:', 'https:'].includes(u.protocol) ? u.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Picks the best declared icon.
 *
 * `data:` URIs are filtered out rather than passed through — example.com ships
 * `<link rel="icon" href="data:,">` specifically to suppress the favicon
 * request, and forwarding that renders a broken image in the bubble.
 */
function pickFavicon(links, base) {
  const icons = links.filter((l) => /\bicon\b/.test(l.rel) && !/^data:/i.test(l.href.trim()));

  const score = (l) => {
    const size = parseInt((l.sizes.match(/(\d+)/) || [])[1] || '0', 10);
    let s = Math.min(size, 512);
    if (/apple-touch-icon/.test(l.rel)) s += 64; // usually a clean, large square
    if (/\.svg(\?|$)/i.test(l.href)) s += 256; // scales to any density
    return s;
  };

  const best = icons.sort((a, b) => score(b) - score(a))[0];
  return absolute(best?.href, base) || new URL(base).origin + '/favicon.ico';
}

/* ─────────────────────────────── oEmbed ─────────────────────────────── */

/* A fixed allowlist, so these secondary fetches carry no SSRF risk: the
   hostname is ours, only the query string comes from the user. */
const OEMBED = [
  { host: /(^|\.)youtube\.com$|(^|\.)youtu\.be$/, endpoint: 'https://www.youtube.com/oembed' },
  { host: /(^|\.)vimeo\.com$/, endpoint: 'https://vimeo.com/api/oembed.json' },
  { host: /(^|\.)tiktok\.com$/, endpoint: 'https://www.tiktok.com/oembed' },
  { host: /(^|\.)soundcloud\.com$/, endpoint: 'https://soundcloud.com/oembed' },
  { host: /(^|\.)spotify\.com$/, endpoint: 'https://open.spotify.com/oembed' },
  { host: /(^|\.)flickr\.com$/, endpoint: 'https://www.flickr.com/services/oembed' },
];

async function oEmbed(url) {
  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    return null;
  }

  const provider = OEMBED.find((p) => p.host.test(host));
  if (!provider) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const res = await fetch(
      provider.endpoint + '?format=json&url=' + encodeURIComponent(url),
      { signal: controller.signal, headers: { 'User-Agent': UA, Accept: 'application/json' } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return {
      title: data.title ? decode(String(data.title)).slice(0, 300) : null,
      description: data.author_name ? decode(String(data.author_name)).slice(0, 300) : null,
      image: absolute(data.thumbnail_url, url),
      siteName: data.provider_name || null,
      type: data.type === 'video' ? 'video' : null,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** YouTube thumbnails are addressable from the video id, so no fetch needed. */
function youtubeThumb(url) {
  try {
    const u = new URL(url);
    const id = /(^|\.)youtu\.be$/.test(u.hostname)
      ? u.pathname.slice(1)
      : /(^|\.)youtube\.com$/.test(u.hostname)
        ? u.searchParams.get('v') || (u.pathname.match(/\/(?:embed|shorts)\/([\w-]+)/) || [])[1]
        : null;
    return /^[\w-]{6,20}$/.test(id || '') ? 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg' : null;
  } catch {
    return null;
  }
}

/* ─────────────────────────────── handler ─────────────────────────────── */

/** Streams the response head, stopping at </head> or the byte cap. */
async function readHead(response) {
  if (!response.body) return '';

  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  let tail = ''; // only the newest text is scanned, so this stays O(n)

  try {
    while (size < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.length;

      tail = (tail + Buffer.from(value).toString('latin1')).slice(-2048);
      if (tail.includes('</head>')) break;
    }
  } finally {
    reader.cancel().catch(() => {});
  }

  const buf = Buffer.concat(chunks);
  const charset = (buf.toString('latin1', 0, 4096).match(/charset=["']?([\w-]+)/i) || [])[1];
  try {
    return new TextDecoder(charset || 'utf-8').decode(buf);
  } catch {
    return buf.toString('utf8');
  }
}

export const linkPreview = asyncHandler(async (req, res) => {
  const raw = String(req.query.url || '').trim();
  if (!raw) throw ApiError.badRequest('Pass a url', 'NO_URL');

  let target;
  try {
    target = new URL(raw.startsWith('http') ? raw : 'https://' + raw);
  } catch {
    throw ApiError.badRequest('That is not a valid link', 'BAD_URL');
  }

  if (!['http:', 'https:'].includes(target.protocol)) {
    throw ApiError.badRequest('Only http and https links are supported', 'BAD_PROTOCOL');
  }

  const key = target.toString();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL) {
    return res.json({ success: true, preview: hit.preview, cached: true });
  }

  await assertPublicHost(target.hostname);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let html = '';
  let finalUrl = key;
  let htmlFailed = false;

  try {
    const response = await fetch(key, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

    finalUrl = response.url || key;

    if (!(response.headers.get('content-type') || '').includes('html')) {
      htmlFailed = true;
      response.body?.cancel().catch(() => {});
    } else {
      html = await readHead(response);
    }
  } catch {
    htmlFailed = true;
  }
  clearTimeout(timer);

  const meta = readMeta(html);
  const links = readLinks(html);
  const host = new URL(finalUrl).hostname.replace(/^www\./, '');

  const pick = (...keys) => {
    for (const k of keys) {
      const v = meta.get(k);
      if (v) return v;
    }
    return null;
  };

  const preview = {
    url: finalUrl,
    siteName: pick('og:site_name', 'application-name') || host,
    // Left null rather than defaulted to the hostname: the card already shows
    // the host on its own line, and a title that just repeats it looks broken.
    title:
      pick('og:title', 'twitter:title') ||
      decode((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '').slice(0, 300) ||
      null,
    description: pick('og:description', 'twitter:description', 'description'),
    image: absolute(
      pick('og:image:secure_url', 'og:image:url', 'og:image', 'twitter:image', 'twitter:image:src'),
      finalUrl
    ),
    favicon: htmlFailed
      ? new URL(finalUrl).origin + '/favicon.ico'
      : pickFavicon(links, finalUrl),
    type: /video/.test(pick('og:type', 'twitter:card') || '') ? 'video' : null,
  };

  /* Sites that hand a bot a JS shell leave us with nothing useful. oEmbed is
     the documented way in, and it is what makes YouTube links resolve. */
  if (!preview.title || !preview.image) {
    const embed = await oEmbed(finalUrl);
    if (embed) {
      preview.title = preview.title || embed.title;
      preview.description = preview.description || embed.description;
      preview.image = preview.image || embed.image;
      preview.type = preview.type || embed.type;
      if (embed.siteName && preview.siteName === host) preview.siteName = embed.siteName;
    }
    preview.image = preview.image || youtubeThumb(finalUrl);
    if (preview.image && !preview.type && youtubeThumb(finalUrl)) preview.type = 'video';
  }

  if (!preview.title && !preview.image && !preview.description && htmlFailed) {
    throw ApiError.badRequest('Could not read that link', 'FETCH_FAILED');
  }

  cache.set(key, { at: Date.now(), preview });
  if (cache.size > 500) cache.delete(cache.keys().next().value);

  res.json({ success: true, preview });
});
