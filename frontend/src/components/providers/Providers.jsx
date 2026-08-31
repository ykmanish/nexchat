'use client';

import { useEffect } from 'react';
import { ThemeProvider, useTheme } from 'next-themes';
import { useAuth } from '@/store/auth';
import { useChat, setMe } from '@/store/chat';
import { useFeed } from '@/store/feed';
import { useUI } from '@/store/ui';
import { onUnauthorized } from '@/lib/api';
import { getSocket, connectSocket } from '@/lib/socket';
import { unlockAudio, feedback } from '@/lib/sound';
import { ToastStack } from '@/components/ui/Toast';
import { applyBubbleTheme, applyFontScale, STATUS_BAR } from '@/lib/theme';
import { vault } from '@/lib/vault';

export function Providers({ children }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <SessionBridge />
      <SocketBridge />
      <AppearanceBridge />
      <AudioUnlock />
      <PushBridge />
      {children}
      <ToastStack />
    </ThemeProvider>
  );
}

/** Keeps bubble colour and text size in sync with the user's settings. */
function AppearanceBridge() {
  const settings = useAuth((s) => s.user?.settings);
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    applyBubbleTheme(settings?.bubbleColor || 'green', resolvedTheme === 'dark');
  }, [settings?.bubbleColor, resolvedTheme]);

  /* Keep the mobile status/URL bar in step with the app's theme.
     The value is read back off `--header` rather than hardcoded, so it stays
     correct if the palette changes. */
  useEffect(() => {
    if (typeof document === 'undefined') return;

    const color = STATUS_BAR[resolvedTheme === 'dark' ? 'dark' : 'light'];

    let meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('name', 'theme-color');
      document.head.appendChild(meta);
    }
    meta.setAttribute('content', color);

    // iOS standalone reads this one instead; `black-translucent` would let
    // content slide under the notch, so each theme gets the opaque style
    // that actually exists.
    let status = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
    if (!status) {
      status = document.createElement('meta');
      status.setAttribute('name', 'apple-mobile-web-app-status-bar-style');
      document.head.appendChild(status);
    }
    status.setAttribute('content', resolvedTheme === 'dark' ? 'black' : 'default');
  }, [resolvedTheme]);

  useEffect(() => {
    applyFontScale(settings?.fontScale || 1);
  }, [settings?.fontScale]);

  useEffect(() => {
    document.documentElement.classList.toggle('reduce-motion', !!settings?.reduceMotion);
  }, [settings?.reduceMotion]);

  return null;
}

/** Restores the session once on mount and reacts to it being lost. */
function SessionBridge() {
  const bootstrap = useAuth((s) => s.bootstrap);
  const user = useAuth((s) => s.user);

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    setMe(user);
  }, [user]);

  useEffect(
    () =>
      onUnauthorized((code) => {
        useAuth.setState({ status: 'guest', user: null });
        useChat.getState().reset();
        useFeed.getState().reset();
        useUI.getState().toast(
          code === 'DEVICE_REVOKED'
            ? 'This device was signed out from another device.'
            : 'Your session expired. Please sign in again.',
          { type: 'error', duration: 6000 }
        );
      }),
    []
  );

  return null;
}

