'use client';

/**
 * Every sound in the app is synthesised with the Web Audio API — no asset
 * downloads, no latency on first play, and it stays in tune with the UI.
 * Tuned to be short, soft and slightly bell-like, the way iOS system sounds are.
 */

let ctx = null;
let master = null;
let ringBus = null;
let enabled = true;
let ringEnabled = true;
let unlocked = false;

/**
 * Two buses, not one.
 *
 * `master` carries the interface: taps, sends, receipts. It is deliberately
 * quiet — those sounds sit under what you are doing and must never startle.
 *
 * `ringBus` carries the ringtone, the ringback and the decline tone, and it is
 * loud. A ringtone that has been attenuated to the level of a button tick is a
 * ringtone nobody answers; it has to carry from a pocket, across a room, over
 * whatever else is playing. It is also independent of "Play sounds in the app",
 * whose own sublabel scopes that setting to "Send, receive, and reaction
 * tones" — silencing calls was never what it offered to do. Calls follow the
 * Calls notification toggle instead, via `setRingEnabled`.
 */
function audio() {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    ctx = new AudioCtx();

    master = ctx.createGain();
    master.gain.value = 0.4;
    master.connect(ctx.destination);

    ringBus = ctx.createGain();
    ringBus.gain.value = 0.95;
    ringBus.connect(ctx.destination);
  }
  return ctx;
}

/**
 * Browsers require a gesture before audio can start.
 *
 * The drain has to hang off the promise, not off a state check underneath it:
 * `resume()` is asynchronous, so the context is still 'suspended' on the line
 * after the call and a synchronous check finds nothing to do. A ringtone
 * waiting on the gesture would have gone on waiting forever.
 */
export function unlockAudio() {
  const c = audio();
  if (!c) return;
  unlocked = true;
  if (c.state === 'suspended') {
    c.resume().then(drainWaiting).catch(() => {});
  } else {
    drainWaiting();
  }
}

export function setSoundEnabled(value) {
  enabled = !!value;
}

/** Whether calls may ring. Wired to the Calls notification setting. */
export function setRingEnabled(value) {
  ringEnabled = !!value;
}

export function setVolume(value) {
  if (master) master.gain.value = Math.max(0, Math.min(1, value));
}

/* ─────────────────── getting sound out of a cold page ───────────────────
 *
 * The hard case for a ringtone is the one that matters most: a call arrives at
 * a tab the user has not touched since it loaded. There has been no gesture, so
 * the AudioContext is suspended, `resume()` is refused, and the phone that
 * should be ringing sits there in silence — the receiving half of "calls don't
 * ring".
 *
 * So a ring does not assume it can make a sound. It asks to be run when audio
 * is actually permitted: now if the context is running, otherwise on the very
 * next gesture anywhere in the page. Tapping the screen — or the notification
 * that goes up as the fallback — starts the ring mid-cadence rather than never.
 */
const waiting = new Set();
let armed = false;

function drainWaiting() {
  const pending = [...waiting];
  waiting.clear();
  pending.forEach((fn) => {
    try {
      fn();
    } catch {
      /* one failed ring must not take the others with it */
    }
  });
}

/* Note for anyone editing the pair above and below: the entries in `waiting`
   must be idempotent rather than self-removing. An entry that guarded itself
   with `waiting.delete(...)` never ran, because `drainWaiting` clears the set
   before it calls anything — two guards that between them let nothing through,
   and a ringtone that stayed silent on exactly the cold tab it exists for. */

function armGesture() {
  if (armed || typeof window === 'undefined') return;
  armed = true;
  const fire = () => {
    armed = false;
    window.removeEventListener('pointerdown', fire);
    window.removeEventListener('keydown', fire);
    window.removeEventListener('touchstart', fire);
    unlockAudio();
  };
  window.addEventListener('pointerdown', fire, { once: true });
  window.addEventListener('keydown', fire, { once: true });
  window.addEventListener('touchstart', fire, { once: true });
}

/**
 * Runs `start` as soon as audio is allowed, and returns a stop function that is
 * correct either way — including when it is called before the sound ever began.
 */
