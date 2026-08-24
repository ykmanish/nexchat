'use client';

import { vault } from './vault';
import { useChat } from '@/store/chat';

/**
 * Emergency share: one tap sends your location to chosen people, then keeps
 * sending it.
 *
 * Built out of ordinary messages on purpose. Each update is a normal encrypted
 * message to a normal direct chat, which means the location is end-to-end
 * encrypted exactly like everything else, arrives with a notification the
 * recipient already knows how to react to, and stays in the conversation
 * afterwards as a record. A bespoke channel would have needed its own
 * encryption, its own delivery guarantees and its own notifications — three
 * chances to be less reliable at the worst possible moment.
 *
 * Design decisions that matter when someone is frightened:
 *
 *   - The first message goes out on the *first* position fix, not after the
 *     accuracy settles. A rough location now beats a precise one in thirty
 *     seconds.
 *   - If the fix fails entirely, the alert is still sent without coordinates.
 *     "I need help" reaching someone matters more than the map link.
 *   - Contacts live on the account, not the device, so a phone you have just
 *     picked up still knows who to tell.
 *   - Stopping is explicit and the banner is always visible. Something that
 *     shares your location silently is a tracker, not a safety feature.
 */

const META_KEY = 'sos';

export const DURATIONS = [
  { value: 15, label: '15 minutes' },
  { value: 60, label: '1 hour' },
  { value: 240, label: '4 hours' },
];

/** Frequent enough to be useful on foot, sparse enough not to flatten a battery. */
const UPDATE_INTERVAL_MS = 45_000;

const DEFAULT_MESSAGE = 'I need help. This is my location — please contact me.';

/* ─────────────────────────────── settings ─────────────────────────────── */

/**
 * Stored on the account rather than the device, deliberately. Someone reaching
 * for this on a borrowed or freshly-signed-in phone should not discover their
 * emergency contacts were left on a device they no longer have.
 */
export const config = {
  async get() {
    const stored = await vault.getMeta(META_KEY);
    return {
      contactIds: [],
      message: DEFAULT_MESSAGE,
      durationMinutes: 60,
      ...(stored || {}),
    };
  },

  async set(patch) {
    const next = { ...(await config.get()), ...patch };
    await vault.setMeta(META_KEY, next);
    return next;
  },
};

export const DEFAULT_SOS_MESSAGE = DEFAULT_MESSAGE;

/* ─────────────────────────────── location ─────────────────────────────── */

export const isSupported = () =>
  typeof navigator !== 'undefined' && !!navigator.geolocation;

/**
 * One position fix, or null.
 *
 * Never rejects. A caller in the middle of an emergency should not have to
 * handle an exception to send the alert anyway.
 */
export function fix({ timeout = 10_000 } = {}) {
  if (!isSupported()) return Promise.resolve(null);

  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    navigator.geolocation.getCurrentPosition(
      (pos) =>
        done({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: Math.round(pos.coords.accuracy),
          at: new Date().toISOString(),
        }),
      () => done(null),
      { enableHighAccuracy: true, timeout, maximumAge: 0 }
    );

    // Belt and braces: some browsers never call either callback.
    setTimeout(() => done(null), timeout + 1000);
  });
}

const mapLink = (p) =>
  p ? 'https://www.google.com/maps?q=' + p.lat.toFixed(6) + ',' + p.lng.toFixed(6) : null;

/* ──────────────────────────────── sending ──────────────────────────────── */

let session = null;

/** Delivers one update to every emergency contact. */
async function broadcast({ contactIds, text, position, kind }) {
  const chat = useChat.getState();

  await Promise.all(
    contactIds.map(async (userId) => {
      try {
        // A direct chat may not exist yet — createDirect is idempotent.
        const conversation = await chat.createDirect(userId);
        const conversationId = conversation?._id || conversation?.id;
        if (!conversationId) return;

        await chat.sendMessage({
          conversationId,
          text,
          type: position ? 'location' : 'text',
          meta: {
            sos: { kind, position: position || null, mapUrl: mapLink(position) },
          },
        });
      } catch {
        // One unreachable contact must not stop the others being told.
      }
    })
  );
}

/**
 * Starts an emergency share. Returns the live session.
 *
 * `onUpdate` is called after every send so the banner can show what has
 * happened — including that a fix failed, which the person needs to know rather
 * than assume.
 */
export async function start({ onUpdate } = {}) {
  if (session) return session;

  const settings = await config.get();
  if (!settings.contactIds.length) {
    throw new Error('Choose at least one emergency contact first');
  }

  const endsAt = Date.now() + settings.durationMinutes * 60_000;
  session = { startedAt: Date.now(), endsAt, sent: 0, lastPosition: null, contactIds: settings.contactIds };

  const tick = async (first = false) => {
    if (!session) return;

    const position = await fix();
    session.lastPosition = position;

    await broadcast({
      contactIds: settings.contactIds,
      text: first
        ? settings.message + (position ? '\n' + mapLink(position) : '\n(location unavailable)')
        : 'Still here. ' + (position ? mapLink(position) : 'Location unavailable.'),
      position,
      kind: first ? 'alert' : 'update',
    });

    session.sent += 1;
    onUpdate?.({ ...session });

    if (Date.now() >= session.endsAt) {
      stop({ reason: 'expired', onUpdate });
    }
  };

  // The first send does not wait for a good fix.
  await tick(true);

  session.timer = setInterval(() => {
    tick(false).catch(() => {});
  }, UPDATE_INTERVAL_MS);

  return session;
}

/** Ends the share and tells the contacts it has ended. */
export async function stop({ reason = 'stopped', onUpdate } = {}) {
  if (!session) return;

  const { contactIds } = session;
  clearInterval(session.timer);
  const finished = { ...session, active: false, reason };
  session = null;

  // Silence after an SOS is ambiguous in the worst way; say it ended.
  await broadcast({
    contactIds,
    text: reason === 'expired' ? 'Location sharing has ended.' : 'I am OK — location sharing stopped.',
    position: null,
    kind: 'end',
  }).catch(() => {});

  onUpdate?.(finished);
  return finished;
}

export const active = () => (session ? { ...session } : null);
export const UPDATE_EVERY_MS = UPDATE_INTERVAL_MS;
