import * as Haptics from 'expo-haptics';

/**
 * The web client synthesises little UI sounds through the Web Audio API. On a
 * phone that is the wrong instinct — a messenger that makes noise on every tap
 * is one people mute — so the same call sites map to haptics instead, which is
 * what the platform's own messaging apps do.
 *
 * Sound stays available for the one case it is actually wanted (an incoming
 * message while you are looking at another chat) and is left to the
 * notification channel, which respects the user's ringer and Do Not Disturb
 * without the app having to reason about either.
 */

let enabled = true;

export const setHapticsEnabled = (value) => {
  enabled = value !== false;
};

export function feedback(kind) {
  if (!enabled) return;

  try {
    switch (kind) {
      case 'send':
      case 'react':
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
      case 'select':
        Haptics.selectionAsync();
        break;
      default:
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  } catch {
    /* a device without a vibrator is not an error worth surfacing */
  }
}

/** Kept for call-site compatibility with the ported web modules. */
export const setSoundEnabled = () => {};
