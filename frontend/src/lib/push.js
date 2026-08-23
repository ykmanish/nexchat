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

export async function isSubscribed() {
  if (!pushSupported()) return false;
  try {
    const registration = await navigator.serviceWorker.getRegistration(SW_PATH);
    return !!(await registration?.pushManager.getSubscription());
  } catch {
    return false;
  }
}
