/** Client-side id for optimistic messages, matched back on the server's reply. */
export const uid = () =>
  'c_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

export const idOf = (person) => String(person?._id || person?.id || person || '');

/** Chat-list timestamps: time today, weekday this week, date beyond that. */
export function shortTime(value) {
  if (!value) return '';
  const date = new Date(value);
  const now = new Date();

  const sameDay =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear();

  if (sameDay) {
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  const dayMs = 24 * 60 * 60 * 1000;
  if (now - date < 6 * dayMs) {
    return date.toLocaleDateString([], { weekday: 'short' });
  }
  return date.toLocaleDateString([], { day: 'numeric', month: 'numeric', year: '2-digit' });
}

export const clockTime = (value) =>
  value ? new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';

/** Day separators inside a thread. */
export function dayLabel(value) {
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);

  const same = (a, b) =>
    a.getDate() === b.getDate() && a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();

  if (same(date, today)) return 'Today';
  if (same(date, yesterday)) return 'Yesterday';
  return date.toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' });
}

export const initialsOf = (name) =>
  String(name || '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

/** Stable per-person avatar tint, so the same contact keeps the same colour. */
const AVATAR_COLOURS = [
  '#0E7C66', '#1F6FEB', '#8B5CF6', '#D9534F',
  '#C2681B', '#0F766E', '#9333EA', '#B4437C',
];

export function avatarColour(seed) {
  const key = String(seed || '');
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) | 0;
  return AVATAR_COLOURS[Math.abs(hash) % AVATAR_COLOURS.length];
}

export const bytes = (n) => {
  if (!n) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = n;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return (unit === 0 ? value : value.toFixed(1)) + ' ' + units[unit];
};
