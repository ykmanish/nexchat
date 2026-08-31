'use client';

import { api } from './api';

/**
 * Web Push registration.
 *
 * The service worker cannot decrypt anything, so notifications say who a
 * message is from but never what it says — the app itself fills in the content
 * once it is open and the keys are unlocked.
 */

const SW_PATH = '/sw.js';

export const pushSupported = () =>
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  'Notification' in window;

export const permission = () =>
  typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;

function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalised = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(normalised);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

export async function registerServiceWorker() {
  if (!pushSupported()) return null;
  try {
    return await navigator.serviceWorker.register(SW_PATH, { scope: '/' });
  } catch {
    return null;
  }
}

/** Asks for permission, subscribes, and hands the subscription to the API. */
export async function enablePush() {
  if (!pushSupported()) {
    throw new Error('This browser cannot receive push notifications');
  }

  const result = await Notification.requestPermission();
  if (result !== 'granted') {
    throw new Error(
      result === 'denied'
        ? 'Notifications are blocked. Allow them for this site in your browser settings.'
        : 'Notification permission was dismissed'
    );
  }

  const { data } = await api.get('/devices/vapid-public-key');
  if (!data.enabled || !data.publicKey) {
    throw new Error('Push is not configured on the server');
  }

  const registration = (await registerServiceWorker()) || (await navigator.serviceWorker.ready);
  if (!registration) throw new Error('Could not start the notification worker');

  await navigator.serviceWorker.ready;

  // Reuse an existing subscription rather than churning endpoints.
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(data.publicKey),
    });
  }

  await api.post('/devices/push-subscription', { subscription: subscription.toJSON() });
  return true;
}

export async function disablePush() {
  try {
    const registration = await navigator.serviceWorker.getRegistration(SW_PATH);
    const subscription = await registration?.pushManager.getSubscription();
    if (subscription) await subscription.unsubscribe();
  } catch {
    /* removing it server-side is what actually stops delivery */
  }
  await api.post('/devices/push-subscription', { subscription: null }).catch(() => {});
}

/**
 * What the server can actually deliver.
 *
 * `ephemeral` is the one that matters: it means the operator left the VAPID keys
 * blank, so the server minted a pair at boot. Push works until the process
 * restarts and then stops delivering with no error on either side — the client
 * still holds a subscription, the push service just refuses a key it no longer
 * recognises. Reporting it is the difference between a fixable configuration
 * problem and a mystery.
 */
export async function pushConfig() {
  try {
    const { data } = await api.get('/devices/vapid-public-key');
    return { enabled: !!data.enabled, ephemeral: !!data.ephemeral };
  } catch {
    return { enabled: false, ephemeral: false, unreachable: true };
  }
}

export async function isSubscribed() {
  if (!pushSupported()) return false;
  try {
    const registration = await navigator.serviceWorker.getRegistration(SW_PATH);
    return !!(await registration?.pushManager.getSubscription());
  } catch {
    return false;
  }
}

/**
 * Asks the server to push one notification to this device.
 *
 * Deliberately a round trip rather than a local `showNotification`. Drawing one
 * locally proves the browser can render a notification and nothing else, while
 * every part that actually breaks — VAPID configuration, the push service, an
 * expired subscription, the worker's push handler — is on the far side of that
 * call. A test that cannot fail is not a test.
 */
export async function sendTestNotification() {
  if (!pushSupported()) throw new Error('This browser cannot receive push notifications');
  if (permission() !== 'granted') throw new Error('Allow notifications first');
  if (!(await isSubscribed())) throw new Error('Turn push on first');

  const { data } = await api.post('/devices/push-test');
  if (!data.success) throw new Error(data.reason || 'The server could not send it');
  return data;
}

/**
 * Re-registers a subscription the browser rotated while we were away.
 *
 * Chrome refreshes push subscriptions periodically and the old endpoint then
 * stops delivering with no error anywhere — notifications simply stop arriving,
 * which is indistinguishable from the feature being broken. The worker handles
 * the case where it happens while a tab is open; this covers the far more
 * common one, where it happened days ago and is only discovered at launch.
 */
export async function reconcileSubscription() {
  if (!pushSupported()) return false;
  if (permission() !== 'granted') return false;

  try {
    const registration =
      (await navigator.serviceWorker.getRegistration(SW_PATH)) || (await registerServiceWorker());
    if (!registration) return false;

    await navigator.serviceWorker.ready;

    const { data } = await api.get('/devices/vapid-public-key');
    if (!data.enabled || !data.publicKey) return false;

    const existing = await registration.pushManager.getSubscription();

    /**
     * A subscription is only useful if it was minted with the key the server
     * is currently signing with.
     *
     * This is the second half of a failure that was completely silent. If the
     * server's VAPID pair changes — a fresh deploy with no keys in `.env`
     * generates an ephemeral pair on every restart — every stored subscription
     * is instantly rejected by the push service. The browser still holds a
     * perfectly valid-looking subscription object, so this function used to
     * post it back, return true, and report success, while nothing was ever
     * delivered again. Notifications "worked yesterday" and then stopped, with
     * nothing in any log and no way for the user to fix it.
     *
     * Comparing the keys turns that into something the client repairs by
     * itself on the next launch.
     */
    if (existing && !keyMatches(existing, data.publicKey)) {
      await existing.unsubscribe().catch(() => {});
    } else if (existing) {
      // Cheap and idempotent: the server stores it against this device, so a
      // rotated endpoint is corrected without the user doing anything.
      await api.post('/devices/push-subscription', { subscription: existing.toJSON() });
      return true;
    }

    // Either the browser dropped the subscription or it was signed with a key
    // the server no longer uses. Re-subscribing needs no prompt.
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(data.publicKey),
    });
    await api.post('/devices/push-subscription', { subscription: subscription.toJSON() });
    return true;
  } catch {
    return false;
  }
}

/** Hands the API a subscription the worker minted on its own. */
/**
 * Whether a subscription was created with this public key.
 *
 * `options.applicationServerKey` comes back as an ArrayBuffer of the raw
 * P-256 point; the server hands out the same bytes as base64url. Compared
 * byte by byte rather than by re-encoding, because base64url padding differs
 * between implementations and a false mismatch would re-subscribe on every
 * single launch.
 */
function keyMatches(subscription, publicKey) {
  const raw = subscription.options?.applicationServerKey;
  if (!raw || !publicKey) return false;

  try {
    const mine = new Uint8Array(raw);
    const theirs = urlBase64ToUint8Array(publicKey);
    if (mine.length !== theirs.length) return false;
    for (let i = 0; i < mine.length; i += 1) {
      if (mine[i] !== theirs[i]) return false;
    }
    return true;
  } catch {
    // Unreadable — treat as a mismatch and re-subscribe. Cheap and safe.
    return false;
  }
}

export async function adoptSubscription(subscription) {
  if (!subscription) return;
  await api.post('/devices/push-subscription', { subscription }).catch(() => {});
}
