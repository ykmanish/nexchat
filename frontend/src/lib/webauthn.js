'use client';

/**
 * WebAuthn, used as a local unlock gesture for the app lock.
 *
 * The app lock is a device-side gate — there is no server in this loop, so the
 * usual "send the challenge to the backend and verify it there" shape does not
 * apply. What we do instead is register a credential, keep its public key in
 * the vault, and verify the assertion signature *here* with WebCrypto before
 * letting the lock screen go. That is weaker than server-side WebAuthn (a
 * determined owner of the device can always reach the code that decides), but
 * it is exactly as strong as a native app's biometric gate: the authenticator
 * will not sign anything until the fingerprint, face or device PIN checks out,
 * and we refuse assertions that were not user-verified.
 *
 * Two flavours, both plain WebAuthn underneath:
 *   - 'biometric' — a platform authenticator (Touch ID, Windows Hello, Android
 *     biometrics). Bound to this device, not discoverable, invisible in the
 *     user's passkey list.
 *   - 'passkey' — a discoverable credential, so a phone or a security key can
 *     unlock the app too.
 */

const RP_NAME = 'Chax';
const TIMEOUT = 60_000;

/* ES256 first: every platform authenticator speaks it and the signatures are
   64 bytes rather than 256. RS256 is the fallback for older Windows Hello. */
const ALGORITHMS = [
  { type: 'public-key', alg: -7 },
  { type: 'public-key', alg: -257 },
];

/* ───────────────────────────── byte wrangling ───────────────────────────── */

const b64url = (buf) => {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 1) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const fromB64url = (value) => {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
};

const randomBytes = (n) => crypto.getRandomValues(new Uint8Array(n));

const concat = (a, b) => {
  const out = new Uint8Array(a.byteLength + b.byteLength);
  out.set(new Uint8Array(a), 0);
  out.set(new Uint8Array(b), a.byteLength);
  return out;
};

/**
 * WebAuthn hands back ECDSA signatures as ASN.1 DER; WebCrypto wants the raw
 * r‖s pair. Nothing else in the stack needs this, so it lives here.
 */
function derToRaw(der) {
  const d = new Uint8Array(der);
  if (d[0] !== 0x30) throw new Error('Malformed signature');

  let i = 2;
  if (d[1] & 0x80) i += d[1] & 0x7f; // long-form length header

  const readInt = () => {
    if (d[i] !== 0x02) throw new Error('Malformed signature');
    i += 1;
    const len = d[i];
    i += 1;
    let value = d.slice(i, i + len);
    i += len;
    // DER keeps a leading 0x00 on values that would otherwise look negative.
    while (value.length > 32 && value[0] === 0) value = value.slice(1);
    const padded = new Uint8Array(32);
    padded.set(value, 32 - value.length);
    return padded;
  };

  const r = readInt();
  const s = readInt();
  const raw = new Uint8Array(64);
  raw.set(r, 0);
  raw.set(s, 32);
  return raw;
}

/* ─────────────────────────────── capability ─────────────────────────────── */

export function isSupported() {
  return (
    typeof window !== 'undefined' &&
    !!window.PublicKeyCredential &&
    !!navigator.credentials?.create &&
    window.isSecureContext
  );
}

