'use client';

import { api } from './api';
import { isSupported, unsupportedReason } from './webauthn';
import { toB64, fromB64, utf8 } from './crypto';
import * as C from './crypto';

/**
 * Passkey sign-in for the account.
 *
 * Distinct from the app lock, which is a local gate verified in the browser.
 * These credentials are verified by the server against a challenge it issued,
 * and they produce a real session.
 *
 * Authentication is the easy half. The hard half is that proving who you are
 * does not hand you the key to your own history: the account identity is sealed
 * under the password. Two ways out, and the code takes whichever is available:
 *
 *   - PRF. If the authenticator can derive a stable secret for this site, we
 *     wrap a second copy of the identity under it at enrolment. Signing in on a
 *     brand-new device then needs nothing but the sensor. The server stores that
 *     wrapped copy and can never open it, having no way to ask for the PRF.
 *   - The password, once. Older authenticators cannot do PRF, so the first sign-in
 *     on a new device asks for the account password and every later one on that
 *     device does not, because the identity is by then in the local vault.
 */

/* ─────────────────── option ↔ wire-format conversion ─────────────────── */

const b64urlToBytes = (value) => {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
};

const bytesToB64url = (buf) => {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 1) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

/** The server speaks base64url; `navigator.credentials` wants BufferSources. */
function inflateCreateOptions(options, prfSalt) {
  return {
    ...options,
    challenge: b64urlToBytes(options.challenge),
    user: { ...options.user, id: b64urlToBytes(options.user.id) },
    excludeCredentials: (options.excludeCredentials || []).map((c) => ({
      ...c,
      id: b64urlToBytes(c.id),
    })),
    // Asked for at creation so the authenticator reports whether it can do PRF;
    // the value itself is only evaluated on assertion.
    extensions: { ...(options.extensions || {}), prf: { eval: { first: utf8(prfSalt) } } },
  };
}

function inflateGetOptions(options, prfSalt) {
  return {
    ...options,
    challenge: b64urlToBytes(options.challenge),
    allowCredentials: (options.allowCredentials || []).map((c) => ({
      ...c,
      id: b64urlToBytes(c.id),
    })),
    extensions: { ...(options.extensions || {}), prf: { eval: { first: utf8(prfSalt) } } },
  };
}

/**
 * Flattens a credential for the wire. Hand-rolled rather than pulled from a
 * helper library because the PRF results are ArrayBuffers that a generic
 * JSON serialiser drops on the floor — and those are the whole point here.
 */
function deflateCredential(credential) {
  const r = credential.response;
  const out = {
    id: credential.id,
    rawId: bytesToB64url(credential.rawId),
    type: credential.type,
    authenticatorAttachment: credential.authenticatorAttachment || null,
    clientExtensionResults: {},
    response: { clientDataJSON: bytesToB64url(r.clientDataJSON) },
  };

  if (r.attestationObject) {
    out.response.attestationObject = bytesToB64url(r.attestationObject);
    out.response.transports = r.getTransports?.() || [];
    out.response.publicKeyAlgorithm = r.getPublicKeyAlgorithm?.();
    const spki = r.getPublicKey?.();
    if (spki) out.response.publicKey = bytesToB64url(spki);
  } else {
    out.response.authenticatorData = bytesToB64url(r.authenticatorData);
    out.response.signature = bytesToB64url(r.signature);
    out.response.userHandle = r.userHandle ? bytesToB64url(r.userHandle) : null;
  }

  // Only the shape the server cares about; the PRF bytes stay in this process.
  const ext = credential.getClientExtensionResults?.() || {};
  if (ext.prf) out.clientExtensionResults.prf = { enabled: !!ext.prf.enabled };

  return out;
}

/** The PRF output, as raw bytes, or null when the authenticator has none. */
const prfSecret = (credential) => {
  const first = credential.getClientExtensionResults?.()?.prf?.results?.first;
  return first ? new Uint8Array(first) : null;
};

/* ───────────────────── wrapping the identity under PRF ───────────────────── */

/**
 * Same job as the password wrapper in crypto.js, with the PRF output standing in
 * for the password. HKDF rather than PBKDF2: the input is already 32 bytes of
 * authenticator-derived randomness, so stretching it hundreds of thousands of
 * times would only cost the user time.
 */
async function keyFromPrf(secret, salt) {
  const bits = await C.hkdf(secret, { salt, info: 'chax-passkey-identity-v1', bits: 256 });
  return crypto.subtle.importKey('raw', bits, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function wrapIdentityWithPrf(secret, rawIdentity) {
  const salt = C.randomBytes(16);
  const iv = C.randomBytes(12);
  const key = await keyFromPrf(secret, salt);

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    utf8(JSON.stringify(rawIdentity))
  );

  return { ciphertext: toB64(ciphertext), iv: toB64(iv), salt: toB64(salt) };
}

async function unwrapIdentityWithPrf(secret, wrapper) {
  const key = await keyFromPrf(secret, fromB64(wrapper.salt));
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(wrapper.iv) },
    key,
    fromB64(wrapper.ciphertext)
  );
  return JSON.parse(new TextDecoder().decode(plain));
}