function whenAudible(start) {
  const c = audio();
  if (!c) return () => {};

  let stop = null;
  let cancelled = false;
  let started = false;

  /* Idempotent, because there are two ways in — our own `resume()` resolving,
     and the next gesture anywhere on the page — and whichever arrives first
     should be the one that rings. */
  const begin = () => {
    if (cancelled || started) return;
    started = true;
    stop = start() || null;
  };

  if (c.state === 'suspended') {
    c.resume().then(begin).catch(() => {});
  }

  if (c.state === 'running') {
    begin();
  } else {
    waiting.add(begin);
    armGesture();
  }

  return () => {
    cancelled = true;
    waiting.delete(begin);
    stop?.();
    stop = null;
  };
}

/** Whether audio can be heard right now, so a caller can pick a fallback. */
export const canPlayNow = () => {
  const c = audio();
  return !!c && c.state === 'running';
};

/**
 * One shaped sine/triangle blip. The building block for everything below.
 *
 * Returns the oscillator, so a scheduled pattern can be cancelled. A ringtone
 * lays its whole cadence down on the audio clock in advance — see `ring` — and
 * answering the call has to be able to silence the bursts that have been
 * scheduled but not yet sounded.
 */
function tone({
  freq = 660,
  duration = 0.12,
  type = 'sine',
  gain = 0.5,
  delay = 0,
  sweepTo = null,
  attack = 0.006,
  bus = 'ui',
  at = null,
} = {}) {
  const c = audio();
  const ring = bus === 'ring';
  if (!c) return null;
  if (ring ? !ringEnabled : !enabled) return null;
  if (c.state === 'suspended') c.resume().catch(() => {});

  /* `at` is an absolute point on the audio clock, for the ring scheduler, which
     works in beats rather than in offsets from whenever it happened to run.
     Never in the past: a start time behind `currentTime` plays immediately and
     would bunch a whole cycle into one instant. */
  const start = at != null ? Math.max(at, c.currentTime) : c.currentTime + delay;
  const osc = c.createOscillator();
  const env = c.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (sweepTo) osc.frequency.exponentialRampToValueAtTime(sweepTo, start + duration);

  env.gain.setValueAtTime(0.0001, start);
  env.gain.exponentialRampToValueAtTime(gain, start + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  osc.connect(env);
  env.connect(ring ? ringBus : master);
  osc.start(start);
  osc.stop(start + duration + 0.02);
  // When it plays, so the ring scheduler can drop nodes that are already done.
  osc.__at = start;
  return osc;
}

/** Short filtered noise burst — used for the swipe and camera sounds. */
function noise({ duration = 0.08, gain = 0.14, filterFreq = 1800, delay = 0 } = {}) {
  const c = audio();
  if (!c || !enabled) return;

  const start = c.currentTime + delay;
  const frames = Math.floor(c.sampleRate * duration);
  const buffer = c.createBuffer(1, frames, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i += 1) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
  }

  const src = c.createBufferSource();
  src.buffer = buffer;

  const filter = c.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = filterFreq;

  const env = c.createGain();
  env.gain.setValueAtTime(gain, start);
  env.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  src.connect(filter);
  filter.connect(env);
  env.connect(master);
  src.start(start);
}

/* ────────────────────────────── haptics ────────────────────────────── */

/* Declared above `sounds` because the ringtone reaches for `buzz`: the ring and
   the vibration are one event, and a phone that rings without buzzing is only
   half of an incoming call. */

let hapticsEnabled = true;
export const setHapticsEnabled = (v) => {
  hapticsEnabled = !!v;
};

const buzz = (pattern) => {
  if (!hapticsEnabled) return;
  if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(pattern);
};

