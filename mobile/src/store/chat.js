import { create } from 'zustand';
import { api } from '../lib/api';
import { emit, emitAsync, getSocket } from '../lib/socket';
import { vault } from '../lib/vault';
import * as e2ee from '../lib/e2ee';
import { uid, idOf } from '../lib/utils';
import { feedback } from '../lib/feedback';
import { toast } from './ui';
import { report, trace } from '../lib/report';

export { idOf };

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
  hasMore: {},
  loadingMessages: {},
  typing: {}, // conversationId -> { userId: name }
  presence: {}, // userId -> boolean
  stories: [],
  replyTo: null,
  loaded: false,
  showArchived: false,
  search: '',

  contacts: [],
  addedYou: [],
  messaged: [],
  contactsLoaded: false,

  /* ────────────────────────── conversations ────────────────────────── */

  /**
   * Loads one scope of the conversation list — archived or not.
   *
   * Merges rather than replaces, because several callers ask for this list
   * independently and none knows about the others: a request for the archive
   * that replaced the whole array would leave the inbox holding only archived
   * rows, which the visible filter then rejects — an empty chat list with
   * nothing in flight to put it right. Each scope also carries a counter, so a
   * slow reply cannot reinstate rows a faster one has already superseded.
   */
  async loadConversations({ archived = false } = {}) {
    const scope = archived ? 'archived' : 'inbox';
    if (listInFlight[scope]) return listInFlight[scope];

    const seq = ++loadSeq[scope];

    listInFlight[scope] = api
      .get('/conversations', { params: { archived } })
      .then(({ data }) => {
        if (seq !== loadSeq[scope]) return get().conversations;

        set((s) => {
          const incoming = data.conversations || [];
          const fresh = new Set(incoming.map((c) => c._id));
          const kept = s.conversations.filter(
            (c) => !!c.archived !== !!archived && !fresh.has(c._id)
          );
          return {
            conversations: sortConversations([...kept, ...incoming]),
            loaded: true,
            showArchived: archived,
          };
        });

        const lastMessages = (data.conversations || []).map((c) => c.lastMessage).filter(Boolean);
        get().decryptMany(lastMessages);
        return data.conversations;
      })
      .catch((err) => {
        set({ loaded: true });
        throw err;
      })
      .finally(() => {
        listInFlight[scope] = null;
      });

    return listInFlight[scope];
  },

  /* ────────────────────────── contacts ────────────────────────── */

  async loadContacts({ force = false } = {}) {
    if (contactsInFlight && !force) return contactsInFlight;

    contactsInFlight = api
      .get('/users/contacts')
      .then(({ data }) => {
        set({
          contacts: data.contacts || [],
          addedYou: data.addedYou || [],
          messaged: data.messaged || [],
          contactsLoaded: true,
        });
        return data;
      })
      .finally(() => {
        contactsInFlight = null;
      });

    return contactsInFlight;
  },

  async saveContact(userId, { name } = {}) {
    const { data } = await api.post('/users/contacts', { userId });
    const contact = data.contact;

    set((s) => ({
      contacts: dedupeById([...s.contacts, contact]),
      addedYou: s.addedYou.filter((p) => idOf(p) !== String(userId)),
      messaged: s.messaged.filter((p) => idOf(p) !== String(userId)),
      conversations: s.conversations.map((c) =>
        c.type === 'direct' && c.peer && idOf(c.peer) === String(userId)
          ? { ...c, peerIsContact: true }
          : c
      ),
    }));

    if (!data.already) toast.success((name || contact.name) + ' saved to contacts');
    return contact;
  },

  async removeContact(userId) {
    await api.delete('/users/contacts/' + userId);
    set((s) => ({
      contacts: s.contacts.filter((p) => idOf(p) !== String(userId)),
      conversations: s.conversations.map((c) =>
        c.type === 'direct' && c.peer && idOf(c.peer) === String(userId)
          ? { ...c, peerIsContact: false }
          : c
      ),
    }));
    get().loadContacts({ force: true }).catch(() => {});
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

  closeConversation() {
    const id = get().activeId;
    if (id) emit('conversation:leave', id);
    // The draft reply goes too, or it reappears attached to whichever chat is
    // opened next.
    set({ activeId: null, replyTo: null });
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
    meta = {},
    mentions = [],
    mentionsEveryone = false,
  }) {
    const conversation = get().conversations.find((c) => c._id === conversationId);
    if (!conversation) throw new Error('Conversation not loaded');

    const clientId = uid();
    const me = getMe();

    /* `localUri` points at a file on this phone and means nothing to anyone
       else. It must not travel: the recipient would decrypt the payload, see a
       path, and render a broken image instead of downloading the real one. The
       sender's own optimistic bubble keeps it through localPayload, so the
       preview is still instant here. */
    const payload = { text, attachments: attachments.map(stripLocalOnly), ...meta };
    const localPayload = { text, attachments, ...meta };

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
      mentions,
      mentionsEveryone,
      receipts: [],
      reactions: [],
      createdAt: new Date().toISOString(),
      pending: true,
    };

    set((s) => ({
      messages: {
        ...s.messages,
        [conversationId]: [...(s.messages[conversationId] || []), optimistic],
      },
      plain: { ...s.plain, [clientId]: localPayload },
    }));

    get().patchConversation(conversationId, { lastMessageAt: optimistic.createdAt });
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
        ...(mentions.length ? { mentions } : {}),
        ...(mentionsEveryone ? { mentionsEveryone: true } : {}),
      };

      trace('sendMessage:encrypted', {
        slots: keys.length,
        viaSocket: !!getSocket()?.connected,
      });

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
        const plain = { ...s.plain, [saved._id]: payload };
        delete plain[clientId];

        return {
          messages: {
            ...s.messages,
            [conversationId]: (s.messages[conversationId] || []).map((m) =>
              m.clientId === clientId ? { ...saved, pending: false } : m
            ),
          },
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
      report('sendMessage', err, {
        conversationId,
        recipients: recipientsOf(conversation).length,
        attachments: attachments.length,
        viaSocket: !!getSocket()?.connected,
      });

      set((s) => ({
        messages: {
          ...s.messages,
          [conversationId]: (s.messages[conversationId] || []).map((m) =>
            m.clientId === clientId ? { ...m, pending: false, failed: true } : m
          ),
        },
      }));
      feedback('error');
      throw err;
    }
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

  async toggleStar(message) {
    const conversationId = String(message.conversation);
    const was = !!message.starred;

    get().applyMessagePatch(conversationId, message._id, { starred: !was });
    try {
      const { data } = await api.post('/messages/' + message._id + '/star');
      get().applyMessagePatch(conversationId, message._id, { starred: data.starred });
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
      const filtered = list.filter(
        (m) => m._id !== message._id && m.clientId !== message.clientId
      );
      return { messages: { ...s.messages, [conversationId]: [...filtered, message] } };
    });

    await get().decrypt(message);

    if (!isMine) {
      emit('message:delivered', { messageIds: [message._id] });
      if (isActive) {
        emit('message:read', { conversationId, messageIds: [message._id] });
        get().patchConversation(conversationId, { unreadCount: 0 });
      } else {
        feedback('receive');
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

  clearTyping(conversationId, userId) {
    set((s) => {
      const room = { ...(s.typing[conversationId] || {}) };
      delete room[userId];
      return { typing: { ...s.typing, [conversationId]: room } };
    });
  },

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

  setPresence(userId, online) {
    set((s) => ({ presence: { ...s.presence, [userId]: online } }));
  },

  setPresenceMap(map) {
    set((s) => ({ presence: { ...s.presence, ...map } }));
  },

  async loadStories() {
    const { data } = await api.get('/stories');
    set({ stories: data.rings });
    return data.rings;
  },

  /* Reply state lives here rather than in the chat screen, because the sheet
     that starts a reply and the composer that renders it sit on opposite sides
     of the tree. */
  setReplyTo: (replyTo) => set({ replyTo }),
  clearReplyTo: () => set({ replyTo: null }),

  setSearch: (search) => set({ search }),

  reset: () =>
    set({
      conversations: [],
      messages: {},
      plain: {},
      activeId: null,
      loaded: false,
      contacts: [],
      addedYou: [],
      messaged: [],
      contactsLoaded: false,
    }),
}));

/* ────────────────────────────── helpers ────────────────────────────── */

const loadSeq = { inbox: 0, archived: 0 };
const listInFlight = { inbox: null, archived: null };
let contactsInFlight = null;

function dedupeById(list) {
  const map = new Map();
  list.filter(Boolean).forEach((p) => map.set(idOf(p), p));
  return [...map.values()].sort((a, b) =>
    String(a.name || '').localeCompare(String(b.name || ''))
  );
}

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
function stripAttachmentSecrets(a) {
  const { key, iv, name, mime, localUri, ...rest } = a;
  return rest;
}

/** Drops fields that only mean something on the device that created them. */
function stripLocalOnly(a) {
  const { localUri, ...rest } = a;
  return rest;
}