/** Every realtime event in the app lands here and is routed into the stores. */
function SocketBridge() {
  const status = useAuth((s) => s.status);
  const userId = useAuth((s) => s.user?._id);

  useEffect(() => {
    if (status !== 'authed' || !userId) return undefined;

    const socket = getSocket() || connectSocket();
    if (!socket) return undefined;

    const chat = () => useChat.getState();

    /* Read live rather than captured.
       This effect used to depend on the whole `user` object, so every settings
       toggle — every mute, every theme change — produced a new identity, tore
       down all forty socket listeners and re-registered them. Events arriving
       during that gap were dropped on the floor, which is a plausible cause of a
       message that never appeared until a reload. Depending on the id alone
       fixes that, and the handlers read the current user through the store so
       they still see fresh settings. */
    const me = () => useAuth.getState().user || { _id: userId };

    const handlers = {
      ready: ({ onlineUsers }) => {
        const map = {};
        (onlineUsers || []).forEach((id) => {
          map[id] = true;
        });
        chat().setPresenceMap(map);
      },

      'message:new': async ({ conversationId, message }) => {
        const isMine = String(message.sender?._id || message.sender) === String(me()._id);
        const isActive = chat().activeId === conversationId;

        await chat().receiveMessage({ conversationId, message });

        if (!isMine) {
          const conv = chat().conversations.find((c) => c._id === conversationId);
          if (audible(conv, message) && me().settings?.sounds !== false) {
            feedback(message.mentionedMe ? 'mention' : 'receive');
          }
          if (!isActive && audible(conv, message)) notify(conv, message, me());
        }
      },

      /* A reply lands in its panel and bumps the root's counter; it must not
         appear in the timeline, which is what threads are for. */
      'message:thread-reply': async ({ conversationId, message, threadRoot }) => {
        const isMine = String(message.sender?._id || message.sender) === String(me()._id);

        await chat().decrypt(message);
        chat().receiveThreadReply(conversationId, threadRoot, message);

        if (!isMine) {
          const conv = chat().conversations.find((c) => c._id === conversationId);
          if (audible(conv, message) && me().settings?.sounds !== false) {
            feedback(message.mentionedMe ? 'mention' : 'receive');
          }
        }
      },

      /* Someone's device confirmed a deletion we ordered. Only the count is
         tracked here; the detail is fetched when the info sheet is opened. */
      'message:deletion-confirmed': ({ conversationId, messageId }) => {
        useChat.setState((s) => ({
          deletionReceipts: {
            ...s.deletionReceipts,
            [messageId]: (s.deletionReceipts?.[messageId] || 0) + 1,
          },
        }));
      },

      'message:edited': ({ conversationId, message }) => {
        chat().applyMessagePatch(conversationId, message._id, message);
        chat().decrypt(message);
      },

      'message:deleted': ({ conversationId, messageId, scope }) => {
        if (scope === 'everyone') {
          /* Sign a receipt once the local copy is actually gone. Fire and
             forget: the deletion has already happened, so a failed receipt is a
             visible gap in the chain rather than a reason to block anything. */
          import('@/lib/receipts').then((m) =>
            m.confirmDeletion({ messageId, conversationId })
          );

          chat().applyMessagePatch(conversationId, messageId, {
            deletedForEveryone: true,
            attachments: [],
            reactions: [],
          });
          // The plaintext is cached on this device; without dropping it the
          // message would come back on the next reload despite the tombstone.
          useChat.setState((s) => {
            const plain = { ...s.plain };
            delete plain[messageId];
            return { plain };
          });
          vault.removeCached(messageId);
        } else {
          useChat.setState((s) => ({
            messages: {
              ...s.messages,
              [conversationId]: (s.messages[conversationId] || []).filter(
                (m) => m._id !== messageId
              ),
            },
          }));
        }
      },

      'message:reaction': ({ conversationId, messageId, reactions, by }) => {
        chat().applyMessagePatch(conversationId, messageId, { reactions });
        if (String(by) !== String(me()._id)) feedback('react');
      },

      'message:delivered': ({ conversationId, messageIds, userId, deliveredAt }) => {
        messageIds.forEach((id) => {
          const list = useChat.getState().messages[conversationId] || [];
          const msg = list.find((m) => m._id === id);
          if (!msg) return;
          chat().applyMessagePatch(conversationId, id, {
            receipts: (msg.receipts || []).map((r) =>
              String(r.user) === String(userId) ? { ...r, deliveredAt } : r
            ),
          });
        });
      },

      'message:read': ({ conversationId, userId, readAt }) => {
        const list = useChat.getState().messages[conversationId] || [];
        list.forEach((m) => {
          if (!m.receipts?.length) return;
          chat().applyMessagePatch(conversationId, m._id, {
            receipts: m.receipts.map((r) =>
              String(r.user) === String(userId) ? { ...r, readAt, deliveredAt: r.deliveredAt || readAt } : r
            ),
          });
        });
      },

      'message:pinned': ({ conversationId, messageId, pinned }) => {
        chat().applyMessagePatch(conversationId, messageId, { pinned });
      },

      'poll:updated': ({ conversationId, messageId, poll }) => {
        chat().applyMessagePatch(conversationId, messageId, { poll });
      },

      'message:viewed-once': ({ conversationId, messageId, by, burned }) => {
        const list = useChat.getState().messages[conversationId] || [];
        const msg = list.find((m) => m._id === messageId);
        chat().applyMessagePatch(conversationId, messageId, {
          viewOnceOpened: burned,
          viewedBy: [...(msg?.viewedBy || []), { user: by, at: new Date().toISOString() }],
        });
      },

      'typing:start': ({ conversationId, userId, name }) =>
        chat().setTyping(conversationId, userId, name),
      'typing:stop': ({ conversationId, userId }) => chat().clearTyping(conversationId, userId),
      'recording:start': ({ conversationId, userId, name }) =>
        chat().setTyping(conversationId, userId, name + ' is recording'),
      'recording:stop': ({ conversationId, userId }) => chat().clearTyping(conversationId, userId),

      'presence:update': ({ userId, presence }) =>
        chat().setPresence(userId, presence === 'online'),

      'conversation:new': ({ conversation }) => {
        chat().upsertConversation(conversation);
        socket.emit('conversation:join', conversation._id);
      },
      'conversation:updated': ({ conversationId, patch }) =>
        chat().patchConversation(conversationId, patch),
      'conversation:state': ({ conversationId, state }) =>
        chat().patchConversation(conversationId, state),
      'conversation:bump': ({
        conversationId,
        lastMessageAt,
        unreadCount,
        mentionCount,
        senderId,
        isThreadReply,
      }) => {
        // A thread reply does not move the chat in the list — see the server
        // side of this in createMessage.
        const patch = isThreadReply ? {} : { lastMessageAt };
        if (String(senderId) !== String(me()._id)) {
          if (!isThreadReply) patch.unreadCount = unreadCount;
          if (mentionCount !== undefined) patch.mentionCount = mentionCount;
        }
        chat().patchConversation(conversationId, patch);
      },
      'conversation:read': ({ conversationId }) =>
        chat().patchConversation(conversationId, { unreadCount: 0, mentionCount: 0 }),

      'conversation:banned': ({ conversationId, userId: banned }) => {
        if (String(banned) === String(me()._id)) return; // handled below
        useChat.setState((s) => ({
          conversations: s.conversations.map((c) =>
            c._id === conversationId
              ? {
                  ...c,
                  memberCount: Math.max(0, (c.memberCount || 1) - 1),
                  bannedCount: (c.bannedCount || 0) + 1,
                }
              : c
          ),
        }));
      },
      'conversation:removed': ({ conversationId, reason }) => {
        chat().removeConversation(conversationId);
        if (reason === 'banned') {
          useUI.getState().toast('You were removed from that chat.', { type: 'error' });
        }
      },

      'devices:changed': () => {
        // A new device joined the account — future fan-outs must include it.
        import('@/lib/e2ee').then((m) => m.invalidateRoster());
        useAuth.getState().refreshDevices?.();
      },

      'device:revoked': () => {
        useUI.getState().toast('This device was signed out.', { type: 'error' });
        useAuth.getState().logout();
      },

      /* Somebody added or removed this account, or another of our own devices
         did. Either way the three groups New chat renders from are stale, and
         re-deriving them is a single request. */
      'contacts:changed': () => {
        chat().loadContacts({ force: true }).catch(() => {});
      },

      'user:updated': ({ user: updated }) => {
        useChat.setState((s) => ({
          conversations: s.conversations.map((c) =>
            c.peer && String(c.peer._id) === String(updated.id || updated._id)
              ? { ...c, peer: { ...c.peer, ...updated }, name: updated.name, avatar: updated.avatar }
              : c
          ),
        }));
      },

      'story:new': () => chat().loadStories().catch(() => {}),

      /* ── feed ──
         A post from somebody you follow slots straight into the timeline. The
         rest are notifications about your own posts: they carry only an id, so
         the counter is refreshed from the post itself rather than trusted from
         the wire — two people liking at once would otherwise each report a
         count of one. */
      'post:new': ({ post }) => useFeed.getState().receivePost(post),
      'post:deleted': ({ postId }) => useFeed.getState().removePost(postId),

      'post:liked': ({ postId, by }) => {
        const feed = useFeed.getState();
        if (!feed.posts[postId]) return;
        feed.loadPost(postId).catch(() => {});
        if (String(by?._id) !== String(me()._id)) feedback('react');
      },

      'post:commented': ({ postId }) => {
        const feed = useFeed.getState();
        if (!feed.posts[postId]) return;
        feed.loadPost(postId).catch(() => {});
        /* Only reload the thread if it is actually open — refetching comments
           for a post nobody is looking at is a request for nothing. */
        if (feed.comments[postId]) feed.loadComments(postId, { refresh: true });
      },

      'post:replied': ({ postId }) => {
        const feed = useFeed.getState();
        if (feed.comments[postId]) feed.loadComments(postId, { refresh: true });
      },

      'post:reposted': ({ postId }) => {
        if (useFeed.getState().posts[postId]) {
          useFeed.getState().loadPost(postId).catch(() => {});
        }
      },

      'comment:liked': ({ postId }) => {
        const feed = useFeed.getState();
        if (feed.comments[postId]) feed.loadComments(postId, { refresh: true });
      },

      'post:mentioned': ({ postId }) => {
        useUI.getState().toast('You were mentioned in a post', {
          type: 'info',
          action: { label: 'View', onClick: () => window.location.assign('/feed/' + postId) },
        });
      },

      'comment:mentioned': ({ postId }) => {
        useUI.getState().toast('You were mentioned in a comment', {
          type: 'info',
          action: { label: 'View', onClick: () => window.location.assign('/feed/' + postId) },
        });
      },

      /* Somebody followed you — your own follower count moved, and so did the
         feed they can now see. Only the suggestion list needs a nudge here. */
      'follow:new': ({ by }) => {
        useFeed.getState().loadSuggestions();
        useUI.getState().toast((by?.name || 'Someone') + ' followed you', { type: 'info' });
      },

      'call:incoming': (payload) => {
        useUI.getState().setCall({ ...payload, direction: 'incoming', status: 'ringing' });
      },
      'call:accepted': ({ callId }) => {
        const call = useUI.getState().call;
        if (call?.callId === callId) useUI.getState().setCall({ ...call, status: 'active' });
      },
      'call:declined': () => {
        useUI.getState().toast('Call declined', { type: 'info' });
        useUI.getState().endCall();
      },
      'call:ended': () => {
        feedback('close');
        useUI.getState().endCall();
      },
    };

    Object.entries(handlers).forEach(([event, fn]) => socket.on(event, fn));

    socket.on('connect_error', (err) => {
      if (err.message === 'DEVICE_REVOKED') useAuth.getState().logout();
    });

    return () => {
      Object.entries(handlers).forEach(([event, fn]) => socket.off(event, fn));
    };
  }, [status, userId]);

  return null;
}

