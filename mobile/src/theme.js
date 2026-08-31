import { useColorScheme } from 'react-native';
import { useMemo } from 'react';

/**
 * The palette, taken from the web client's `globals.css` token by token.
 *
 * The brand colour is the thing to get right: `accent` is the lime from the app
 * icon and it is a **fill**, not a text colour. Dark ink (`accentInk`) sits on
 * top of it. As text on a light background it is roughly 1.4:1 and unreadable,
 * which is why the web client carries a separate `accentStrong` — a deep olive
 * in light mode, the lime itself in dark — for every place that renders
 * brand-coloured *text*. Using `accent` for a label is the mistake this comment
 * exists to prevent.
 */

export const light = {
  scheme: 'light',

  app: '#ffffff',
  surface: '#ffffff',
  surface2: '#f7f8fa',
  surface3: '#eff2f5',
  raised: '#ffffff',
  header: '#f7f8fa',

  border: 'rgba(17,27,33,0.08)',
  borderStrong: 'rgba(17,27,33,0.16)',

  ink: '#111b21',
  inkSoft: '#3b4a54',
  inkMuted: '#667781',
  inkFaint: '#8696a0',

  accent: '#c1ff72',
  accentStrong: '#4d7c0f',
  accentDeep: '#3f6212',
  accentInk: '#14200a',
  accentHover: '#aef05a',
  accentTint: 'rgba(193,255,114,0.34)',

  bubbleOut: '#d9fdd3',
  bubbleOutInk: '#111b21',
  bubbleIn: '#ffffff',
  bubbleInInk: '#111b21',
  meta: 'rgba(17,27,33,0.45)',
  metaIn: 'rgba(17,27,33,0.4)',

  wallpaper: '#efe7de',
  tickRead: '#53bdeb',
  danger: '#ea0038',
  warn: '#ffa726',
  info: '#027eb5',
  overlay: 'rgba(11,20,26,0.45)',

  // The brand panel behind the auth screens.
  brandPanel: '#075e54',
};

export const dark = {
  scheme: 'dark',

  /* `app` deliberately sits a step below `surface` — the window reads as the
     darkest layer with the lists floating above it, which is what gives the
     web client its depth. */
  app: '#0a0f0d',
  surface: '#101614',
  surface2: '#1c2321',
  surface3: '#29312e',
  raised: '#182120',
  header: '#101614',

  border: 'rgba(233,237,239,0.08)',
  borderStrong: 'rgba(233,237,239,0.16)',

  ink: '#e9edef',
  inkSoft: '#d3d9d7',
  inkMuted: '#8c9a95',
  inkFaint: '#6a7772',

  accent: '#c1ff72',
  // On a near-black ground the lime is legible as text too, so this stays
  // bright here rather than dropping to the deep variant.
  accentStrong: '#c1ff72',
  accentDeep: '#9fe04a',
  accentInk: '#14200a',
  accentHover: '#d2ff92',
  accentTint: 'rgba(193,255,114,0.16)',

  bubbleOut: '#144d37',
  bubbleOutInk: '#e9edef',
  bubbleIn: '#1c2321',
  bubbleInInk: '#e9edef',
  meta: 'rgba(233,237,239,0.55)',
  metaIn: 'rgba(233,237,239,0.45)',

  wallpaper: '#0b100e',
  tickRead: '#53bdeb',
  danger: '#f15c6d',
  warn: '#ffb84d',
  info: '#53bdeb',
  overlay: 'rgba(0,0,0,0.6)',

  brandPanel: '#0b100e',
};

export function useTheme() {
  const scheme = useColorScheme();
  return useMemo(() => (scheme === 'dark' ? dark : light), [scheme]);
}

/**
 * Type.
 *
 * Satre carries the interface — every label, message and list row. Outfit is
 * reserved for headings and numerals, the same split the web client makes, and
 * the reason headings there set `font-display` with tighter tracking.
 */
export const font = {
  body: 'Satre',
  display: 'Outfit_600SemiBold',
  displayMedium: 'Outfit_500Medium',
  displayBold: 'Outfit_700Bold',
};

/** Heading style, matching `h1..h4, .font-display` in globals.css. */
export const heading = (size) => ({
  fontFamily: font.display,
  fontSize: size,
  letterSpacing: -0.02 * size,
});

export const radius = { bubble: 8, card: 12, sheet: 16, pill: 999 };
export const space = (n) => n * 4;
