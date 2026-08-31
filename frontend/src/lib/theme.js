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

/**
 * Mobile status/URL-bar colour per theme.
 *
 * Kept as constants rather than read back off `--header` at runtime: the theme
 * class lands on <html> in next-themes' own effect, so any synchronous read
 * (or one a frame later) can still return the colour being replaced. These
 * must stay equal to `--header` in globals.css.
 */
export const STATUS_BAR = { light: '#f7f8fa', dark: '#101614' };

/**
 * The status bar during a call.
 *
 * A call takes the whole screen, and the strip the phone draws above it is not
 * ours to paint with anything except this tag — so leaving it on the app's
 * normal header colour put a pale grey band across the top of a near-black call
 * screen, or a chat-dark band that did not quite match it. These are sampled
 * from what the call screen actually renders: `#0a0f0d` is the call canvas, and
 * each state is that canvas carrying the same tint the screen itself is showing
 * at that moment — the lime bloom while it rings, a deeper lime once the call is
 * up, the danger red when it could not connect. The head panel then reads as
 * the top edge of the call rather than as a seam.
 *
 * Kept dark across both themes, because the call screen is dark in both.
 */
export const CALL_STATUS_BAR = {
  /* Ringing, incoming. The brand lime bloom is at its strongest here, and this
     is the one that has to be recognisable at a glance from a pocket. */
  incoming: '#132a13',
  /* Ringing, outgoing, and connecting — the canvas with only a trace of lime. */
  outgoing: '#0d1710',
  /* Up and connected. */
  connected: '#102015',
  /* Reconnecting: the warning amber, folded into the same near-black. */
  reconnecting: '#221a0d',
  /* Failed. */
  failed: '#2a1014',
};

/**
 * One owner for the status-bar tags.
 *
 * There are two writers — the theme, and a call that wants the head panel to
 * match it — and two tags to keep in step, so both go through here. A call
 * pushes an override and drops it when it ends; the base colour underneath it
 * is whatever the theme last set, so the bar returns to the right colour on
 * hang-up even if the theme changed mid-call.
 */
let baseColor = STATUS_BAR.dark;
let baseDark = true;
let override = null;

function applyStatusBar() {
  if (typeof document === 'undefined') return;

  const color = override || baseColor;
  // An override is only ever used for the call screen, which is dark.
  const dark = override ? true : baseDark;

  let meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.setAttribute('name', 'theme-color');
    document.head.appendChild(meta);
  }
  meta.setAttribute('content', color);

  // iOS standalone reads this one instead; `black-translucent` would let
  // content slide under the notch, so each theme gets the opaque style that
  // actually exists.
  let status = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
  if (!status) {
    status = document.createElement('meta');
    status.setAttribute('name', 'apple-mobile-web-app-status-bar-style');
    document.head.appendChild(status);
  }
  status.setAttribute('content', dark ? 'black' : 'default');
}

/** The colour the bar returns to: the app's own header, per theme. */
export function setStatusBarBase(isDark) {
  baseDark = !!isDark;
  baseColor = STATUS_BAR[isDark ? 'dark' : 'light'];
  applyStatusBar();
}

/** Paint the bar to match a full-screen surface. `null` gives it back. */
export function setStatusBarOverride(color) {
  override = color || null;
  applyStatusBar();
}

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
