'use client';

/**
 * Remembers where each scrollable pane was left.
 *
 * A tab you return to should be where you left it. The browser restores scroll
 * for real navigations, but a client-side route change inside a single shell is
 * not one — every pane came back at the top, which on a feed you were fifty
 * cards into is the single most annoying thing an app can do.
 *
 * Kept in a module map rather than sessionStorage: it is per-tab, it should not
 * survive a reload (a reload is a deliberate fresh start), and writing to
 * storage on every scroll frame would be absurd.
 */
const positions = new Map();

export const rememberScroll = (key, top) => {
  if (key) positions.set(key, top);
};

export const recallScroll = (key) => positions.get(key) || 0;

export const forgetScroll = (key) => positions.delete(key);

export const clearScrollMemory = () => positions.clear();
