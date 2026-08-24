'use client';

import { api } from './api';
import { vault } from './vault';
import * as backup from './backup';
import * as e2ee from './e2ee';
import * as C from './crypto';

/**
 * Keeping the same history on every device.
 *
 * The awkward truth of this architecture: a message is encrypted to the devices
 * that existed when it was sent. A phone linked on Tuesday has no key slot in
 * Monday's messages and never will, so it cannot decrypt them no matter how
 * many times it asks the server. That is why the same account can look different
 * on a laptop and a phone — not a bug in the sync, an absence of one.
 *
 * The fix is for the devices to hand each other the *plaintext* they already
 * hold, sealed so the server cannot read it in passing. The key for that seal
 * has to be something every device of this account has and no one else does,
 * which is exactly what the account identity private key is: unwrapped at login,
 * identical across devices, never sent anywhere.
 *
 * So: derive a key from the account identity, seal a snapshot of the local
 * vault under it, and let every device push and pull. No passphrase to
 * remember, nothing new to trust, and the server still holds only ciphertext.
 *
 * Distinct from the backup in ./backup, which is passphrase-based and meant for
 * surviving the loss of *every* device. This one is for the ordinary case of
 * owning two.
 */

const SNAPSHOT_KEY = 'syncSnapshot';
/* Long enough that opening the app twice in a minute does not re-upload a
   multi-megabyte snapshot, short enough that a phone picked up after lunch is
   current. */
const MIN_PUSH_INTERVAL_MS = 10 * 60 * 1000;

/* ─────────────────────────────── the key ─────────────────────────────── */

/**
 * A stable AES key derived from the account identity.
 *
 * The identity private key is a P-256 ECDH key, which cannot be used for
 * symmetric encryption directly, so its exported bytes are run through HKDF.
 * Reading them out of the vault rather than from the in-memory CryptoKey keeps
 * this independent of whether that key was imported as extractable.
 */
async function syncKey() {
  const userId = await vault.activeUserId();
  const record = userId ? await vault.loadIdentity(userId) : null;
  if (!record?.identityPrivateKey) throw new Error('This device is locked');

  const bits = await C.hkdf(C.fromB64(record.identityPrivateKey), {
    // Fixed and distinct from every other use of this key material.
    info: 'chax-device-sync-v1',
    bits: 256,
  });
  return crypto.subtle.importKey('raw', bits, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/* ────────────────────────────── pushing ────────────────────────────── */

/**
 * Seals this device's history and stores it.
 *
 * Media is left out deliberately: it is re-fetchable with the keys that are in
 * the snapshot, and including it would turn a routine background push into
 * hundreds of megabytes.
 */
export async function push({ force = false } = {}) {
  if (!e2ee.isUnlocked()) return { skipped: 'locked' };

  const last = (await vault.getMeta(SNAPSHOT_KEY))?.pushedAt || 0;
  if (!force && Date.now() - last < MIN_PUSH_INTERVAL_MS) {
    return { skipped: 'recent' };
  }

  const { payload, stats } = await backup.collect({ includeMedia: false });
  const key = await syncKey();
  const iv = C.randomBytes(12);

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    C.utf8(JSON.stringify(payload))
  );

  const { data } = await api.put('/sync/snapshot', {
    ciphertext: C.toB64(ciphertext),
    iv: C.toB64(iv),
    stats,
  });

  await vault.setMeta(SNAPSHOT_KEY, { pushedAt: Date.now(), version: data.snapshot.version });
  return { pushed: true, stats, version: data.snapshot.version };
}

/* ────────────────────────────── pulling ────────────────────────────── */

/**
 * Merges whatever other devices have contributed into this vault.
 *
 * Merge, never replace: this device's own decrypted messages are the newest
 * thing in the system and must not be overwritten by an older snapshot. The
 * identity is explicitly excluded for the same reason — swapping a live
 * device's keys would strand every session it has negotiated.
 */
export async function pull() {
  if (!e2ee.isUnlocked()) return { skipped: 'locked' };

  let snapshot;
  try {
    const { data } = await api.get('/sync/snapshot');
    snapshot = data.snapshot;
  } catch (err) {
    if (err.status === 404) return { skipped: 'none' };
    throw err;
  }

  const local = await vault.getMeta(SNAPSHOT_KEY);
  // Nothing new, and no point spending a decrypt to find that out twice.
  if (local?.appliedVersion && local.appliedVersion === snapshot.version) {
    return { skipped: 'current' };
  }

  const key = await syncKey();

  let payload;
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: C.fromB64(snapshot.iv) },
      key,
      C.fromB64(snapshot.ciphertext)
    );
    payload = JSON.parse(new TextDecoder().decode(plain));
  } catch {
    // The only realistic cause is a snapshot written under a previous account
    // identity — after a password reset, say. Not worth surfacing; the next
    // push replaces it.
    return { skipped: 'unreadable' };
  }

  const counts = await backup.restore(payload, { replaceIdentity: false });

  await vault.setMeta(SNAPSHOT_KEY, {
    ...(local || {}),
    appliedVersion: snapshot.version,
    pulledAt: Date.now(),
  });

  return { pulled: true, counts };
}

/* ─────────────────────────────── driving ─────────────────────────────── */

let running = null;

/**
 * One round: take what other devices know, then contribute what this one does.
 *
 * Pull first on purpose. Pushing first would upload a snapshot that is missing
 * everything the other devices had, and since the snapshot is a single shared
 * slot, that would make the gap permanent rather than closing it.
 *
 * De-duplicated with a promise rather than a flag so two callers racing at
 * startup — the app shell and a socket reconnect — wait on the same round.
 */
export function sync({ force = false } = {}) {
  if (running) return running;

  running = (async () => {
    const result = { pulled: null, pushed: null };
    try {
      result.pulled = await pull();
      result.pushed = await push({ force });
    } catch (err) {
      result.error = err.message;
    } finally {
      running = null;
    }
    return result;
  })();

  return running;
}

/** What the settings screen shows about the state of this. */
export async function status() {
  const local = (await vault.getMeta(SNAPSHOT_KEY)) || {};

  let remote = null;
  try {
    const { data } = await api.get('/sync/snapshot/info');
    remote = data.snapshot;
  } catch {
    /* nothing stored yet */
  }

  return {
    lastPushedAt: local.pushedAt || null,
    lastPulledAt: local.pulledAt || null,
    remote,
    /** True when another device has pushed something this one has not taken. */
    behind: !!remote && local.appliedVersion !== remote.version,
  };
}

export async function forget() {
  await api.delete('/sync/snapshot').catch(() => {});
  await vault.setMeta(SNAPSHOT_KEY, null);
}
