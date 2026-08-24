'use client';

import { openDB } from 'idb';
import { api } from './api';
import { vault } from './vault';
import { toB64, fromB64, randomBytes, utf8 } from './crypto';

/**
 * Encrypted export and restore of everything this device knows.
 *
 * The whole readable history lives in IndexedDB, which makes "clear site data"
 * and "lost laptop" the same event: the ciphertext on the server survives, the
 * keys that open it do not. An archive is that local vault — identity, ratchet
 * sessions and decrypted messages — sealed under a passphrase the user chooses
 * and nothing else ever sees.
 *
 * Two places to put it, same bytes either way: a file the user keeps, or the
 * server, which can hold one copy without being able to read it. Storing it
 * server-side is a convenience, not a change in who is trusted.
 *
 * The passphrase is not the account password and deliberately has no recovery
 * path. Losing it means losing the archive, which is the only honest thing an
 * end-to-end encrypted backup can offer.
 */

const FORMAT_VERSION = 1;
const ITERATIONS = 310_000;
const MAGIC = 'chax-backup';

/* ─────────────────────────── key derivation ─────────────────────────── */

/**
 * One PBKDF2 pass yields 512 bits: the first half encrypts, the second half is
 * a verifier stored in the clear. That lets a wrong passphrase be reported as a
 * wrong passphrase instead of surfacing as a corrupt archive — and the verifier
 * gives away nothing, being an independent slice of the same stretched output.
 */
async function deriveKeys(passphrase, salt, iterations = ITERATIONS) {
  const base = await crypto.subtle.importKey('raw', utf8(passphrase), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
      base,
      512
    )
  );

  const key = await crypto.subtle.importKey('raw', bits.slice(0, 32), 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ]);
  return { key, verifier: toB64(bits.slice(32)) };
}

/* ───────────────────────────── collecting ───────────────────────────── */

/** Reads a whole object store as [{ key, value }]. */
async function dumpStore(database, name) {
  const keys = await database.getAllKeys(name);
  const values = await database.getAll(name);
  return keys.map((key, i) => ({ key, value: values[i] }));
}

/**
 * Meta that should not travel. The app lock is this device's PIN and its
 * registered authenticators — carrying it to another machine would be both
 * useless (the credentials are device-bound) and wrong (a lock the user set
 * here would silently appear there).
 */
const SKIP_META = new Set(['appLock', 'activeUser']);

/**
 * Everything worth keeping, plus counts to describe it.
 *
 * Media blobs are left out by default: they are re-fetchable from the server
 * with the keys that *are* in here, and including them turns a 2 MB archive
 * into a 200 MB one. `includeMedia` is there for people who would rather have
 * the bytes than the round trip.
 */
export async function collect({ includeMedia = false } = {}) {
  const database = await openDB('nexchat', 1);

  const [identity, prekeys, sessions, plaintext, meta] = await Promise.all([
    dumpStore(database, 'identity'),
    dumpStore(database, 'prekeys'),
    dumpStore(database, 'sessions'),
    dumpStore(database, 'plaintext'),
    dumpStore(database, 'meta'),
  ]);

  let media = [];
  if (includeMedia) {
    const rows = await dumpStore(database, 'media');
    // Blobs cannot be JSON, so each becomes base64. This is the expensive part
    // of the archive and the reason it is opt-in.
    media = await Promise.all(
      rows.map(async ({ key, value }) => ({
        key,
        type: value?.type || 'application/octet-stream',
        data: toB64(new Uint8Array(await value.arrayBuffer())),
      }))
    );
  }

  const payload = {
    magic: MAGIC,
    version: FORMAT_VERSION,
    createdAt: new Date().toISOString(),
    identity,
    prekeys,
    sessions,
    plaintext,
    meta: meta.filter((row) => !SKIP_META.has(row.key)),
    media,
  };

  const conversations = new Set(plaintext.map((p) => p.value?.conversationId).filter(Boolean));

  return {
    payload,
    stats: {
      messages: plaintext.length,
      conversations: conversations.size,
      sessions: sessions.length,
      media: media.length,
    },
  };
}

/* ────────────────────────────── sealing ────────────────────────────── */

/** Seals a collected payload. Returns exactly what both sinks want. */
export async function seal(passphrase, { includeMedia = false } = {}) {
  if (!passphrase || passphrase.length < 8) {
    throw new Error('Use a passphrase of at least 8 characters');
  }

  const { payload, stats } = await collect({ includeMedia });
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const { key, verifier } = await deriveKeys(passphrase, salt);

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    utf8(JSON.stringify(payload))
  );

  return {
    formatVersion: FORMAT_VERSION,
    ciphertext: toB64(ciphertext),
    iv: toB64(iv),
    salt: toB64(salt),
    iterations: ITERATIONS,
    verifier,
    stats,
  };
}

