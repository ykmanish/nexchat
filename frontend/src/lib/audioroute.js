'use client';

/**
 * Where a call's audio comes out.
 *
 * A phone call belongs at the earpiece. You hold the phone to your head, the
 * sound is private, and the echo canceller has an easy job because the speaker
 * is nowhere near the microphone. Speakerphone is the deliberate choice you make
 * afterwards, by pressing a button — not the state you are dropped into.
 *
 * The web gives us exactly one lever for this, and it is a narrow one:
 * `HTMLMediaElement.setSinkId`, which picks an output *device* by id from
 * `enumerateDevices`. What that buys us depends entirely on the platform, and it
 * is worth being precise, because the honest answer is not "yes":
 *
 *   - Desktop Chrome and Edge: `setSinkId` works, and every output the machine
 *     has is listed. Real control.
 *   - Android Chrome: `setSinkId` exists, and on many builds the earpiece and
 *     the speaker are both enumerated (labelled along the lines of "Earpiece"
 *     and "Speakerphone"). Where they are, this works properly. Where the list
 *     collapses to a single "Default", nothing can move the audio.
 *   - iOS Safari: `setSinkId` is not implemented at all, and the audio session
 *     category — the thing that actually decides earpiece versus speaker on iOS
 *     — is not reachable from a web page. A browser tab cannot choose. Only a
 *     native app can.
 *
 * So this module does what is possible and reports what it managed, and the call
 * screen shows the truth rather than a button that pretends. `supported()` is
 * the difference between "you can switch this" and "your phone decides".
 *
 * Output device labels also stay empty until microphone permission has been
 * granted, which is why routing is only ever set up once a call has its stream.
 */

/**
 * What we can tell about each output from its label.
 *
 * `internal speaker (built-in)` used to be in the earpiece pattern, which was
 * simply wrong: a Mac's internal speakers are the loudspeaker, and putting them
 * in the earpiece slot meant the toggle's two positions could be the same
 * device. Headphones are their own thing and belong in neither — a call should
 * not be moved off them by either position of a speakerphone button.
 */
const EARPIECE = /earpiece|receiver|handset/i;
const SPEAKER = /speaker(phone)?|loudspeaker/i;
const HEADSET = /headphone|headset|earbud|airpod|bluetooth/i;

let cached = null; // { earpiece, speaker, all } — device ids
let invalidatorAttached = false;

const media = () =>
  typeof navigator !== 'undefined' && navigator.mediaDevices ? navigator.mediaDevices : null;

/**
 * Drops the cache whenever the devices change, whoever is or is not watching.
 *
 * The cache used to be cleared only inside `watchDevices`, which tied the
 * correctness of the answer to somebody having asked to be notified. A caller
 * that merely wants to know where the audio can go — and there is no reason such
 * a caller must also subscribe — would have been handed a list from earlier in
 * the page's life, and pointed the call at a device that had since been
 * unplugged. The cache belongs to this module, so invalidating it does too.
 */
function attachInvalidator() {
  if (invalidatorAttached) return;
  const m = media();
  if (!m?.addEventListener) return;
  m.addEventListener('devicechange', () => {
    cached = null;
  });
  invalidatorAttached = true;
}

/**
 * Whether this browser can be told where to put the sound.
 *
 * Deliberately a capability check on the API and not a guess from the user
 * agent: a Chromium build that gained `setSinkId` last month should get the
 * working button without anybody editing a regex here.
 */
export function supported() {
  if (typeof document === 'undefined') return false;
  const el = document.createElement('audio');
  return typeof el.setSinkId === 'function' && !!media()?.enumerateDevices;
}

/**
 * Finds the earpiece and the speaker among the outputs, if they are there.
 *
 * Cached, because enumerating is a real call and the answer does not change
 * during a call — but the cache is cleared on `devicechange`, which is what
 * plugging in headphones looks like.
 */
