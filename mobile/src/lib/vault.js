import * as SQLite from 'expo-sqlite';
import * as FileSystem from 'expo-file-system/legacy';

/**
 * On-device storage for everything the server must never see: private keys,
 * ratchet state, and the decrypted message cache that makes search and offline
 * reading possible.
 *
 * The web client keeps this in IndexedDB. Here it is SQLite, which changes the
 * shape but not the contract — every method below matches the web vault's
 * signature so the ported e2ee layer runs unmodified against either.
 *
 * The database lives in the app's private data directory, which Android keeps
 * readable only by this uid. Decrypted attachments are written as files rather
 * than blobs in a row, because a 20 MB video in a SQLite cell has to be fully
 * materialised in JS to be read back, while a file path can be handed straight
 * to the image and video components.
 */

const DB_NAME = 'chax.db';

let dbPromise = null;

async function db() {
  if (!dbPromise) {
    dbPromise = (async () => {
      const database = await SQLite.openDatabaseAsync(DB_NAME);
      await database.execAsync(`
        PRAGMA journal_mode = WAL;

        CREATE TABLE IF NOT EXISTS kv (
          store TEXT NOT NULL,
          key   TEXT NOT NULL,
          value TEXT NOT NULL,
          PRIMARY KEY (store, key)
        );

        CREATE TABLE IF NOT EXISTS plaintext (
          messageId      TEXT PRIMARY KEY,
          conversationId TEXT,
          createdAt      TEXT,
          text           TEXT,
          payload        TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS plaintext_conversation
          ON plaintext (conversationId, createdAt);
        CREATE INDEX IF NOT EXISTS plaintext_created
          ON plaintext (createdAt DESC);

        CREATE TABLE IF NOT EXISTS media (
          url  TEXT PRIMARY KEY,
          path TEXT NOT NULL,
          mime TEXT
        );

        CREATE TABLE IF NOT EXISTS outbox (
          clientId       TEXT PRIMARY KEY,
          conversationId TEXT NOT NULL,
          text           TEXT NOT NULL,
          createdAt      TEXT NOT NULL,
          attempts       INTEGER NOT NULL DEFAULT 0,
          lastError      TEXT
        );
      `);
      return database;
    })();
  }
  return dbPromise;
}

const get = async (store, key) => {
  const row = await (await db()).getFirstAsync(
    'SELECT value FROM kv WHERE store = ? AND key = ?',
    [store, String(key)]
  );
  return row ? JSON.parse(row.value) : undefined;
};

const set = async (store, key, value) => {
  await (await db()).runAsync(
    'INSERT INTO kv (store, key, value) VALUES (?, ?, ?) ' +
      'ON CONFLICT(store, key) DO UPDATE SET value = excluded.value',
    [store, String(key), JSON.stringify(value)]
  );
};

const del = async (store, key) => {
  await (await db()).runAsync('DELETE FROM kv WHERE store = ? AND key = ?', [store, String(key)]);
};

const MEDIA_DIR = FileSystem.documentDirectory + 'media/';

