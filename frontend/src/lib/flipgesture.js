'use client';

import { vault } from './vault';
import { isSupported, listen } from './motion';

export {
  isSupported,
  needsPermission,
  requestPermission,
  unsupportedReason,
  probe,
} from './motion';

/**
 * Flip face-down and back up to lock or sign out.
 *
 * A panic gesture: something you can do with one hand, without looking, while
 * someone is walking towards you. Turning the phone over is about the most
 * natural version of that.
 *
 * The whole difficulty is telling it apart from putting your phone down on a
 * table, which is the same motion and happens twenty times a day. The
 * discriminator is *how long it stays face-down*: a deliberate flip is a flick —
 * down and back within a second or two — while setting a phone down leaves it
 * there for far longer. So the face-down interval has to fall inside a window:
 * long enough to rule out a wobble, short enough to rule out "put it on the
 * desk". Outside that window the gesture quietly resets instead of firing.
 *
 * Uses `devicemotion` rather than orientation because gravity on the z axis is a
 * direct read of which way the screen is pointing — roughly +9.8 face-up and
 * −9.8 face-down — with no dependence on compass heading or which way the user
 * happens to be facing.
 *
 * Note this can only work while Chax is on screen: browsers stop delivering
 * motion events to a hidden page. The settings copy says so rather than
 * implying a protection that is not there.
 */

const META_KEY = 'panicGesture';

/* Gravity is ~9.81 m/s². 7 leaves a wide neutral band around the vertical, so
   holding the phone upright to read is never mistaken for either face. */
const FACE_THRESHOLD = 7;

/* Below this, it was a knock or a pocket shuffle rather than a turn. */
const MIN_DOWN_MS = 350;
/* Beyond this, the phone was put down rather than flipped. */
const MAX_DOWN_MS = 3000;

/* Smooths the accelerometer, which is noisy enough that a single sample either
   side of the threshold would rattle the state machine. */
const SMOOTHING = 0.35;

export const ACTIONS = [
  {
    value: 'lock',
    label: 'Lock Chax',
    hint: 'Instant, and nothing is lost — your PIN or fingerprint reopens it',
  },
  {
    value: 'logout',
    label: 'Sign out',
    hint: 'Ends the session on this device and clears its local history',
  },
];

/* ─────────────────────────────── settings ─────────────────────────────── */

/**
 * Kept on the device, not the account. A laptop has no accelerometer, and a
 * gesture armed on a phone should not follow the user to a desktop where it can
 * never fire and would only be confusing to find switched on.
 */
export const config = {
  async get() {
    const stored = await vault.getMeta(META_KEY);
    return { enabled: false, action: 'lock', ...(stored || {}) };
  },

  async set(patch) {
    const current = await config.get();
    const next = { ...current, ...patch };
    await vault.setMeta(META_KEY, next);
    return next;
  },
};

/* ─────────────────────────────── detection ─────────────────────────────── */

/**
 * Watches for the gesture and calls `onFlip` once per completed flip.
 *
 * Returns a stop function. Deliberately does no permission handling of its own:
 * by the time anything is watching, the answer is already known.
 */
export function watch(onFlip, { minDown = MIN_DOWN_MS, maxDown = MAX_DOWN_MS } = {}) {
  if (!isSupported()) return () => {};

  let smoothed = null;
  let face = null; // 'up' | 'down' | null while still settling
  let downAt = 0;
  /* One trigger per flip. Without this the few samples after the phone comes
     back up would each re-fire while the handler is still running. */
  let armed = true;

  const onMotion = ({ z }) => {
    smoothed = smoothed === null ? z : smoothed + SMOOTHING * (z - smoothed);

    const next =
      smoothed > FACE_THRESHOLD ? 'up' : smoothed < -FACE_THRESHOLD ? 'down' : null;

    // Inside the neutral band nothing changes — that is what the band is for.
    if (!next || next === face) return;

    if (next === 'down') {
      downAt = Date.now();
      face = 'down';
      return;
    }

    // next === 'up'
    const wasDownFor = face === 'down' ? Date.now() - downAt : Infinity;
    face = 'up';

    if (armed && wasDownFor >= minDown && wasDownFor <= maxDown) {
      armed = false;
      try {
        onFlip({ downMs: wasDownFor });
      } finally {
        // Long enough that the wrist settling after the flip cannot count as a
        // second one, short enough to be usable twice in a row.
        setTimeout(() => {
          armed = true;
        }, 1200);
      }
    }
  };

  return listen(onMotion);
}

export const TIMING = { minDown: MIN_DOWN_MS, maxDown: MAX_DOWN_MS };
