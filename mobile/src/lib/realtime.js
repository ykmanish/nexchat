import { AppState } from 'react-native';
import { getSocket, connectSocket } from './socket';
import { useAuth } from '../store/auth';
import { useChat } from '../store/chat';
import { toast } from '../store/ui';
import { feedback } from './feedback';
import * as notifications from './notifications';
import * as e2ee from './e2ee';
import { vault } from './vault';

/**
 * Every realtime event lands here and is routed into the stores.
 *
 * A near-literal port of the web client's SocketBridge, with one addition that
 * only makes sense on a phone: when a message arrives and the app is not on
 * screen, a local notification is raised from the socket. That is the fallback
 * transport — it covers the window before FCM has been configured, and the case
 * where the process is alive in the background and FCM would be redundant.
 */

/** Whether this chat should make a sound for this message. */
function audible(conversation, message) {
  if (!conversation) return true;

  const mutedNow =
    conversation.muted &&
    (!conversation.mutedUntil || new Date(conversation.mutedUntil) > new Date());

  if (!mutedNow) return true;
  // 'mentions' mode is the only setting that makes a busy group survivable:
  // silent for ordinary traffic, audible when the message names you.
  return conversation.muteMode === 'mentions' && !!message.mentionedMe;
}

export function attachRealtime() {
  const socket = getSocket() || connectSocket();
  if (!socket) return () => {};

  const chat = () => useChat.getState();
  const me = () => useAuth.getState().user || {};

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
      const onScreen = AppState.currentState === 'active';

      await chat().receiveMessage({ conversationId, message });

      if (isMine) return;

      const conv = chat().conversations.find((c) => c._id === conversationId);
      if (!audible(conv, message)) return;

      // On screen and looking at this chat: nothing to announce.
      if (onScreen && isActive) return;

      if (onScreen) {
        feedback(message.mentionedMe ? 'success' : 'receive');
        return;
      }

      /* Backgrounded. The socket is still up, so this notification is drawn
         locally — and because the message has already been decrypted above, it
         can show the actual text, which the FCM path cannot: the server has no
         way to read it. */
      const payload = chat().plain[message._id];
      notifications
        .present({
          conversationId,
          messageId: message._id,
          senderName: message.sender?.name,
          conversationName: conv?.type === 'direct' ? message.sender?.name : conv?.name,
          isGroup: conv?.type !== 'direct',
          mention: !!message.mentionedMe,
          body: payload?.text || undefined,
        })
        .catch(() => {});
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
        // message comes back on the next launch despite the tombstone.
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
            [conversationId]: (s.messages[conversationId] || []).filter((m) => m._id !== messageId),
          },
        }));
      }
    },

    'message:reaction': ({ conversationId, messageId, reactions, by }) => {
      chat().applyMessagePatch(conversationId, messageId, { reactions });
      if (String(by) !== String(me()._id)) feedback('react');
    },

    'message:delivered': ({ conversationId, messageIds, userId, deliveredAt }) => {
      (messageIds || []).forEach((id) => {
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
            String(r.user) === String(userId)
              ? { ...r, readAt, deliveredAt: r.deliveredAt || readAt }
              : r
          ),
        });
      });
    },

    'message:pinned': ({ conversationId, messageId, pinned }) => {
      chat().applyMessagePatch(conversationId, messageId, { pinned });
    },

    'typing:start': ({ conversationId, userId, name }) =>
      chat().setTyping(conversationId, userId, name),
    'typing:stop': ({ conversationId, userId }) => chat().clearTyping(conversationId, userId),
    'recording:start': ({ conversationId, userId, name }) =>
      chat().setTyping(conversationId, userId, name + ' is recording'),
    'recording:stop': ({ conversationId, userId }) => chat().clearTyping(conversationId, userId),

    'presence:update': ({ userId, presence }) => chat().setPresence(userId, presence === 'online'),

    'conversation:new': ({ conversation }) => {
      chat().upsertConversation(conversation);
      socket.emit('conversation:join', conversation._id);
    },
    'conversation:updated': ({ conversationId, patch }) =>
      chat().patchConversation(conversationId, patch),
    'conversation:state': ({ conversationId, state }) =>
      chat().patchConversation(conversationId, state),

    'conversation:bump': ({ conversationId, lastMessageAt, unreadCount, mentionCount, senderId }) => {
      const patch = { lastMessageAt };
      if (String(senderId) !== String(me()._id)) {
        patch.unreadCount = unreadCount;
        if (mentionCount !== undefined) patch.mentionCount = mentionCount;
      }
      chat().patchConversation(conversationId, patch);
    },

    'conversation:read': ({ conversationId }) =>
      chat().patchConversation(conversationId, { unreadCount: 0, mentionCount: 0 }),

    'conversation:removed': ({ conversationId, reason }) => {
      chat().removeConversation(conversationId);
      if (reason === 'banned') toast.error('You were removed from that chat.');
    },

    'devices:changed': () => {
      // A new device joined the account — future fan-outs must include it.
      e2ee.invalidateRoster();
      useAuth.getState().refreshDevices?.();
    },

    'device:revoked': () => {
      toast.error('This device was signed out.');
      useAuth.getState().logout();
    },

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
  };

  Object.entries(handlers).forEach(([event, fn]) => socket.on(event, fn));

  const onConnectError = (err) => {
    if (err.message === 'DEVICE_REVOKED') useAuth.getState().logout();
  };
  socket.on('connect_error', onConnectError);

  return () => {
    Object.entries(handlers).forEach(([event, fn]) => socket.off(event, fn));
    socket.off('connect_error', onConnectError);
  };
}
