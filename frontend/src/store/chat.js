'use client';

import { create } from 'zustand';
import { api } from '@/lib/api';
import { emit, emitAsync, getSocket } from '@/lib/socket';
import { vault } from '@/lib/vault';
import * as e2ee from '@/lib/e2ee';
import { uid } from '@/lib/utils';
import { feedback } from '@/lib/sound';
import { toast } from '@/store/ui';

/** Recipients for a fan-out: every member of the chat, ourselves included, so
 *  our own other devices can read what we send. */
function recipientsOf(conversation) {
  return (conversation.participants || [])
    .filter((p) => !p.leftAt && p.user)
    .map((p) => ({
      userId: String(p.user._id || p.user),
      identityPublicKey: p.user.identityPublicKey || null,
    }))
    .filter((r) => r.identityPublicKey);
}

export const useChat = create((set, get) => ({
  conversations: [],
  activeId: null,
  messages: {}, // conversationId -> [message]
  plain: {}, // messageId -> decrypted payload
  hasMore: {}, // conversationId -> bool
  loadingMessages: {},
  typing: {}, // conversationId -> { userId: name }
  threads: {}, // rootMessageId -> { root, replies, following }
  deletionReceipts: {}, // messageId -> confirmations seen this session
  threadLoading: {},
  presence: {}, // userId -> boolean
  stories: [],
  loaded: false,
  showArchived: false,
  search: '',

  /* ────────────────────────── conversations ────────────────────────── */

  async loadConversations({ archived = false } = {}) {
    const { data } = await api.get('/conversations', { params: { archived } });
    set({ conversations: data.conversations, loaded: true, showArchived: archived });

    // Warm the cache so the list previews render instantly.
    const lastMessages = data.conversations.map((c) => c.lastMessage).filter(Boolean);
    get().decryptMany(lastMessages);
    return data.conversations;
  },

  upsertConversation(conversation) {
    set((s) => {
      const i = s.conversations.findIndex((c) => c._id === conversation._id);
      const next = [...s.conversations];
      if (i >= 0) next[i] = { ...next[i], ...conversation };
      else next.unshift(conversation);
      return { conversations: sortConversations(next) };
    });
  },

  patchConversation(id, patch) {
    set((s) => ({
      conversations: sortConversations(
        s.conversations.map((c) => (c._id === id ? { ...c, ...patch } : c))
      ),
    }));
  },

  removeConversation(id) {
    set((s) => ({
      conversations: s.conversations.filter((c) => c._id !== id),
      activeId: s.activeId === id ? null : s.activeId,
    }));
  },

  async openConversation(id) {
    set({ activeId: id });
    if (!id) return;

    emit('conversation:join', id);

    // Show whatever this device already decrypted while the fetch runs.
    if (!get().messages[id]) {
      const cached = await vault.conversationCache(id);
      if (cached.length) {
        set((s) => ({
          plain: {
            ...s.plain,
            ...Object.fromEntries(cached.map((c) => [c.messageId, c.payload])),
          },
        }));
      }
    }

    await get().loadMessages(id);
    get().markRead(id);
  },

  async createDirect(userId) {
    const { data } = await api.post('/conversations/direct', { userId });
    get().upsertConversation(data.conversation);
    return data.conversation;
  },

  async createGroup(payload) {
    const { data } = await api.post('/conversations/group', payload);
    get().upsertConversation(data.conversation);
    return data.conversation;
  },

  async createCommunity(payload) {
    const { data } = await api.post('/conversations/community', payload);
    get().upsertConversation(data.conversation);
    return data.conversation;
  },

  /** Flips locally first; puts it back if the server disagrees. */
  async setConversationState(id, patch) {
    const before = get().conversations.find((c) => c._id === id);
    const rollback = Object.fromEntries(
      Object.keys(patch).map((k) => [k, before ? before[k] : undefined])
    );

    get().patchConversation(id, patch);

    try {
      await api.patch('/conversations/' + id + '/state', patch);
    } catch (err) {
      get().patchConversation(id, rollback);
      toast.error(err.message || 'Could not save that change');
    }
  },

  async markRead(id) {
    const conv = get().conversations.find((c) => c._id === id);
    if (!conv?.unreadCount) return;

    get().patchConversation(id, { unreadCount: 0 });
    emit('message:read', { conversationId: id });
    api.post('/conversations/' + id + '/read').catch(() => {});
  },

  /* ────────────────────────── messages ────────────────────────── */

  async loadMessages(conversationId, { before = null } = {}) {
    if (get().loadingMessages[conversationId]) return;
    set((s) => ({ loadingMessages: { ...s.loadingMessages, [conversationId]: true } }));

    try {
      const { data } = await api.get('/messages/conversation/' + conversationId, {
        params: { before, limit: 40 },
      });

      set((s) => {
        const existing = s.messages[conversationId] || [];
        const merged = before ? [...data.messages, ...existing] : mergeById(existing, data.messages);
        return {
          messages: { ...s.messages, [conversationId]: merged },
          hasMore: { ...s.hasMore, [conversationId]: data.hasMore },
        };
      });

      await get().decryptMany(data.messages);

      // Tell senders their messages landed.
      const undelivered = data.messages
        .filter((m) => m.receipts?.some((r) => !r.deliveredAt))
        .map((m) => m._id);
      if (undelivered.length) emit('message:delivered', { messageIds: undelivered });
    } finally {
      set((s) => ({ loadingMessages: { ...s.loadingMessages, [conversationId]: false } }));
    }
  },

  async loadOlder(conversationId) {
    const list = get().messages[conversationId] || [];
    if (!list.length || !get().hasMore[conversationId]) return;
    await get().loadMessages(conversationId, { before: list[0].createdAt });
  },

  /** Decrypts once, then remembers — both in memory and on disk. */
  async decrypt(message) {
    if (!message?._id) return null;
    const existing = get().plain[message._id];
    if (existing) return existing;

    if (message.type === 'system' || message.type === 'call' || message.deletedForEveryone) {
      return null;
    }

    const cached = await vault.getCached(message._id);
    if (cached?.payload) {
      set((s) => ({ plain: { ...s.plain, [message._id]: cached.payload } }));
      return cached.payload;
    }

    try {
      const payload = await e2ee.decryptEnvelope(message);
      if (!payload) return null;

      set((s) => ({ plain: { ...s.plain, [message._id]: payload } }));

      vault.cacheMessage({
        messageId: message._id,
        conversationId: String(message.conversation),
        text: payload.text || '',
        payload,
        createdAt: message.createdAt,
      });

      return payload;
    } catch {
      return null;
    }
  },

  async decryptMany(messages = []) {
    const todo = messages.filter((m) => m && !get().plain[m._id]);
    if (!todo.length) return;

    const cached = await vault.getCachedMany(todo.map((m) => m._id));
    const fromCache = {};
    const remaining = [];

    todo.forEach((m) => {
      if (cached[m._id]?.payload) fromCache[m._id] = cached[m._id].payload;
      else remaining.push(m);
    });

    if (Object.keys(fromCache).length) {
      set((s) => ({ plain: { ...s.plain, ...fromCache } }));
    }

    const results = await Promise.all(
      remaining.map(async (m) => {
        if (m.type === 'system' || m.type === 'call' || m.deletedForEveryone) return null;
        try {
          const payload = await e2ee.decryptEnvelope(m);
          return payload ? { message: m, payload } : null;
        } catch {
          return null;
        }
      })
    );

    const decrypted = results.filter(Boolean);
    if (!decrypted.length) return;

    set((s) => ({
      plain: {
        ...s.plain,
        ...Object.fromEntries(decrypted.map((d) => [d.message._id, d.payload])),
      },
    }));

    vault.cacheMessages(
      decrypted.map((d) => ({
        messageId: d.message._id,
        conversationId: String(d.message.conversation),
        text: d.payload.text || '',
        payload: d.payload,
        createdAt: d.message.createdAt,
      }))
    );
  },

  /* ────────────────────────── sending ────────────────────────── */

  async sendMessage({
    conversationId,
    text = '',
    attachments = [],
    replyTo = null,
    type = 'text',
    viewOnce = false,
    poll = null,
    meta = {},
    /** Ids of the people @-named. The names themselves stay in the payload. */
    mentions = [],
    mentionsEveryone = false,
    /** Set to hang this under another message instead of the timeline. */
    threadRoot = null,
  }) {
    const conversation = get().conversations.find((c) => c._id === conversationId);
    if (!conversation) throw new Error('Conversation not loaded');

    const clientId = uid();
    const me = getMe();

    /* `previewUrl` is a blob: URL minted by URL.createObjectURL on this
       device — it is meaningful only in this browser session. It must not
       travel: the recipient decrypts the payload, sees a previewUrl, and
       <Attachment> then skips decryption entirely and renders a blob that
       does not exist for them, which is a broken image. The sender's own
       optimistic bubble keeps it via localPayload, so the preview is still
       instant locally. */
    const payload = { text, attachments: attachments.map(stripLocalOnly), ...meta };
    const localPayload = { text, attachments, ...meta };

    // Optimistic bubble — it appears before the network round-trip.
    const optimistic = {
      _id: clientId,
      clientId,
      conversation: conversationId,
      sender: me,
      type,
      body: {},
      keys: [],
      attachments: attachments.map(stripAttachmentSecrets),
      replyTo,
      viewOnce,
      threadRoot,
      mentions,
      mentionsEveryone,
      receipts: [],
      reactions: [],
      createdAt: new Date().toISOString(),
      pending: true,
    };

    set((s) => ({
      // A reply is optimistically added to its thread, never to the timeline —
      // the timeline is where it must not appear.
      messages: threadRoot
        ? s.messages
        : {
            ...s.messages,
            [conversationId]: [...(s.messages[conversationId] || []), optimistic],
          },
      threads: threadRoot
        ? {
            ...s.threads,
            [threadRoot]: {
              ...(s.threads[threadRoot] || { replies: [] }),
              replies: [...(s.threads[threadRoot]?.replies || []), optimistic],
            },
          }
        : s.threads,
      plain: { ...s.plain, [clientId]: localPayload },
    }));

    if (!threadRoot) {
      get().patchConversation(conversationId, { lastMessageAt: optimistic.createdAt });
    }
    feedback('send');

    try {
      const { body, keys } = await e2ee.encryptEnvelope({
        payload,
        recipients: recipientsOf(conversation),
      });

      const wire = {
        conversationId,
        clientId,
        type,
        body,
        keys,
        attachments: attachments.map(stripAttachmentSecrets),
        replyTo: replyTo?._id || replyTo || null,
        viewOnce,
        ...(poll ? { poll } : {}),
        ...(threadRoot ? { threadRoot } : {}),
        ...(mentions.length ? { mentions } : {}),
        ...(mentionsEveryone ? { mentionsEveryone: true } : {}),
      };

      // Socket first (lower latency); REST is the fallback if it is down.
      let saved;
      if (getSocket()?.connected) {
        const res = await emitAsync('message:send', wire);
        if (!res?.success) throw new Error(res?.message || 'Could not send');
        saved = res.message;
      } else {
        const { data } = await api.post('/messages', wire);
        saved = data.message;
      }

      set((s) => {
        const settle = (list) =>
          (list || []).map((m) => (m.clientId === clientId ? { ...saved, pending: false } : m));

        const plain = { ...s.plain, [saved._id]: payload };
        delete plain[clientId];

        if (threadRoot) {
          const thread = s.threads[threadRoot];
          return {
            plain,
            threads: {
              ...s.threads,
              [threadRoot]: { ...thread, replies: settle(thread?.replies) },
            },
            // Keep the root's advertised count in step with what is on screen.
            messages: bumpReplyCount(s.messages, conversationId, threadRoot, saved.createdAt),
          };
        }

        return {
          messages: { ...s.messages, [conversationId]: settle(s.messages[conversationId]) },
          plain,
        };
      });

      vault.cacheMessage({
        messageId: saved._id,
        conversationId,
        text: payload.text || '',
        payload,
        createdAt: saved.createdAt,
      });

      return saved;
    } catch (err) {
      const mark = (list) =>
        (list || []).map((m) =>
          m.clientId === clientId ? { ...m, pending: false, failed: true } : m
        );

      set((s) =>
        threadRoot
          ? {
              threads: {
                ...s.threads,
                [threadRoot]: {
                  ...s.threads[threadRoot],
                  replies: mark(s.threads[threadRoot]?.replies),
                },
              },
            }
          : {
              messages: {
                ...s.messages,
                [conversationId]: mark(s.messages[conversationId]),
              },
            }
      );
      feedback('error');
      throw err;
    }
  },

  /* ─────────────────────────────── threads ─────────────────────────────── */

  /** Loads a thread and its root. Cheap enough to refetch rather than cache. */
  async openThread(messageId) {
    set((s) => ({ threadLoading: { ...s.threadLoading, [messageId]: true } }));
    try {
      const { data } = await api.get('/messages/' + messageId + '/thread');
      const rootId = data.root._id;

      // Replies carry the same encrypted envelope as anything else.
      await get().decryptMany([data.root, ...data.replies]);

      set((s) => ({
        threads: {
          ...s.threads,
          [rootId]: { root: data.root, replies: data.replies, following: data.following },
        },
        threadLoading: { ...s.threadLoading, [messageId]: false, [rootId]: false },
      }));

      return rootId;
    } catch (err) {
      set((s) => ({ threadLoading: { ...s.threadLoading, [messageId]: false } }));
      throw err;
    }
  },

  /** A reply that arrived over the socket. */
  receiveThreadReply(conversationId, threadRoot, message) {
    set((s) => {
      const thread = s.threads[threadRoot];
      // Only worth holding if the panel is open; otherwise the count is enough
      // and the replies are fetched fresh when it opens.
      const replies = thread
        ? [...thread.replies.filter((r) => r._id !== message._id), message]
        : null;

      return {
        threads: replies ? { ...s.threads, [threadRoot]: { ...thread, replies } } : s.threads,
        messages: bumpReplyCount(s.messages, conversationId, threadRoot, message.createdAt),
      };
    });
  },

  closeThread(rootId) {
    set((s) => {
      const threads = { ...s.threads };
      delete threads[rootId];
      return { threads };
    });
  },

  async retryMessage(conversationId, clientId) {
    const list = get().messages[conversationId] || [];
    const failed = list.find((m) => m.clientId === clientId);
    if (!failed) return;

    const payload = get().plain[clientId] || { text: '' };

    set((s) => ({
      messages: {
        ...s.messages,
        [conversationId]: s.messages[conversationId].filter((m) => m.clientId !== clientId),
      },
    }));

    return get().sendMessage({
      conversationId,
      text: payload.text,
      attachments: payload.attachments || [],
      replyTo: failed.replyTo,
      type: failed.type,
    });
  },

  /* ────────────────────────── message actions ────────────────────────── */

  async editMessage(message, text) {
    const conversation = get().conversations.find((c) => c._id === String(message.conversation));
    const payload = { ...(get().plain[message._id] || {}), text };

    const { body, keys } = await e2ee.encryptEnvelope({
      payload,
      recipients: recipientsOf(conversation),
    });

    const { data } = await api.patch('/messages/' + message._id, { body, keys });

    set((s) => ({
      plain: { ...s.plain, [message._id]: payload },
      messages: {
        ...s.messages,
        [conversation._id]: (s.messages[conversation._id] || []).map((m) =>
          m._id === message._id ? { ...m, ...data.message } : m
        ),
      },
    }));

    vault.cacheMessage({
      messageId: message._id,
      conversationId: conversation._id,
      text,
      payload,
      createdAt: message.createdAt,
    });
  },

  async deleteMessage(message, scope = 'me') {
    const conversationId = String(message.conversation);
    await api.delete('/messages/' + message._id, { params: { scope } });

    if (scope === 'me') {
      set((s) => ({
        messages: {
          ...s.messages,
          [conversationId]: (s.messages[conversationId] || []).filter((m) => m._id !== message._id),
        },
      }));
      vault.removeCached(message._id);
    }
  },

  async toggleReaction(message, emoji) {
    feedback('react');
    const res = await emitAsync('message:react', { messageId: message._id, emoji }).catch(
      () => null
    );
    if (!res?.success) {
      await api.post('/messages/' + message._id + '/reactions', { emoji });
    }
  },

  /* Star and pin both flip locally first so the menu reacts instantly, then
     reconcile with what the server actually stored. On failure the change is
     rolled back and said out loud — silently doing nothing looked like the
     button was broken. */
  async toggleStar(message) {
    const conversationId = String(message.conversation);
    const was = !!message.starred;

    get().applyMessagePatch(conversationId, message._id, { starred: !was });
    try {
      const { data } = await api.post('/messages/' + message._id + '/star');
      get().applyMessagePatch(conversationId, message._id, { starred: data.starred });
      toast.success(data.starred ? 'Starred' : 'Removed from starred');
    } catch (err) {
      get().applyMessagePatch(conversationId, message._id, { starred: was });
      toast.error(err.message || 'Could not star that message');
    }
  },

  async togglePin(message) {
    const conversationId = String(message.conversation);
    const was = !!message.pinned;

    get().applyMessagePatch(conversationId, message._id, { pinned: !was });
    try {
      const { data } = await api.post('/messages/' + message._id + '/pin');
      get().applyMessagePatch(conversationId, message._id, { pinned: data.pinned });
      toast.success(data.pinned ? 'Pinned' : 'Unpinned');
    } catch (err) {
      get().applyMessagePatch(conversationId, message._id, { pinned: was });
      toast.error(err.message || 'Could not pin that message');
    }
  },

  async forwardTo(message, conversationIds) {
    const payload = get().plain[message._id];
    if (!payload) throw new Error('That message has not been decrypted on this device');

    const items = [];
    for (const conversationId of conversationIds) {
      const conversation = get().conversations.find((c) => c._id === conversationId);
      if (!conversation) continue;

      const { body, keys } = await e2ee.encryptEnvelope({
        payload,
        recipients: recipientsOf(conversation),
      });

      items.push({
        conversationId,
        clientId: uid(),
        type: message.type,
        body,
        keys,
        attachments: message.attachments || [],
        forwardedFrom: message.sender?._id || message.sender,
        forwardScore: message.forwardScore || 0,
      });
    }

    const { data } = await api.post('/messages/forward', { items });
    await get().decryptMany(data.messages);
    return data.messages;
  },

  applyMessagePatch(conversationId, messageId, patch) {
    set((s) => ({
      messages: {
        ...s.messages,
        [conversationId]: (s.messages[conversationId] || []).map((m) =>
          m._id === messageId ? { ...m, ...patch } : m
        ),
      },
    }));
  },

  /* ────────────────────────── realtime intake ────────────────────────── */

  async receiveMessage({ conversationId, message }) {
    const isMine = String(message.sender?._id || message.sender) === String(getMe()?._id);
    const isActive = get().activeId === conversationId;

    set((s) => {
      const list = s.messages[conversationId] || [];
      // Our own optimistic copy may already be here.
      const filtered = list.filter(
        (m) => m._id !== message._id && m.clientId !== message.clientId
      );
      return {
        messages: { ...s.messages, [conversationId]: [...filtered, message] },
      };
    });

    await get().decrypt(message);

    if (!isMine) {
      emit('message:delivered', { messageIds: [message._id] });
      if (isActive) {
        emit('message:read', { conversationId, messageIds: [message._id] });
        get().patchConversation(conversationId, { unreadCount: 0 });
      }
    }

    get().patchConversation(conversationId, {
      lastMessage: message,
      lastMessageAt: message.createdAt,
    });
  },

  setTyping(conversationId, userId, name) {
    set((s) => ({
      typing: {
        ...s.typing,
        [conversationId]: { ...(s.typing[conversationId] || {}), [userId]: name },
      },
    }));
  },

  /**
   * Wipes what this device shows for a chat after a server-side clear.
   *
   * Three separate places hold the same text, and missing any one of them is
   * what made "clear" look like it had not worked: the loaded message list, the
   * decrypted-payload map that the sidebar preview reads, and the on-disk cache
   * that survives a reload. The conversation's own `lastMessage` goes too, or
   * the row keeps its last line until the next refetch.
   */
  async clearLocalHistory(conversationId) {
    const ids = (get().messages[conversationId] || []).map((m) => m._id).filter(Boolean);

    set((s) => {
      const plain = { ...s.plain };
      ids.forEach((id) => delete plain[id]);

      return {
        messages: { ...s.messages, [conversationId]: [] },
        plain,
        conversations: s.conversations.map((c) =>
          c._id === conversationId
            ? { ...c, lastMessage: null, unreadCount: 0, mentionCount: 0 }
            : c
        ),
      };
    });

    await vault.clearConversationCache(conversationId);
  },

  clearTyping(conversationId, userId) {
    set((s) => {
      const room = { ...(s.typing[conversationId] || {}) };
      delete room[userId];
      return { typing: { ...s.typing, [conversationId]: room } };
    });
  },

  setPresence(userId, online) {
    set((s) => ({ presence: { ...s.presence, [userId]: online } }));
  },

  setPresenceMap(map) {
    set((s) => ({ presence: { ...s.presence, ...map } }));
  },

  /* ────────────────────────── stories ────────────────────────── */

  async loadStories() {
    const { data } = await api.get('/stories');
    set({ stories: data.rings });
    return data.rings;
  },

  setSearch: (search) => set({ search }),
  reset: () =>
    set({
      conversations: [],
      messages: {},
      plain: {},
      threads: {},
      activeId: null,
      loaded: false,
    }),
}));

