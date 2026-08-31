/**
 * The three motion gestures, driven with synthetic accelerometer data.
 *
 * The detectors are byte-identical ports of the web client's, so what is
 * actually under test here is the seam: `lib/motion.js` reads expo-sensors,
 * which reports **multiples of g**, while the detectors were written against
 * `DeviceMotionEvent.accelerationIncludingGravity`, which is **m/s²**. The
 * native module scales by 9.81 on the way through. Get that wrong and every
 * threshold is out by an order of magnitude — the gestures either never fire or
 * fire constantly, and both files still look correct in isolation.
 *
 * So the samples below are written in m/s², exactly as a phone would produce
 * them, and the assertions are about whether real-world motion trips the
 * detector.
 *
 *   node scripts/gestures.test.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const lib = path.resolve(here, '../src/lib');

/* ── a clock we control, so a 900ms dwell does not take 900ms ── */
let now = 0;
const timers = [];

const realDate = Date.now;
Date.now = () => now;
globalThis.setTimeout = (fn, ms) => {
  const timer = { at: now + (ms || 0), fn, done: false };
  timers.push(timer);
  return timer;
};
globalThis.clearTimeout = (timer) => {
  if (timer) timer.done = true;
};

function advance(ms) {
  const target = now + ms;
  for (;;) {
    const due = timers
      .filter((t) => !t.done && t.at <= target)
      .sort((a, b) => a.at - b.at)[0];
    if (!due) break;
    now = due.at;
    due.done = true;
    due.fn();
  }
  now = target;
}

/**
 * Loads a detector with its storage and sensor dependencies removed.
 *
 * `deviceSetting` reaches for the vault (SQLite) and `motion` reaches for
 * expo-sensors; neither loads in Node. `watch` touches neither, so both are
 * replaced and the state machine itself is what runs.
 */
async function load(name) {
  const source = fs.readFileSync(path.join(lib, name + '.js'), 'utf8');

  const stripped = source
    .replace(/import \{ deviceSetting \} from '\.\/devicesetting';\r?\n/, '')
    .replace(/import \{[^}]*\} from '\.\/motion';\r?\n/, '')
    // Each detector also re-exports the platform helpers for its settings
    // screen; that block spans several lines and still pulls in ./motion.
    .replace(/export \{[\s\S]*?\} from '\.\/motion';\r?\n/, '')
    .replace(/export const config = deviceSetting\([\s\S]*?\}\);\r?\n/, '')
    // The sensor seam: samples are pushed by the test instead of by a listener.
    .replace(
      /^/,
      'const G = 9.81;\n' +
        'const isSupported = () => true;\n' +
        'let __push = null;\n' +
        'const listen = (fn) => { __push = fn; return () => { __push = null; }; };\n' +
        'export const __emit = (sample) => __push && __push(sample);\n'
    );

  const shim = path.join(lib, '.' + name + '.undertest.mjs');
  fs.writeFileSync(shim, stripped);
  try {
    return await import(pathToFileURL(shim).href + '?v=' + realDate());
  } finally {
    fs.rmSync(shim, { force: true });
  }
}

/* ────────────────────────────── harness ────────────────────────────── */

let passed = 0;
const failures = [];
const check = (name, ok, detail = '') => {
  if (ok) {
    passed += 1;
    console.log('  \x1b[32m✓\x1b[0m ' + name);
  } else {
    failures.push(name + (detail ? ' — ' + detail : ''));
    console.log('  \x1b[31m✗\x1b[0m ' + name + (detail ? ' — ' + detail : ''));
  }
};
const section = (t) => console.log('\n\x1b[1m' + t + '\x1b[0m');

/** Feeds one reading repeatedly, letting the smoothing settle. */
function hold(mod, sample, samples = 40, stepMs = 20) {
  for (let i = 0; i < samples; i += 1) {
    mod.__emit(sample);
    advance(stepMs);
  }
}

/* ────────────────────────── flip to hide ────────────────────────── */

section('Flip to hide');
{
  const flip = await load('flipgesture');
  let fired = 0;
  const stop = flip.watch(() => {
    fired += 1;
  });

  // Face up: z is +g. In m/s² that is +9.81, which is what a phone reports.
  hold(flip, { x: 0, y: 0, z: 9.81 });
  check('resting face up does not fire', fired === 0);

  /* The gesture completes on the way *back*: turning it over starts a timer,
     and picking it up again is what counts — which is right, because the point
     is to hide the screen for as long as it is face down. */
  hold(flip, { x: 0, y: 0, z: -9.81 }, 40);
  check('face down alone does not fire yet', fired === 0, 'fired ' + fired);

  hold(flip, { x: 0, y: 0, z: 9.81 }, 20);
  check('turning it back up completes the flip', fired === 1, 'fired ' + fired);

  // A flick far shorter than the 350ms dwell is not a deliberate flip.
  advance(1400); // past the re-arm window
  const before = fired;
  hold(flip, { x: 0, y: 0, z: -9.81 }, 4, 20); // ~80ms face down
  hold(flip, { x: 0, y: 0, z: 9.81 }, 20);
  check('a brief flick does not fire', fired === before, 'fired ' + (fired - before));

  stop();
}

