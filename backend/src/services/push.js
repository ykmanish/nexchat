import webpush from 'web-push';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { Device } from '../models/Device.js';
import { User } from '../models/User.js';
import { presence } from './presence.js';
import { initFcm, fcmReady, sendToToken } from './fcm.js';

let ready = false;
let publicKey = null;
/** True when the keys were minted at boot rather than configured. */
let ephemeral = false;

/**
 * Web Push delivery for devices that are not currently holding a socket.
 *
 * The payload deliberately carries no message content — the service worker has
 * no access to the user's keys and could not decrypt it anyway. It ships only
 * the routing metadata the server already knows, so a notification can say who
 * it is from and open the right chat.
 */
export function initPush() {
  // The Android app is delivered to over FCM; the browser over Web Push. Both
  // are optional and independent — a server with only one configured still
  // notifies the clients it can reach.
  initFcm();

  let { publicKey: pub, privateKey: priv } = env.push;

  if (!pub || !priv) {
    /* Without keys nothing can be delivered, so mint a pair and tell the
       operator to persist them.

       This is worth being loud about, because the failure it causes is
       invisible from both ends. A browser subscribes against the public key it
       was handed; restart the server with a fresh pair and every stored
       subscription is signed by a key the push service no longer accepts.
       Delivery stops, the client still believes it is subscribed, and the
       symptom reported is "notifications just stopped working" with nothing in
       any log to explain it. So the state is also reported to the client, which
       says so on the notifications screen rather than claiming push is on. */
    const generated = webpush.generateVAPIDKeys();
    pub = generated.publicKey;
    priv = generated.privateKey;
    ephemeral = true;

    logger.warn('No VAPID keys configured — generated a TEMPORARY pair.');
    logger.warn('Push will work until this process restarts, then every');
    logger.warn('subscription silently stops delivering. Put these in .env:');
    logger.warn('  VAPID_PUBLIC_KEY=' + pub);
    logger.warn('  VAPID_PRIVATE_KEY=' + priv);
  }

  try {
    webpush.setVapidDetails(env.push.subject, pub, priv);
    publicKey = pub;
    ready = true;
    logger.success('Web Push ready');
  } catch (err) {
    logger.error('Web Push disabled: ' + err.message);
    ready = false;
  }
}

export const pushPublicKey = () => publicKey;
export const pushEphemeral = () => ephemeral;
export { fcmReady };

/** True when *some* transport can deliver — Web Push, FCM, or both. */
export const pushReady = () => ready || fcmReady();

/** Removes a subscription the client has permanently rejected. */
async function dropSubscription(deviceId) {
  await Device.updateOne({ deviceId }, { pushSubscription: null }).catch(() => {});
}

/**
 * Sends to one device over whichever transport its subscription describes.
 *
 * A browser stores a PushSubscription (it has an `endpoint`); the Android app
 * stores `{ type: 'fcm', token }`. Discriminating on the stored shape rather
 * than on a column keeps this additive — existing rows are untouched and keep
 * working exactly as before.
 */
async function deliver(device, payload, { urgency, collapse, ttl }) {
  const subscription = device.pushSubscription;
  if (!subscription) return false;

  if (subscription.type === 'fcm') {
    if (!fcmReady()) return false;

    const result = await sendToToken(subscription.token, payload, {
      collapseKey: collapse,
      ttlSeconds: ttl,
    });

    if (result.gone) await dropSubscription(device.deviceId);
    return result.ok;
  }

  if (!ready || !subscription.endpoint) return false;

  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload), {
      TTL: ttl,
      urgency,
      ...(collapse ? { topic: collapse } : {}),
    });
    return true;
  } catch (err) {
    // 404/410 mean the browser threw the subscription away for good.
    if (err.statusCode === 404 || err.statusCode === 410) {
      await dropSubscription(device.deviceId);
    } else {
      logger.warn('Push to ' + device.deviceId + ' failed: ' + err.message);
    }
    return false;
  }
}

/**
 * Notifies one user's devices.
 *
 * Only devices that are *both* connected and on screen are skipped. That
 * distinction is the whole fix for "notifications do not arrive": a phone with
 * the app in the background keeps its websocket for as long as the OS lets it,
 * so it used to count as connected and got nothing — while the browser had
 * frozen the tab and rendered none of the socket traffic. The message then
 * appeared the instant you opened the app, which reads as a notification that
 * never came rather than one that was suppressed on purpose.
 *
 * `urgency: 'high'` matters as much. Web Push defaults to normal urgency, and
 * both FCM and APNs deliberately batch normal-priority messages to save
 * battery — minutes late is within spec. A chat message is the canonical case
 * for high, which is delivered immediately and is what every other messenger
 * asks for.
 *
 * `topic` lets the push service collapse an undelivered notification rather
 * than queue five of them: a phone that comes back after ten messages should
 * ring once, not ten times.
 */
