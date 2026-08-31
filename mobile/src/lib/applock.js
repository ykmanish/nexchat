import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { report } from './report';

/**
 * App lock.
 *
 * Biometric or device-credential, held entirely on the phone. This is worth
 * being precise about because it is easy to oversell: the lock gates the *UI*,
 * not the data. Your messages are decrypted by keys in the vault, and those
 * keys are not derived from the fingerprint — someone with a rooted device and
 * your unlocked phone is not stopped by this. What it does stop is the ordinary
 * case: a phone handed over, or picked up off a desk.
 *
 * The setting lives in SecureStore rather than the user's server-side settings
 * on purpose. It is a property of this device, and syncing it would lock a
 * laptop because a phone had a fingerprint reader.
 */

const ENABLED_KEY = 'chax.applock.enabled';
const TIMEOUT_KEY = 'chax.applock.timeout';

/** How long the app may sit in the background before it locks again. */
export const TIMEOUTS = [
  { value: 0, label: 'Immediately' },
  { value: 60_000, label: 'After 1 minute' },
  { value: 900_000, label: 'After 15 minutes' },
  { value: 3_600_000, label: 'After 1 hour' },
];

export async function capabilities() {
  try {
    const [hasHardware, enrolled, types] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
      LocalAuthentication.supportedAuthenticationTypesAsync(),
    ]);

    const kinds = types.map((t) => {
      if (t === LocalAuthentication.AuthenticationType.FINGERPRINT) return 'fingerprint';
      if (t === LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION) return 'face';
      if (t === LocalAuthentication.AuthenticationType.IRIS) return 'iris';
      return 'unknown';
    });

    return { hasHardware, enrolled, kinds, available: hasHardware && enrolled };
  } catch (err) {
    report('applock:capabilities', err);
    return { hasHardware: false, enrolled: false, kinds: [], available: false };
  }
}

export async function isEnabled() {
  try {
    return (await SecureStore.getItemAsync(ENABLED_KEY)) === '1';
  } catch {
    return false;
  }
}

export async function timeout() {
  try {
    const raw = await SecureStore.getItemAsync(TIMEOUT_KEY);
    const value = Number(raw);
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

export async function setTimeout_(ms) {
  await SecureStore.setItemAsync(TIMEOUT_KEY, String(ms)).catch(() => {});
}

/**
 * Turning it on authenticates first.
 *
 * Enabling a lock you cannot then pass would leave the app permanently shut,
 * and the only way out would be clearing app data — which destroys the vault
 * and, with it, this device's ability to read its own history.
 */
export async function enable() {
  const caps = await capabilities();
  if (!caps.hasHardware) throw new Error('This phone has no biometric hardware.');
  if (!caps.enrolled) {
    throw new Error('Set up a fingerprint or face unlock in Android settings first.');
  }

  const ok = await authenticate({ reason: 'Confirm to turn on app lock' });
  if (!ok) throw new Error('Not confirmed — app lock is still off.');

  await SecureStore.setItemAsync(ENABLED_KEY, '1');
  return true;
}

export async function disable() {
  const ok = await authenticate({ reason: 'Confirm to turn off app lock' });
  if (!ok) throw new Error('Not confirmed — app lock is still on.');
  await SecureStore.deleteItemAsync(ENABLED_KEY).catch(() => {});
  return true;
}

export async function authenticate({ reason = 'Unlock Chax' } = {}) {
  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: reason,
      // The device PIN is a valid way in: refusing it would strand anyone
      // whose fingerprint stops being recognised.
      disableDeviceFallback: false,
      cancelLabel: 'Cancel',
    });
    return !!result.success;
  } catch (err) {
    report('applock:authenticate', err);
    return false;
  }
}
