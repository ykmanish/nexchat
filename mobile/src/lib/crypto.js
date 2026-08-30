/**
 * Chax client-side cryptography, native edition.
 *
 * This is a re-implementation of the web client's `lib/crypto.js` against
 * @noble rather than Web Crypto, which React Native does not have. Every
 * function here has to produce **byte-identical output** to the browser
 * version: the same account is used from both, the server stores key material
 * minted by either, and a mismatch anywhere shows up as history that will not
 * decrypt rather than as an error. `scripts/crypto-parity.test.mjs` pins that
 * down by running both implementations side by side against Node's WebCrypto.
 *
 * The mapping:
 *
 *   Web Crypto                        here
 *   ─────────────────────────────     ───────────────────────────────────
 *   ECDH P-256 deriveBits(256)        p256.getSharedSecret(...).slice(1)
 *   ECDSA P-256 / SHA-256             p256.sign(sha256(m)) compact r‖s
 *   HKDF-SHA256                       @noble/hashes/hkdf
 *   AES-GCM-256 (128-bit tag)         @noble/ciphers gcm
 *   PBKDF2-SHA256 250k                @noble/hashes/pbkdf2
 *   exportKey('raw')                  65-byte uncompressed point
 *   exportKey('pkcs8')                DER, encoded below
 *
 * Keys are plain byte arrays rather than CryptoKey handles: a private key is
 * its 32-byte scalar, a public key its 65-byte uncompressed point.
 */

import { p256 } from '@noble/curves/p256';
import { sha256 } from '@noble/hashes/sha256';
import { sha512 } from '@noble/hashes/sha512';
import { hkdf as nobleHkdf } from '@noble/hashes/hkdf';
import { pbkdf2Async } from '@noble/hashes/pbkdf2';
import { gcm } from '@noble/ciphers/aes';

const PBKDF2_ITERATIONS = 250_000;

/* ────────────────────────────── encoding ────────────────────────────── */

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_LOOKUP = (() => {
  const table = new Uint8Array(256).fill(255);
  for (let i = 0; i < B64.length; i += 1) table[B64.charCodeAt(i)] = i;
  return table;
})();

export function toB64(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let out = '';

  for (let i = 0; i < bytes.length; i += 3) {
    const remaining = bytes.length - i;
    const a = bytes[i];
    const b = remaining > 1 ? bytes[i + 1] : 0;
    const c = remaining > 2 ? bytes[i + 2] : 0;

    out += B64[a >> 2];
    out += B64[((a & 3) << 4) | (b >> 4)];
    out += remaining > 1 ? B64[((b & 15) << 2) | (c >> 6)] : '=';
    out += remaining > 2 ? B64[c & 63] : '=';
  }
  return out;
}

export function fromB64(b64) {
  const clean = String(b64).replace(/[^A-Za-z0-9+/]/g, '');
  const len = Math.floor((clean.length * 3) / 4);
  const out = new Uint8Array(len);

  let byte = 0;
  let bits = 0;
  let written = 0;

  for (let i = 0; i < clean.length; i += 1) {
    const value = B64_LOOKUP[clean.charCodeAt(i)];
    if (value === 255) continue;
    byte = (byte << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[written] = (byte >> bits) & 0xff;
      written += 1;
    }
  }
  return written === len ? out : out.subarray(0, written);
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const utf8 = (str) => encoder.encode(str);
export const fromUtf8 = (bytes) => decoder.decode(bytes);

/**
 * Randomness comes from the platform CSPRNG.
 *
 * `polyfills.js` points `globalThis.crypto.getRandomValues` at expo-crypto,
 * which is Android's SecureRandom. Node supplies its own, so the parity test
 * and the app draw from equally sound sources.
 */
export const randomBytes = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));

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

/* ──────────────────────────── PKCS#8 for P-256 ──────────────────────────── */

