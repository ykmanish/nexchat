'use client';

import { openDB } from 'idb';

/**
 * On-device storage for everything the server must never see:
 * private keys, ratchet state, and the decrypted message cache that makes
 * search and offline reading possible.
 */

const DB_NAME = 'nexchat';
const DB_VERSION = 1;

let dbPromise = null;

function db() {
  if (typeof window === 'undefined') return null;
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(database) {
        database.createObjectStore('identity');
        database.createObjectStore('prekeys');
        database.createObjectStore('sessions');

        const plaintext = database.createObjectStore('plaintext', { keyPath: 'messageId' });
        plaintext.createIndex('conversation', 'conversationId');
        plaintext.createIndex('createdAt', 'createdAt');

        database.createObjectStore('meta');
        database.createObjectStore('media');
      },
    });
  }
  return dbPromise;
}

const get = async (store, key) => (await db())?.get(store, key);
const set = async (store, key, value) => (await db())?.put(store, value, key);
const del = async (store, key) => (await db())?.delete(store, key);

/* ────────────────────────────── identity ────────────────────────────── */

export const vault = {
  async saveIdentity(userId, payload) {
    await set('identity', userId, payload);
    await set('meta', 'activeUser', userId);
  },

  async loadIdentity(userId) {
    const id = userId || (await get('meta', 'activeUser'));
    if (!id) return null;
    return get('identity', id);
  },

  async activeUserId() {
    return get('meta', 'activeUser');
  },

  async clearIdentity(userId) {
    await del('identity', userId);
    await del('meta', 'activeUser');
  },

  /* ────────────────────────── prekey privates ────────────────────────── */

  async savePreKeys(deviceId, { privateKeys, signedPreKeyPrivate, signedPreKeyId }) {
    const existing = (await get('prekeys', deviceId)) || { privateKeys: {} };
    await set('prekeys', deviceId, {
      privateKeys: { ...existing.privateKeys, ...privateKeys },
      signedPreKeyPrivate: signedPreKeyPrivate ?? existing.signedPreKeyPrivate,
      signedPreKeyId: signedPreKeyId ?? existing.signedPreKeyId,
    });
  },

  async getPreKeys(deviceId) {
    return (await get('prekeys', deviceId)) || null;
  },

  /** One-time prekeys are single use — drop it the moment it is spent. */
  async consumePreKey(deviceId, keyId) {
    const store = await get('prekeys', deviceId);
    if (!store?.privateKeys?.[keyId]) return null;
    const key = store.privateKeys[keyId];
    delete store.privateKeys[keyId];
    await set('prekeys', deviceId, store);
    return key;
  },

  async countPreKeys(deviceId) {
    const store = await get('prekeys', deviceId);
    return Object.keys(store?.privateKeys || {}).length;
  },

  /* ────────────────────────────── sessions ────────────────────────────── */

  async saveSession(peerKey, session) {
    await set('sessions', peerKey, session);
  },

  async getSession(peerKey) {
    return (await get('sessions', peerKey)) || null;
  },

  async deleteSession(peerKey) {
    await del('sessions', peerKey);
  },

  async allSessions() {
    const database = await db();
    if (!database) return [];
    const keys = await database.getAllKeys('sessions');
    const values = await database.getAll('sessions');
    return keys.map((k, i) => ({ key: k, ...values[i] }));
  },

  /* ─────────────────── decrypted cache (search + offline) ─────────────────── */

  async cacheMessage(entry) {
    const database = await db();
    if (!database) return;
    await database.put('plaintext', entry);
  },

  async cacheMessages(entries) {
    const database = await db();
    if (!database || !entries.length) return;
    const tx = database.transaction('plaintext', 'readwrite');
    await Promise.all([...entries.map((e) => tx.store.put(e)), tx.done]);
  },

  async getCached(messageId) {
    return get('plaintext', messageId);
  },

  async getCachedMany(messageIds) {
    const database = await db();
    if (!database) return {};
    const tx = database.transaction('plaintext');
    const rows = await Promise.all(messageIds.map((id) => tx.store.get(id)));
    const out = {};
    rows.forEach((r) => {
      if (r) out[r.messageId] = r;
    });
    return out;
  },

  async conversationCache(conversationId, limit = 200) {
    const database = await db();
    if (!database) return [];
    const rows = await database.getAllFromIndex('plaintext', 'conversation', conversationId);
    return rows.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)).slice(-limit);
  },

  /** Local full-text search over what this device has already decrypted. */
  async searchPlaintext(query, { limit = 60 } = {}) {
    const database = await db();
    if (!database || !query) return [];

    const needle = query.toLowerCase();
    const out = [];
    let cursor = await database.transaction('plaintext').store.index('createdAt').openCursor(null, 'prev');

    while (cursor && out.length < limit) {
      const value = cursor.value;
      if (value.text && value.text.toLowerCase().includes(needle)) out.push(value);
      cursor = await cursor.continue();
    }
    return out;
  },

  async removeCached(messageId) {
    await del('plaintext', messageId);
  },

  async clearConversationCache(conversationId) {
    const database = await db();
    if (!database) return;
    const keys = await database.getAllKeysFromIndex('plaintext', 'conversation', conversationId);
    const tx = database.transaction('plaintext', 'readwrite');
    await Promise.all([...keys.map((k) => tx.store.delete(k)), tx.done]);
  },

  /* ──────────────────── decrypted attachment blob cache ──────────────────── */

  async cacheMedia(url, blob) {
    await set('media', url, blob);
  },

  async getMedia(url) {
    return get('media', url);
  },

  /* ────────────────────────────── misc ────────────────────────────── */

  async setMeta(key, value) {
    await set('meta', key, value);
  },

  async getMeta(key) {
    return get('meta', key);
  },

  async wipe() {
    const database = await db();
    if (!database) return;
    await Promise.all(
      ['identity', 'prekeys', 'sessions', 'plaintext', 'meta', 'media'].map((s) =>
        database.clear(s)
      )
    );
  },
};
