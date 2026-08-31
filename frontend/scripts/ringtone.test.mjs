/**
 * Tests the call ringtone against a fake AudioContext and a fake vibrator.
 *
 * A ringtone is the one sound in the app you cannot check by ear during
 * development — it only happens when somebody else calls you, on a device you
 * are not holding. So the things that break silently get pinned down here, and
 * each of these was a real failure mode:
 *
 *   - The cadence covers the whole window the call rings for. The old ring was
 *     driven by `setInterval`, and a background tab has its timers throttled to
 *     once a minute — so the phone rang twice and then went quiet, in precisely
 *     the case where a ringtone is the only thing that matters. Scheduling on
 *     the audio clock is the fix, and "did it actually schedule 45 seconds of
 *     ringing" is the assertion that proves it.
 *   - Answering silences it. Bursts already queued on the audio clock will
 *     sound whether or not the call is still ringing unless they are explicitly
 *     stopped, and a ringtone that keeps going after you pick up is worse than
 *     one that never started.
 *   - A cold tab still rings. Audio cannot start without a gesture, so a call
 *     arriving at a page nobody has touched found a suspended context and made
 *     no sound at all — the receiving half of "calls don't ring". The ring has
 *     to survive that and start when the gesture arrives.
 *   - The ringtone is loud and the interface is not. They are separate buses
 *     for that reason; routing the ring through the quiet one attenuates it to
 *     the level of a button tick.
 *   - Turning off in-app sounds does not stop calls ringing. That switch offers
 *     "Send, receive, and reaction tones"; the Calls toggle is what silences a
 *     ringtone.
 *
 * Run: node scripts/ringtone.test.mjs   (from frontend/)
 */
import fs from 'node:fs';
import path from 'node:path';

/* ── a fake AudioContext, recording what gets scheduled ── */

let state = 'running';
let resumeAllowed = true;
const scheduled = []; // every oscillator ever created
const vibrations = []; // every navigator.vibrate argument

class FakeParam {
  constructor() {
    this.events = [];
  }
  setValueAtTime(v, t) {
    this.events.push(['set', v, t]);
  }
  exponentialRampToValueAtTime(v, t) {
    this.events.push(['ramp', v, t]);
  }
  /** The peak this envelope reaches, which is the sound's level. */
  peak() {
    return Math.max(...this.events.map(([, v]) => v));
  }
}

class FakeNode {
  constructor() {
    this.connectedTo = null;
  }
  connect(target) {
    this.connectedTo = target;
    return target;
  }
}

/* The module creates exactly two gain nodes that feed the destination directly:
   the interface bus, then the ring bus. Naming them as they connect is how the
   checks below can tell which bus a sound came out on without the test needing
   to know either bus's level. */
const BUS_NAMES = ['ui', 'ring'];
let busesSeen = 0;

class FakeGain extends FakeNode {
  constructor() {
    super();
    this.gain = new FakeParam();
    this.gain.value = 1;
  }
  connect(target) {
    if (target.busName === 'destination' && busesSeen < BUS_NAMES.length) {
      this.busName = BUS_NAMES[busesSeen];
      busesSeen += 1;
    }
    return super.connect(target);
  }
}

class FakeOsc extends FakeNode {
  constructor(ctx) {
    super();
    this.ctx = ctx;
    this.type = 'sine';
    this.frequency = new FakeParam();
    this.startedAt = null;
    this.stopAt = null;
    this.hardStopped = false;
    scheduled.push(this);
  }
  start(t) {
    this.startedAt = t;
  }
  stop(t) {
    // Called with no argument by the ring's own stop function.
    if (t === undefined) this.hardStopped = true;
    else this.stopAt = t;
  }
  /** Which bus this oscillator's envelope ends up feeding. */
  bus() {
    let node = this.connectedTo;
    while (node && !node.busName) node = node.connectedTo;
    return node?.busName || null;
  }
  /** The peak gain of the envelope between this oscillator and its bus. */
  level() {
    return this.connectedTo instanceof FakeGain ? this.connectedTo.gain.peak() : 0;
  }
}

class FakeAudioContext {
  constructor() {
    this.currentTime = 0;
    this.sampleRate = 48000;
    this.destination = new FakeNode();
    this.destination.busName = 'destination';
  }
  get state() {
    return state;
  }
  createGain() {
    return new FakeGain();
  }
  createOscillator() {
    return new FakeOsc(this);
  }
  createBiquadFilter() {
    const n = new FakeNode();
    n.type = '';
    n.frequency = { value: 0 };
    return n;
  }
  createBuffer(channels, frames) {
    return { getChannelData: () => new Float32Array(frames) };
  }
  createBufferSource() {
    const n = new FakeNode();
    n.buffer = null;
    n.start = () => {};
    return n;
  }
  resume() {
    if (!resumeAllowed) return Promise.reject(new Error('not allowed'));
    state = 'running';
    return Promise.resolve();
  }
}