/**
 * Keeps this device's push subscription alive, and listens to the worker.
 *
 * Two things go wrong quietly without it. Chrome rotates push subscriptions on
 * its own schedule and the old endpoint then stops delivering with no error
 * anywhere — the user's experience is that notifications worked for a week and
 * then stopped, and the only known cure was toggling the setting off and on.
 * And a worker that re-subscribes while no tab is listening has nowhere to send
 * the new endpoint. Reconciling on launch covers the first; the message
 * listener covers the second.
 */
function PushBridge() {
  const status = useAuth((s) => s.status);

  useEffect(() => {
    if (status !== 'authed') return undefined;
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return undefined;

    let cancelled = false;

    import('@/lib/push').then(({ reconcileSubscription }) => {
      if (!cancelled) reconcileSubscription().catch(() => {});
    });

    const onMessage = (event) => {
      const payload = event.data;
      if (payload?.kind === 'resubscribed' && payload.subscription) {
        import('@/lib/push').then(({ adoptSubscription }) =>
          adoptSubscription(payload.subscription)
        );
      }
    };

    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener('message', onMessage);
    };
  }, [status]);

  return null;
}

/** Browsers block audio until the first gesture — arm it on the first touch. */
function AudioUnlock() {
  useEffect(() => {
    const arm = () => {
      unlockAudio();
      window.removeEventListener('pointerdown', arm);
      window.removeEventListener('keydown', arm);
    };
    window.addEventListener('pointerdown', arm, { once: true });
    window.addEventListener('keydown', arm, { once: true });
    return () => {
      window.removeEventListener('pointerdown', arm);
      window.removeEventListener('keydown', arm);
    };
  }, []);
  return null;
}

