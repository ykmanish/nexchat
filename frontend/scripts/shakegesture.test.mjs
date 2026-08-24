/**
 * Tests the shake detector against synthetic accelerometer data.
 *
 * The thing worth proving is the discriminator, as with the flip gesture: a
 * deliberate shake has to fire, and the three things that happen far more often
 * — walking, one hard knock, and picking the phone up off a table — must not.
 * A safety trigger with false positives gets switched off, and a switched-off
 * safety feature protects nobody.
 *
 * Run: node scripts/shakegesture.test.mjs   (from frontend/)
 */
import fs from 'node:fs';
import path from 'node:path';

/* ── harness ── */

const listeners = new Set();
globalThis.window = {
  isSecureContext: true,
  DeviceMotionEvent: function DeviceMotionEvent() {},
  addEventListener: (type, fn) => type === 'devicemotion' && listeners.add(fn),
  removeEventListener: (type, fn) => listeners.delete(fn),
};

/* Time and timers are driven by the test, so the re-arm window costs no real
   seconds and cannot flake on a slow machine. */
let now = 1_700_000_000_000;
Date.now = () => now;

const timers = [];
globalThis.setTimeout = (fn, ms) => {
  timers.push({ at: now + ms, fn });
  return timers.length;
};

/** Advances the clock, running any timer that comes due. */
function advance(ms) {
  const target = now + ms;
  for (;;) {
    const due = timers.filter((t) => !t.done && t.at <= target).sort((a, b) => a.at - b.at)[0];
    if (!due) break;
    now = due.at;
    due.done = true;
    due.fn();
  }
  now = target;
}

/**
 * The module imports the vault, which pulls in `idb` and cannot load outside a
 * browser. `watch` touches none of it, so the import and the settings helper are
 * stripped from a working copy — the detector under test is byte-identical.
 */
const source = fs.readFileSync(path.resolve('src/lib/shakegesture.js'), 'utf8');
const stripped = source
  .replace(/import \{ deviceSetting \} from '\.\/devicesetting';\n/, '')
  // The app resolves extensionless imports through its bundler; raw Node ESM
  // does not, so the one that survives the strip gets its extension back.
  .replaceAll("'./motion'", "'./motion.js'")
  .replace(/export const config = deviceSetting\([\s\S]*?\}\);\n/, '');

/* Beside the original rather than in a temp directory, so the module's
   remaining relative import of ./motion still resolves. */
const shim = path.resolve('src/lib/.shakegesture.undertest.mjs');
fs.writeFileSync(shim, stripped);
const shake = await import('file://' + shim.replace(/\\/g, '/'));

/* ── driving the sensor ── */

const G = 9.81;
const SAMPLE_MS = 16; // ~60Hz, which is what a phone actually reports

function sample(x, y, z) {
  now += SAMPLE_MS;
  listeners.forEach((fn) => fn({ accelerationIncludingGravity: { x, y, z } }));
}

/** Phone held still, upright. Lets the gravity filter lock on. */
function still(ms) {
  const steps = Math.max(1, Math.round(ms / SAMPLE_MS));
  for (let i = 0; i < steps; i += 1) sample(0, G, 0);
}

/**
 * A shake: `count` alternating swings of `amplitude` m/s² on top of gravity.
 *
 * Alternating sign matters. Real shaking reverses direction, and a detector that
 * counted magnitude alone would score a single sustained push as a shake.
 */
function shakeIt(count, amplitude, { periodMs = 160 } = {}) {
  const perSwing = Math.max(2, Math.round(periodMs / 2 / SAMPLE_MS));
  for (let i = 0; i < count; i += 1) {
    const sign = i % 2 === 0 ? 1 : -1;
    for (let j = 0; j < perSwing; j += 1) sample(sign * amplitude, G, 0);
    // Back through neutral, which is what releases the peak latch.
    for (let j = 0; j < perSwing; j += 1) sample(0, G, 0);
  }
}

function session(sensitivity = 'normal') {
  const fired = [];
  const stop = shake.watch((detail) => fired.push(detail), { sensitivity });
  // The gravity estimate needs a run of samples before any reading is trusted.
  still(400);
  return { fired, stop };
}

/* ── cases ── */

const results = [];
const check = (name, fn) => {
  try {
    fn();
    results.push(['PASS', name]);
  } catch (err) {
    results.push(['FAIL', name, err.message]);
  }
};
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

check('a deliberate shake fires', () => {
  const { fired, stop } = session();
  shakeIt(6, 30);
  stop();
  assert(fired.length >= 1, 'expected a trigger, got none');
});