/* ────────────────────────────── helpers ────────────────────────────── */

let meRef = null;
export const setMe = (user) => {
  meRef = user;
};
const getMe = () => meRef;

function sortConversations(list) {
  return [...list].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return new Date(b.lastMessageAt) - new Date(a.lastMessageAt);
  });
}

function mergeById(existing, incoming) {
  const map = new Map(existing.map((m) => [m._id, m]));
  incoming.forEach((m) => map.set(m._id, { ...map.get(m._id), ...m }));
  return [...map.values()].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}

/** Attachment keys live inside the encrypted payload, never on the wire meta. */
/**
 * Keeps a root message's reply counter in step with what the panel shows.
 * The server is authoritative, but waiting for a refetch to learn that a reply
 * you just sent exists makes the count look broken.
 */
function bumpReplyCount(messages, conversationId, rootId, at) {
  const list = messages[conversationId];
  if (!list) return messages;

  let touched = false;
  const next = list.map((m) => {
    if (m._id !== rootId) return m;
    touched = true;
    return {
      ...m,
      thread: {
        ...(m.thread || {}),
        replyCount: (m.thread?.replyCount || 0) + 1,
        lastReplyAt: at,
      },
    };
  });

  return touched ? { ...messages, [conversationId]: next } : messages;
}

function stripAttachmentSecrets(a) {
  const { key, iv, name, mime, ...rest } = a;
  return rest;
}

/** Drops fields that only mean something on the device that created them. */
function stripLocalOnly(a) {
  const { previewUrl, ...rest } = a;
  return rest;
}
