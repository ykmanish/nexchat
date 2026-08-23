'use client';

import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import {
  format,
  formatDistanceToNowStrict,
  isToday,
  isYesterday,
  isThisWeek,
  isThisYear,
  differenceInMinutes,
} from 'date-fns';

export const cn = (...inputs) => twMerge(clsx(inputs));

/* ────────────────────────────── time ────────────────────────────── */

/** Chat-list timestamps: 09:41 · Yesterday · Tue · 14/03/24 */
export function chatTime(date) {
  if (!date) return '';
  const d = new Date(date);
  if (isToday(d)) return format(d, 'HH:mm');
  if (isYesterday(d)) return 'Yesterday';
  if (isThisWeek(d, { weekStartsOn: 1 })) return format(d, 'EEE');
  if (isThisYear(d)) return format(d, 'dd/MM');
  return format(d, 'dd/MM/yy');
}

export const bubbleTime = (date) => (date ? format(new Date(date), 'HH:mm') : '');

/** Day separators inside a thread. */
export function dayLabel(date) {
  const d = new Date(date);
  if (isToday(d)) return 'Today';
  if (isYesterday(d)) return 'Yesterday';
  if (isThisWeek(d, { weekStartsOn: 1 })) return format(d, 'EEEE');
  if (isThisYear(d)) return format(d, 'd MMMM');
  return format(d, 'd MMMM yyyy');
}

export function lastSeenLabel(user) {
  if (!user) return '';
  if (user.presence === 'online') return 'Online';
  if (!user.lastSeen) return 'Offline';

  const d = new Date(user.lastSeen);
  const mins = differenceInMinutes(new Date(), d);
  if (mins < 1) return 'Last seen just now';
  if (isToday(d)) return 'Last seen today at ' + format(d, 'HH:mm');
  if (isYesterday(d)) return 'Last seen yesterday at ' + format(d, 'HH:mm');
  return 'Last seen ' + formatDistanceToNowStrict(d) + ' ago';
}

export function duration(seconds) {
  const s = Math.max(0, Math.round(seconds || 0));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    return h + ':' + String(m % 60).padStart(2, '0') + ':' + String(rem).padStart(2, '0');
  }
  return m + ':' + String(rem).padStart(2, '0');
}

/* ────────────────────────────── text ────────────────────────────── */

export function initials(name = '') {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function truncate(text = '', max = 60) {
  const t = String(text).replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

export function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return (bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
}

/** True when a message is nothing but emoji — those render large and bare. */
export function isEmojiOnly(text) {
  if (!text) return false;
  const stripped = text.replace(/\s/g, '');
  if (!stripped || stripped.length > 12) return false;
  return /^(\p{Extended_Pictographic}|\p{Emoji_Component})+$/u.test(stripped);
}

export function linkify(text = '') {
  const pattern = /(https?:\/\/[^\s<]+|www\.[^\s<]+)/gi;
  const parts = [];
  let last = 0;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) parts.push({ type: 'text', value: text.slice(last, match.index) });
    const href = match[0].startsWith('http') ? match[0] : 'https://' + match[0];
    parts.push({ type: 'link', value: match[0], href });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ type: 'text', value: text.slice(last) });
  return parts;
}

/* ────────────────────────────── colour ────────────────────────────── */

const AVATAR_COLORS = [
  '#21C063', '#0EA5E9', '#8B5CF6', '#EC4899', '#F59E0B',
  '#14B8A6', '#6366F1', '#EF4444', '#10B981', '#64748B',
];

export function colorFor(seed = '') {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

/** Picks black or white text depending on how bright the background is. */
export function readableOn(hex = '#21C063') {
  const c = hex.replace('#', '');
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.62 ? '#111B21' : '#FFFFFF';
}

/* ────────────────────────────── misc ────────────────────────────── */

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function debounce(fn, wait = 300) {
  let timer;
  const wrapped = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
  wrapped.cancel = () => clearTimeout(timer);
  return wrapped;
}

export function throttle(fn, wait = 300) {
  let last = 0;
  return (...args) => {
    const now = Date.now();
    if (now - last >= wait) {
      last = now;
      fn(...args);
    }
  };
}

export const uid = () =>
  'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

export function groupByDay(messages) {
  const groups = [];
  let current = null;

  for (const message of messages) {
    const key = new Date(message.createdAt).toDateString();
    if (!current || current.key !== key) {
      current = { key, label: dayLabel(message.createdAt), messages: [] };
      groups.push(current);
    }
    current.messages.push(message);
  }
  return groups;
}

/** Consecutive messages from one person get tucked together. */
export function withGrouping(messages) {
  return messages.map((m, i) => {
    const prev = messages[i - 1];
    const next = messages[i + 1];
    const sameSender = (a, b) =>
      a && b && String(a.sender?._id || a.sender) === String(b.sender?._id || b.sender);
    const closeInTime = (a, b) =>
      a && b && Math.abs(new Date(a.createdAt) - new Date(b.createdAt)) < 4 * 60_000;

    const isSystem = m.type === 'system' || m.type === 'call';

    return {
      ...m,
      firstOfGroup: isSystem || !(sameSender(prev, m) && closeInTime(prev, m) && prev.type !== 'system'),
      lastOfGroup: isSystem || !(sameSender(next, m) && closeInTime(m, next) && next.type !== 'system'),
    };
  });
}

/** Scrolls a message into view and flashes it so the eye can find it. */
export function scrollToMessage(messageId, { flash = true } = {}) {
  if (typeof document === 'undefined' || !messageId) return false;
  const el = document.getElementById('msg-' + messageId);
  if (!el) return false;

  el.scrollIntoView({ behavior: 'smooth', block: 'center' });

  /* A smooth scroll is driven by the compositor, and it silently does nothing
     when the compositor is not running — a hidden window, a background tab, or
     a reduced-motion preference all leave the element exactly where it was.
     Check once the animation should have finished and snap if it never moved,
     so the jump always lands. */
  setTimeout(() => {
    const r = el.getBoundingClientRect();
    const viewport = window.innerHeight || document.documentElement.clientHeight;
    if (r.bottom < 0 || r.top > viewport) el.scrollIntoView({ block: 'center' });
  }, 400);

  if (flash) {
    el.classList.remove('msg-flash');
    // Force a reflow so the animation restarts on a repeat tap.
    void el.offsetWidth;
    el.classList.add('msg-flash');
    setTimeout(() => el.classList.remove('msg-flash'), 1600);
  }
  return true;
}

/** Splits text around every case-insensitive match of `query`. */
export function highlightParts(text = '', query = '') {
  const q = query.trim();
  if (!q) return [{ match: false, value: text }];

  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = [];
  const rx = new RegExp(escaped, 'ig');
  let last = 0;
  let m;

  while ((m = rx.exec(text)) !== null) {
    if (m.index > last) parts.push({ match: false, value: text.slice(last, m.index) });
    parts.push({ match: true, value: m[0] });
    last = m.index + m[0].length;
    if (m[0].length === 0) rx.lastIndex += 1;
  }
  if (last < text.length) parts.push({ match: false, value: text.slice(last) });
  return parts;
}

export const isMobile = () =>
  typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches;

export const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;
