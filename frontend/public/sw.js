/* Chax service worker — notifications only.
 *
 * It has no access to the user's encryption keys, so it cannot and does not
 * read message content. The payload carries routing metadata only; the body
 * text below is written here, not sent by the server.
 */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

const KINDS = new Set(['message', 'typing', 'test']);

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }

  if (!KINDS.has(data.type)) return;

  event.waitUntil(show(data));
});

async function show(data) {
  /* A notification the app has already drawn on screen is noise, so a push that
     arrives while a focused window is up is dropped.

     The tradeoff, since it is a real one: `userVisibleOnly` subscriptions are
     expected to show something for every push, and Chrome will eventually
     substitute its own "site updated in the background" notice for an origin
     that keeps silently swallowing them. This path is deliberately narrow — the
     server already skips devices it believes are on screen, so reaching here at
     all means the visibility report and the push crossed in flight — and a
     confusing browser-authored notice is a better risk than a duplicate alert
     for a message the reader is looking at. */
  if (data.type !== 'test' && (await hasVisibleWindow())) {
    // Typing is transient; there is nothing to catch up on later.
    if (data.type === 'typing') return;
    // A message still gets a badge bump so the tab title can react.
    await postToClients({ kind: 'push', data });
    return;
  }

  if (data.type === 'test') {
    return self.registration.showNotification(data.title || 'Test notification', {
      body: data.body || 'Notifications are working.',
      icon: '/icon-192.png',
      badge: '/icon-96.png',
      tag: 'chax-test',
      renotify: true,
      requireInteraction: false,
      timestamp: Date.now(),
      data: {},
    });
  }

  const from = data.senderName || 'Someone';
  const title = data.isGroup && data.conversationName ? data.conversationName : from;

  const typing = data.type === 'typing';

  const body = typing
    ? data.isGroup
      ? from + ' is typing…'
      : 'is typing…'
    : data.isGroup
      ? from + ' sent a message'
      : data.mention
        ? 'Mentioned you'
        : 'Sent you a message';

  return self.registration.showNotification(title, {
    body,
    icon: '/icon-192.png',
    badge: '/icon-96.png',
    /* One notification per chat per kind. A typing notice used to share the
       message tag, so it replaced — and silently threw away — an unread
       message notification the moment the sender started typing again. */
    tag: (typing ? 'typing-' : 'chat-') + data.conversationId,
    renotify: !typing,
    silent: !!typing,
    // A mention deserves to survive a glance; ordinary traffic does not.
    requireInteraction: false,
    vibrate: typing ? undefined : data.mention ? [30, 60, 30, 60, 30] : [40, 60, 40],
    timestamp: data.at ? new Date(data.at).getTime() : Date.now(),
    data: { conversationId: data.conversationId, type: data.type },
    actions: typing ? [] : [{ action: 'open', title: 'Open' }],
  });
}

async function hasVisibleWindow() {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  return clients.some((c) => c.visibilityState === 'visible' && c.focused !== false);
}

async function postToClients(message) {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  clients.forEach((c) => {
    try {
      c.postMessage(message);
    } catch {
      /* a closing client is not a problem worth reporting */
    }
  });
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const conversationId = event.notification.data && event.notification.data.conversationId;
  const target = conversationId ? '/chats/' + conversationId : '/chats';

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clients) => {
        // Reuse an open tab when there is one.
        for (const client of clients) {
          if ('focus' in client) {
            client.navigate(target).catch(() => {});
            return client.focus();
          }
        }
        return self.clients.openWindow(target);
      })
  );
});

/**
 * The browser rotated or revoked this subscription behind our back.
 *
 * Chrome does this periodically, and on expiry the old endpoint stops
 * delivering silently — no error anywhere, notifications simply stop. Without
 * this handler the only cure was for the user to toggle push off and on again,
 * which nobody knows to do. Re-subscribing with the same application key
 * produces a working endpoint, and any client that is open forwards it to the
 * API; if none is open the app picks it up on next launch.
 */
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      const previous = event.oldSubscription || (await self.registration.pushManager.getSubscription());
      const key = event.newSubscription?.options?.applicationServerKey
        || previous?.options?.applicationServerKey;
      if (!key) return;

      const subscription =
        event.newSubscription
        || (await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: key,
        }));

      await postToClients({ kind: 'resubscribed', subscription: subscription.toJSON() });
    })().catch(() => {})
  );
});
