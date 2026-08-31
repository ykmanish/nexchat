import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { api, tokens } from './api';
import { vault } from './vault';
import * as e2ee from './e2ee';
import { uid } from './utils';
import { HAS_FCM } from './config';
import { report, trace } from './report';

/**
 * Notifications, and replying from inside one.
 *
 * The server pushes routing metadata only — who wrote and in which chat, never
 * what they said, because it cannot read that. So the notification says "Ada
 * sent you a message", and the text is filled in from the local cache once the
 * app has keys, exactly as the web service worker behaves.
 *
 * Two transports, deliberately:
 *
 *   FCM     the primary. Survives the app being killed and is what Android's
 *           own battery rules are built around.
 *   socket  the fallback. While the process is alive the websocket is already
 *           delivering messages, so a local notification is raised from it —
 *           which also covers a build that has no Firebase config at all.
 *
 * Both funnel into `present`, so a message never produces two notifications:
 * they share a collapse id per conversation, and the second one replaces the
 * first rather than stacking.
 */

const CATEGORY = 'chax.message';
const CHANNEL = 'messages';
const BACKGROUND_TASK = 'chax.notification.received';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

/* ────────────────────────────── setup ────────────────────────────── */

/**
 * The reply action.
 *
 * `opensAppToForeground: false` is what makes this a *direct* reply rather than
 * a shortcut into the app: Android keeps the shade open, hands the typed text
 * to a background JS context, and the message goes out without the UI ever
 * being drawn.
 */
export async function configureCategories() {
  await Notifications.setNotificationCategoryAsync(CATEGORY, [
    {
      identifier: 'reply',
      buttonTitle: 'Reply',
      textInput: { submitButtonTitle: 'Send', placeholder: 'Message' },
      options: { opensAppToForeground: false },
    },
    {
      identifier: 'markRead',
      buttonTitle: 'Mark as read',
      options: { opensAppToForeground: false },
    },
  ]);

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL, {
      name: 'Messages',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 220, 120, 220],
      lightColor: '#25D366',
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
      // Heads-up and audible: a chat message is the canonical high-priority
      // notification, and Android downranks anything that does not say so.
      enableVibrate: true,
      showBadge: true,
    });
  }
}

/**
 * Asks permission, then registers this device's push token with the API.
 *
 * The token goes to the same `/devices/push-subscription` endpoint the browser
 * uses, tagged so the server knows to route it through FCM rather than treating
 * it as a Web Push subscription.
 */
export async function registerForPush({ prompt = true } = {}) {
  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;

  if (status !== 'granted' && prompt) {
    const asked = await Notifications.requestPermissionsAsync();
    status = asked.status;
  }

  if (status !== 'granted') {
    if (!prompt) return { transport: null, reason: 'not-granted' };
    throw new Error(
      'Notifications are turned off for Chax. Enable them in Android settings to be told about new messages.'
    );
  }

  await configureCategories();

  if (!HAS_FCM) {
    // Without a Firebase config there is no token to hand over. The socket
    // transport still works whenever the app is running, so this is a
    // degraded state rather than a failure.
    return { transport: 'socket', token: null };
  }

  const token = await Notifications.getDevicePushTokenAsync();
  trace('push:token', {
    type: token.type,
    // Never the whole token: it is a credential for reaching this device.
    tail: String(token.data || '').slice(-10),
    length: String(token.data || '').length,
  });

  await api.post('/devices/push-subscription', {
    subscription: { type: 'fcm', token: token.data, platform: 'android' },
  });
  trace('push:registered', { transport: 'fcm' });

  return { transport: 'fcm', token: token.data };
}

/**
 * Re-registers this device's token at launch, without prompting.
 *
 * FCM rotates tokens on its own schedule — a restore to a new phone, a long
 * gap between launches, an app data clear — and the old one then stops
 * delivering with no error on either side. The symptom is "notifications worked
 * for a week and then stopped", which is indistinguishable from the feature
 * being broken.
 *
 * It also covers the case that made the test button fail: permission granted
 * on a previous run, but the server holding no subscription for this device,
 * so there was nothing for it to send to. Posting the token is idempotent, so
 * doing it on every launch costs one request and removes a whole class of
 * silent failure.
 */
export async function reconcilePush() {
  try {
    return await registerForPush({ prompt: false });
  } catch (err) {
    /* This ran silently on every launch and swallowed whatever went wrong, so
       a device that never registered looked identical to one that had. */
    report('push:reconcile', err);
    return { transport: null, reason: 'failed' };
  }
}

