

import { vault } from './vault';

/**
 * A device-local setting that tells you when it changes.
 *
 * The reason this exists: features like tilt-to-read and the flip gesture read
 * their configuration once, when their watcher starts. Writing a new value to
 * the vault therefore changed nothing until the page was reloaded, which made
 * every toggle look broken — you flipped a switch and had to refresh to find out
 * whether it had worked.
 *
 * So a write notifies. Anything holding a live sensor subscription re-reads and
 * restarts itself, and the switch takes effect on the tap.
 *
 * Kept out of ./motion on purpose: this touches the vault, and the motion tests
 * import that module for real. Keeping storage on this side of the line means
 * they do not have to stub IndexedDB.
 */
export function deviceSetting(key, defaults = {}) {
  const listeners = new Set();

  const read = async () => ({ ...defaults, ...((await vault.getMeta(key)) || {}) });

  return {
    get: read,

    async set(patch) {
      const next = { ...(await read()), ...patch };
      await vault.setMeta(key, next);

      // One listener throwing must not stop the others hearing about it.
      listeners.forEach((fn) => {
        try {
          fn(next);
        } catch {
          /* a subscriber's problem, not this one's */
        }
      });

      return next;
    },

    /** Returns an unsubscribe function. */
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
