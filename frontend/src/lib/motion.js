'use client';

/**
 * Shared plumbing for the two motion features — flip-to-hide and tilt-to-read.
 *
 * Both need the same three awkward things from the platform, and neither should
 * own them: whether a motion sensor exists at all, iOS's permission prompt, and
 * a way to tell a browser that merely *has* the API from a device that actually
 * has hardware behind it.
 */

/** Gravity, for turning a reading into an angle. */
export const G = 9.81;

export function isSupported() {
  return (
    typeof window !== 'undefined' &&
    typeof window.DeviceMotionEvent !== 'undefined' &&
    window.isSecureContext
  );
}

/** iOS gates motion behind a prompt that must come from a real tap. */
export const needsPermission = () =>
  isSupported() && typeof window.DeviceMotionEvent.requestPermission === 'function';

/** Why this cannot be offered here, or null when it can. */
export function unsupportedReason() {
  if (typeof window === 'undefined') return null;
  if (!window.isSecureContext) return 'Needs a secure (https) connection';
  if (typeof window.DeviceMotionEvent === 'undefined') {
    return 'This device has no motion sensor';
  }
  return null;
}

/**
 * Asks for motion access. Call from inside a click handler — iOS rejects it
 * otherwise, and the rejection looks identical to the user saying no.
 */
export async function requestPermission() {
  if (!needsPermission()) return true;
  try {
    const result = await window.DeviceMotionEvent.requestPermission();
    return result === 'granted';
  } catch {
    return false;
  }
}

/**
 * Waits for a real sample to prove there is a sensor behind the API.
 *
 * `DeviceMotionEvent` exists in desktop Chrome whether or not the machine has an
 * accelerometer, so feature detection alone would happily let someone arm a
 * gesture on a laptop that can never fire it. Listening for actual gravity is
 * the only honest test — nothing arrives on a device with no sensor.
 */
export function probe({ timeout = 2000 } = {}) {
  if (!isSupported()) return Promise.resolve(false);

  return new Promise((resolve) => {
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('devicemotion', onMotion);
      clearTimeout(timer);
      resolve(result);
    };

    const onMotion = (event) => {
      const z = event.accelerationIncludingGravity?.z;
      // A sensorless browser still fires the event, just with null readings —
      // so the presence of a number is the signal, not the event itself.
      if (typeof z === 'number' && !Number.isNaN(z)) finish(true);
    };

    const timer = setTimeout(() => finish(false), timeout);
    window.addEventListener('devicemotion', onMotion);
  });
}

/**
 * Attaches a motion listener that only sees usable samples.
 *
 * Returns a detach function. Filtering the garbage here means neither feature
 * has to repeat the same three guards.
 */
export function listen(onSample) {
  if (!isSupported()) return () => {};

  const handler = (event) => {
    const a = event.accelerationIncludingGravity;
    if (!a) return;
    if (typeof a.z !== 'number' || Number.isNaN(a.z)) return;
    onSample(a);
  };

  window.addEventListener('devicemotion', handler);
  return () => window.removeEventListener('devicemotion', handler);
}