/** Desktop notification for messages that arrive while you're elsewhere. */
/**
 * Whether this message should make a sound or raise a notification.
 *
 * Mute used to be all-or-nothing, and a muted group therefore went completely
 * dark — including the one case you actually wanted through it. 'mentions' mode
 * is the answer: silent for ordinary traffic, audible when it names you. The
 * server applies the same rule to push, so a closed tab behaves identically.
 */
function audible(conversation, message) {
  if (!conversation?.muted) return true;
  if (conversation.mutedUntil && new Date(conversation.mutedUntil) < new Date()) return true;
  return conversation.muteMode === 'mentions' && !!message.mentionedMe;
}

/**
 * Raises a notification for a message that arrived over the socket.
 *
 * This used to call `new Notification(...)`, which is the single most common way
 * to ship a messenger with no notifications on a phone: Android Chrome throws
 * `Illegal constructor` for that API and insists on
 * `ServiceWorkerRegistration.showNotification` instead. The throw landed in a
 * silent catch, so on a desktop it worked, on a phone nothing happened, and
 * nothing was logged either way.
 *
 * The visibility test also had to change. `visibilityState` is `visible` for a
 * tab sitting behind another window, so a message that arrived while you were
 * in a different app was dropped on the floor for being "on screen".
 */
async function notify(conversation, message, user) {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') return;
  if (Notification.permission !== 'granted') return;
  if (user.settings?.notifications?.messages === false) return;

  // Being on screen *and* focused is what makes a notification redundant.
  const attentive =
    document.visibilityState === 'visible' &&
    (typeof document.hasFocus !== 'function' || document.hasFocus());
  if (attentive) return;

  const showPreview = user.settings?.notifications?.previews !== false;
  const title = conversation?.name || message.sender?.name || 'New message';
  const options = {
    body: showPreview
      ? message.mentionedMe
        ? 'Mentioned you'
        : 'Sent you a message'
      : 'New message',
    icon: '/icon-192.png',
    badge: '/icon-96.png',
    tag: 'chat-' + String(message.conversation),
    renotify: true,
    data: { conversationId: String(message.conversation) },
  };

  try {
    const registration =
      'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration('/sw.js') : null;

    if (registration) {
      // The worker's notificationclick handler focuses the right chat, so this
      // path needs no onclick of its own.
      await registration.showNotification(title, options);
      return;
    }

    // Desktop browsers without a worker registered still support the
    // constructor, so it stays as the fallback rather than the default.
    const n = new Notification(title, { ...options, silent: true });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    /* notifications are a nicety, never a hard dependency */
  }
}
