import { useColorScheme } from 'react-native';
import { useMemo } from 'react';

/**
 * The palette, carried over from the web client's CSS variables.
 *
 * Same values, so the two clients look like one product; expressed as plain
 * objects because there is no cascade to hang them off. `useTheme` reads the
 * system scheme, which is the "auto" the web app defaults to.
 */

const wa = {
  100: '#d9fdd3',
  200: '#a5e5b8',
  500: '#21c063',
  600: '#1daa61',
  700: '#128c7e',
  800: '#075e54',
  900: '#005c4b',
};

export const light = {
  scheme: 'light',
  app: '#f0f2f5',
  surface: '#ffffff',
  surface2: '#f7f8fa',
  surface3: '#eef0f2',
  header: '#f0f2f5',
  border: '#e4e6e9',
  borderStrong: '#d1d7db',
  ink: '#111b21',
  inkSoft: '#3b4a54',
  inkMuted: '#667781',
  inkFaint: '#8696a0',
  accent: wa[500],
  accentDeep: wa[700],
  accentInk: '#ffffff',
  accentTint: '#e7fbef',
  bubbleOut: wa[100],
  bubbleOutInk: '#111b21',
  bubbleIn: '#ffffff',
  bubbleInInk: '#111b21',
  meta: 'rgba(17,27,33,.45)',
  tickRead: '#53bdeb',
  danger: '#e5484d',
  warn: '#f5a524',
  wallpaper: '#efe7dd',
  overlay: 'rgba(11,20,26,.45)',
};

export const dark = {
  scheme: 'dark',
  app: '#0b141a',
  surface: '#111b21',
  surface2: '#182229',
  surface3: '#202c33',
  header: '#202c33',
  border: '#222d34',
  borderStrong: '#2a3942',
  ink: '#e9edef',
  inkSoft: '#d1d7db',
  inkMuted: '#8696a0',
  inkFaint: '#667781',
  accent: wa[500],
  accentDeep: wa[600],
  accentInk: '#04160c',
  accentTint: '#0e2b1c',
  bubbleOut: '#144d37',
  bubbleOutInk: '#e9edef',
  bubbleIn: '#202c33',
  bubbleInInk: '#e9edef',
  meta: 'rgba(233,237,239,.55)',
  tickRead: '#53bdeb',
  danger: '#f2555a',
  warn: '#f5a524',
  wallpaper: '#0b141a',
  overlay: 'rgba(0,0,0,.6)',
};

export function useTheme() {
  const scheme = useColorScheme();
  return useMemo(() => (scheme === 'dark' ? dark : light), [scheme]);
}

/** Spacing and radii, so screens do not each invent their own. */
export const radius = { bubble: 8, card: 12, sheet: 16, pill: 999 };
export const space = (n) => n * 4;