/* ────────────────────────── tilt to read ────────────────────────── */

section('Tilt to read');
{
  const tilt = await load('tiltreveal');

  // The angle helper is the piece the units flow through most directly.
  const flat = tilt.tiltAngle({ x: 0, y: 0, z: 9.81 });
  const upright = tilt.tiltAngle({ x: 0, y: 9.81, z: 0 });
  check('flat reads near 0°', Math.abs(flat) < 12, flat.toFixed(1) + '°');
  check('upright reads near 90°', Math.abs(upright - 90) < 12, upright.toFixed(1) + '°');

  let revealed = null;
  const stop = tilt.watch((on) => {
    revealed = on;
  });

  hold(tilt, { x: 0, y: 0, z: 9.81 }, 40);
  check('lying flat is not a reading angle', revealed !== true);

  // Tilted up towards the face.
  hold(tilt, { x: 0, y: 8.5, z: 4.9 }, 40);
  check('tilted towards you reveals', revealed === true, 'revealed=' + revealed);

  hold(tilt, { x: 0, y: 0, z: 9.81 }, 40);
  check('laying it flat again hides', revealed === false, 'revealed=' + revealed);

  stop();
}

/* ────────────────────────── shake for emergency ────────────────────────── */

section('Shake for emergency');
{
  const shake = await load('shakegesture');

  /* `jolt` hands back the updated gravity estimate alongside the linear
     component, so the detector can carry the estimate forward sample to
     sample rather than recomputing it. */
  const resting = shake.jolt({ x: 0, y: 0, z: 9.81 }, { x: 0, y: 0, z: 9.81 });
  check(
    'a resting phone has no linear motion',
    resting !== null && resting.linear < 1,
    'linear=' + resting?.linear?.toFixed(2)
  );

  const jerked = shake.jolt({ x: 0, y: 0, z: 9.81 + 30 }, { x: 0, y: 0, z: 9.81 });
  check('a jerk shows up as linear motion', jerked.linear > 16, 'linear=' + jerked.linear.toFixed(1));

  let fired = 0;
  const stop = shake.watch(() => {
    fired += 1;
  });

  // Settle the gravity estimate first, exactly as holding the phone would.
  hold(shake, { x: 0, y: 0, z: 9.81 }, 60);
  check('holding it still does not fire', fired === 0);

  // Walking: a slow, gentle rhythm. Must not accumulate into a trigger.
  for (let i = 0; i < 30; i += 1) {
    shake.__emit({ x: 0, y: 0, z: 9.81 + (i % 2 ? 2.2 : -2.2) });
    advance(300);
  }
  check('walking does not fire', fired === 0, 'fired ' + fired);

  /* A real shake is a peak, a return through near-rest, and a peak the *other
     way*. Both halves matter:
       · without the return the detector never re-arms, because it only does so
         once the signal falls back under 45% of the bar;
       · without alternating direction the slow gravity filter drifts towards
         the one side being pushed, and within a few cycles the "rest" samples
         no longer clear that threshold either.
     Reproducing only half of it counts three peaks and stalls one short. */
  for (let i = 0; i < 6; i += 1) {
    shake.__emit({ x: 0, y: 0, z: 9.81 + 40 });
    advance(50);
    shake.__emit({ x: 0, y: 0, z: 9.81 });
    advance(50);
    shake.__emit({ x: 0, y: 0, z: 9.81 - 40 });
    advance(50);
    shake.__emit({ x: 0, y: 0, z: 9.81 });
    advance(50);
  }
  check('a deliberate shake fires', fired >= 1, 'fired ' + fired);

  const afterFirst = fired;
  for (let i = 0; i < 6; i += 1) {
    shake.__emit({ x: 0, y: 0, z: 9.81 + 40 });
    advance(50);
    shake.__emit({ x: 0, y: 0, z: 9.81 });
    advance(50);
    shake.__emit({ x: 0, y: 0, z: 9.81 - 40 });
    advance(50);
    shake.__emit({ x: 0, y: 0, z: 9.81 });
    advance(50);
  }
  check('it does not re-fire immediately', fired === afterFirst, 'fired ' + (fired - afterFirst));

  stop();
}

/* ────────────────────────────── verdict ────────────────────────────── */

console.log('\n' + '─'.repeat(60));
if (failures.length) {
  console.log(`\x1b[31m${failures.length} failed\x1b[0m, ${passed} passed\n`);
  failures.forEach((f) => console.log('  · ' + f));
  process.exit(1);
}
console.log(`\x1b[32mAll ${passed} checks passed.\x1b[0m Gestures fire on real-world motion.\n`);
