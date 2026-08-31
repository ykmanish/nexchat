import * as Haptics from 'expo-haptics';
import { Audio } from 'expo-av';

/**
 * Sound and haptics.
 *
 * The web client synthesises its UI sounds through the Web Audio API. React
 * Native has no oscillator, so the same tones are rendered to small WAVs at
 * build time and played from memory here — same character, no network, a few KB
 * each.
 *
 * Deliberately expo-av rather than expo-audio, even though expo-audio is the
 * newer API: the version of it that Expo lists for SDK 54 depends on
 * `expo-asset@57`, two SDKs ahead of the `expo-modules-core` this SDK bundles.
 * Autolinking compiles that nested copy, whose source references classes the
 * core does not have, and the release build fails at R8 with "missing classes"
 * pointing at expo-asset rather than at the real culprit. expo-av is deprecated
 * but correct for this SDK, and playing five short files needs nothing newer.
 *
 * Sounds are loaded once at launch. Loading per tap is what makes one arrive
 * late and then all at once, and a busy chat can fire several a second.
 */

const FILES = {
  send: require('../../assets/sounds/send.wav'),
  receive: require('../../assets/sounds/receive.wav'),
  react: require('../../assets/sounds/react.wav'),
  error: require('../../assets/sounds/error.wav'),
  success: require('../../assets/sounds/success.wav'),
};

let soundEnabled = true;
let hapticsEnabled = true;
let sounds = null;
let audioReady = false;

export const setSoundEnabled = (value) => {
  soundEnabled = value !== false;
};

export const setHapticsEnabled = (value) => {
  hapticsEnabled = value !== false;
};

/**
 * Prepared once at launch.
 *
 * `playsInSilentModeIOS: false` and ducking rather than interrupting: a
 * messenger that talks over music, or chirps while the phone is on silent, is
 * one people mute at the OS level — and then miss the notifications too.
 */
export async function prepareAudio() {
  if (audioReady) return;
  audioReady = true;

  try {
    await Audio.setAudioModeAsync({
      playsInSilentModeIOS: false,
      shouldDuckAndroid: true,
      staysActiveInBackground: false,
    });

    const loaded = await Promise.all(
      Object.entries(FILES).map(async ([name, source]) => {
        const { sound } = await Audio.Sound.createAsync(source, { volume: 0.6 });
        return [name, sound];
      })
    );

    sounds = Object.fromEntries(loaded);
  } catch {
    // A device that will not give us an audio session still gets haptics.
    sounds = null;
  }
}

function play(name) {
  if (!soundEnabled || !sounds?.[name]) return;
  try {
    // `replayAsync` rewinds and plays: a second tap while the first is still
    // ringing should retrigger rather than queue or be dropped.
    sounds[name].replayAsync();
  } catch {
    /* never let a sound break the action that triggered it */
  }
}

function vibrate(kind) {
  if (!hapticsEnabled) return;
  try {
    switch (kind) {
      case 'send':
      case 'react':
      case 'select':
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        break;
      case 'receive':
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft);
        break;
      case 'error':
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        break;
      case 'success':
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        break;
      default:
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  } catch {
    /* a device without a vibrator is not an error worth surfacing */
  }
}

/** One call site for both channels, as the web client has. */
export function feedback(kind) {
  vibrate(kind);

  switch (kind) {
    case 'send':
      play('send');
      break;
    case 'receive':
    case 'mention':
      play('receive');
      break;
    case 'react':
    case 'select':
      play('react');
      break;
    case 'error':
      play('error');
      break;
    case 'success':
      play('success');
      break;
    default:
      break;
  }
}
