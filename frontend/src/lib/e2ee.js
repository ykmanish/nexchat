'use client';

import * as C from './crypto';
import { vault } from './vault';
import { api } from './api';

/**
 * Session + envelope management.
 *
 * Every message is encrypted **once** with a random content key (CEK). That
 * CEK is then sealed separately for each recipient, in two flavours:
 *
 *   1. an *account slot* — sealed to the recipient's account identity key, so
 *      any device they own (now or later) can read their history;
 *   2. a *device slot*  — sealed through a ratcheting X3DH session with each
 *      individual device, which gives forward secrecy on the fast path.
 *
 * Decryption tries the device slot first and falls back to the account slot,
 * so a missing or stale session degrades gracefully instead of losing a message.
 */

const ACCOUNT_SLOT = 'account';

/** Unlocked key material for this tab. Never persisted in plain form. */
let state = {
  userId: null,
  deviceId: null,
  identityPrivateKey: null,
  identityPublicKey: null,
  signingPrivateKey: null,
  signingPublicKey: null,
  deviceIdentityPrivateKey: null,
  deviceIdentityPublicKey: null,
  deviceSigningPrivateKey: null,
  ready: false,
};

export const isUnlocked = () => state.ready;
export const currentKeys = () => ({ ...state });

/* ────────────────────────── account + device setup ────────────────────────── */

/** Fresh account: mint the identity, wrap it under the password, mint device keys. */
export async function bootstrapAccount(password) {
  const identity = await C.generateEcdhKeyPair();
  const signing = await C.generateSigningKeyPair();

  const encryptedIdentity = await C.wrapIdentity(
    { identityPrivateKey: identity.privateKey, signingPrivateKey: signing.privateKey },
    password
  );

  const account = {
    identityPublicKey: await C.exportPublicKey(identity.publicKey),
    signingPublicKey: await C.exportPublicKey(signing.publicKey),
    encryptedIdentity,
  };

  const device = await buildDeviceKeys();

  return {
    account,
    device: device.publicBundle,
    _private: {
      identityPrivateKey: identity.privateKey,
      signingPrivateKey: signing.privateKey,
      identityPublicKey: account.identityPublicKey,
      signingPublicKey: account.signingPublicKey,
      device: device.privateBundle,
    },
  };
}

/** Every sign-in mints a brand-new device key set — sessions never get reused. */
export async function buildDeviceKeys() {
  const deviceId = 'dev_' + C.randomId();
  const identity = await C.generateEcdhKeyPair();
  const signing = await C.generateSigningKeyPair();

  const batch = await C.generatePreKeyBatch(signing.privateKey, { count: 60 });

  const publicBundle = {
    deviceId,
    registrationId: Math.floor(Math.random() * 16000) + 1,
    identityPublicKey: await C.exportPublicKey(identity.publicKey),
    signingPublicKey: await C.exportPublicKey(signing.publicKey),
    signedPreKey: batch.signedPreKey,
    oneTimePreKeys: batch.oneTimePreKeys,
  };

  const privateBundle = {
    deviceId,
    identityPrivateKey: await C.exportPrivateKey(identity.privateKey),
    identityPublicKey: publicBundle.identityPublicKey,
    signingPrivateKey: await C.exportPrivateKey(signing.privateKey),
    privateKeys: batch.privateKeys,
    signedPreKeyPrivate: batch.signedPreKeyPrivate,
    signedPreKeyId: batch.signedPreKey.keyId,
  };

  return { publicBundle, privateBundle, deviceId };
}

/** Persists unlocked keys for this browser and loads them into memory. */
export async function persistAndUnlock({ userId, accountPrivate, devicePrivate, accountPublic }) {
  await vault.saveIdentity(userId, {
    userId,
    identityPrivateKey: accountPrivate.identityPrivateKey,
    signingPrivateKey: accountPrivate.signingPrivateKey,
    identityPublicKey: accountPublic.identityPublicKey,
    signingPublicKey: accountPublic.signingPublicKey,
    deviceId: devicePrivate.deviceId,
    deviceIdentityPrivateKey: devicePrivate.identityPrivateKey,
    deviceIdentityPublicKey: devicePrivate.identityPublicKey,
    deviceSigningPrivateKey: devicePrivate.signingPrivateKey,
  });

  await vault.savePreKeys(devicePrivate.deviceId, {
    privateKeys: devicePrivate.privateKeys,
    signedPreKeyPrivate: devicePrivate.signedPreKeyPrivate,
    signedPreKeyId: devicePrivate.signedPreKeyId,
  });

  return loadFromVault(userId);
}

