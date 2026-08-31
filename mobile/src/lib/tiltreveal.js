

import { deviceSetting } from './devicesetting';
import { G, isSupported, listen } from './motion';

export {
  isSupported,
  needsPermission,
  requestPermission,
  unsupportedReason,
  probe,
} from './motion';

/**
 * Tilt to read: message content stays blurred until you raise the phone.
 *
 * Aimed at the specific, ordinary threat of somebody reading over your
 * shoulder — on a train, across a desk, next to you on a sofa. A phone lying
 * flat is visible to everyone around it; a phone raised steeply toward your own
 * face has a narrow viewing cone. So the blur lifts on that angle and nothing
 * else.
 *
 * The measurement is the angle between the screen and horizontal, derived from
 * where gravity falls on the z axis:
 *
 *     flat, face-up    z = +g   →   0°
 *     upright          z =  0   →  90°
 *     face-down        z = −g   → 180°
 *
 * Two properties of that formula matter. It ignores rotation about the screen's
 * own axis, so portrait and landscape behave identically without special-casing
 * either. And it needs no compass, so it does not care which way the room faces.
 *
 * Deliberately *not* a security boundary. It defeats a glance, not a camera, and
 * the settings copy says exactly that — a blur that people believe is stronger
 * than it is would be worse than no blur.
 */

const META_KEY = 'tiltReveal';

/** Degrees of overlap between revealing and re-hiding, to stop it flickering
 *  when the phone is held right at the threshold. */
const HYSTERESIS = 8;

/** Smooths a noisy accelerometer, as in the flip gesture. */
const SMOOTHING = 0.25;

export const SENSITIVITY = [
  { value: 35, label: 'Gentle', hint: 'Reveals with a small lift' },
  { value: 50, label: 'Normal', hint: 'Reveals at a normal reading angle' },
  { value: 65, label: 'Strict', hint: 'Only when held steeply upright' },
];

/** How long a tap holds the blur off, for a phone in a stand or a mount. */
export const PEEK_MS = 6000;

/* ─────────────────────────────── the maths ─────────────────────────────── */

/**
 * Screen angle from horizontal, in degrees, or null if the reading is unusable.
 *
 * Uses the measured magnitude rather than assuming 9.81: a phone in a moving car
 * or a hand that is still settling reads high, and normalising against the
 * actual vector keeps acos in range instead of returning NaN.
 */
export function tiltAngle({ x = 0, y = 0, z = 0 } = {}) {
  const magnitude = Math.hypot(x, y, z);
  // Free-fall, or a sensor returning nothing useful. No angle to report.
  if (!Number.isFinite(magnitude) || magnitude < G * 0.35) return null;

  const ratio = Math.min(1, Math.max(-1, z / magnitude));
  return (Math.acos(ratio) * 180) / Math.PI;
}

/* ─────────────────────────────── settings ─────────────────────────────── */

/**
 * Device-local, like the flip gesture: it describes this screen, not the account.
 * Observable, so the curtain restarts the moment the switch is tapped instead of
 * waiting for a reload.
 */
export const config = deviceSetting(META_KEY, { enabled: false, threshold: 50 });

/* ─────────────────────────────── watching ─────────────────────────────── */

/**
 * Reports whether content should be readable right now.
 *
 * `onChange` fires only on a transition, not per sample — at 60Hz anything else
 * would mean sixty class toggles a second for no reason.
 *
 * Starts hidden and stays hidden until a sample says otherwise, which is also
 * what happens when the app comes back from the background: motion events stop
 * while a page is hidden, so the last known angle is not to be trusted.
 */
export function watch(onChange, { threshold = 50 } = {}) {
  if (!isSupported()) return () => {};

  const revealAt = threshold;
  const hideAt = Math.max(5, threshold - HYSTERESIS);

  let smoothed = null;
  let readable = false;

  onChange(false);

  return listen((a) => {
    const angle = tiltAngle(a);
    if (angle === null) return;

    smoothed = smoothed === null ? angle : smoothed + SMOOTHING * (angle - smoothed);

    // Asymmetric thresholds: it takes more of a lift to reveal than to keep
    // revealed, so a steady hand near the boundary does not flicker.
    const next = readable ? smoothed > hideAt : smoothed >= revealAt;
    if (next === readable) return;

    readable = next;
    onChange(readable);
  });
}

export const TUNING = { hysteresis: HYSTERESIS, peekMs: PEEK_MS };
