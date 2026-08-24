/**
 * Tests the flip-gesture state machine against synthetic accelerometer data.
 *
 * The thing actually worth proving is the discriminator: a deliberate flip has
 * to fire, and putting the phone down on a table — the same motion, held for
 * longer — must not. Everything else here guards the edges around that.
 *
 * Run: node scripts/flipgesture.test.mjs   (from frontend/)
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

/* Time and timers are driven by the test, so a "3 second" case does not take
   three seconds and cannot flake on a slow machine. */
let now = 1_700_000_000_000;
const realNow = Date.now;
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
 * stripped from a working copy — the state machine under test is byte-identical.
 */
const source = fs.readFileSync(
  path.resolve('src/lib/flipgesture.js'),
  'utf8'
);
const stripped = source
  .replace("import { vault } from './vault';", '')
  // The app resolves extensionless imports through its bundler; raw Node ESM
  // does not, so the one that survives the strip gets its extension back.
  .replaceAll("'./motion'", "'./motion.js'")
  .replace(/export const config = \{[\s\S]*?\n\};\n/, '');

/* Beside the original rather than in a temp directory, so the module's
   remaining relative import of ./motion still resolves. */
const shim = path.resolve('src/lib/.flipgesture.undertest.mjs');
fs.writeFileSync(shim, stripped);
const flip = await import('file://' + shim.replace(/\\/g, '/'));

/* ── driving the sensor ── */

const FACE_UP = 9.81;
const FACE_DOWN = -9.81;
const UPRIGHT = 0.2; // held vertically to read — neither face

/**
 * Feeds samples at 60Hz. The lib low-pass filters, so a state change needs a
 * run of samples rather than one — which is the point of the filter.
 */
function hold(z, ms) {
  const steps = Math.max(1, Math.round(ms / 16));
  for (let i = 0; i < steps; i += 1) {
    now += 16;
    listeners.forEach((fn) => fn({ accelerationIncludingGravity: { z } }));
  }
}

function session() {
  const fired = [];
  const stop = flip.watch((detail) => fired.push(detail));
  // Settle at face-up first: the machine only fires on a down→up transition,
  // so it has to know it started up.
  hold(FACE_UP, 300);
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

check('a deliberate flip fires', () => {
  const { fired, stop } = session();
  hold(FACE_DOWN, 700);
  hold(FACE_UP, 300);
  stop();
  assert(fired.length === 1, 'expected 1 trigger, got ' + fired.length);
});

check('putting the phone down on a table does not fire', () => {
  const { fired, stop } = session();
  hold(FACE_DOWN, 400);
  // Face-down for a while, as a phone on a desk is. Sampling the whole ten
  // seconds is pointless; the clock moving is what the machine reads.
  advance(10_000);
  hold(FACE_UP, 300);
  stop();
  assert(fired.length === 0, 'a phone left face-down triggered it');
});

check('a knock or pocket shuffle does not fire', () => {
  const { fired, stop } = session();
  hold(FACE_DOWN, 80);
  hold(FACE_UP, 300);
  stop();
  assert(fired.length === 0, 'a brief wobble triggered it');
});

check('holding the phone upright does nothing', () => {
  const { fired, stop } = session();
  hold(UPRIGHT, 2000);
  hold(FACE_UP, 300);
  stop();
  assert(fired.length === 0, 'reading upright triggered it');
});

check('a flip through upright still fires', () => {
  // A real hand passes through vertical on the way over; the neutral band must
  // not be mistaken for a face and break the down→up pair.
  const { fired, stop } = session();
  hold(UPRIGHT, 120);
  hold(FACE_DOWN, 600);
  hold(UPRIGHT, 120);
  hold(FACE_UP, 300);
  stop();
  assert(fired.length === 1, 'expected 1 trigger, got ' + fired.length);
});

check('one flip fires exactly once', () => {
  const { fired, stop } = session();
  hold(FACE_DOWN, 600);
  // A long face-up tail: the settling wrist must not read as more flips.
  hold(FACE_UP, 2000);
  stop();
  assert(fired.length === 1, 'expected 1 trigger, got ' + fired.length);
});

check('two flips fire twice once re-armed', () => {
  const { fired, stop } = session();
  hold(FACE_DOWN, 600);
  hold(FACE_UP, 200);
  advance(1400); // past the re-arm delay
  hold(FACE_UP, 100);
  hold(FACE_DOWN, 600);
  hold(FACE_UP, 300);
  stop();
  assert(fired.length === 2, 'expected 2 triggers, got ' + fired.length);
});

check('a flip during the re-arm window is swallowed', () => {
  const { fired, stop } = session();
  hold(FACE_DOWN, 600);
  hold(FACE_UP, 100);
  hold(FACE_DOWN, 600);
  hold(FACE_UP, 200);
  stop();
  assert(fired.length === 1, 'expected the second to be swallowed, got ' + fired.length);
});

check('stopping detaches the listener', () => {
  const { fired, stop } = session();
  stop();
  hold(FACE_DOWN, 600);
  hold(FACE_UP, 300);
  assert(fired.length === 0, 'it fired after stop()');
});

check('missing or garbage samples are ignored', () => {
  const { fired, stop } = session();
  listeners.forEach((fn) => fn({}));
  listeners.forEach((fn) => fn({ accelerationIncludingGravity: {} }));
  listeners.forEach((fn) => fn({ accelerationIncludingGravity: { z: NaN } }));
  hold(FACE_DOWN, 600);
  hold(FACE_UP, 300);
  stop();
  assert(fired.length === 1, 'garbage samples broke it');
});

check('the dwell window matches what the UI promises', () => {
  assert(flip.TIMING.minDown === 350, 'minDown moved: ' + flip.TIMING.minDown);
  assert(flip.TIMING.maxDown === 3000, 'maxDown moved: ' + flip.TIMING.maxDown);
});

/* ── report ── */

Date.now = realNow;
for (const [state, name, why] of results) {
  console.log(`${state}  ${name}${why ? '\n        ↳ ' + why : ''}`);
}
const failed = results.filter(([s]) => s === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} passed`);
fs.unlinkSync(shim);
process.exit(failed ? 1 : 0);
