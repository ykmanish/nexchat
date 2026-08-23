'use client';

/**
 * NexChat client-side cryptography.
 *
 * Everything here runs in the browser. The server only ever receives public
 * keys and ciphertext — private keys never leave the device except during a
 * QR device-link, where they are sealed to the new device's ephemeral key.
 *
 *   · ECDH P-256      key agreement (X3DH-style handshake)
 *   · ECDSA P-256     signs prekeys so a swapped key is detectable
 *   · HKDF-SHA256     key derivation + the per-message symmetric ratchet
 *   · AES-GCM-256     message + attachment content
 *   · PBKDF2-SHA256   wraps the account identity under the user's password
 */

const subtle = () => {
  if (typeof window === 'undefined' || !window.crypto?.subtle) {
    throw new Error('Web Crypto is unavailable — NexChat needs HTTPS or localhost.');
  }
  return window.crypto.subtle;
};

const CURVE = { name: 'ECDH', namedCurve: 'P-256' };
const SIGN_CURVE = { name: 'ECDSA', namedCurve: 'P-256' };
const PBKDF2_ITERATIONS = 250_000;

/* ────────────────────────────── encoding ────────────────────────────── */

const enc = new TextEncoder();
const dec = new TextDecoder();

export function toB64(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function fromB64(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export const utf8 = (str) => enc.encode(str);
export const fromUtf8 = (bytes) => dec.decode(bytes);

export const randomBytes = (n) => window.crypto.getRandomValues(new Uint8Array(n));
export const randomId = () => toB64(randomBytes(18)).replace(/[+/=]/g, '').slice(0, 22);

function concat(...arrays) {
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}

/* ────────────────────────────── key pairs ────────────────────────────── */

export async function generateEcdhKeyPair() {
  return subtle().generateKey(CURVE, true, ['deriveBits']);
}

export async function generateSigningKeyPair() {
  return subtle().generateKey(SIGN_CURVE, true, ['sign', 'verify']);
}

export async function exportPublicKey(key) {
  return toB64(await subtle().exportKey('raw', key));
}

export async function exportPrivateKey(key) {
  return toB64(await subtle().exportKey('pkcs8', key));
}

export async function importEcdhPublic(b64) {
  return subtle().importKey('raw', fromB64(b64), CURVE, true, []);
}

export async function importEcdhPrivate(b64) {
  return subtle().importKey('pkcs8', fromB64(b64), CURVE, true, ['deriveBits']);
}

export async function importSigningPublic(b64) {
  return subtle().importKey('raw', fromB64(b64), SIGN_CURVE, true, ['verify']);
}

export async function importSigningPrivate(b64) {
  return subtle().importKey('pkcs8', fromB64(b64), SIGN_CURVE, true, ['sign']);
}

export async function sign(privateKey, data) {
  const bytes = typeof data === 'string' ? utf8(data) : data;
  const sig = await subtle().sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, bytes);
  return toB64(sig);
}

export async function verify(publicKey, signatureB64, data) {
  const bytes = typeof data === 'string' ? utf8(data) : data;
  return subtle().verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    publicKey,
    fromB64(signatureB64),
    bytes
  );
}

/* ────────────────────────────── derivation ────────────────────────────── */

async function ecdhBits(privateKey, publicKey) {
  return new Uint8Array(
    await subtle().deriveBits({ name: 'ECDH', public: publicKey }, privateKey, 256)
  );
}

export async function hkdf(ikm, { salt = new Uint8Array(32), info = '', bits = 256 } = {}) {
  const base = await subtle().importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(
    await subtle().deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt, info: typeof info === 'string' ? utf8(info) : info },
      base,
      bits
    )
  );
}

export async function importAesKey(rawBytes, usages = ['encrypt', 'decrypt']) {
  return subtle().importKey('raw', rawBytes, { name: 'AES-GCM', length: 256 }, false, usages);
}

export async function generateAesKey() {
  return randomBytes(32);
}

/* ────────────────────────────── symmetric ────────────────────────────── */

export async function aesEncrypt(rawKey, plaintext, aad) {
  const key = await importAesKey(rawKey, ['encrypt']);
  const iv = randomBytes(12);
  const data = typeof plaintext === 'string' ? utf8(plaintext) : plaintext;
  const params = { name: 'AES-GCM', iv, tagLength: 128 };
  if (aad) params.additionalData = typeof aad === 'string' ? utf8(aad) : aad;

  const ciphertext = await subtle().encrypt(params, key, data);
  return { ciphertext: toB64(ciphertext), iv: toB64(iv) };
}