const winListeners = new Map();

globalThis.window = {
  AudioContext: FakeAudioContext,
  addEventListener: (type, fn) => {
    if (!winListeners.has(type)) winListeners.set(type, new Set());
    winListeners.get(type).add(fn);
  },
  removeEventListener: (type, fn) => winListeners.get(type)?.delete(fn),
};

/* Node's own `navigator` is a getter-only global, so it has to be replaced
   rather than assigned to. */
const fakeNavigator = {
  vibrate: (pattern) => {
    vibrations.push(pattern);
    return true;
  },
};
Object.defineProperty(globalThis, 'navigator', {
  value: fakeNavigator,
  writable: true,
  configurable: true,
});

/**
 * Simulate the user touching the page, and wait for the unlock to land.
 *
 * The wait is not test scaffolding, it is the behaviour: `resume()` resolves
 * asynchronously, so the queued ringtone starts a microtask after the tap
 * rather than during it.
 */
const gesture = async () => {
  [...(winListeners.get('pointerdown') || [])].forEach((fn) => fn({}));
  await Promise.resolve();
  await Promise.resolve();
};

/* The module is a plain ES module with no imports, so it loads as-is once the
   globals above exist — but Node needs the .mjs extension to treat it as one. */
const source = fs.readFileSync(path.resolve('src/lib/sound.js'), 'utf8');
const shim = path.resolve('src/lib/.sound.undertest.mjs');
fs.writeFileSync(shim, source);
const audio = await import('file://' + shim.replace(/\\/g, '/'));

/* ── cases ── */

const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push(['PASS', name]);
  } catch (err) {
    results.push(['FAIL', name + ' — ' + err.message]);
  }
};
const assert = (cond, message) => {
  if (!cond) throw new Error(message);
};

const reset = () => {
  scheduled.length = 0;
  vibrations.length = 0;
  state = 'running';
  resumeAllowed = true;
  audio.setSoundEnabled(true);
  audio.setRingEnabled(true);
  audio.setHapticsEnabled(true);
};

/* The window the server waits before marking a call missed. If this test and
   backend/src/sockets/call.handlers.js ever disagree, the ring stops early. */
const RING_WINDOW = 45;

await check('the ringtone covers the whole window a call rings for', () => {
  reset();
  const stop = audio.sounds.ring();

  const starts = scheduled.map((o) => o.startedAt).sort((a, b) => a - b);
  assert(starts.length > 0, 'nothing was scheduled at all');

  const ends = scheduled.map((o) => o.stopAt).filter((t) => t != null);
  const last = Math.max(...ends);
  assert(
    last >= RING_WINDOW,
    'the ring falls silent at ' + last + 's, before the ' + RING_WINDOW + 's a call rings for'
  );

  // And it is a cadence, not one long drone: no gap between consecutive bursts
  // longer than a few seconds, or the phone falls silent mid-ring.
  const gaps = starts.slice(1).map((t, i) => t - starts[i]);
  assert(Math.max(...gaps) <= 4.5, 'a ' + Math.max(...gaps) + 's gap in the middle of the ring');

  stop();
});

await check('the ringtone vibrates for the same window, in one call', () => {
  reset();
  const stop = audio.sounds.ring();

  assert(vibrations.length === 1, 'expected a single vibrate call, got ' + vibrations.length);

  const pattern = vibrations[0];
  assert(Array.isArray(pattern), 'the pattern is not an on/off array');

  // Handing the whole pattern over at once is what makes this survive a
  // background tab; a per-cycle timer would be throttled away.
  const total = pattern.reduce((a, b) => a + b, 0) / 1000;
  assert(
    total >= RING_WINDOW,
    'the vibration covers ' + total + 's, short of the ' + RING_WINDOW + 's ring'
  );

  stop();
});

await check('answering silences bursts that were already scheduled', () => {
  reset();
  const stop = audio.sounds.ring();
  const count = scheduled.length;
  assert(count > 0, 'nothing was scheduled');

  stop();

  const unstopped = scheduled.filter((o) => !o.hardStopped);
  assert(
    unstopped.length === 0,
    unstopped.length + ' of ' + count + ' bursts would still sound after answering'
  );
  assert(vibrations[vibrations.length - 1] === 0, 'the vibration was not cancelled');
});

await check('a call arriving at an untouched page rings once the page is touched', async () => {
  reset();
  // A cold tab: the context exists but audio is not permitted yet.
  state = 'suspended';
  resumeAllowed = false;

  const stop = audio.sounds.ring();
  assert(scheduled.length === 0, 'audio was scheduled while it was still blocked');

  // The user taps the screen — or the fallback notification.
  resumeAllowed = true;
  await gesture();

  assert(scheduled.length > 0, 'the ring never started after the gesture');
  stop();
});

