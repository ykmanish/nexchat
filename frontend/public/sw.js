/* NexChat service worker — notifications only.
 *
 * It has no access to the user's encryption keys, so it cannot and does not
 * read message content. The payload carries routing metadata only; the body
 * text below is written here, not sent by the server.
 */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }

  if (data.type !== 'message' && data.type !== 'typing') return;

  const from = data.senderName || 'Someone';
  const title = data.isGroup && data.conversationName ? data.conversationName : from;

  const body =
    data.type === 'typing'
      ? data.isGroup
        ? from + ' is typing…'
        : 'is typing…'
      : data.isGroup
        ? from + ' sent a message'
        : 'Sent you a message';

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/icon-192.png',
      badge: '/icon-96.png',
      // One notification per chat, replaced rather than stacked. A typing
      // notice is transient, so it never vibrates or demands attention.
      tag: 'chat-' + data.conversationId,
      renotify: data.type === 'message',
      silent: data.type === 'typing',
      timestamp: data.at ? new Date(data.at).getTime() : Date.now(),
      data: { conversationId: data.conversationId },
      actions: data.type === 'message' ? [{ action: 'open', title: 'Open' }] : [],
    })
  );
});

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
