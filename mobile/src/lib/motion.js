import { Accelerometer } from 'expo-sensors';

/**
 * Shared plumbing for the three motion features — flip-to-hide, tilt-to-read
 * and shake-for-emergency.
 *
 * The native counterpart of the web client's `lib/motion.js`. The gesture
 * detectors above it are ported verbatim, which is only safe because this
 * module hands them samples in **exactly the same units**: the web reads
 * `DeviceMotionEvent.accelerationIncludingGravity`, which is m/s², while
 * expo-sensors reports multiples of g. Every sample is therefore scaled by
 * 9.81 on the way through. Skipping that would leave every threshold in the
 * detectors out by an order of magnitude — the gestures would either never fire
 * or fire constantly, and the arithmetic would look correct in both files.
 */

/** Gravity, for turning a reading into an angle. */
export const G = 9.81;

/** 50 Hz. Fast enough to catch a shake peak, slow enough not to cost battery. */
const INTERVAL_MS = 20;

let available = null;

export function isSupported() {
  // Synchronous answer for call sites that only gate UI; `probe` is the honest
  // check and is what the settings screen uses.
  return available !== false;
}

/** Android needs no runtime prompt for the accelerometer. */
export const needsPermission = () => false;
export const requestPermission = async () => true;

export function unsupportedReason() {
  if (available === false) return 'This device has no motion sensor';
  return null;
}

/**
 * Waits for a real sample to prove there is a sensor behind the API.
 *
 * `Accelerometer.isAvailableAsync` is the documented check, but an emulator
 * answers yes and then never emits, so a sample is what actually settles it.
 */
export async function probe({ timeout = 2000 } = {}) {
  try {
    const declared = await Accelerometer.isAvailableAsync();
    if (!declared) {
      available = false;
      return false;
    }
  } catch {
    available = false;
    return false;
  }

  return new Promise((resolve) => {
    let settled = false;
    let subscription = null;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      available = result;
      clearTimeout(timer);
      try {
        subscription?.remove();
      } catch {
        /* already gone */
      }
      resolve(result);
    };

    const timer = setTimeout(() => finish(false), timeout);

    try {
      Accelerometer.setUpdateInterval(INTERVAL_MS);
      subscription = Accelerometer.addListener(({ z }) => {
        if (typeof z === 'number' && !Number.isNaN(z)) finish(true);
      });
    } catch {
      finish(false);
    }
  });
}

/**
 * Attaches a motion listener that only sees usable samples, in m/s².
 *
 * Returns a detach function, matching the web's contract exactly so the gesture
 * detectors need no changes.
 */
export function listen(onSample) {
  let subscription = null;

  try {
    Accelerometer.setUpdateInterval(INTERVAL_MS);
    subscription = Accelerometer.addListener(({ x, y, z }) => {
      if (typeof z !== 'number' || Number.isNaN(z)) return;
      onSample({ x: x * G, y: y * G, z: z * G });
    });
  } catch {
    return () => {};
  }

  return () => {
    try {
      subscription?.remove();
    } catch {
      /* already detached */
    }
  };
}