await check('a ring cancelled before the gesture never starts', async () => {
  reset();
  state = 'suspended';
  resumeAllowed = false;

  const stop = audio.sounds.ring();
  stop(); // declined, or the caller gave up

  resumeAllowed = true;
  await gesture();

  assert(scheduled.length === 0, 'a cancelled ring started anyway on the next tap');
});

await check('the ringtone is loud and the interface is quiet', () => {
  reset();
  audio.sounds.ring();
  const ringPeak = Math.max(...scheduled.map((o) => o.level()));
  const ringBus = scheduled[0].bus();

  scheduled.length = 0;
  audio.sounds.tap();
  const tapPeak = Math.max(...scheduled.map((o) => o.level()));
  const uiBus = scheduled[0].bus();

  assert(ringBus === 'ring', 'the ringtone is not on the ring bus (got ' + ringBus + ')');
  assert(uiBus === 'ui', 'a tap is not on the interface bus (got ' + uiBus + ')');
  assert(
    ringPeak > tapPeak * 3,
    'the ringtone (' + ringPeak + ') is not meaningfully louder than a tap (' + tapPeak + ')'
  );
});

await check('turning off in-app sounds does not stop calls ringing', () => {
  reset();
  audio.setSoundEnabled(false);

  audio.sounds.ring();
  assert(scheduled.length > 0, 'the ringtone was silenced by the in-app sound switch');

  scheduled.length = 0;
  audio.sounds.receive();
  assert(scheduled.length === 0, 'a message tone played with in-app sounds off');
});

await check('turning off call notifications does stop the ringing', () => {
  reset();
  audio.setRingEnabled(false);

  const stop = audio.sounds.ring();
  assert(scheduled.length === 0, 'the ringtone played with calls silenced');
  assert(vibrations.length === 0, 'the phone vibrated with calls silenced');
  assert(typeof stop === 'function', 'a silenced ring must still return a stop function');
  stop(); // must not throw

  const dialStop = audio.sounds.dial();
  assert(scheduled.length === 0, 'the ringback played with calls silenced');
  dialStop();
});

await check('the ringback does not vibrate your own phone', () => {
  reset();
  const stop = audio.sounds.dial();

  assert(scheduled.length > 0, 'the ringback made no sound');
  assert(vibrations.length === 0, 'your own phone buzzed while you were calling out');

  // It has to stop when the other end picks up, same as the ringtone.
  stop();
  assert(
    scheduled.every((o) => o.hardStopped),
    'the ringback would keep sounding after the call connected'
  );
});

await check('declined and connected do not sound the same', () => {
  reset();
  audio.sounds.declined();
  const declined = scheduled.map((o) => o.frequency.events[0][1]);
  const declinedBus = scheduled[0].bus();

  scheduled.length = 0;
  audio.sounds.connected();
  const connected = scheduled.map((o) => o.frequency.events[0][1]);

  assert(declined.length > 0 && connected.length > 0, 'one of them made no sound');
  assert(
    declined.some((f) => !connected.includes(f)),
    'a declined call sounds exactly like a connected one'
  );

  // A refusal falls and an answer rises. That is the whole difference you hear.
  const falls = declined[declined.length - 1] < declined[0];
  const rises = connected[connected.length - 1] > connected[0];
  assert(falls, 'the decline tone does not fall');
  assert(rises, 'the connect tone does not rise');

  // Both play against an ear, so both belong on the loud bus.
  assert(declinedBus === 'ring', 'the decline tone is on the quiet bus');
});

await check('the call haptics are distinct, and honour the haptics setting', () => {
  reset();
  audio.haptics.callAccepted();
  const accepted = JSON.stringify(vibrations[0]);

  vibrations.length = 0;
  audio.haptics.callDeclined();
  const declined = JSON.stringify(vibrations[0]);

  assert(accepted !== declined, 'accepting and declining feel identical');

  vibrations.length = 0;
  audio.setHapticsEnabled(false);
  audio.haptics.callAccepted();
  assert(vibrations.length === 0, 'the phone buzzed with haptics turned off');
});

await check('a device with no vibration motor still rings', () => {
  reset();
  const motor = globalThis.navigator.vibrate;
  delete globalThis.navigator.vibrate;

  const stop = audio.sounds.ring();
  assert(scheduled.length > 0, 'the ringtone died on a device that cannot vibrate');
  stop();

  globalThis.navigator.vibrate = motor;
});

/* ── report ── */

fs.unlinkSync(shim);

const failed = results.filter(([r]) => r === 'FAIL');
results.forEach(([r, name]) => console.log(r === 'PASS' ? '  ok  ' + name : '  FAIL  ' + name));
console.log(
  '\n' + (results.length - failed.length) + '/' + results.length + ' ringtone checks passed'
);
process.exit(failed.length ? 1 : 0);