/* ──────────────────────────── capability ──────────────────────────── */

export { isSupported, unsupportedReason };

/* ──────────────────────────── enrolment ──────────────────────────── */

/**
 * Adds a passkey to the signed-in account.
 *
 * `rawIdentity` is the unwrapped account key material — `{ identityPrivateKey,
 * signingPrivateKey }` as base64, exactly what unwrapIdentity returns in `raw`.
 * Passing it is what makes the passkey able to unlock history later; without it
 * the passkey still signs in, it just cannot skip the password on a new device.
 */
export async function enrol({ name, rawIdentity = null } = {}) {
  if (!isSupported()) throw new Error(unsupportedReason() || 'Not supported in this browser');

  const { data } = await api.post('/auth/passkeys/register/options');

  let credential;
  try {
    credential = await navigator.credentials.create({
      publicKey: inflateCreateOptions(data.options, data.prfSalt),
    });
  } catch (err) {
    throw new Error(describe(err, 'Setup'));
  }
  if (!credential) throw new Error('Setup was cancelled');

  // Whether PRF is *available* is known now; the value is not, because create()
  // does not evaluate it. So enrolment asks for one assertion straight after to
  // fetch the secret and seal the identity with it.
  const prfCapable = !!credential.getClientExtensionResults?.()?.prf?.enabled;

  let identityWrapper = null;
  if (prfCapable && rawIdentity) {
    identityWrapper = await sealIdentityForCredential(credential.rawId, data.prfSalt, rawIdentity);
  }

  const { data: saved } = await api.post('/auth/passkeys/register/verify', {
    credential: deflateCredential(credential),
    name,
    identityWrapper,
  });

  return { ...saved.passkey, prfCapable };
}

/**
 * Evaluates the PRF for a credential we have just created, and seals the
 * identity under the result. One extra sensor touch, in exchange for never
 * needing the password on a new device.
 */
async function sealIdentityForCredential(rawId, prfSalt, rawIdentity) {
  try {
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge: C.randomBytes(32), // local only — nothing verifies this one
        allowCredentials: [{ type: 'public-key', id: new Uint8Array(rawId) }],
        userVerification: 'required',
        extensions: { prf: { eval: { first: utf8(prfSalt) } } },
      },
    });

    const secret = prfSecret(assertion);
    if (!secret) return null;
    return wrapIdentityWithPrf(secret, rawIdentity);
  } catch {
    // A refused or unsupported PRF is not a failed enrolment — the passkey is
    // already made and still signs in. It just falls back to the password.
    return null;
  }
}

/* ──────────────────────────── signing in ──────────────────────────── */

/**
 * First half of a passkey sign-in: prove who you are.
 *
 * Returns the ticket plus whatever is needed to unlock the identity. When
 * `identity` comes back non-null the PRF did its job and no password is needed;
 * otherwise the caller has to ask for one and use `encryptedIdentity`.
 */
export async function authenticate() {
  if (!isSupported()) throw new Error(unsupportedReason() || 'Not supported in this browser');

  const { data } = await api.post('/auth/passkeys/login/options');

  let assertion;
  try {
    assertion = await navigator.credentials.get({
      publicKey: inflateGetOptions(data.options, data.prfSalt),
    });
  } catch (err) {
    throw new Error(describe(err, 'Sign-in'));
  }
  if (!assertion) throw new Error('Sign-in was cancelled');

  const secret = prfSecret(assertion);

  const { data: verified } = await api.post('/auth/passkeys/login/verify', {
    credential: deflateCredential(assertion),
  });

  let identity = null;
  if (secret && verified.identityWrapper) {
    try {
      identity = await unwrapIdentityWithPrf(secret, verified.identityWrapper);
    } catch {
      // A wrapper that will not open is not fatal; the password path still works
      // and is what the caller falls back to.
      identity = null;
    }
  }

  return {
    ticket: verified.ticket,
    account: verified.account,
    encryptedIdentity: verified.encryptedIdentity,
    /** Raw `{ identityPrivateKey, signingPrivateKey }`, or null. */
    identity,
    needsPassword: !identity,
  };
}

/** Second half: hand back device keys and take the session. */
export async function complete({ ticket, keys, device }) {
  const { data } = await api.post('/auth/passkeys/login/complete', { ticket, keys, device });
  return data;
}

/* ──────────────────────────── management ──────────────────────────── */

export const list = async () => (await api.get('/auth/passkeys')).data.passkeys;

export const rename = async (id, name) =>
  (await api.patch('/auth/passkeys/' + id, { name })).data.passkey;

export const remove = async (id) => (await api.delete('/auth/passkeys/' + id)).data;

/* ─────────────────────────────── errors ─────────────────────────────── */

function describe(err, verb) {
  const name = err?.name;
  if (name === 'NotAllowedError') return verb + ' was cancelled or timed out';
  if (name === 'InvalidStateError') return 'This device already has a passkey for that account';
  if (name === 'NotSupportedError') return 'This device cannot make a passkey';
  if (name === 'SecurityError') return 'Blocked by the browser on this address';
  return err?.message || verb + ' failed';
}