/** What this device's notification setup actually looks like, for the UI. */
export async function pushStatus() {
  const [{ status }, config] = await Promise.all([
    Notifications.getPermissionsAsync(),
    pushConfig(),
  ]);

  return {
    permission: status,
    granted: status === 'granted',
    serverEnabled: config.enabled,
    serverFcm: config.fcm,
    ephemeral: config.ephemeral,
    unreachable: !!config.unreachable,
    // FCM only counts as usable when both ends have it.
    transport: status === 'granted' && HAS_FCM && config.fcm ? 'fcm' : status === 'granted' ? 'socket' : null,
  };
}

export async function unregisterPush() {
  await api.post('/devices/push-subscription', { subscription: null }).catch(() => {});
}

/** Whether the server thinks it can deliver to this account at all. */
export async function pushConfig() {
  try {
    const { data } = await api.get('/devices/vapid-public-key');
    return {
      enabled: !!data.enabled,
      ephemeral: !!data.ephemeral,
      fcm: !!data.fcm,
    };
  } catch {
    return { enabled: false, ephemeral: false, fcm: false, unreachable: true };
  }
}

/** Round-trips through the server, so it tests the delivery path end to end. */
export async function sendTestNotification() {
  const { data } = await api.post('/devices/push-test');
  trace('push:test', { success: !!data.success, reason: data.reason || null, sent: data.sent });
  if (!data.success) throw new Error(data.reason || 'The server could not send it');
  return data;
}

/* ────────────────────────────── presenting ────────────────────────────── */

/**
 * Raises one notification for a message.
 *
 * `body` is filled from the decrypted cache when this device has already opened
 * that message, and otherwise stays vague. It is never taken from the push
 * payload, because the server does not have it to give.
 */
export async function present({ conversationId, messageId, senderName, conversationName, isGroup, mention, body }) {
  const title = conversationName || senderName || 'New message';
  const line =
    body ||
    (isGroup ? `${senderName || 'Someone'} sent a message` : 'sent you a message');

  await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body: mention ? '@ ' + line : line,
      data: { conversationId, messageId, senderName },
      categoryIdentifier: CATEGORY,
      ...(Platform.OS === 'android'
        ? {
            channelId: CHANNEL,
            // One notification per conversation: ten messages while you were
            // away should ring once and show the latest, not stack ten deep.
            // expo-notifications maps this onto the Android notification tag.
            sticky: false,
          }
        : {}),
    },
    identifier: 'conv:' + conversationId,
    trigger: null,
  });
}

export async function dismissFor(conversationId) {
  await Notifications.dismissNotificationAsync('conv:' + conversationId).catch(() => {});
}

/* ────────────────────────────── replying ────────────────────────────── */

/**
 * Sends a reply typed into the notification shade.
 *
 * This runs with no UI and, when the app was killed, no store — so it does its
 * own minimal boot: hydrate the tokens, load the keys out of the vault, fetch
 * the conversation for its participant list, encrypt, send over REST.
 *
 * The write to the outbox comes first and the delete only after the server has
 * acknowledged. Android can stop this context at any point, and a reply that
 * was typed but never sent is far worse than one that arrives late — on the
 * next launch `flushOutbox` finds it and finishes the job.
 */
export async function sendReplyFromNotification({ conversationId, text }) {
  const clientId = uid();
  const trimmed = String(text || '').trim();
  if (!trimmed || !conversationId) return { sent: false };

  await vault.queueOutbound({ clientId, conversationId, text: trimmed });

  try {
    await deliverOutbound({ clientId, conversationId, text: trimmed });
    await vault.dequeueOutbound(clientId);
    return { sent: true };
  } catch (err) {
    await vault.markOutboundFailed(clientId, err.message);
    return { sent: false, error: err.message };
  }
}

/** The actual encrypt-and-post, shared by the shade reply and the flush. */
async function deliverOutbound({ clientId, conversationId, text }) {
  // A cold background start has none of the app's boot sequence behind it, so
  // the keystore read the root layout normally does has to happen here.
  if (!tokens.access) await tokens.hydrate();
  if (!tokens.access) throw new Error('Not signed in');

  if (!e2ee.isUnlocked()) {
    const userId = await vault.activeUserId();
    const unlocked = await e2ee.loadFromVault(userId);
    if (!unlocked) throw new Error('Keys are locked on this device');
  }

  const { data: conv } = await api.get('/conversations/' + conversationId);
  const conversation = conv.conversation;

  const recipients = (conversation.participants || [])
    .filter((p) => !p.leftAt && p.user)
    .map((p) => ({
      userId: String(p.user._id || p.user),
      identityPublicKey: p.user.identityPublicKey || null,
    }))
    .filter((r) => r.identityPublicKey);

  const payload = { text, attachments: [] };
  const { body, keys } = await e2ee.encryptEnvelope({ payload, recipients });

  // REST rather than the socket: in a background context the websocket is
  // usually not up, and waiting for it to connect risks the process being
  // stopped mid-handshake.
  const { data } = await api.post('/messages', {
    conversationId,
    clientId,
    type: 'text',
    body,
    keys,
    attachments: [],
  });

  await vault.cacheMessage({
    messageId: data.message._id,
    conversationId,
    text,
    payload,
    createdAt: data.message.createdAt,
  });

  return data.message;
}