export const vault = {
  /* ────────────────────────────── identity ────────────────────────────── */

  async saveIdentity(userId, payload) {
    await set('identity', userId, payload);
    await set('meta', 'activeUser', userId);
  },

  async loadIdentity(userId) {
    const id = userId || (await get('meta', 'activeUser'));
    if (!id) return null;
    return (await get('identity', id)) || null;
  },

  async activeUserId() {
    return (await get('meta', 'activeUser')) || null;
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
    const rows = await (await db()).getAllAsync("SELECT key, value FROM kv WHERE store = 'sessions'");
    return rows.map((r) => ({ key: r.key, ...JSON.parse(r.value) }));
  },

  /* ─────────────────── decrypted cache (search + offline) ─────────────────── */

  async cacheMessage(entry) {
    if (!entry?.messageId) return;
    await (await db()).runAsync(
      'INSERT INTO plaintext (messageId, conversationId, createdAt, text, payload) ' +
        'VALUES (?, ?, ?, ?, ?) ON CONFLICT(messageId) DO UPDATE SET ' +
        'conversationId = excluded.conversationId, createdAt = excluded.createdAt, ' +
        'text = excluded.text, payload = excluded.payload',
      [
        String(entry.messageId),
        entry.conversationId ? String(entry.conversationId) : null,
        entry.createdAt ? new Date(entry.createdAt).toISOString() : null,
        entry.text || null,
        JSON.stringify(entry),
      ]
    );
  },

  async cacheMessages(entries) {
    if (!entries?.length) return;
    const database = await db();
    // One transaction rather than N — a 200-message page of history otherwise
    // pays a full fsync per row and visibly stalls the thread list.
    await database.withTransactionAsync(async () => {
      for (const entry of entries) {
        if (!entry?.messageId) continue;
        await database.runAsync(
          'INSERT INTO plaintext (messageId, conversationId, createdAt, text, payload) ' +
            'VALUES (?, ?, ?, ?, ?) ON CONFLICT(messageId) DO UPDATE SET ' +
            'conversationId = excluded.conversationId, createdAt = excluded.createdAt, ' +
            'text = excluded.text, payload = excluded.payload',
          [
            String(entry.messageId),
            entry.conversationId ? String(entry.conversationId) : null,
            entry.createdAt ? new Date(entry.createdAt).toISOString() : null,
            entry.text || null,
            JSON.stringify(entry),
          ]
        );
      }
    });
  },

  async getCached(messageId) {
    const row = await (await db()).getFirstAsync(
      'SELECT payload FROM plaintext WHERE messageId = ?',
      [String(messageId)]
    );
    return row ? JSON.parse(row.payload) : undefined;
  },

  async getCachedMany(messageIds) {
    if (!messageIds?.length) return {};
    const placeholders = messageIds.map(() => '?').join(',');
    const rows = await (await db()).getAllAsync(
      `SELECT messageId, payload FROM plaintext WHERE messageId IN (${placeholders})`,
      messageIds.map(String)
    );
    const out = {};
    rows.forEach((r) => {
      out[r.messageId] = JSON.parse(r.payload);
    });
    return out;
  },

  async conversationCache(conversationId, limit = 200) {
    const rows = await (await db()).getAllAsync(
      'SELECT payload FROM plaintext WHERE conversationId = ? ORDER BY createdAt DESC LIMIT ?',
      [String(conversationId), limit]
    );
    return rows.map((r) => JSON.parse(r.payload)).reverse();
  },

  /** Local full-text search over what this device has already decrypted. */
  async searchPlaintext(query, { limit = 60 } = {}) {
    if (!query) return [];
    const rows = await (await db()).getAllAsync(
      'SELECT payload FROM plaintext WHERE text LIKE ? ORDER BY createdAt DESC LIMIT ?',
      ['%' + query + '%', limit]
    );
    return rows.map((r) => JSON.parse(r.payload));
  },

  async removeCached(messageId) {
    await (await db()).runAsync('DELETE FROM plaintext WHERE messageId = ?', [String(messageId)]);
  },

  async clearConversationCache(conversationId) {
    await (await db()).runAsync('DELETE FROM plaintext WHERE conversationId = ?', [
      String(conversationId),
    ]);
  },

  /* ──────────────────── decrypted attachment cache ──────────────────── */

  /**
   * Attachments are cached as files, and the row only remembers where.
   *
   * `bytes` is written through expo-file-system as base64, which is the one
   * encoding it accepts for binary writes.
   */
  async cacheMedia(url, bytes, mime, toBase64) {
    try {
      await FileSystem.makeDirectoryAsync(MEDIA_DIR, { intermediates: true });
    } catch {
      /* already there */
    }

    const name = String(url).replace(/[^a-zA-Z0-9]/g, '_').slice(-80);
    const path = MEDIA_DIR + name;

    await FileSystem.writeAsStringAsync(path, toBase64(bytes), {
      encoding: FileSystem.EncodingType.Base64,
    });

    await (await db()).runAsync(
      'INSERT INTO media (url, path, mime) VALUES (?, ?, ?) ' +
        'ON CONFLICT(url) DO UPDATE SET path = excluded.path, mime = excluded.mime',
      [String(url), path, mime || null]
    );
    return path;
  },

  async getMedia(url) {
    const row = await (await db()).getFirstAsync('SELECT path, mime FROM media WHERE url = ?', [
      String(url),
    ]);
    if (!row) return null;

    // A row whose file has been cleared by Android's storage manager is worse
    // than a miss, because the path still looks valid to every caller.
    const info = await FileSystem.getInfoAsync(row.path);
    if (!info.exists) {
      await (await db()).runAsync('DELETE FROM media WHERE url = ?', [String(url)]);
      return null;
    }
    return row;
  },

  /* ────────────────────────── outbox (reply queue) ────────────────────────── */

  /**
   * Replies typed into the notification shade land here first.
   *
   * A reply sent from a notification runs in a background JS context that
   * Android may stop at any moment, and it is the one message people most
   * expect to be reliable — nobody re-checks that a one-word answer actually
   * left. Writing it down before attempting the network means the worst case is
   * a delay until the app next runs, not a message that quietly never existed.
   */
  async queueOutbound({ clientId, conversationId, text }) {
    await (await db()).runAsync(
      'INSERT OR REPLACE INTO outbox (clientId, conversationId, text, createdAt, attempts) ' +
        'VALUES (?, ?, ?, ?, COALESCE((SELECT attempts FROM outbox WHERE clientId = ?), 0))',
      [clientId, String(conversationId), text, new Date().toISOString(), clientId]
    );
  },

  async pendingOutbound(limit = 50) {
    return (await db()).getAllAsync(
      'SELECT * FROM outbox ORDER BY createdAt ASC LIMIT ?',
      [limit]
    );
  },

  async dequeueOutbound(clientId) {
    await (await db()).runAsync('DELETE FROM outbox WHERE clientId = ?', [clientId]);
  },

  async markOutboundFailed(clientId, message) {
    await (await db()).runAsync(
      'UPDATE outbox SET attempts = attempts + 1, lastError = ? WHERE clientId = ?',
      [String(message || '').slice(0, 300), clientId]
    );
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
    await database.execAsync(
      'DELETE FROM kv; DELETE FROM plaintext; DELETE FROM media; DELETE FROM outbox;'
    );
    try {
      await FileSystem.deleteAsync(MEDIA_DIR, { idempotent: true });
    } catch {
      /* the rows are gone either way */
    }
  },
};
