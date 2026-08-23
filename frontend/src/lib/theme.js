'use client';

/**
 * Per-user appearance. Bubble colour and wallpaper are stored in the user's
 * settings and applied here as CSS variables, so a change repaints the whole
 * app instantly without a reload.
 */

/** Outgoing-bubble palettes. `ink` is chosen for contrast, not taste. */
export const BUBBLE_COLORS = [
  {
    id: 'green',
    name: 'Green',
    light: { bg: '#d9fdd3', ink: '#111b21', meta: 'rgba(17,27,33,.45)' },
    dark: { bg: '#144d37', ink: '#e9edef', meta: 'rgba(233,237,239,.55)' },
    swatch: '#25d366',
  },
  {
    id: 'teal',
    name: 'Teal',
    light: { bg: '#cdefea', ink: '#0d2f2b', meta: 'rgba(13,47,43,.45)' },
    dark: { bg: '#0f4c46', ink: '#e4f5f2', meta: 'rgba(228,245,242,.5)' },
    swatch: '#14b8a6',
  },
  {
    id: 'sky',
    name: 'Sky',
    light: { bg: '#d8ecfb', ink: '#0b2c42', meta: 'rgba(11,44,66,.45)' },
    dark: { bg: '#0d4a6b', ink: '#e3f1fb', meta: 'rgba(227,241,251,.5)' },
    swatch: '#0ea5e9',
  },
  {
    id: 'lavender',
    name: 'Lavender',
    light: { bg: '#e8e2fb', ink: '#241a4a', meta: 'rgba(36,26,74,.45)' },
    dark: { bg: '#3a2d68', ink: '#ece7fb', meta: 'rgba(236,231,251,.5)' },
    swatch: '#8b5cf6',
  },
  {
    id: 'blush',
    name: 'Blush',
    light: { bg: '#fbe0e7', ink: '#4a1226', meta: 'rgba(74,18,38,.45)' },
    dark: { bg: '#59203a', ink: '#fbe4ec', meta: 'rgba(251,228,236,.5)' },
    swatch: '#ec4899',
  },
  {
    id: 'sand',
    name: 'Sand',
    light: { bg: '#fbeed2', ink: '#42330d', meta: 'rgba(66,51,13,.45)' },
    dark: { bg: '#4a3a12', ink: '#faf0da', meta: 'rgba(250,240,218,.5)' },
    swatch: '#f59e0b',
  },
  {
    id: 'graphite',
    name: 'Graphite',
    light: { bg: '#e6e9e8', ink: '#111b21', meta: 'rgba(17,27,33,.45)' },
    dark: { bg: '#29312e', ink: '#e9edef', meta: 'rgba(233,237,239,.55)' },
    swatch: '#64748b',
  },
];

export const WALLPAPERS = [
  { id: 'doodle', name: 'Doodles', preview: '#efe7de', previewDark: '#0b100e' },
  { id: 'plain', name: 'Classic', preview: '#efe7de', previewDark: '#0b100e' },
  { id: 'paper', name: 'Paper', preview: '#f4f1ea', previewDark: '#141a17' },
  { id: 'mint', name: 'Mint', preview: '#e4f2e8', previewDark: '#0d1a16' },
  { id: 'sky', name: 'Sky', preview: '#e6eef5', previewDark: '#0c1620' },
  { id: 'blush', name: 'Blush', preview: '#f7e9ea', previewDark: '#1a1114' },
  { id: 'graphite', name: 'Graphite', preview: '#e8eaec', previewDark: '#151917' },
];

export const bubbleById = (id) =>
  BUBBLE_COLORS.find((b) => b.id === id) || BUBBLE_COLORS[0];

export const wallpaperClass = (id) =>
  'wp-' + (WALLPAPERS.find((w) => w.id === id) ? id : 'doodle');

/** Writes the chosen bubble palette onto :root for the current theme. */
export function applyBubbleTheme(bubbleId, isDark) {
  if (typeof document === 'undefined') return;

  const palette = bubbleById(bubbleId);
  const tone = isDark ? palette.dark : palette.light;
  const root = document.documentElement.style;

  root.setProperty('--bubble-out', tone.bg);
  root.setProperty('--bubble-out-ink', tone.ink);
  root.setProperty('--bubble-out-meta', tone.meta);
}

/** Font scale lives on the root so every rem/em-free size still responds. */
export function applyFontScale(scale) {
  if (typeof document === 'undefined') return;
  document.documentElement.style.setProperty('--font-scale', scale || 1);
}