/** Retries anything the shade could not finish. Called on every app start. */
export async function flushOutbox() {
  let queued = [];
  try {
    queued = await vault.pendingOutbound();
  } catch {
    return 0;
  }

  let sent = 0;
  for (const row of queued) {
    // Give up rather than retry forever; the message stays visible as failed.
    if (row.attempts > 5) continue;
    try {
      await deliverOutbound({
        clientId: row.clientId,
        conversationId: row.conversationId,
        text: row.text,
      });
      await vault.dequeueOutbound(row.clientId);
      sent += 1;
    } catch (err) {
      await vault.markOutboundFailed(row.clientId, err.message);
    }
  }
  return sent;
}

export async function markReadFromNotification(conversationId) {
  try {
    await api.post('/conversations/' + conversationId + '/read');
    await dismissFor(conversationId);
  } catch {
    /* it will be marked read when the chat is next opened */
  }
}

/* ────────────────────────── response routing ────────────────────────── */

/**
 * Handles one notification action.
 *
 * Shared by the warm listener and the cold-start drain so a reply behaves
 * identically whether the app was on screen, backgrounded, or not running.
 */
export async function handleResponse(response) {
  const action = response?.actionIdentifier;
  const data = response?.notification?.request?.content?.data || {};
  const conversationId = data.conversationId;

  if (action === 'reply' && response.userText) {
    const result = await sendReplyFromNotification({
      conversationId,
      text: response.userText,
    });

    // Replace the notification with the outcome rather than leaving the
    // original sitting there, which reads as "nothing happened".
    if (!result.sent) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: 'Reply not sent',
          body: 'Chax will send it when you are back online.',
          data: { conversationId },
          ...(Platform.OS === 'android' ? { channelId: CHANNEL } : {}),
        },
        identifier: 'conv:' + conversationId,
        trigger: null,
      });
    } else {
      await dismissFor(conversationId);
    }
    return { handled: true, opened: null };
  }

  if (action === 'markRead') {
    await markReadFromNotification(conversationId);
    return { handled: true, opened: null };
  }

  // A plain tap opens the chat.
  return { handled: false, opened: conversationId || null };
}

/**
 * Background delivery.
 *
 * Registered at module scope so it exists before Android needs it — a task
 * defined inside a component would not be there when the process is started
 * cold just to deliver a notification.
 */
/**
 * Digs the server's payload out of whatever wrapper it arrived in.
 *
 * expo-notifications hands the task different shapes depending on the Android
 * version and whether the message came through the notification trigger or the
 * raw FCM one, and getting this wrong is silent — the task runs, finds nothing,
 * and no notification is drawn. So every known position is checked rather than
 * betting on one.
 */
function extractPayload(data) {
  const candidates = [
    data?.notification?.request?.trigger?.remoteMessage?.data,
    data?.notification?.request?.content?.data,
    data?.notification?.data,
    data?.remoteMessage?.data,
    data?.data,
    data,
  ];

  return candidates.find((c) => c && typeof c === 'object' && c.conversationId) || null;
}

const isTrue = (value) => value === true || value === 'true';

TaskManager.defineTask(BACKGROUND_TASK, async ({ data, error }) => {
  if (error) return;

  try {
    const payload = extractPayload(data);
    if (!payload) return;

    // A typing notice must not look like a message.
    if (payload.type === 'typing') return;

    /* The push carries no text — the server cannot read it. If this device has
       already decrypted that message (it was fetched over the socket moments
       ago, say) the cache has the real thing, so it is worth a look before
       falling back to "sent you a message". */
    let body;
    try {
      const cached = payload.messageId ? await vault.getCached(payload.messageId) : null;
      body = cached?.payload?.text || undefined;
    } catch {
      /* the vague version is still a correct notification */
    }

    await present({
      conversationId: payload.conversationId,
      messageId: payload.messageId,
      senderName: payload.senderName,
      conversationName: payload.conversationName,
      isGroup: isTrue(payload.isGroup),
      mention: isTrue(payload.mention),
      body,
    });
  } catch {
    /* a notification that cannot be drawn must not crash the task */
  }
});

export async function registerBackgroundHandler() {
  try {
    await Notifications.registerTaskAsync(BACKGROUND_TASK);
  } catch {
    /* not fatal — foreground delivery still works */
  }
}

export { CATEGORY, CHANNEL };