export async function outputs({ refresh = false } = {}) {
  attachInvalidator();
  if (cached && !refresh) return cached;
  if (!supported()) {
    cached = { primary: null, secondary: null, named: false, all: [] };
    return cached;
  }

  try {
    const all = (await media().enumerateDevices()).filter((d) => d.kind === 'audiooutput');

    /* `default` and `communications` are Chrome's own aliases rather than
       hardware, and they are what the list collapses to when the real outputs
       are not exposed. Matching on them would give a button that appears to work
       and changes nothing. */
    const real = all.filter((d) => d.deviceId !== 'default' && d.deviceId !== 'communications');

    const find = (re) => real.find((d) => re.test(d.label || '')) || null;

    const earpiece = find(EARPIECE);
    const speaker = find(SPEAKER);

    /**
     * The two positions of the toggle, which is not always earpiece/speaker.
     *
     * A phone that names both is the easy case. A desktop names neither — its
     * outputs are "Speakers (Realtek)", "Dell U2720Q", "Headphones" — and
     * requiring the words "earpiece" and "speakerphone" meant the button was
     * dead on every desktop in the world, which is not "your device decides", it
     * is this code failing to look. So when the pair cannot be named, any two
     * distinct outputs will do: the toggle then moves the call between them and
     * the hint says which one it is on.
     *
     * Headphones are excluded from the fallback pair. Moving a call off the
     * headphones somebody has just plugged in, because they pressed a button
     * labelled Speaker, would be a worse answer than doing nothing.
     */
    let primary = earpiece;
    let secondary = speaker;

    if (!primary || !secondary || primary.deviceId === secondary.deviceId) {
      const plain = real.filter((d) => !HEADSET.test(d.label || ''));
      const speakerish = plain.find((d) => SPEAKER.test(d.label || ''));
      const other = plain.find((d) => d.deviceId !== speakerish?.deviceId);
      primary = other || plain[0] || null;
      secondary =
        speakerish && speakerish.deviceId !== primary?.deviceId ? speakerish : plain[1] || null;
    }

    cached = {
      /* `primary` and `secondary`, not `earpiece` and `speaker`: on a phone they
         are exactly that, and on a desktop they are just two outputs. Naming
         them for the phone case would make every desktop read as a lie. */
      primary: primary?.deviceId || null,
      primaryLabel: primary?.label || null,
      secondary: secondary?.deviceId || null,
      secondaryLabel: secondary?.label || null,
      /* Whether the two positions really are an earpiece and a speaker, or just
         two outputs. The call screen words its hint from this. */
      named: !!(earpiece && speaker && earpiece.deviceId !== speaker.deviceId),
      all: real.map((d) => ({ id: d.deviceId, label: d.label })),
    };
    return cached;
  } catch {
    cached = { primary: null, secondary: null, named: false, all: [] };
    return cached;
  }
}

/**
 * Called when the set of devices changes — headphones in or out.
 *
 * Only notification; the cache is dropped by `attachInvalidator` above whether
 * anybody subscribes or not.
 */
export function watchDevices(onChange) {
  const m = media();
  if (!m?.addEventListener) return () => {};
  attachInvalidator();
  const handler = () => onChange?.();
  m.addEventListener('devicechange', handler);
  return () => m.removeEventListener('devicechange', handler);
}

/**
 * Points an element's output at the earpiece or the speaker.
 *
 * Returns the route it actually achieved, which is the point: the caller shows
 * that, not what it asked for. `null` means the platform would not move it and
 * whatever the phone chose is what you get.
 */
export async function routeTo(el, want) {
  if (!el || !supported()) return null;

  const found = await outputs();
  const target = want === 'speaker' ? found.secondary : found.primary;

  /* An explicit id is the only thing worth setting. Falling back to '' (the
     system default) would report success while leaving the sound exactly where
     it was — the failure mode this whole module exists to avoid. */
  if (!target) return null;

  try {
    await el.setSinkId(target);
    return want;
  } catch {
    /* Permission refused, or the device disappeared between the enumeration and
       the assignment. Either way the sound did not move. */
    return null;
  }
}

/**
 * Whether both ends of the switch exist on this device.
 *
 * A phone that exposes only its speaker cannot be put on the earpiece, and a
 * toggle with one position is not a toggle.
 */
export async function canSwitch() {
  if (!supported()) return false;
  const found = await outputs();
  return !!found.primary && !!found.secondary && found.primary !== found.secondary;
}

/**
 * How to describe the two positions to the person pressing the button.
 *
 * `named` is the difference between a phone, where "speaker" means the
 * loudspeaker instead of the earpiece, and a desktop, where it only means a
 * different output — and saying "earpiece" about a monitor's speakers would be
 * nonsense.
 */
export async function describe() {
  const found = await outputs();
  return {
    named: !!found.named,
    earpiece: found.primaryLabel || 'the earpiece',
    speaker: found.secondaryLabel || 'the speaker',
  };
}
