'use client';

/**
 * Every sound in the app is synthesised with the Web Audio API — no asset
 * downloads, no latency on first play, and it stays in tune with the UI.
 * Tuned to be short, soft and slightly bell-like, the way iOS system sounds are.
 */

let ctx = null;
let master = null;
let enabled = true;
let unlocked = false;

function audio() {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    ctx = new AudioCtx();
    master = ctx.createGain();
    master.gain.value = 0.4;
    master.connect(ctx.destination);
  }
  return ctx;
}

/** Browsers require a gesture before audio can start. */
export function unlockAudio() {
  const c = audio();
  if (!c) return;
  if (c.state === 'suspended') c.resume();
  unlocked = true;
}

export function setSoundEnabled(value) {
  enabled = !!value;
}

export function setVolume(value) {
  if (master) master.gain.value = Math.max(0, Math.min(1, value));
}

/** One shaped sine/triangle blip. The building block for everything below. */
function tone({
  freq = 660,
  duration = 0.12,
  type = 'sine',
  gain = 0.5,
  delay = 0,
  sweepTo = null,
  attack = 0.006,
} = {}) {
  const c = audio();
  if (!c || !enabled) return;
  if (c.state === 'suspended') c.resume();

  const start = c.currentTime + delay;
  const osc = c.createOscillator();
  const env = c.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (sweepTo) osc.frequency.exponentialRampToValueAtTime(sweepTo, start + duration);

  env.gain.setValueAtTime(0.0001, start);
  env.gain.exponentialRampToValueAtTime(gain, start + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  osc.connect(env);
  env.connect(master);
  osc.start(start);
  osc.stop(start + duration + 0.02);
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

  /** Repeating ring for an incoming call — returns a stop function. */
  ring: () => {
    if (!enabled) return () => {};
    const play = () => {
      tone({ freq: 880, duration: 0.32, gain: 0.22 });
      tone({ freq: 1174, duration: 0.32, gain: 0.16, delay: 0.02 });
      tone({ freq: 880, duration: 0.32, gain: 0.22, delay: 0.42 });
      tone({ freq: 1174, duration: 0.32, gain: 0.16, delay: 0.44 });
    };
    play();
    const timer = setInterval(play, 2400);
    return () => clearInterval(timer);
  },

  /** Outgoing call dial tone. */
  dial: () => {
    if (!enabled) return () => {};
    const play = () => tone({ freq: 440, duration: 0.9, gain: 0.09, type: 'sine' });
    play();
    const timer = setInterval(play, 3000);
    return () => clearInterval(timer);
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

/* ────────────────────────────── haptics ────────────────────────────── */

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
};

/** The one call most components need: a click sound plus a matching tap. */
export function feedback(kind = 'tap') {
  sounds[kind]?.();
  const map = {
    tap: haptics.light,
    select: haptics.selection,
    send: haptics.light,
    receive: haptics.medium,
    react: haptics.impact,
    open: haptics.light,
    close: haptics.light,
    error: haptics.error,
    success: haptics.success,
    linked: haptics.success,
    recordStart: haptics.medium,
    recordStop: haptics.medium,
  };
  map[kind]?.();
}

export { unlocked };