export async function pushToUser(userId, payload, { skipDeviceIds = [], urgency = 'high' } = {}) {
  if (!pushReady()) return 0;

  const skip = new Set(presence.attentiveDevicesOf(userId));
  skipDeviceIds.forEach((d) => skip.add(String(d)));

  const devices = await Device.find({
    user: userId,
    revokedAt: null,
    pushSubscription: { $ne: null },
  })
    .select('deviceId pushSubscription')
    .lean();

  const targets = devices.filter((d) => !skip.has(String(d.deviceId)));
  if (!targets.length) return 0;

  const options = {
    ttl: payload.type === 'typing' ? 30 : 60 * 60,
    urgency,
    collapse: collapseKey(payload),
  };

  const results = await Promise.all(
    targets.map((device) => deliver(device, payload, options).catch(() => false))
  );

  return results.filter(Boolean).length;
}

/**
 * Per-conversation collapse key.
 *
 * Must be URL-safe base64 of at most 32 characters — the spec is strict and a
 * rejected topic fails the whole send, so a Mongo id is hashed down rather than
 * used raw. Typing and message notices get different keys: a typing notice must
 * never replace an undelivered message.
 */
function collapseKey(payload) {
  if (!payload?.conversationId) return null;
  const seed = (payload.type === 'typing' ? 't' : 'm') + payload.conversationId;
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return (payload.type === 'typing' ? 'typ' : 'msg') + Math.abs(hash).toString(36);
}

/**
 * A notification the user asked for, to prove the pipeline works end to end.
 *
 * Deliberately ignores the skip list. The point is to test *this* device's
 * subscription while the settings screen is open in front of you, and the
 * settings screen is by definition in the foreground — the ordinary rules would
 * suppress the one notification you are trying to see.
 */
export async function pushTest(userId, deviceId) {
  if (!pushReady()) return { sent: 0, reason: 'Push is not configured on this server' };

  const device = await Device.findOne({
    user: userId,
    deviceId,
    revokedAt: null,
  })
    .select('deviceId pushSubscription')
    .lean();

  if (!device?.pushSubscription) {
    return { sent: 0, reason: 'This device has no push subscription yet' };
  }

  const payload = {
    type: 'test',
    title: 'Notifications are working',
    body: 'This is a test from Chax. Real alerts say who wrote to you.',
    at: new Date().toISOString(),
  };

  const delivered = await deliver(device, payload, {
    ttl: 60,
    urgency: 'high',
    collapse: null,
  });

  if (delivered) return { sent: 1 };

  // `deliver` has already dropped the subscription if the service retired it,
  // so a second look tells us which of the two failures this was.
  const still = await Device.findOne({ deviceId }).select('pushSubscription').lean();
  return {
    sent: 0,
    reason: still?.pushSubscription
      ? 'The push service would not accept it — check the server logs'
      : 'This device dropped its subscription — turn notifications on again',
  };
}

/* One typing notice per conversation per person per cooldown — otherwise every
   keystroke burst would ring the recipient's phone.

   Was three minutes, which in practice meant the notice never arrived: by the
   time it was allowed again the person had long since sent the message and the
   "is typing" was a lie about the past. Forty seconds is long enough that a
   paragraph written in bursts rings once, short enough that a second
   conversation an hour later actually gets one. */
const typingCooldown = new Map();
const TYPING_COOLDOWN_MS = 40 * 1000;

export async function pushTyping({ conversation, sender, recipients }) {
  if (!pushReady()) return;

  const now = Date.now();
  const key = String(conversation._id) + ':' + String(sender._id);
  const last = typingCooldown.get(key) || 0;
  if (now - last < TYPING_COOLDOWN_MS) return;
  typingCooldown.set(key, now);

  // Keep the map from growing without bound on a busy server.
  if (typingCooldown.size > 5000) {
    for (const [k, at] of typingCooldown) {
      if (now - at > TYPING_COOLDOWN_MS) typingCooldown.delete(k);
    }
  }

  const payload = {
    type: 'typing',
    conversationId: String(conversation._id),
    senderName: sender?.name || 'Someone',
    conversationName: conversation.type === 'direct' ? sender?.name : conversation.name,
    isGroup: conversation.type !== 'direct',
    at: new Date().toISOString(),
  };

  /* A muted chat stays quiet while somebody types in it, and so does one whose
     owner turned typing notices off. Both are decided here rather than in the
     service worker, which has no idea what the recipient's settings are — and a
     phone that lights up for a chat you muted is worse than no notice at all. */
  await Promise.all(
    recipients.map(async (r) => {
      const participant = conversation.participantOf?.(r.userId);
      if (!shouldNotify(participant, { mentioned: false })) return 0;
      if (!(await wantsTypingNotices(r.userId))) return 0;
      return pushToUser(r.userId, payload).catch(() => 0);
    })
  );
}