/**
 * Web Crypto hands private keys out as PKCS#8 DER, and those bytes are what
 * ends up in the password-wrapped identity blob on the server — the one a
 * browser has to be able to open. So the format is not ours to choose.
 *
 * P-256 makes it a fixed layout, identical for ECDH and ECDSA because both use
 * the id-ecPublicKey OID, so the whole thing is a template with the scalar and
 * the point spliced in:
 *
 *   SEQUENCE                                   30 81 87
 *     INTEGER 0                                02 01 00
 *     SEQUENCE                                 30 13
 *       OID id-ecPublicKey                     06 07 2a8648ce3d0201
 *       OID prime256v1                         06 08 2a8648ce3d030107
 *     OCTET STRING                             04 6d
 *       SEQUENCE  (RFC 5915 ECPrivateKey)      30 6b
 *         INTEGER 1                            02 01 01
 *         OCTET STRING  scalar                 04 20 <32 bytes>
 *         [1] BIT STRING  public point         a1 44 03 42 00 <65 bytes>
 */
const PKCS8_PREFIX = new Uint8Array([
  0x30, 0x81, 0x87, 0x02, 0x01, 0x00, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02,
  0x01, 0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x04, 0x6d, 0x30, 0x6b, 0x02,
  0x01, 0x01, 0x04, 0x20,
]);
const PKCS8_MID = new Uint8Array([0xa1, 0x44, 0x03, 0x42, 0x00]);

function encodePkcs8(scalar, point) {
  if (scalar.length !== 32) throw new Error('Bad private scalar length');
  if (point.length !== 65) throw new Error('Bad public point length');
  return concat(PKCS8_PREFIX, scalar, PKCS8_MID, point);
}

/**
 * Pulls the scalar back out.
 *
 * Deliberately tolerant of layout rather than assuming our own template: a key
 * wrapped by a browser is normally byte-for-byte the above, but an
 * implementation that omits the optional public point produces a shorter,
 * equally valid encoding, and refusing that would lock someone out of their own
 * account. So it walks the DER for the ECPrivateKey's `04 20` scalar instead.
 */
function decodePkcs8(der) {
  // The RFC 5915 body always opens `02 01 01 04 20` — version 1 followed by the
  // 32-byte scalar — and that sequence cannot occur in the fixed prelude.
  for (let i = 0; i + 37 <= der.length; i += 1) {
    if (
      der[i] === 0x02 &&
      der[i + 1] === 0x01 &&
      der[i + 2] === 0x01 &&
      der[i + 3] === 0x04 &&
      der[i + 4] === 0x20
    ) {
      return der.slice(i + 5, i + 37);
    }
  }
  throw new Error('Unrecognised private key encoding');
}

/* ────────────────────────────── key pairs ────────────────────────────── */

function keyPair() {
  const privateKey = p256.utils.randomPrivateKey();
  return { privateKey, publicKey: p256.getPublicKey(privateKey, false) };
}

export async function generateEcdhKeyPair() {
  return keyPair();
}

export async function generateSigningKeyPair() {
  return keyPair();
}

export async function exportPublicKey(key) {
  // Accepts either a key pair or a bare point, mirroring how the web version
  // is called with `pair.publicKey`.
  const point = key?.publicKey || key;
  return toB64(point);
}

export async function exportPrivateKey(key) {
  const scalar = key?.privateKey || key;
  return toB64(encodePkcs8(scalar, p256.getPublicKey(scalar, false)));
}

export async function importEcdhPublic(b64) {
  const bytes = fromB64(b64);
  // Throws on a point that is not on the curve, which is the check that stops a
  // malicious "public key" from leaking bits of our private one.
  p256.Point.fromHex(bytes).assertValidity();
  return bytes;
}

export async function importEcdhPrivate(b64) {
  return decodePkcs8(fromB64(b64));
}

export const importSigningPublic = importEcdhPublic;
export const importSigningPrivate = importEcdhPrivate;

export async function sign(privateKey, data) {
  const bytes = typeof data === 'string' ? utf8(data) : data;
  const scalar = privateKey?.privateKey || privateKey;
  return toB64(p256.sign(sha256(bytes), scalar).toCompactRawBytes());
}