/** Opens a sealed archive, or says why it could not. */
export async function open(archive, passphrase) {
  if (!archive?.ciphertext) throw new Error('That does not look like a Chax archive');

  const { key, verifier } = await deriveKeys(
    passphrase,
    fromB64(archive.salt),
    archive.iterations || ITERATIONS
  );

  // Checked before the decrypt so the common mistake gets the honest message.
  if (archive.verifier && archive.verifier !== verifier) {
    throw new Error('Wrong passphrase');
  }

  let payload;
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromB64(archive.iv) },
      key,
      fromB64(archive.ciphertext)
    );
    payload = JSON.parse(new TextDecoder().decode(plain));
  } catch {
    // Without a verifier a wrong passphrase lands here instead, and AES-GCM
    // cannot tell us which of the two it was.
    throw new Error('Wrong passphrase, or the archive is damaged');
  }

  if (payload?.magic !== MAGIC) throw new Error('That is not a Chax archive');
  if (payload.version > FORMAT_VERSION) {
    throw new Error('That archive was made by a newer version of Chax');
  }

  return payload;
}

/* ───────────────────────────── restoring ───────────────────────────── */

/**
 * Writes an opened archive back into the vault.
 *
 * Merges rather than replaces. A restore is usually run on a device that has
 * already been signed in and has *some* history, and throwing that away to make
 * room for an older archive would be a strange way to help. Cached messages are
 * keyed by message id, so re-adding one is a no-op.
 */
export async function restore(payload, { replaceIdentity = false } = {}) {
  const database = await openDB('nexchat', 1);
  const counts = { messages: 0, sessions: 0, prekeys: 0, media: 0, identity: 0 };

  const putAll = async (store, rows, keyed = true) => {
    if (!rows?.length) return 0;
    const tx = database.transaction(store, 'readwrite');
    await Promise.all([
      ...rows.map((row) => (keyed ? tx.store.put(row.value, row.key) : tx.store.put(row.value))),
      tx.done,
    ]);
    return rows.length;
  };

  // The identity is the one thing a merge cannot be casual about: overwriting a
  // live device's keys would strand every session it has already negotiated.
  const activeUser = await vault.activeUserId();
  const identityRows = (payload.identity || []).filter(
    (row) => replaceIdentity || String(row.key) !== String(activeUser)
  );
  counts.identity = await putAll('identity', identityRows);

  counts.prekeys = await putAll('prekeys', payload.prekeys);
  counts.sessions = await putAll('sessions', payload.sessions);
  // The plaintext store has a keyPath, so its rows carry their own key.
  counts.messages = await putAll('plaintext', payload.plaintext, false);
  await putAll('meta', (payload.meta || []).filter((row) => !SKIP_META.has(row.key)));

  if (payload.media?.length) {
    const tx = database.transaction('media', 'readwrite');
    await Promise.all([
      ...payload.media.map((row) =>
        tx.store.put(new Blob([fromB64(row.data)], { type: row.type }), row.key)
      ),
      tx.done,
    ]);
    counts.media = payload.media.length;
  }

  return counts;
}

/* ──────────────────────────── file transport ──────────────────────────── */

const fileName = () =>
  'chax-backup-' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '.chaxbak';

/** Seals and hands the archive to the browser as a download. */
export async function exportToFile(passphrase, options = {}) {
  const archive = await seal(passphrase, options);

  const blob = new Blob([JSON.stringify({ ...archive, magic: MAGIC }, null, 0)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = fileName();
  a.click();
  // Revoked on a timer rather than immediately: Safari has not started reading
  // the blob by the time click() returns.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);

  return { ...archive, name: a.download, size: blob.size };
}

/** Reads a `.chaxbak` file into the archive envelope, without decrypting it. */
export async function readFile(file) {
  const text = await file.text();

  let archive;
  try {
    archive = JSON.parse(text);
  } catch {
    throw new Error('That file is not a Chax archive');
  }

  if (archive?.magic !== MAGIC || !archive.ciphertext) {
    throw new Error('That file is not a Chax archive');
  }
  return archive;
}

/* ─────────────────────────── server transport ─────────────────────────── */

export const remote = {
  /** Metadata for the settings screen: what is stored, how big, from where. */
  async info() {
    const { data } = await api.get('/backups');
    return data.backup;
  },

  async upload(passphrase, options = {}) {
    const archive = await seal(passphrase, options);
    const { data } = await api.put('/backups', {
      ...archive,
      deviceName: navigator.userAgent.includes('Mobile') ? 'Phone' : 'This browser',
    });
    return data.backup;
  },

  /** Fetches and opens the stored archive in one step. */
  async download(passphrase) {
    const { data } = await api.get('/backups/archive');
    return open(data.backup, passphrase);
  },

  async remove() {
    await api.delete('/backups');
  },
};

export const FORMAT = { version: FORMAT_VERSION, iterations: ITERATIONS, magic: MAGIC };
