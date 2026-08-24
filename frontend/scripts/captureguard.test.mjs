/**
 * Tests the view-once capture guard against a minimal DOM.
 *
 * Three things are worth proving, and none of them is "screenshots are blocked"
 * — the web cannot do that and the module says so. What it can do is get the
 * *mechanics* right, and each of these has an obvious failure mode:
 *
 *   - The blank goes up on every signal that accompanies a capture, and comes
 *     back down only when the window is genuinely in front of the user again.
 *     Revealing on a `focus` event that arrives while the page is still hidden
 *     would expose the photo at exactly the wrong moment.
 *   - The reference count holds. Two view-once surfaces can overlap, and the
 *     first to close must not disarm the second.
 *   - Releasing cleans up. A leftover class blacks out the entire app.
 *
 * Run: node scripts/captureguard.test.mjs   (from frontend/)
 */
import fs from 'node:fs';
import path from 'node:path';

/* ── a DOM, in as few lines as the module actually needs ── */

const classes = new Set();
const winListeners = new Map();
const docListeners = new Map();

const add = (map) => (type, fn) => {
  if (!map.has(type)) map.set(type, new Set());
  map.get(type).add(fn);
};
const remove = (map) => (type, fn) => map.get(type)?.delete(fn);

let visibility = 'visible';
let focused = true;

globalThis.document = {
  get visibilityState() {
    return visibility;
  },
  hasFocus: () => focused,
  documentElement: {
    classList: {
      toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)),
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name),
    },
  },
  addEventListener: add(docListeners),
  removeEventListener: remove(docListeners),
};

globalThis.window = {
  addEventListener: add(winListeners),
  removeEventListener: remove(winListeners),
};

/* Node ships a real `navigator` with only a getter, so the clipboard stub has
   to be defined over it rather than assigned. */
Object.defineProperty(globalThis, 'navigator', {
  value: { clipboard: { writeText: async () => {} } },
  configurable: true,
  writable: true,
});

/* Timers under test control, so a 2.2-second hold costs no real time. */
let now = 1_700_000_000_000;
const timers = [];
globalThis.setTimeout = (fn, ms) => {
  timers.push({ at: now + (ms || 0), fn, id: timers.length + 1 });
  return timers.length;
};
globalThis.clearTimeout = (id) => {
  const t = timers[id - 1];
  if (t) t.done = true;
};

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

const fire = (map, type, event = {}) => {
  [...(map.get(type) || [])].forEach((fn) => fn(event));
};
const onWindow = (type, event) => fire(winListeners, type, event);
const onDocument = (type, event) => fire(docListeners, type, event);

/* The module is a plain ES module with no imports, so it loads as-is once the
   globals above exist — but Node needs the .mjs extension to treat it as one. */
const source = fs.readFileSync(path.resolve('src/lib/captureguard.js'), 'utf8');
const shim = path.resolve('src/lib/.captureguard.undertest.mjs');
fs.writeFileSync(shim, source);
const guard = await import('file://' + shim.replace(/\\/g, '/'));

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
const shielded = () => classes.has('capture-shield');

/** Back to a clean, armed, visible state. */
function session() {
  visibility = 'visible';
  focused = true;
  const release = guard.arm();
  return release;
}

check('losing focus blanks it', () => {
  const release = session();
  assert(!shielded(), 'it started blanked');
  focused = false;
  onWindow('blur');
  assert(shielded(), 'losing focus did not blank it');
  release();
});

check('regaining focus reveals it', () => {
  const release = session();
  focused = false;
  onWindow('blur');
  focused = true;
  onWindow('focus');
  // There is a deliberate delay, for platforms that draw capture chrome late.
  assert(shielded(), 'it revealed before the hold elapsed');
  advance(500);
  assert(!shielded(), 'it never revealed');
  release();
});

check('focus arriving while still hidden does not reveal', () => {
  // The dangerous ordering: a focus event fires but the page is not on screen.
  const release = session();
  onWindow('blur');
  visibility = 'hidden';
  focused = true;
  onWindow('focus');
  advance(1000);
  assert(shielded(), 'it revealed a view-once photo while the page was hidden');
  release();
});