export async function verify(publicKey, signatureB64, data) {
  const bytes = typeof data === 'string' ? utf8(data) : data;
  const point = publicKey?.publicKey || publicKey;
  try {
    return p256.verify(fromB64(signatureB64), sha256(bytes), point);
  } catch {
    return false;
  }
}

/* ────────────────────────────── derivation ────────────────────────────── */

/**
 * ECDH agreement, trimmed to match Web Crypto.
 *
 * `deriveBits(…, 256)` yields the raw X coordinate. noble returns a compressed
 * point, so the leading 0x02/0x03 parity byte comes off — forgetting that shift
 * would produce a shared secret that differs from the browser's by one byte and
 * silently break every cross-client session.
 */
function ecdhBits(privateKey, publicKey) {
  const scalar = privateKey?.privateKey || privateKey;
  const point = publicKey?.publicKey || publicKey;
  return p256.getSharedSecret(scalar, point, true).slice(1);
}

export async function hkdf(ikm, { salt = new Uint8Array(32), info = '', bits = 256 } = {}) {
  return nobleHkdf(
    sha256,
    ikm,
    salt,
    typeof info === 'string' ? utf8(info) : info,
    bits / 8
  );
}

export async function generateAesKey() {
  return randomBytes(32);
}

/* ────────────────────────────── symmetric ────────────────────────────── */

export async function aesEncrypt(rawKey, plaintext, aad) {
  const iv = randomBytes(12);
  const data = typeof plaintext === 'string' ? utf8(plaintext) : plaintext;
  const aadBytes = aad ? (typeof aad === 'string' ? utf8(aad) : aad) : undefined;

  const ciphertext = gcm(rawKey, iv, aadBytes).encrypt(data);
  return { ciphertext: toB64(ciphertext), iv: toB64(iv) };
}

export async function aesDecrypt(rawKey, ciphertextB64, ivB64, aad) {
  const aadBytes = aad ? (typeof aad === 'string' ? utf8(aad) : aad) : undefined;
  return gcm(rawKey, fromB64(ivB64), aadBytes).decrypt(fromB64(ciphertextB64));
}

export async function aesDecryptToString(rawKey, ciphertextB64, ivB64, aad) {
  return fromUtf8(await aesDecrypt(rawKey, ciphertextB64, ivB64, aad));
}

/* ──────────────────── password-wrapped account identity ──────────────────── */

/**
 * 250 000 SHA-256 iterations is meaningfully slower here than in a browser,
 * because this runs in JS rather than in the engine's native crypto. It is
 * still the right number — lowering it would weaken every existing account,
 * and it is paid once, on sign-in, behind a spinner. `pbkdf2Async` yields
 * between blocks so the UI thread keeps painting while it works.
 */
async function deriveKek(password, salt, iterations = PBKDF2_ITERATIONS) {
  return pbkdf2Async(sha256, utf8(password), salt, { c: iterations, dkLen: 32 });
}

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

export async function sealTo(recipientPublicKeyB64, plaintext, info = 'NexChat-seal-v1') {
  const recipient = await importEcdhPublic(recipientPublicKeyB64);
  const ephemeral = keyPair();

  const shared = ecdhBits(ephemeral.privateKey, recipient);

  const key = await hkdf(shared, {
    salt: fromB64(recipientPublicKeyB64).slice(0, 32),
    info,
  });

  const { ciphertext, iv } = await aesEncrypt(key, plaintext);
  return { ciphertext, iv, ephemeralPublicKey: toB64(ephemeral.publicKey) };
}

export async function openSealed(myPrivateKey, sealed, myPublicKeyB64, info = 'NexChat-seal-v1') {
  const ephemeral = await importEcdhPublic(sealed.ephemeralPublicKey);
  const shared = ecdhBits(myPrivateKey, ephemeral);

  const key = await hkdf(shared, {
    salt: fromB64(myPublicKeyB64).slice(0, 32),
    info,
  });

  return aesDecrypt(key, sealed.ciphertext, sealed.iv);
}