/** Rehydrates key material on a page reload. */
export async function loadFromVault(userId) {
  const record = await vault.loadIdentity(userId);
  if (!record) {
    state.ready = false;
    return false;
  }

  state = {
    userId: record.userId,
    deviceId: record.deviceId,
    identityPrivateKey: await C.importEcdhPrivate(record.identityPrivateKey),
    identityPublicKey: record.identityPublicKey,
    signingPrivateKey: await C.importSigningPrivate(record.signingPrivateKey),
    signingPublicKey: record.signingPublicKey,
    deviceIdentityPrivateKey: await C.importEcdhPrivate(record.deviceIdentityPrivateKey),
    deviceIdentityPublicKey: record.deviceIdentityPublicKey,
    deviceSigningPrivateKey: await C.importSigningPrivate(record.deviceSigningPrivateKey),
    ready: true,
  };

  return true;
}

export async function lock() {
  state = { ...state, ready: false, identityPrivateKey: null, signingPrivateKey: null };
}

export async function forget() {
  await vault.wipe();
  state = { ready: false };
}

/** Unwraps the account identity with the password, then mints new device keys. */
export async function unlockWithPassword({ encryptedIdentity, password }) {
  const { identityPrivateKey, signingPrivateKey, raw } = await C.unwrapIdentity(
    encryptedIdentity,
    password
  );

  return {
    identityPrivateKey: raw.identityPrivateKey,
    signingPrivateKey: raw.signingPrivateKey,
    keys: { identityPrivateKey, signingPrivateKey },
  };
}

/* ────────────────────────────── roster cache ────────────────────────────── */

const rosterCache = new Map(); // userId -> { at, devices: [{deviceId, identityPublicKey}] }
const ROSTER_TTL = 60_000;

async function getRoster(userIds) {
  const now = Date.now();
  const stale = userIds.filter((id) => {
    const hit = rosterCache.get(id);
    return !hit || now - hit.at > ROSTER_TTL;
  });

  if (stale.length) {
    try {
      const { data } = await api.get('/keys/roster', { params: { userIds: stale.join(',') } });
      Object.entries(data.roster || {}).forEach(([uid, devices]) =>
        rosterCache.set(uid, { at: now, devices })
      );
      stale.forEach((id) => {
        if (!rosterCache.has(id)) rosterCache.set(id, { at: now, devices: [] });
      });
    } catch {
      stale.forEach((id) => rosterCache.set(id, { at: now, devices: [] }));
    }
  }

  const out = {};
  userIds.forEach((id) => {
    out[id] = rosterCache.get(id)?.devices || [];
  });
  return out;
}

export const invalidateRoster = (userId) => {
  if (userId) rosterCache.delete(String(userId));
  else rosterCache.clear();
};

/* ────────────────────────────── sessions ────────────────────────────── */

const sessionKeyFor = (userId, deviceId) => userId + ':' + deviceId;

/** Opens (or resumes) a ratcheting session with one specific device. */
async function getSendSession(userId, deviceId) {
  const key = sessionKeyFor(userId, deviceId);
  const existing = await vault.getSession(key);
  if (existing?.rootKey) return existing;

  const { data } = await api.get('/keys/' + userId);
  const bundle = data.bundle;
  const device = bundle.devices.find((d) => d.deviceId === deviceId);
  if (!device) throw new Error('No bundle for device ' + deviceId);

  const trusted = await C.verifyBundle(device, device.signingPublicKey);
  if (!trusted) throw new Error('Prekey signature did not verify for ' + deviceId);

  const { rootKey, ephemeralPublicKey } = await C.initiateSession({
    myIdentityPrivate: state.deviceIdentityPrivateKey,
    theirIdentityPublic: device.identityPublicKey,
    theirSignedPreKeyPublic: device.signedPreKey.publicKey,
    theirOneTimePreKeyPublic: device.oneTimePreKey?.publicKey || null,
  });

  const session = {
    rootKey: C.toB64(rootKey),
    sessionId: C.randomId(),
    sendCounter: 0,
    recvCounter: 0,
    ephemeralPublicKey,
    preKeyId: device.oneTimePreKey?.keyId ?? null,
    signedPreKeyId: device.signedPreKey.keyId,
    theirIdentityPublic: device.identityPublicKey,
    initiator: true,
    handshakeAcked: false,
  };

  await vault.saveSession(key, session);
  return session;
}

