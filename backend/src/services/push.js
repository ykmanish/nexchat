import webpush from 'web-push';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { Device } from '../models/Device.js';
import { presence } from './presence.js';

let ready = false;
let publicKey = null;

/**
 * Web Push delivery for devices that are not currently holding a socket.
 *
 * The payload deliberately carries no message content — the service worker has
 * no access to the user's keys and could not decrypt it anyway. It ships only
 * the routing metadata the server already knows, so a notification can say who
 * it is from and open the right chat.
 */
export function initPush() {
  let { publicKey: pub, privateKey: priv } = env.push;

  if (!pub || !priv) {
    // Without keys nothing can be delivered, so mint a pair and tell the
    // operator to persist them — regenerating invalidates every subscription.
    const generated = webpush.generateVAPIDKeys();
    pub = generated.publicKey;
    priv = generated.privateKey;

    logger.warn('No VAPID keys configured — generated a temporary pair.');
    logger.warn('Add these to backend/.env so subscriptions survive a restart:');
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
export const pushReady = () => ready;

/** Removes a subscription the browser has permanently rejected. */
async function dropSubscription(deviceId) {
  await Device.updateOne({ deviceId }, { pushSubscription: null }).catch(() => {});
}

/**
 * Notifies one user's devices, skipping any that already have a live socket —
 * those got the message over the websocket and would double-notify.
 */
export async function pushToUser(userId, payload, { skipDeviceIds = [] } = {}) {
  if (!ready) return 0;

  const connected = new Set(presence.devicesOf(userId));
  skipDeviceIds.forEach((d) => connected.add(d));

  const devices = await Device.find({
    user: userId,
    revokedAt: null,
    pushSubscription: { $ne: null },
  })
    .select('deviceId pushSubscription')
    .lean();

  const targets = devices.filter((d) => !connected.has(d.deviceId));
  if (!targets.length) return 0;

  const body = JSON.stringify(payload);
  let sent = 0;

  await Promise.all(
    targets.map(async (device) => {
      try {
        await webpush.sendNotification(device.pushSubscription, body, { TTL: 60 * 60 });
        sent += 1;
      } catch (err) {
        // 404/410 mean the browser threw the subscription away for good.
        if (err.statusCode === 404 || err.statusCode === 410) {
          await dropSubscription(device.deviceId);
        } else {
          logger.warn('Push to ' + device.deviceId + ' failed: ' + err.message);
        }
      }
    })
  );

  return sent;
}

/* One typing notice per conversation per person per cooldown — otherwise every
   keystroke burst would ring the recipient's phone. */
const typingCooldown = new Map();
const TYPING_COOLDOWN_MS = 3 * 60 * 1000;

export async function pushTyping({ conversation, sender, recipients }) {
  if (!ready) return;

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

  await Promise.all(
    recipients.map((r) => pushToUser(r.userId, payload).catch(() => 0))
  );
}

/** Fan-out helper for a new message. */
export async function pushNewMessage({ conversation, message, sender, recipients }) {
  if (!ready) return;

  const payload = {
    type: 'message',
    conversationId: String(conversation._id),
    messageId: String(message._id),
    senderName: sender?.name || 'Someone',
    conversationName: conversation.type === 'direct' ? sender?.name : conversation.name,
    isGroup: conversation.type !== 'direct',
    at: message.createdAt,
  };

  await Promise.all(
    recipients.map((r) =>
      pushToUser(r.userId, payload, { skipDeviceIds: [] }).catch(() => 0)
    )
  );
}