/** True when this device can verify a fingerprint or face itself. */
export async function hasPlatformAuthenticator() {
  if (!isSupported()) return false;
  try {
    return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

/** Why the browser cannot offer WebAuthn at all, in words a person can act on. */
export function unsupportedReason() {
  if (typeof window === 'undefined') return null;
  if (!window.isSecureContext) return 'Needs a secure (https) connection';
  if (!window.PublicKeyCredential) return 'Not supported in this browser';
  return null;
}

/** Turns the DOMExceptions WebAuthn throws into something worth showing. */
function describe(err, verb) {
  const name = err?.name;
  if (name === 'NotAllowedError') return `${verb} was cancelled or timed out`;
  if (name === 'InvalidStateError') return 'That authenticator is already set up';
  if (name === 'NotSupportedError') return 'This device cannot do that';
  if (name === 'SecurityError') return 'Blocked by the browser on this address';
  if (name === 'AbortError') return `${verb} was cancelled`;
  return err?.message || `${verb} failed`;
}

/* ───────────────────────────── authenticatorData ────────────────────────── */

const UV_FLAG = 0x04;

/** The one byte we care about: did the authenticator actually verify the user? */
function userVerified(authenticatorData) {
  if (!authenticatorData) return false;
  const flags = new Uint8Array(authenticatorData)[32];
  return (flags & UV_FLAG) !== 0;
}

/* ─────────────────────────────── registration ───────────────────────────── */

/**
 * Creates a credential and returns the record to keep in the vault.
 * `existing` is the list of already-registered records, so the same
 * authenticator cannot be enrolled twice.
 */
export async function register({ kind, user, existing = [] }) {
  if (!isSupported()) throw new Error(unsupportedReason() || 'Not supported in this browser');

  const biometric = kind === 'biometric';

  const options = {
    challenge: randomBytes(32),
    rp: { name: RP_NAME }, // no id — the browser uses this origin's domain
    user: {
      // A stable handle keeps a re-registration replacing the old credential
      // rather than piling up entries in the user's passkey manager.
      id: new TextEncoder().encode(user?.id || 'chax-app-lock'),
      name: user?.name || 'Chax app lock',
      displayName: user?.displayName || user?.name || 'Chax',
    },
    pubKeyCredParams: ALGORITHMS,
    authenticatorSelection: {
      // A lock that only proves "someone touched the laptop" is not a lock.
      userVerification: 'required',
      ...(biometric
        ? { authenticatorAttachment: 'platform', residentKey: 'discouraged' }
        : { residentKey: 'required' }),
    },
    excludeCredentials: existing.map((c) => ({
      type: 'public-key',
      id: fromB64url(c.id),
      ...(c.transports?.length ? { transports: c.transports } : {}),
    })),
    attestation: 'none', // we trust the device, not a manufacturer certificate
    timeout: TIMEOUT,
  };

  let credential;
  try {
    credential = await navigator.credentials.create({ publicKey: options });
  } catch (err) {
    throw new Error(describe(err, 'Setup'));
  }
  if (!credential) throw new Error('Setup was cancelled');

  const response = credential.response;
  const spki = response.getPublicKey?.();
  const authData = response.getAuthenticatorData?.();

  return {
    id: b64url(credential.rawId),
    kind,
    // Without getPublicKey() (pre-2021 browsers) we cannot check signatures, so
    // the unlock falls back to matching the credential id and the UV flag.
    alg: response.getPublicKeyAlgorithm?.() ?? null,
    publicKey: spki ? b64url(spki) : null,
    transports: response.getTransports?.() || [],
    // getAuthenticatorData() is newer than the rest; if it is missing, trust
    // that the authenticator honoured userVerification: 'required'.
    userVerified: authData ? userVerified(authData) : true,
    createdAt: Date.now(),
  };
}

/* ──────────────────────────────── assertion ─────────────────────────────── */

async function verifySignature(record, { authenticatorData, clientDataJSON, signature }) {
  if (!record.publicKey || !record.alg) return true; // see the note in register()

  const spki = fromB64url(record.publicKey);
  const hash = await crypto.subtle.digest('SHA-256', clientDataJSON);
  const signed = concat(authenticatorData, hash);

  if (record.alg === -7) {
    const key = await crypto.subtle.importKey(
      'spki',
      spki,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify']
    );
    return crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      derToRaw(signature),
      signed
    );
  }

  if (record.alg === -257) {
    const key = await crypto.subtle.importKey(
      'spki',
      spki,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify']
    );
    return crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, signed);
  }

  return false; // an algorithm we never asked for
}

/**
 * Asks for one of `records` and checks the result end to end: the credential is
 * one of ours, the client data echoes our challenge and origin, the user was
 * verified, and the signature holds. Throws with a readable message otherwise.
 */
export async function assert(records = []) {
  if (!isSupported()) throw new Error(unsupportedReason() || 'Not supported in this browser');
  if (!records.length) throw new Error('Nothing is set up on this device');

  const challenge = randomBytes(32);

  let assertion;
  try {
    assertion = await navigator.credentials.get({
      publicKey: {
        challenge,
        // Naming the ids covers both flavours: platform credentials are not
        // discoverable so they have to be listed, and listing a passkey still
        // gets the phone-or-security-key flow via its transport hints. Leaving
        // this empty would also let a stale passkey for this origin be picked,
        // which we would then have to reject.
        allowCredentials: records.map((r) => ({
          type: 'public-key',
          id: fromB64url(r.id),
          ...(r.transports?.length ? { transports: r.transports } : {}),
        })),
        userVerification: 'required',
        timeout: TIMEOUT,
      },
    });
  } catch (err) {
    throw new Error(describe(err, 'Unlock'));
  }
  if (!assertion) throw new Error('Unlock was cancelled');

  const used = b64url(assertion.rawId);
  const record = records.find((r) => r.id === used);
  if (!record) throw new Error('That is not the credential set up here');

  const { authenticatorData, clientDataJSON, signature } = assertion.response;

  const client = JSON.parse(new TextDecoder().decode(clientDataJSON));
  if (client.type !== 'webauthn.get') throw new Error('Unexpected response');
  if (client.challenge !== b64url(challenge)) throw new Error('Challenge did not match');
  if (client.origin !== window.location.origin) throw new Error('Origin did not match');

  if (!userVerified(authenticatorData)) throw new Error('Fingerprint or PIN was not checked');

  const ok = await verifySignature(record, { authenticatorData, clientDataJSON, signature });
  if (!ok) throw new Error('Signature did not verify');

  return record;
}