export const haptics = {
  light: () => buzz(8),
  medium: () => buzz(14),
  heavy: () => buzz(24),
  success: () => buzz([10, 40, 18]),
  warning: () => buzz([16, 60, 16]),
  error: () => buzz([24, 50, 24, 50, 24]),
  selection: () => buzz(5),
  impact: () => buzz([6, 20, 12]),

  /* ── calls ──
     Longer and firmer than anything in the interface set. These mark the two
     moments in a call you should be able to feel without looking: the answer,
     and the refusal. `callAccepted` is two pulses with the second the longer of
     them — it rises, the way the tone beside it does. `callDeclined` falls away
     in three shortening buzzes, the tactile shape of its own falling tone. */
  callAccepted: () => buzz([26, 70, 42]),
  callDeclined: () => buzz([60, 90, 40, 90, 24]),

  /** One cycle of the ringtone's buzz, for previewing it in settings. */
  ringtone: () => buzz([500, 240, 500]),
};

/* ─────────────────── the ringing scheduler ───────────────────
 *
 * A ringtone rings until something stops it. It has no length of its own, so
 * nothing here picks one: the cadence is laid onto the audio clock a horizon at
 * a time and topped up, and it goes on until the call is answered, refused or
 * given up on.
 *
 * The horizon has to be longer than the worst throttling, not merely longer
 * than the top-up interval. Both `setInterval` and `setTimeout` are throttled in
 * a background tab, and Chrome's floor is one call per minute — which is exactly
 * the tab a phone rings in. A sixty-second horizon topped up every fifteen
 * seconds sounds like plenty and is not: one minute of throttling consumes all
 * sixty seconds and the ring falls silent at the moment it runs out. Two minutes
 * queued ahead leaves a full minute of runway even then, and the audio clock
 * itself is never throttled, so whatever is already scheduled plays on time.
 */
const RING_CYCLE = 4; // seconds: two bursts, then a pause
const RING_HORIZON = 120; // seconds of cadence kept queued ahead
const RING_TOPUP_MS = 20_000;
/* Chrome's background timer floor. The horizon must comfortably exceed it, and
   the ringtone test asserts exactly that. */
const WORST_THROTTLE = 60;

/**
 * Rings `burst` on the beat, forever, and returns a stop function.
 *
 * `burst(at)` is handed an absolute audio-clock time and returns the nodes it
 * scheduled, so they can be cancelled the moment somebody picks up — bursts
 * already queued would otherwise sound into an answered call.
 *
 * `pattern` is one cycle of vibration, or null for a ring that should not buzz.
 */
function ringLoop(burst, pattern) {
  const c = audio();
  if (!c) return () => {};

  let live = [];
  let nextAt = c.currentTime;
  let timer = null;
  let stopped = false;

  const fill = () => {
    if (stopped) return;
    const horizon = c.currentTime + RING_HORIZON;

    while (nextAt < horizon) {
      live.push(...burst(nextAt));
      nextAt += RING_CYCLE;
    }

    // Anything whose time has passed can be forgotten, so a long ring does not
    // accumulate a node per burst for as long as it lasts.
    live = live.filter((n) => n && n.__at >= c.currentTime - RING_CYCLE);

    if (pattern) {
      /* Re-issued rather than extended: `navigator.vibrate` replaces whatever
         is running, so each top-up hands over a fresh pattern. The leading
         zero-length buzz is how a pattern is made to start on the next beat
         instead of immediately, which keeps the buzz in step with the sound
         across the seam. */
      const untilNextBeat = Math.max(0, nextAt - RING_CYCLE - c.currentTime);
      const full = [0, Math.round(untilNextBeat * 1000)];
      for (let i = 0; i < Math.ceil(RING_HORIZON / RING_CYCLE); i += 1) full.push(...pattern);
      buzz(full);
    }
  };

  fill();
  timer = setInterval(fill, RING_TOPUP_MS);

  return () => {
    stopped = true;
    clearInterval(timer);
    live.forEach((n) => {
      try {
        n?.stop();
      } catch {
        /* already finished — nothing to stop */
      }
    });
    live = [];
    if (pattern) buzz(0);
  };
}