export async function aesDecrypt(rawKey, ciphertextB64, ivB64, aad) {
  const key = await importAesKey(rawKey, ['decrypt']);
  const params = { name: 'AES-GCM', iv: fromB64(ivB64), tagLength: 128 };
  if (aad) params.additionalData = typeof aad === 'string' ? utf8(aad) : aad;

  const plain = await subtle().decrypt(params, key, fromB64(ciphertextB64));
  return new Uint8Array(plain);
}

export async function aesDecryptToString(rawKey, ciphertextB64, ivB64, aad) {
  return fromUtf8(await aesDecrypt(rawKey, ciphertextB64, ivB64, aad));
}

/* ──────────────────── password-wrapped account identity ──────────────────── */

async function deriveKek(password, salt, iterations = PBKDF2_ITERATIONS) {
  const base = await subtle().importKey('raw', utf8(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle().deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base,
    256
  );
  return new Uint8Array(bits);
}

/** Seals the account's private keys so only the password can reopen them. */
export async function wrapIdentity({ identityPrivateKey, signingPrivateKey }, password) {
  const salt = randomBytes(16);
  const kek = await deriveKek(password, salt);

  const payload = JSON.stringify({
    v: 1,
    identityPrivateKey: await exportPrivateKey(identityPrivateKey),
    signingPrivateKey: await exportPrivateKey(signingPrivateKey),
  });

  const { ciphertext, iv } = await aesEncrypt(kek, payload);
  return { ciphertext, iv, salt: toB64(salt), iterations: PBKDF2_ITERATIONS };
}

export async function unwrapIdentity(blob, password) {
  if (!blob?.ciphertext) throw new Error('No identity backup found for this account.');

  const kek = await deriveKek(password, fromB64(blob.salt), blob.iterations || PBKDF2_ITERATIONS);

  let json;
  try {
    json = JSON.parse(await aesDecryptToString(kek, blob.ciphertext, blob.iv));
  } catch {
    throw new Error('Wrong password — your keys could not be unlocked.');
  }

  return {
    identityPrivateKey: await importEcdhPrivate(json.identityPrivateKey),
    signingPrivateKey: await importSigningPrivate(json.signingPrivateKey),
    raw: json,
  };
}

/* ──────────── ECIES: seal to a public key with an ephemeral key ──────────── */

/** One-shot public-key encryption. Used for the account key slot and for the
 *  device-link handover, where there is no established session yet. */
export async function sealTo(recipientPublicKeyB64, plaintext, info = 'NexChat-seal-v1') {
  const recipient = await importEcdhPublic(recipientPublicKeyB64);
  const ephemeral = await generateEcdhKeyPair();

  const shared = await ecdhBits(ephemeral.privateKey, recipient);
  const ephemeralPublicKey = await exportPublicKey(ephemeral.publicKey);

  const key = await hkdf(shared, {
    salt: fromB64(recipientPublicKeyB64).slice(0, 32),
    info,
  });

  const { ciphertext, iv } = await aesEncrypt(key, plaintext);
  return { ciphertext, iv, ephemeralPublicKey };
}

export async function openSealed(myPrivateKey, sealed, myPublicKeyB64, info = 'NexChat-seal-v1') {
  const ephemeral = await importEcdhPublic(sealed.ephemeralPublicKey);
  const shared = await ecdhBits(myPrivateKey, ephemeral);

  const key = await hkdf(shared, {
    salt: fromB64(myPublicKeyB64).slice(0, 32),
    info,
  });

  return aesDecrypt(key, sealed.ciphertext, sealed.iv);
}

/* ──────────────────────────── X3DH-style handshake ──────────────────────────── */

const X3DH_INFO = 'NexChat-X3DH-v1';

/**
 * Sender side. Mixes four Diffie-Hellmans so the session is bound to both
 * long-term identities *and* to fresh, single-use key material.
 */
export async function initiateSession({
  myIdentityPrivate,
  theirIdentityPublic,
  theirSignedPreKeyPublic,
  theirOneTimePreKeyPublic,
}) {
  const ephemeral = await generateEcdhKeyPair();

  const [idPub, spkPub] = await Promise.all([
    importEcdhPublic(theirIdentityPublic),
    importEcdhPublic(theirSignedPreKeyPublic),
  ]);

  const dh1 = await ecdhBits(myIdentityPrivate, spkPub);
  const dh2 = await ecdhBits(ephemeral.privateKey, idPub);
  const dh3 = await ecdhBits(ephemeral.privateKey, spkPub);

  let material = concat(dh1, dh2, dh3);
  if (theirOneTimePreKeyPublic) {
    const otpPub = await importEcdhPublic(theirOneTimePreKeyPublic);
    material = concat(material, await ecdhBits(ephemeral.privateKey, otpPub));
  }

  const rootKey = await hkdf(material, { info: X3DH_INFO });

  return {
    rootKey,
    ephemeralPublicKey: await exportPublicKey(ephemeral.publicKey),
  };
}

/** Receiver side — reconstructs the same root from the header's ephemeral key. */
export async function acceptSession({
  myIdentityPrivate,
  mySignedPreKeyPrivate,
  myOneTimePreKeyPrivate,
  theirIdentityPublic,
  theirEphemeralPublic,
}) {
  const [idPub, ephPub] = await Promise.all([
    importEcdhPublic(theirIdentityPublic),
    importEcdhPublic(theirEphemeralPublic),
  ]);

  const dh1 = await ecdhBits(mySignedPreKeyPrivate, idPub);
  const dh2 = await ecdhBits(myIdentityPrivate, ephPub);
  const dh3 = await ecdhBits(mySignedPreKeyPrivate, ephPub);

  let material = concat(dh1, dh2, dh3);
  if (myOneTimePreKeyPrivate) {
    material = concat(material, await ecdhBits(myOneTimePreKeyPrivate, ephPub));
  }

  return { rootKey: await hkdf(material, { info: X3DH_INFO }) };
}

/* ──────────────────────────── symmetric ratchet ──────────────────────────── */

/**
 * Each direction of a session gets its own hash chain, labelled by the sending
 * device. Advancing is one-way, so a key recovered today cannot unlock
 * yesterday's messages.
 */
export async function chainRoot(rootKey, senderDeviceId) {
  return hkdf(rootKey, { info: 'chain|' + senderDeviceId });
}

async function step(chainKey, label) {
  return hkdf(chainKey, { info: label });
}

/** Walks the chain forward to `counter`, returning that message's key. */
export async function messageKeyAt(chainKey0, counter) {
  let ck = chainKey0;
  for (let i = 0; i < counter; i += 1) {
    ck = await step(ck, 'ratchet');
  }
  return { messageKey: await step(ck, 'message'), chainKey: ck };
}

/* ────────────────────────────── fingerprints ────────────────────────────── */

/** The 60-digit safety number two people can compare out of band. */
export async function safetyNumber(myIdentityPublicB64, theirIdentityPublicB64) {
  const pair = [myIdentityPublicB64, theirIdentityPublicB64].sort().join('|');
  const digest = new Uint8Array(await subtle().digest('SHA-512', utf8(pair)));

  let out = '';
  for (let i = 0; i < 30; i += 1) {
    out += (digest[i] % 10).toString();
    out += (digest[i + 30] % 10).toString();
  }
  return out.match(/.{1,5}/g).join(' ');
}

export async function shortFingerprint(publicKeyB64) {
  const digest = new Uint8Array(await subtle().digest('SHA-256', fromB64(publicKeyB64)));
  return Array.from(digest.slice(0, 6))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()
    .match(/.{1,4}/g)
    .join(' ');
}

/* ────────────────────────────── prekey batches ────────────────────────────── */

export async function generatePreKeyBatch(signingPrivateKey, { count = 60, startId = 1 } = {}) {
  const oneTimePreKeys = [];
  const privateKeys = {};

  for (let i = 0; i < count; i += 1) {
    const pair = await generateEcdhKeyPair();
    const keyId = startId + i;
    const publicKey = await exportPublicKey(pair.publicKey);
    oneTimePreKeys.push({ keyId, publicKey });
    privateKeys[keyId] = await exportPrivateKey(pair.privateKey);
  }

  const spkPair = await generateEcdhKeyPair();
  const spkPublic = await exportPublicKey(spkPair.publicKey);
  const signedPreKey = {
    keyId: Math.floor(Math.random() * 100000) + 1,
    publicKey: spkPublic,
    signature: await sign(signingPrivateKey, spkPublic),
  };

  return {
    oneTimePreKeys,
    privateKeys,
    signedPreKey,
    signedPreKeyPrivate: await exportPrivateKey(spkPair.privateKey),
  };
}

/** Rejects a bundle whose prekey isn't signed by the claimed identity. */
export async function verifyBundle(bundle, signingPublicKeyB64) {
  if (!bundle?.signedPreKey?.signature || !signingPublicKeyB64) return false;
  try {
    const key = await importSigningPublic(signingPublicKeyB64);
    return await verify(key, bundle.signedPreKey.signature, bundle.signedPreKey.publicKey);
  } catch {
    return false;
  }
}