check('the tab going away blanks it', () => {
  const release = session();
  visibility = 'hidden';
  onDocument('visibilitychange');
  assert(shielded(), 'a hidden tab was not blanked');
  visibility = 'visible';
  onDocument('visibilitychange');
  advance(1000);
  assert(!shielded(), 'it stayed blanked after coming back');
  release();
});

check('PrintScreen blanks it and holds', () => {
  const release = session();
  onWindow('keydown', { key: 'PrintScreen' });
  assert(shielded(), 'PrintScreen did not blank it');
  advance(1000);
  assert(shielded(), 'the hold expired before the screenshot could land');
  advance(2000);
  assert(!shielded(), 'it never came back');
  release();
});

check('the platform capture shortcuts are recognised', () => {
  const yes = [
    { key: 'PrintScreen' },
    { code: 'PrintScreen', key: '' },
    { key: 'S', shiftKey: true, metaKey: true },
    { key: 's', shiftKey: true, metaKey: true },
    { key: '3', shiftKey: true, metaKey: true },
    { key: '4', shiftKey: true, metaKey: true },
    { key: '5', shiftKey: true, metaKey: true },
  ];
  const no = [
    { key: 'a' },
    { key: 'S' },
    { key: 'S', metaKey: true },
    { key: '4', metaKey: true },
    { key: '3', shiftKey: true },
    { key: 'Enter', shiftKey: true, metaKey: true },
  ];

  yes.forEach((e) =>
    assert(guard.isCaptureKey(e), 'missed ' + JSON.stringify(e))
  );
  no.forEach((e) =>
    assert(!guard.isCaptureKey(e), 'false positive on ' + JSON.stringify(e))
  );
  assert(!guard.isCaptureKey(null), 'a missing event was treated as a capture');
});

check('printing blanks it', () => {
  const release = session();
  onWindow('beforeprint');
  assert(shielded(), 'printing did not blank it');
  onWindow('afterprint');
  advance(1000);
  assert(!shielded(), 'it stayed blanked after printing');
  release();
});

check('the right-click menu is swallowed', () => {
  const release = session();
  let prevented = false;
  onDocument('contextmenu', { preventDefault: () => { prevented = true; } });
  assert(prevented, '"save image as" was still reachable');
  release();
});

check('two surfaces need two releases', () => {
  const first = guard.arm();
  const second = guard.arm();

  first();
  focused = false;
  onWindow('blur');
  assert(shielded(), 'the first release disarmed a guard the second still wanted');

  second();
  focused = true;
  assert(!shielded(), 'releasing both left the app blanked out');
});

check('releasing detaches every listener', () => {
  const release = session();
  release();

  // Nothing should respond, and nothing should be left behind.
  focused = false;
  onWindow('blur');
  onWindow('keydown', { key: 'PrintScreen' });
  onDocument('visibilitychange');
  assert(!shielded(), 'the guard still reacted after release');
  assert(!guard.guarding(), 'the reference count did not return to zero');
});

check('arming while already hidden starts blanked', () => {
  visibility = 'hidden';
  focused = false;
  const release = guard.arm();
  assert(shielded(), 'a guard armed in the background exposed its content');
  release();
  visibility = 'visible';
  focused = true;
});

check('the caveat is stated, not implied', () => {
  // The copy is load-bearing: somebody deciding whether to send a photo has to
  // know a camera pointed at the screen still works.
  assert(/cannot block/i.test(guard.CAPTURE_CAVEAT), 'the caveat does not admit the limit');
  assert(/photo of the screen/i.test(guard.CAPTURE_CAVEAT), 'the caveat omits the obvious bypass');
});

/* ── report ── */

fs.unlinkSync(shim);

const failed = results.filter((r) => r[0] === 'FAIL');
results.forEach(([status, name, why]) => {
  console.log((status === 'PASS' ? '  ok  ' : '  FAIL') + '  ' + name + (why ? ' — ' + why : ''));
});
console.log(
  '\n' + (results.length - failed.length) + '/' + results.length + ' capture-guard checks passed'
);
process.exit(failed.length ? 1 : 0);