check('one hard knock does not fire', () => {
  const { fired, stop } = session();
  // A single big spike — a phone set down hard, or bumped on a table.
  shakeIt(1, 40);
  still(600);
  stop();
  assert(fired.length === 0, 'a single knock triggered it');
});

check('walking does not fire', () => {
  const { fired, stop } = session();
  // Roughly two steps a second at a few m/s², sustained for ten seconds.
  for (let i = 0; i < 20; i += 1) {
    shakeIt(1, 3.5, { periodMs: 500 });
  }
  stop();
  assert(fired.length === 0, 'walking triggered it');
});

check('picking the phone up off a table does not fire', () => {
  const { fired, stop } = session();
  // A lift is one smooth acceleration and one deceleration, no oscillation.
  for (let i = 0; i < 12; i += 1) sample(0, G + 4, 0);
  for (let i = 0; i < 12; i += 1) sample(0, G - 3, 0);
  still(400);
  stop();
  assert(fired.length === 0, 'picking it up triggered it');
});

check('holding it perfectly still does not fire', () => {
  const { fired, stop } = session();
  still(4000);
  stop();
  assert(fired.length === 0, 'sitting still triggered it');
});

check('changing the phone orientation does not fire', () => {
  const { fired, stop } = session();
  // Gravity moves from the y axis to the x axis — portrait to landscape. The
  // magnitude never changes, which is the whole point of removing gravity
  // rather than thresholding the raw reading.
  for (let i = 0; i < 40; i += 1) {
    const t = i / 40;
    sample(G * t, G * (1 - t), 0);
  }
  still(600);
  stop();
  assert(fired.length === 0, 'rotating the phone triggered it');
});

check('one shake fires exactly once', () => {
  const { fired, stop } = session();
  shakeIt(10, 30);
  stop();
  assert(fired.length === 1, 'expected 1 trigger, got ' + fired.length);
});

check('a second shake fires once re-armed', () => {
  const { fired, stop } = session();
  shakeIt(6, 30);
  advance(shake.REARM + 200);
  still(300);
  shakeIt(6, 30);
  stop();
  assert(fired.length === 2, 'expected 2 triggers, got ' + fired.length);
});

check('a firm setting ignores a gentle shake', () => {
  const { fired, stop } = session('firm');
  shakeIt(8, 13); // enough for "gentle", not for "firm"
  stop();
  assert(fired.length === 0, 'a gentle shake passed the firm threshold');
});

check('a gentle setting catches a small shake', () => {
  const { fired, stop } = session('gentle');
  shakeIt(6, 15);
  stop();
  assert(fired.length >= 1, 'a small shake missed the gentle threshold');
});

check('peaks spread beyond the window do not accumulate', () => {
  const { fired, stop } = session();
  // Four hard jolts, but one every two seconds — outside the burst window.
  for (let i = 0; i < 4; i += 1) {
    shakeIt(1, 35);
    still(2000);
  }
  stop();
  assert(fired.length === 0, 'peaks outside the window accumulated');
});

check('stopping detaches the listener', () => {
  const { fired, stop } = session();
  stop();
  shakeIt(10, 35);
  assert(fired.length === 0, 'it fired after stop()');
});

check('garbage samples are ignored', () => {
  const { fired, stop } = session();
  listeners.forEach((fn) => fn({}));
  listeners.forEach((fn) => fn({ accelerationIncludingGravity: null }));
  listeners.forEach((fn) => fn({ accelerationIncludingGravity: { x: null, y: null, z: null } }));
  stop();
  assert(fired.length === 0, 'garbage triggered it');
});

check('an unknown sensitivity falls back to normal', () => {
  const profile = shake.profileFor('nonsense');
  assert(profile.value === 'normal', 'expected the normal profile, got ' + profile.value);
});

check('gravity is removed from the reading', () => {
  // A phone at rest reads a full g, and the filter should report almost no
  // linear acceleration once it has settled.
  let gravity = null;
  let linear = 0;
  for (let i = 0; i < 120; i += 1) {
    const r = shake.jolt({ x: 0, y: G, z: 0 }, gravity);
    gravity = r.gravity;
    linear = r.linear;
  }
  assert(linear < 0.5, 'a resting phone reported ' + linear.toFixed(2) + ' m/s² of motion');
});

/* ── report ── */

fs.unlinkSync(shim);

const failed = results.filter((r) => r[0] === 'FAIL');
results.forEach(([status, name, why]) => {
  console.log((status === 'PASS' ? '  ok  ' : '  FAIL') + '  ' + name + (why ? ' — ' + why : ''));
});
console.log(
  '\n' + (results.length - failed.length) + '/' + results.length + ' shake-gesture checks passed'
);
process.exit(failed.length ? 1 : 0);