export const sounds = {
  /** Soft tick under every button press. */
  tap: () => tone({ freq: 1180, duration: 0.035, gain: 0.1, type: 'sine' }),

  /** A slightly brighter tick for switching tabs or chats. */
  select: () => {
    tone({ freq: 880, duration: 0.045, gain: 0.14 });
    tone({ freq: 1320, duration: 0.05, gain: 0.07, delay: 0.02 });
  },

  /** Rising two-note chirp as your message leaves. */
  send: () => {
    tone({ freq: 700, duration: 0.09, gain: 0.22, sweepTo: 1050 });
    tone({ freq: 1400, duration: 0.1, gain: 0.1, delay: 0.05 });
  },

  /** Warm bell for an incoming message. */
  receive: () => {
    tone({ freq: 880, duration: 0.16, gain: 0.24, type: 'sine' });
    tone({ freq: 1174, duration: 0.22, gain: 0.14, delay: 0.055 });
    tone({ freq: 1760, duration: 0.18, gain: 0.05, delay: 0.055 });
  },

  /** Someone @-named you. Deliberately more insistent than `receive`: it is the
   *  one message that gets through a muted chat, so it has to sound different. */
  mention: () => {
    tone({ freq: 1046, duration: 0.13, gain: 0.26, type: 'sine' });
    tone({ freq: 1568, duration: 0.13, gain: 0.18, delay: 0.1 });
    tone({ freq: 2093, duration: 0.2, gain: 0.1, delay: 0.2 });
  },

  /** Fired when a message you sent is read. */
  seen: () => tone({ freq: 1560, duration: 0.06, gain: 0.08 }),

  /** Reaction burst — three quick ascending notes. */
  react: () => {
    tone({ freq: 1046, duration: 0.06, gain: 0.16 });
    tone({ freq: 1318, duration: 0.06, gain: 0.14, delay: 0.045 });
    tone({ freq: 1568, duration: 0.09, gain: 0.11, delay: 0.09 });
  },

  /** Sheet or modal sliding up. */
  open: () => {
    noise({ duration: 0.13, gain: 0.05, filterFreq: 900 });
    tone({ freq: 420, duration: 0.13, gain: 0.1, sweepTo: 760 });
  },

  close: () => {
    tone({ freq: 700, duration: 0.11, gain: 0.09, sweepTo: 400 });
  },

  /** Pull-to-refresh / swipe-to-reply. */
  swipe: () => noise({ duration: 0.07, gain: 0.09, filterFreq: 2400 }),

  /** Voice note recording starts. */
  recordStart: () => {
    tone({ freq: 520, duration: 0.07, gain: 0.16 });
    tone({ freq: 780, duration: 0.09, gain: 0.12, delay: 0.06 });
  },

  recordStop: () => {
    tone({ freq: 780, duration: 0.07, gain: 0.14 });
    tone({ freq: 470, duration: 0.11, gain: 0.11, delay: 0.055 });
  },

  /** Something went wrong — a low, flat double note. */
  error: () => {
    tone({ freq: 300, duration: 0.13, gain: 0.2, type: 'triangle' });
    tone({ freq: 240, duration: 0.2, gain: 0.18, type: 'triangle', delay: 0.11 });
  },

  /** Task finished, contact added, device linked. */
  success: () => {
    tone({ freq: 784, duration: 0.1, gain: 0.18 });
    tone({ freq: 1046, duration: 0.1, gain: 0.16, delay: 0.08 });
    tone({ freq: 1568, duration: 0.24, gain: 0.12, delay: 0.16 });
  },

  /** A device was linked over QR. */
  linked: () => {
    tone({ freq: 660, duration: 0.09, gain: 0.16 });
    tone({ freq: 990, duration: 0.09, gain: 0.15, delay: 0.07 });
    tone({ freq: 1320, duration: 0.12, gain: 0.14, delay: 0.14 });
    tone({ freq: 1980, duration: 0.3, gain: 0.08, delay: 0.21 });
  },

  /**
   * The ringtone for an incoming call. Returns a stop function.
   *
   * Rings until it is stopped — see `ringLoop` for why it is scheduled on the
   * audio clock rather than driven by a timer, and why it never runs out. Two
   * bell bursts, then a pause; a four-second beat.
   */
  ring: () => {
    if (!ringEnabled) return () => {};

    return whenAudible(() =>
      ringLoop(
        (at) => [
          /* The chord under it is what makes this read as a *ring* rather than
             as a loud version of the message tone: a fifth below, and a soft
             triangle body carrying part of the level. */
          tone({ freq: 880, duration: 0.42, gain: 0.5, at, bus: 'ring' }),
          tone({ freq: 1174, duration: 0.42, gain: 0.34, at: at + 0.02, bus: 'ring' }),
          tone({ freq: 587, duration: 0.46, gain: 0.2, at, type: 'triangle', bus: 'ring' }),
          tone({ freq: 880, duration: 0.42, gain: 0.5, at: at + 0.56, bus: 'ring' }),
          tone({ freq: 1174, duration: 0.42, gain: 0.34, at: at + 0.58, bus: 'ring' }),
          tone({
            freq: 587,
            duration: 0.46,
            gain: 0.2,
            at: at + 0.56,
            type: 'triangle',
            bus: 'ring',
          }),
        ],
        // One cycle of buzz, in step with the two bursts above.
        [500, 240, 500, 2760]
      )
    );
  },

  /**
   * The ringback the caller hears while the other phone rings.
   *
   * Quieter and plainer than the ringtone on purpose: this one is held against
   * an ear, and its whole job is to say the line is open and nobody has picked
   * up yet. No vibration — your own phone buzzing at you while you wait would
   * be nonsense.
   */
  dial: () => {
    if (!ringEnabled) return () => {};

    return whenAudible(() =>
      ringLoop(
        (at) => [
          tone({ freq: 440, duration: 0.8, gain: 0.22, at, bus: 'ring' }),
          tone({ freq: 480, duration: 0.8, gain: 0.16, at, bus: 'ring' }),
        ],
        null
      )
    );
  },

  /**
   * The call was declined.
   *
   * Deliberately not `hangup`: a call that ended and a call that was refused
   * are different events, and hearing the same tone for both leaves you
   * checking the screen to find out which happened. This one falls — two
   * descending notes over a short busy-signal pulse — and it plays on the ring
   * bus, so the person who has been holding a phone to their ear actually
   * hears it.
   */
  declined: () => {
    tone({ freq: 480, duration: 0.22, gain: 0.3, type: 'triangle', bus: 'ring' });
    tone({ freq: 360, duration: 0.3, gain: 0.28, type: 'triangle', delay: 0.2, bus: 'ring' });
    tone({ freq: 300, duration: 0.34, gain: 0.2, type: 'sine', delay: 0.42, bus: 'ring' });
  },

  /** The call was answered and media is coming up — a short confident rise. */
  connected: () => {
    tone({ freq: 660, duration: 0.1, gain: 0.26, bus: 'ring' });
    tone({ freq: 880, duration: 0.1, gain: 0.24, delay: 0.08, bus: 'ring' });
    tone({ freq: 1320, duration: 0.22, gain: 0.16, delay: 0.16, bus: 'ring' });
  },

  hangup: () => {
    tone({ freq: 620, duration: 0.1, gain: 0.16 });
    tone({ freq: 420, duration: 0.16, gain: 0.14, delay: 0.09 });
  },

  camera: () => {
    noise({ duration: 0.05, gain: 0.2, filterFreq: 3200 });
    noise({ duration: 0.07, gain: 0.12, filterFreq: 1400, delay: 0.05 });
  },

  typing: () => tone({ freq: 1500, duration: 0.02, gain: 0.04 }),
};

/** The one call most components need: a click sound plus a matching tap. */
export function feedback(kind = 'tap') {
  sounds[kind]?.();
  const map = {
    tap: haptics.light,
    select: haptics.selection,
    send: haptics.light,
    receive: haptics.medium,
    mention: haptics.warning,
    react: haptics.impact,
    open: haptics.light,
    close: haptics.light,
    error: haptics.error,
    success: haptics.success,
    linked: haptics.success,
    recordStart: haptics.medium,
    recordStop: haptics.medium,
    declined: haptics.callDeclined,
    connected: haptics.callAccepted,
    hangup: haptics.medium,
  };
  map[kind]?.();
}

export { unlocked };
