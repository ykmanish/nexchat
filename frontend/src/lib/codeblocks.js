/**
 * Turns a message body into renderable parts: prose, fenced code, and inline
 * code. Pure functions, no React — so the heuristics can be unit-tested.
 */

/**
 * Splits text into prose and code runs. Also promotes an unfenced block that is
 * *obviously* code, so pasting a snippet without backticks still renders well.
 */
export function parseMessageBody(text = '') {
  if (!text) return [];

  const parts = [];
  const fence = /```(\w+)?\n?([\s\S]*?)```/g;
  let last = 0;
  let m;

  while ((m = fence.exec(text)) !== null) {
    if (m.index > last) parts.push({ type: 'text', value: text.slice(last, m.index) });
    parts.push({ type: 'code', value: m[2].replace(/\n$/, ''), language: m[1] || null });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ type: 'text', value: text.slice(last) });

  // Nothing fenced? Check whether the whole message reads as code.
  if (parts.length === 1 && parts[0].type === 'text' && looksLikeCode(text)) {
    return [{ type: 'code', value: text.trim(), language: guessLanguage(text) }];
  }
  return parts;
}

/**
 * Deliberately conservative. A false positive turns an ordinary sentence into a
 * code block, which is far worse than missing a snippet — so this demands
 * several structural signals before it commits.
 */
export function looksLikeCode(text) {
  const trimmed = text.trim();
  if (trimmed.length < 24) return false;

  const lines = trimmed.split('\n');
  if (lines.length < 2) return false;

  // A run of ordinary sentences is prose, whatever else it contains.
  const prose = lines.filter((l) => /^[A-Z][^\n]{12,}[.!?]$/.test(l.trim())).length;
  if (prose >= lines.length / 2) return false;

  const signals = [
    /^(?:import|export|const|let|var|function|class|def|public|private|SELECT|INSERT|UPDATE|#include)\b/m,
    /[{};]\s*$/m,
    /^[ \t]{2,}\S/m,
    /=>|::|->|<\/\w+>/,
    /\b(?:if|for|while|return)\s*\(/,
    /\w+\([^)]*\)\s*[{;]/,
  ].filter((rx) => rx.test(trimmed)).length;

  return signals >= 2;
}

export function guessLanguage(text) {
  if (/^\s*(?:SELECT|INSERT|UPDATE|DELETE)\b/im.test(text)) return 'sql';
  if (/^\s*def\s|^\s*class\s+\w+\(|print\(/m.test(text)) return 'python';
  if (/^\s*(?:import|export)\s|=>|const\s|let\s|console\./m.test(text)) return 'javascript';
  if (/^\s*#include|std::/m.test(text)) return 'cpp';
  if (/^\s*(?:public|private|protected)\s+\w+/m.test(text)) return 'java';
  if (/<\/?\w+[^>]*>/.test(text)) return 'html';
  return null;
}

/** Splits a prose run around `inline code` spans. */
export function splitInlineCode(value = '') {
  const parts = [];
  const rx = /`([^`\n]+)`/g;
  let last = 0;
  let m;

  while ((m = rx.exec(value)) !== null) {
    if (m.index > last) parts.push({ code: false, value: value.slice(last, m.index) });
    parts.push({ code: true, value: m[1] });
    last = m.index + m[0].length;
  }
  if (last < value.length) parts.push({ code: false, value: value.slice(last) });
  return parts;
}

/** First http(s) URL in a message, used to decide what to preview. */
/* Bare domains are how people actually paste links, but `report.txt` and
   `index.js` look identical to one. Requiring a real TLD separates them.
   Deliberately omitted despite being valid ccTLDs: .sh .py .md .rs — in a
   developer's chat those are far more often filenames than hosts. */
const TLDS = new Set(
  ('com net org edu gov mil int io co ai app dev me tv fm gg xyz online site tech ' +
   'store shop blog cloud page live news wiki info biz pro name mobi asia link chat ' +
   'uk us ca au de fr es it nl se no fi dk pl ru ua in jp cn kr br mx ar cl za nz ' +
   'ch at be pt gr cz sk hu ro bg tr il ae sa sg hk tw th vn id my ph pk bd lk np ' +
   'ir eg ng ke gh tz ug ly to cc ws im is la st nu ee lt lv si hr rs ba mk al').split(' ')
);

export function firstUrl(text = '') {
  const pattern =
    /(?:https?:\/\/|www\.)[^\s<>"']+|\b[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?:\/[^\s<>"']*)?/gi;

  for (const m of text.matchAll(pattern)) {
    const url = clean(m[0]);
    if (!url) continue;

    const explicit = /^(?:https?:\/\/|www\.)/i.test(url);

    // Skip the domain half of an email address.
    if (!explicit && text[m.index - 1] === '@') continue;

    if (!explicit) {
      const host = url.split(/[/?#]/)[0];
      const tld = host.split('.').pop().toLowerCase();
      if (!TLDS.has(tld)) continue;
    }

    const full = /^https?:\/\//i.test(url) ? url : 'https://' + url;
    try {
      const parsed = new URL(full);
      if (parsed.hostname.includes('.')) return full;
    } catch {
      /* keep looking */
    }
  }
  return null;
}

/**
 * Trims trailing sentence punctuation. Closing brackets only count as
 * punctuation when unmatched, so a Wikipedia-style `..._(disambiguation)`
 * URL survives intact.
 */
function clean(raw) {
  let url = raw.replace(/[.,;:!?]+$/, '');
  while (/[)\]]$/.test(url)) {
    const open = (url.match(/[([]/g) || []).length;
    const close = (url.match(/[)\]]/g) || []).length;
    if (close <= open) break;
    url = url.slice(0, -1).replace(/[.,;:!?]+$/, '');
  }
  return url;
}