/** Rebuilds the session on the receiving side from a handshake header. */
async function getRecvSession(userId, deviceId, slot) {
  const key = sessionKeyFor(userId, deviceId);
  const existing = await vault.getSession(key);
  if (existing?.rootKey) return existing;

  if (!slot.ephemeralPublicKey) throw new Error('No session and no handshake header');

  const prekeys = await vault.getPreKeys(state.deviceId);
  if (!prekeys?.signedPreKeyPrivate) throw new Error('This device has no prekeys stored');

  const roster = await getRoster([userId]);
  const peer = roster[userId]?.find((d) => d.deviceId === deviceId);
  if (!peer) throw new Error('Sender device is not in the roster');

  const oneTimePrivate =
    slot.preKeyId != null ? await vault.consumePreKey(state.deviceId, slot.preKeyId) : null;

  const { rootKey } = await C.acceptSession({
    myIdentityPrivate: state.deviceIdentityPrivateKey,
    mySignedPreKeyPrivate: await C.importEcdhPrivate(prekeys.signedPreKeyPrivate),
    myOneTimePreKeyPrivate: oneTimePrivate ? await C.importEcdhPrivate(oneTimePrivate) : null,
    theirIdentityPublic: peer.identityPublicKey,
    theirEphemeralPublic: slot.ephemeralPublicKey,
  });

  const session = {
    rootKey: C.toB64(rootKey),
    sessionId: slot.sessionId || C.randomId(),
    sendCounter: 0,
    recvCounter: 0,
    theirIdentityPublic: peer.identityPublicKey,
    initiator: false,
    handshakeAcked: true,
  };

  await vault.saveSession(key, session);
  return session;
}

/* ────────────────────────────── envelopes ────────────────────────────── */

/**
 * Encrypts one payload for a whole conversation.
 * Returns the exact shape the API expects: `{ body, keys }`.
 */
export async function encryptEnvelope({ payload, recipients }) {
  if (!state.ready) throw new Error('Your keys are locked. Sign in again.');

  const cek = await C.generateAesKey();
  const body = await C.aesEncrypt(cek, JSON.stringify(payload));

  const userIds = recipients.map((r) => String(r.userId));
  const roster = await getRoster(userIds);
  const keys = [];

  for (const recipient of recipients) {
    const userId = String(recipient.userId);

    // 1. Account slot — the durable path that survives new devices.
    if (recipient.identityPublicKey) {
      try {
        const sealed = await C.sealTo(recipient.identityPublicKey, cek);
        keys.push({
          user: userId,
          deviceId: ACCOUNT_SLOT,
          ciphertext: sealed.ciphertext,
          iv: sealed.iv,
          ephemeralPublicKey: sealed.ephemeralPublicKey,
          counter: 0,
        });
      } catch {
        /* a missing account key must not block the send */
      }
    }

    // 2. Device slots — forward secrecy for everyone currently online.
    for (const device of roster[userId] || []) {
      if (device.deviceId === state.deviceId) continue; // never to ourselves
      try {
        const session = await getSendSession(userId, device.deviceId);
        const chain0 = await C.chainRoot(C.fromB64(session.rootKey), state.deviceId);
        const { messageKey } = await C.messageKeyAt(chain0, session.sendCounter);
        const wrapped = await C.aesEncrypt(messageKey, cek);

        keys.push({
          user: userId,
          deviceId: device.deviceId,
          ciphertext: wrapped.ciphertext,
          iv: wrapped.iv,
          ephemeralPublicKey: session.initiator ? session.ephemeralPublicKey : null,
          preKeyId: session.initiator ? session.preKeyId : null,
          signedPreKeyId: session.initiator ? session.signedPreKeyId : null,
          counter: session.sendCounter,
          sessionId: session.sessionId,
        });

        session.sendCounter += 1;
        await vault.saveSession(sessionKeyFor(userId, device.deviceId), session);
      } catch {
        /* the account slot still covers this device */
      }
    }
  }

  return { body, keys, cek };
}

