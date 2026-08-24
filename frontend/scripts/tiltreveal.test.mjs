/**
 * Tests tilt-to-read against synthetic gravity vectors.
 *
 * The two claims worth proving are that a phone lying flat stays hidden and a
 * phone raised to read does not, and that the answer does not change when the
 * phone is rotated in its own plane — portrait, landscape, upside down. That
 * rotation-invariance is the whole reason the angle is computed from z alone,
 * so it deserves a test rather than a comment.
 *
 * Run: node scripts/tiltreveal.test.mjs   (from frontend/)
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

/* Same trick as the flip test: strip the vault import, keep the maths, and put
   the copy beside the original so ./motion still resolves. */
const source = fs.readFileSync(path.resolve('src/lib/tiltreveal.js'), 'utf8');
const stripped = source
  .replace("import { vault } from './vault';", '')
  .replaceAll("'./motion'", "'./motion.js'")
  .replace(/export const config = \{[\s\S]*?\n\};\n/, '');

const shim = path.resolve('src/lib/.tiltreveal.undertest.mjs');
fs.writeFileSync(shim, stripped);
const tilt = await import('file://' + shim.replace(/\\/g, '/'));

/* ── gravity for a given screen angle ── */

const G = 9.81;
const RAD = Math.PI / 180;

/**
 * Builds a reading for a screen `deg` from horizontal, rotated `roll` degrees
 * about its own axis. The roll is what portrait vs landscape amounts to, and it
 * must not change the outcome.
 */
function gravityAt(deg, roll = 0) {
  const z = G * Math.cos(deg * RAD);
  const inPlane = G * Math.sin(deg * RAD);
  return {
    x: inPlane * Math.sin(roll * RAD),
    y: inPlane * Math.cos(roll * RAD),
    z,
  };
}

/** Feeds enough samples for the smoothing filter to settle on the new angle. */
function settle(sample, times = 60) {
  for (let i = 0; i < times; i += 1) {
    listeners.forEach((fn) => fn({ accelerationIncludingGravity: sample }));
  }
}

function session(threshold = 50) {
  const states = [];
  const stop = tilt.watch((readable) => states.push(readable), { threshold });
  return { states, stop, current: () => states[states.length - 1] };
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
const near = (a, b, tol = 1) => Math.abs(a - b) <= tol;

check('the angle maths matches the documented reference points', () => {
  assert(near(tilt.tiltAngle({ z: G }), 0), 'flat face-up should be 0°');
  assert(near(tilt.tiltAngle({ y: G, z: 0 }), 90), 'upright should be 90°');
  assert(near(tilt.tiltAngle({ z: -G }), 180), 'face-down should be 180°');
  assert(near(tilt.tiltAngle(gravityAt(50)), 50), '50° should read back as 50°');
});

check('the angle ignores rotation in the screen plane', () => {
  // Portrait, landscape either way, upside down — all the same tilt.
  for (const roll of [0, 90, 180, 270]) {
    const angle = tilt.tiltAngle(gravityAt(60, roll));
    assert(near(angle, 60), 'roll ' + roll + '° gave ' + angle?.toFixed(1) + '°');
  }
});

check('free fall and dead sensors report no angle', () => {
  assert(tilt.tiltAngle({ x: 0, y: 0, z: 0 }) === null, 'zero gravity gave an angle');
  assert(tilt.tiltAngle({}) === null, 'an empty reading gave an angle');
});

check('it starts hidden before any sample arrives', () => {
  const { states, stop } = session();
  stop();
  assert(states[0] === false, 'the first thing reported should be hidden');
});

check('a phone flat on a desk stays hidden', () => {
  const { current, stop } = session();
  settle(gravityAt(0));
  settle(gravityAt(20)); // a slight lean, as on a stand or a case
  stop();
  assert(current() === false, 'flat on a desk revealed itself');
});

check('raising it to read reveals', () => {
  const { current, stop } = session();
  settle(gravityAt(0));
  settle(gravityAt(65));
  stop();
  assert(current() === true, 'a reading angle stayed hidden');
});

check('lowering it hides again', () => {
  const { current, stop } = session();
  settle(gravityAt(70));
  assert(current() === true, 'setup: should be revealed');
  settle(gravityAt(10));
  stop();
  assert(current() === false, 'putting it down left it revealed');
});

check('hovering at the threshold does not flicker', () => {
  // Hysteresis means revealing takes 50° but staying revealed only takes 42°,
  // so a hand wavering across the line must not strobe the blur.
  const { states, stop } = session(50);
  settle(gravityAt(55));
  const afterReveal = states.length;

  for (let i = 0; i < 6; i += 1) {
    settle(gravityAt(46), 12);
    settle(gravityAt(52), 12);
  }
  stop();

  assert(
    states.length === afterReveal,
    'it toggled ' + (states.length - afterReveal) + ' extra times near the line'
  );
});

check('it only reports transitions, not samples', () => {
  const { states, stop } = session();
  settle(gravityAt(70), 300); // three hundred samples, one change
  stop();
  assert(states.length === 2, 'expected [false, true], got ' + states.length + ' updates');
});

check('sensitivity changes where the line sits', () => {
  const gentle = session(35);
  settle(gravityAt(40));
  gentle.stop();
  assert(gentle.current() === true, 'gentle should reveal at 40°');

  listeners.clear();
  const strict = session(65);
  settle(gravityAt(40));
  strict.stop();
  assert(strict.current() === false, 'strict should stay hidden at 40°');
});

check('every offered sensitivity is a usable angle', () => {
  for (const option of tilt.SENSITIVITY) {
    assert(
      option.value > tilt.TUNING.hysteresis && option.value < 90,
      option.label + ' (' + option.value + '°) is not a sane threshold'
    );
  }
});

check('stopping detaches the listener', () => {
  const { states, stop } = session();
  stop();
  const before = states.length;
  settle(gravityAt(80));
  assert(states.length === before, 'it kept reporting after stop()');
});

/* ── report ── */

for (const [state, name, why] of results) {
  console.log(`${state}  ${name}${why ? '\n        ↳ ' + why : ''}`);
}
const failed = results.filter(([s]) => s === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} passed`);
fs.unlinkSync(shim);
process.exit(failed ? 1 : 0);