/* One lookup per user per minute at most; the setting almost never changes and
   a typing burst must not turn into a burst of database reads. */
const typingPrefCache = new Map();
const TYPING_PREF_TTL_MS = 60 * 1000;

async function wantsTypingNotices(userId) {
  const key = String(userId);
  const hit = typingPrefCache.get(key);
  if (hit && Date.now() - hit.at < TYPING_PREF_TTL_MS) return hit.value;

  const user = await User.findById(key).select('settings.notifications').lean().catch(() => null);
  // Off by default: a notification for something that is not a message yet has
  // to be asked for, not assumed.
  const value = user?.settings?.notifications?.typing === true;

  typingPrefCache.set(key, { value, at: Date.now() });
  if (typingPrefCache.size > 5000) typingPrefCache.clear();
  return value;
}

/** Called when the setting is written, so a flip takes effect immediately. */
export function forgetTypingPreference(userId) {
  typingPrefCache.delete(String(userId));
}

/**
 * Whether this particular person should hear about this particular message.
 *
 * Mute used to be a client-side nicety — the server pushed regardless and the
 * app decided whether to make a sound, which meant a muted group still lit up
 * a locked phone. It is decided here now. 'mentions' mode is the interesting
 * one: silent for ordinary traffic, audible when the message names you, which
 * is the only setting that makes a busy group survivable.
 */
function shouldNotify(participant, { mentioned }) {
  if (!participant) return true;

  const mutedNow =
    participant.muted && (!participant.mutedUntil || participant.mutedUntil > new Date());
  if (!mutedNow) return true;

  return participant.muteMode === 'mentions' && mentioned;
}

/** Fan-out helper for a new message. */
export async function pushNewMessage({
  conversation,
  message,
  sender,
  recipients,
  mentioned = new Set(),
  threadRoot = null,
}) {
  /* `pushReady()`, not `ready`.
     `ready` is the Web Push flag alone — so a deployment configured with FCM
     and no VAPID keys returned here on every message and delivered nothing,
     while `pushToUser` below was perfectly capable of reaching the Android
     app. Two different readiness checks for one pipeline, and the stricter one
     was the gate. */
  if (!pushReady()) return;

  /* A secret chat gives a notification nothing to say.
     Not even who wrote — the name on a lock screen is most of what a glance
     over a shoulder gets, and a chat you turned this on for is exactly the one
     where that matters. `hidden` also tells the service worker not to group or
     re-notify by conversation, which would leak the same thing by counting. */
  const hidden = !!conversation.secret?.enabled && conversation.secret?.hideNotifications !== false;

  const basePayload = hidden
    ? {
        type: 'message',
        hidden: true,
        conversationId: String(conversation._id),
        messageId: String(message._id),
        senderName: 'Chax',
        conversationName: 'Secret chat',
        isGroup: false,
        threadRoot: null,
        at: message.createdAt,
      }
    : {
        type: 'message',
        conversationId: String(conversation._id),
        messageId: String(message._id),
        senderName: sender?.name || 'Someone',
        conversationName: conversation.type === 'direct' ? sender?.name : conversation.name,
        isGroup: conversation.type !== 'direct',
        threadRoot: threadRoot ? String(threadRoot) : null,
        at: message.createdAt,
      };

  await Promise.all(
    recipients.map((r) => {
      const participant = conversation.participantOf?.(r.userId);
      const wasMentioned = mentioned.has?.(String(r.userId)) || false;
      if (!shouldNotify(participant, { mentioned: wasMentioned })) return 0;

      // A mention is worth marking: the service worker raises it differently
      // from ordinary traffic, and it is the reason a muted chat spoke at all.
      return pushToUser(
        r.userId,
        { ...basePayload, mention: wasMentioned },
        { skipDeviceIds: [] }
      ).catch(() => 0);
    })
  );
}