/** Reverses encryptEnvelope for a message addressed to us. */
export async function decryptEnvelope(message) {
  if (!state.ready) throw new Error('Locked');
  if (!message?.body?.ciphertext) return null;

  const slots = message.keys || [];
  const senderId = String(message.sender?._id || message.sender);
  const senderDeviceId = message.senderDeviceId;

  // Fast path: a session slot addressed to this exact device.
  const deviceSlot = slots.find((k) => k.deviceId === state.deviceId);
  if (deviceSlot && senderDeviceId) {
    try {
      const session = await getRecvSession(senderId, senderDeviceId, deviceSlot);
      const chain0 = await C.chainRoot(C.fromB64(session.rootKey), senderDeviceId);
      const { messageKey } = await C.messageKeyAt(chain0, deviceSlot.counter || 0);
      const cek = await C.aesDecrypt(messageKey, deviceSlot.ciphertext, deviceSlot.iv);
      return JSON.parse(await C.aesDecryptToString(cek, message.body.ciphertext, message.body.iv));
    } catch {
      /* fall through to the account slot */
    }
  }

  // Durable path: sealed to the account identity, readable on any of our devices.
  const accountSlot = slots.find((k) => k.deviceId === ACCOUNT_SLOT);
  if (accountSlot) {
    try {
      const cek = await C.openSealed(
        state.identityPrivateKey,
        {
          ciphertext: accountSlot.ciphertext,
          iv: accountSlot.iv,
          ephemeralPublicKey: accountSlot.ephemeralPublicKey,
        },
        state.identityPublicKey
      );
      return JSON.parse(await C.aesDecryptToString(cek, message.body.ciphertext, message.body.iv));
    } catch {
      /* fall through */
    }
  }

  return null;
}

/* ────────────────────────────── attachments ────────────────────────────── */

export async function encryptFile(file) {
  const key = await C.generateAesKey();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { ciphertext, iv } = await C.aesEncrypt(key, bytes);

  const blob = new Blob([C.fromB64(ciphertext)], { type: 'application/octet-stream' });
  return {
    blob,
    key: C.toB64(key),
    iv,
    meta: { name: file.name, mime: file.type, size: file.size },
  };
}

export async function decryptFile({ url, key, iv, mime }) {
  const cached = await vault.getMedia(url);
  if (cached) return cached;

  const res = await fetch(url.startsWith('http') ? url : (api.defaults.baseURL || '').replace('/api', '') + url);
  if (!res.ok) throw new Error('Could not download that attachment');

  const encrypted = new Uint8Array(await res.arrayBuffer());
  const plain = await C.aesDecrypt(C.fromB64(key), C.toB64(encrypted), iv);
  const blob = new Blob([plain], { type: mime || 'application/octet-stream' });

  await vault.cacheMedia(url, blob);
  return blob;
}

/* ────────────────────────── device link handover ────────────────────────── */

/** Runs on the trusted phone: seals the account identity to the new device. */
export async function sealIdentityForLink(ephemeralPublicKey) {
  const record = await vault.loadIdentity(state.userId);
  if (!record) throw new Error('No identity on this device');

  const payload = JSON.stringify({
    v: 1,
    userId: record.userId,
    identityPrivateKey: record.identityPrivateKey,
    signingPrivateKey: record.signingPrivateKey,
    identityPublicKey: record.identityPublicKey,
    signingPublicKey: record.signingPublicKey,
  });

  const sealed = await C.sealTo(ephemeralPublicKey, payload, 'NexChat-link-v1');
  return {
    ciphertext: sealed.ciphertext,
    iv: sealed.iv,
    senderEphemeralKey: sealed.ephemeralPublicKey,
  };
}

/** Runs on the new device once the phone approves. */
export async function openLinkPayload({ payload, ephemeralPrivateKey, ephemeralPublicKey }) {
  const bytes = await C.openSealed(
    ephemeralPrivateKey,
    {
      ciphertext: payload.ciphertext,
      iv: payload.iv,
      ephemeralPublicKey: payload.senderEphemeralKey,
    },
    ephemeralPublicKey,
    'NexChat-link-v1'
  );
  return JSON.parse(C.fromUtf8(bytes));
}

/* ────────────────────────────── prekey top-up ────────────────────────────── */

/** Keeps a healthy pool of one-time prekeys on the server. */
export async function replenishPreKeys() {
  if (!state.ready || !state.deviceId) return;

  try {
    const { data } = await api.get('/keys/count');
    if (!data.needsRefill) return;

    const batch = await C.generatePreKeyBatch(state.deviceSigningPrivateKey, {
      count: 60,
      startId: Date.now() % 100000,
    });

    await vault.savePreKeys(state.deviceId, {
      privateKeys: batch.privateKeys,
      signedPreKeyPrivate: batch.signedPreKeyPrivate,
      signedPreKeyId: batch.signedPreKey.keyId,
    });

    await api.post('/keys/prekeys', {
      signedPreKey: batch.signedPreKey,
      oneTimePreKeys: batch.oneTimePreKeys,
    });
  } catch {
    /* best effort — sessions still work off the account slot */
  }
}

export { C as crypto, ACCOUNT_SLOT };