/* ──────────────────────── X3DH-style handshake ──────────────────────── */

const X3DH_INFO = 'NexChat-X3DH-v1';

export async function initiateSession({
  myIdentityPrivate,
  theirIdentityPublic,
  theirSignedPreKeyPublic,
  theirOneTimePreKeyPublic,
}) {
  const ephemeral = keyPair();

  const idPub = await importEcdhPublic(theirIdentityPublic);
  const spkPub = await importEcdhPublic(theirSignedPreKeyPublic);

  const dh1 = ecdhBits(myIdentityPrivate, spkPub);
  const dh2 = ecdhBits(ephemeral.privateKey, idPub);
  const dh3 = ecdhBits(ephemeral.privateKey, spkPub);

  let material = concat(dh1, dh2, dh3);
  if (theirOneTimePreKeyPublic) {
    const otpPub = await importEcdhPublic(theirOneTimePreKeyPublic);
    material = concat(material, ecdhBits(ephemeral.privateKey, otpPub));
  }

  const rootKey = await hkdf(material, { info: X3DH_INFO });

  return { rootKey, ephemeralPublicKey: toB64(ephemeral.publicKey) };
}

export async function acceptSession({
  myIdentityPrivate,
  mySignedPreKeyPrivate,
  myOneTimePreKeyPrivate,
  theirIdentityPublic,
  theirEphemeralPublic,
}) {
  const idPub = await importEcdhPublic(theirIdentityPublic);
  const ephPub = await importEcdhPublic(theirEphemeralPublic);

  const dh1 = ecdhBits(mySignedPreKeyPrivate, idPub);
  const dh2 = ecdhBits(myIdentityPrivate, ephPub);
  const dh3 = ecdhBits(mySignedPreKeyPrivate, ephPub);

  let material = concat(dh1, dh2, dh3);
  if (myOneTimePreKeyPrivate) {
    material = concat(material, ecdhBits(myOneTimePreKeyPrivate, ephPub));
  }

  return { rootKey: await hkdf(material, { info: X3DH_INFO }) };
}

/* ──────────────────────────── symmetric ratchet ──────────────────────────── */

export async function chainRoot(rootKey, senderDeviceId) {
  return hkdf(rootKey, { info: 'chain|' + senderDeviceId });
}

async function step(chainKey, label) {
  return hkdf(chainKey, { info: label });
}

export async function messageKeyAt(chainKey0, counter) {
  let ck = chainKey0;
  for (let i = 0; i < counter; i += 1) {
    ck = await step(ck, 'ratchet');
  }
  return { messageKey: await step(ck, 'message'), chainKey: ck };
}

/* ────────────────────────────── fingerprints ────────────────────────────── */

export async function safetyNumber(myIdentityPublicB64, theirIdentityPublicB64) {
  const pair = [myIdentityPublicB64, theirIdentityPublicB64].sort().join('|');
  const digest = sha512(utf8(pair));

  let out = '';
  for (let i = 0; i < 30; i += 1) {
    out += (digest[i] % 10).toString();
    out += (digest[i + 30] % 10).toString();
  }
  return out.match(/.{1,5}/g).join(' ');
}

export async function shortFingerprint(publicKeyB64) {
  const digest = sha256(fromB64(publicKeyB64));
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
    const pair = keyPair();
    const keyId = startId + i;
    oneTimePreKeys.push({ keyId, publicKey: toB64(pair.publicKey) });
    privateKeys[keyId] = await exportPrivateKey(pair.privateKey);
  }

  const spkPair = keyPair();
  const spkPublic = toB64(spkPair.publicKey);
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

export async function verifyBundle(bundle, signingPublicKeyB64) {
  if (!bundle?.signedPreKey?.signature || !signingPublicKeyB64) return false;
  try {
    const key = await importSigningPublic(signingPublicKeyB64);
    return await verify(key, bundle.signedPreKey.signature, bundle.signedPreKey.publicKey);
  } catch {
    return false;
  }
}
