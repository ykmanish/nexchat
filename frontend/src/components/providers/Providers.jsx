'use client';

import { useEffect } from 'react';
import { ThemeProvider, useTheme } from 'next-themes';
import { useAuth } from '@/store/auth';
import { useChat, setMe } from '@/store/chat';
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
  const user = useAuth((s) => s.user);

  useEffect(() => {
    if (status !== 'authed' || !user) return undefined;

    const socket = getSocket() || connectSocket();
    if (!socket) return undefined;

    const chat = () => useChat.getState();

    const handlers = {
      ready: ({ onlineUsers }) => {
        const map = {};
        (onlineUsers || []).forEach((id) => {
          map[id] = true;
        });
        chat().setPresenceMap(map);
      },

      'message:new': async ({ conversationId, message }) => {
        const isMine = String(message.sender?._id || message.sender) === String(user._id);
        const isActive = chat().activeId === conversationId;

        await chat().receiveMessage({ conversationId, message });

        if (!isMine) {
          const conv = chat().conversations.find((c) => c._id === conversationId);
          if (audible(conv, message) && user.settings?.sounds !== false) {
            feedback(message.mentionedMe ? 'mention' : 'receive');
          }
          if (!isActive && audible(conv, message)) notify(conv, message, user);
        }
      },

      /* A reply lands in its panel and bumps the root's counter; it must not
         appear in the timeline, which is what threads are for. */
      'message:thread-reply': async ({ conversationId, message, threadRoot }) => {
        const isMine = String(message.sender?._id || message.sender) === String(user._id);

        await chat().decrypt(message);
        chat().receiveThreadReply(conversationId, threadRoot, message);

        if (!isMine) {
          const conv = chat().conversations.find((c) => c._id === conversationId);
          if (audible(conv, message) && user.settings?.sounds !== false) {
            feedback(message.mentionedMe ? 'mention' : 'receive');
          }
        }
      },

      'message:edited': ({ conversationId, message }) => {
        chat().applyMessagePatch(conversationId, message._id, message);
        chat().decrypt(message);
      },

      'message:deleted': ({ conversationId, messageId, scope }) => {
        if (scope === 'everyone') {
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
        if (String(by) !== String(user._id)) feedback('react');
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
        if (String(senderId) !== String(user._id)) {
          if (!isThreadReply) patch.unreadCount = unreadCount;
          if (mentionCount !== undefined) patch.mentionCount = mentionCount;
        }
        chat().patchConversation(conversationId, patch);
      },
      'conversation:read': ({ conversationId }) =>
        chat().patchConversation(conversationId, { unreadCount: 0, mentionCount: 0 }),

      'conversation:banned': ({ conversationId, userId: banned }) => {
        if (String(banned) === String(user._id)) return; // handled below
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
  }, [status, user]);

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

function notify(conversation, message, user) {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  if (document.visibilityState === 'visible') return;
  if (user.settings?.notifications?.messages === false) return;

  const showPreview = user.settings?.notifications?.previews !== false;
  const title = conversation?.name || message.sender?.name || 'New message';

  try {
    const n = new Notification(title, {
      body: showPreview ? 'Sent you a message' : 'New message',
      icon: '/icon-192.png',
      tag: String(message.conversation),
      silent: true,
    });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    /* notifications are a nicety, never a hard dependency */
  }
}
