'use client';

import { deviceSetting } from './devicesetting';
import { isSupported, listen } from './motion';

export {
  isSupported,
  needsPermission,
  requestPermission,
  unsupportedReason,
  probe,
} from './motion';

/**
 * Shake the phone to raise the emergency share.
 *
 * The case for it: the emergency sheet is three taps deep — menu, Emergency
 * share, the button — and all three assume you can look at a screen and aim at
 * a target. Somebody being followed, or in a car, or holding the phone inside a
 * pocket, cannot do any of that. Shaking is the one gesture that needs no
 * accuracy, no sight, and no particular grip.
 *
 * The whole difficulty is telling a shake apart from walking, from a phone
 * bouncing in a bag, and from being handed to someone — which is why this is a
 * peak counter and not a threshold.
 *
 *   1. Gravity is estimated with a slow low-pass and subtracted, leaving only
 *      what the hand did. Without that, holding the phone at a different angle
 *      changes the reading as much as shaking it does.
 *   2. A peak counts only after the signal has fallen back below a lower bar.
 *      That hysteresis is what makes it count *shakes* rather than samples: one
 *      hard jolt is one peak however long it lasts.
 *   3. Enough peaks have to land inside a short window. A single knock never
 *      qualifies, and the slow one-hertz rhythm of walking cannot accumulate
 *      four peaks in a second and a half.
 *
 * What it deliberately does not do is fire the alert. It asks. A gesture this
 * broad will have false positives, and a false positive here broadcasts your
 * location to five people — so the callback opens a countdown that any tap
 * cancels, and only silence sends. An emergency feature that cries wolf is one
 * people switch off, and a switched-off safety feature protects nobody.
 *
 * Note the same limitation as the flip gesture: browsers stop delivering motion
 * events to a hidden page, so this can only fire while Chax is on screen. The
 * settings copy says so rather than implying otherwise.
 */

const META_KEY = 'shakeSos';

/** How long a burst of peaks has to arrive within, to count as one shake. */
const WINDOW_MS = 1500;

/** Gravity estimate. Slow on purpose — it should track orientation, not motion. */
const GRAVITY_SMOOTHING = 0.08;

/** A peak is only re-armed once the signal drops to this fraction of the bar. */
const RELEASE_RATIO = 0.45;

/** One trigger per shake; the hand is still moving when the callback runs. */
const REARM_MS = 4000;

/**
 * Thresholds in m/s² of linear acceleration, and how many peaks are needed.
 *
 * `firm` exists for a phone that lives in a bag or a coat pocket, where the
 * ambient jostling of a bus ride would trip anything gentler.
 */
export const SENSITIVITY = [
  {
    value: 'gentle',
    label: 'Gentle',
    hint: 'A small shake is enough — more false alarms',
    peak: 11,
    peaks: 3,
  },
  {
    value: 'normal',
    label: 'Normal',
    hint: 'A deliberate shake, about a second long',
    peak: 16,
    peaks: 4,
  },
  {
    value: 'firm',
    label: 'Firm',
    hint: 'Hard shaking only — best if the phone lives in a bag',
    peak: 23,
    peaks: 5,
  },
];

export const profileFor = (value) =>
  SENSITIVITY.find((s) => s.value === value) || SENSITIVITY[1];

/** How long the cancel countdown runs before the alert actually goes out. */
export const COUNTDOWN_MS = 5000;

/* ─────────────────────────────── settings ─────────────────────────────── */

/**
 * Device-local, like the other two gestures. A laptop has no accelerometer, and
 * a gesture armed on a phone should not follow the user to a desktop where it
 * can never fire.
 *
 * Observable, so arming or disarming takes effect on the tap rather than at the
 * next reload.
 */
export const config = deviceSetting(META_KEY, {
  enabled: false,
  sensitivity: 'normal',
});

/* ─────────────────────────────── detection ─────────────────────────────── */

/**
 * The linear acceleration left once gravity is removed.
 *
 * Exported for the tests, which is the only honest way to check the filter
 * separately from the counter it feeds.
 */
export function jolt({ x = 0, y = 0, z = 0 } = {}, gravity) {
  const magnitude = Math.hypot(x, y, z);
  // A sensor returning nothing usable, or free-fall. Either way, no reading.
  if (!Number.isFinite(magnitude)) return null;

  const next = gravity
    ? {
        x: gravity.x + GRAVITY_SMOOTHING * (x - gravity.x),
        y: gravity.y + GRAVITY_SMOOTHING * (y - gravity.y),
        z: gravity.z + GRAVITY_SMOOTHING * (z - gravity.z),
      }
    : { x, y, z };

  return {
    gravity: next,
    // What the hand did, with the pull of the earth taken out.
    linear: Math.hypot(x - next.x, y - next.y, z - next.z),
  };
}

/**
 * Watches for a shake and calls `onShake` once per burst.
 *
 * Returns a stop function. Like the flip gesture it does no permission handling
 * of its own: by the time anything is watching, the answer is already known.
 */
export function watch(onShake, { sensitivity = 'normal' } = {}) {
  if (!isSupported()) return () => {};

  const profile = profileFor(sensitivity);
  const release = profile.peak * RELEASE_RATIO;

  let gravity = null;
  /** Timestamps of recent peaks, oldest first. */
  let peaks = [];
  /** False while the signal is still above the bar from the last peak. */
  let armed = true;
  /** Cleared for a moment after firing, so one shake is one alert. */
  let live = true;
  /** Samples seen, so the gravity filter is not judged before it has settled. */
  let seen = 0;

  const onMotion = (sample) => {
    const reading = jolt(sample, gravity);
    if (!reading) return;

    gravity = reading.gravity;
    seen += 1;

    /* The filter needs a moment to lock on. Without this, the very first sample
       reads as a huge jolt — the estimate starts at zero — and picking the phone
       up would fire the alarm. */
    if (seen < 12) return;

    const now = Date.now();

    if (armed && reading.linear >= profile.peak) {
      armed = false;
      peaks.push(now);
    } else if (!armed && reading.linear <= release) {
      armed = true;
    }

    // Only peaks inside the window count towards a shake.
    peaks = peaks.filter((at) => now - at <= WINDOW_MS);

    if (live && peaks.length >= profile.peaks) {
      live = false;
      peaks = [];
      try {
        onShake({ peaks: profile.peaks, sensitivity: profile.value });
      } finally {
        setTimeout(() => {
          live = true;
        }, REARM_MS);
      }
    }
  };

  return listen(onMotion);
}

export const WINDOW = WINDOW_MS;
export const REARM = REARM_MS;
