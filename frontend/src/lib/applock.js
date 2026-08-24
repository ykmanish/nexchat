'use client';

import { vault } from './vault';
import * as webauthn from './webauthn';

/**
 * App lock — a local PIN in front of the app.
 *
 * This is a device-side lock, not an account credential: it never leaves the
 * browser and the server knows nothing about it. It stops someone who picks up
 * an unlocked laptop, which is exactly what it claims to do. It does *not*
 * protect the message cache from someone with access to the disk.
 *
 * A fingerprint (platform authenticator) or a passkey can be registered as a
 * faster way past the same gate — see ./webauthn. The PIN is still the thing
 * being set up, and it always keeps working, so a lost or reset authenticator
 * never locks anyone out of their own device.
 */

const META_KEY = 'appLock';
const ITERATIONS = 150_000;

const enc = new TextEncoder();

const toB64 = (buf) => {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 1) s += String.fromCharCode(bytes[i]);
  return btoa(s);
};

const fromB64 = (b64) => {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
};

async function derive(pin, salt) {
  const base = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    base,
    256
  );
  return toB64(bits);
}

/** Timing-safe-ish comparison; both strings are the same length by construction. */
function equal(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const AUTO_LOCK_OPTIONS = [
  { value: 0, label: 'Immediately' },
  { value: 60, label: 'After 1 minute' },
  { value: 300, label: 'After 5 minutes' },
  { value: 900, label: 'After 15 minutes' },
  { value: 3600, label: 'After 1 hour' },
];

export const appLock = {
  async config() {
    return (await vault.getMeta(META_KEY)) || null;
  },

  async isEnabled() {
    const cfg = await vault.getMeta(META_KEY);
    return !!cfg?.hash;
  },

  async enable(pin, { autoLockSeconds = 300 } = {}) {
    if (!/^\d{4,8}$/.test(pin)) throw new Error('Choose a PIN of 4 to 8 digits');

    // Changing the PIN goes through here too, so keep whatever authenticators
    // are already registered instead of silently dropping them.
    const existing = await vault.getMeta(META_KEY);
    const salt = crypto.getRandomValues(new Uint8Array(16));
    await vault.setMeta(META_KEY, {
      hash: await derive(pin, salt),
      salt: toB64(salt),
      autoLockSeconds,
      credentials: existing?.credentials || [],
      failedAttempts: 0,
      lockedAt: Date.now(),
    });
  },

  async disable() {
    await vault.setMeta(META_KEY, null);
  },

  async setAutoLock(seconds) {
    const cfg = await vault.getMeta(META_KEY);
    if (!cfg) return;
    await vault.setMeta(META_KEY, { ...cfg, autoLockSeconds: seconds });
  },

  async verify(pin) {
    const cfg = await vault.getMeta(META_KEY);
    if (!cfg?.hash) return true;

    const candidate = await derive(pin, fromB64(cfg.salt));
    const ok = equal(candidate, cfg.hash);

    await vault.setMeta(META_KEY, {
      ...cfg,
      failedAttempts: ok ? 0 : (cfg.failedAttempts || 0) + 1,
    });
    return ok;
  },

  /* ──────────────────── fingerprint and passkey unlock ──────────────────── */

  /** Everything registered on this device. */
  async credentials() {
    const cfg = await vault.getMeta(META_KEY);
    return cfg?.credentials || [];
  },

  async hasCredential(kind) {
    const cfg = await vault.getMeta(META_KEY);
    return (cfg?.credentials || []).some((c) => c.kind === kind);
  },

  /** What this browser can actually offer, for the settings sheet to show. */
  async availability() {
    return {
      supported: webauthn.isSupported(),
      reason: webauthn.unsupportedReason(),
      platform: await webauthn.hasPlatformAuthenticator(),
    };
  },

  /**
   * Registers a fingerprint ('biometric') or a passkey ('passkey'). The PIN has
   * to exist first — it is the fallback the whole design leans on.
   */
  async addCredential(kind, user) {
    const cfg = await vault.getMeta(META_KEY);
    if (!cfg?.hash) throw new Error('Set a PIN first');

    const existing = cfg.credentials || [];
    const record = await webauthn.register({ kind, user, existing });

    await vault.setMeta(META_KEY, {
      ...cfg,
      // One entry per method, so re-registering replaces instead of piling up.
      credentials: [...existing.filter((c) => c.kind !== kind && c.id !== record.id), record],
    });
    return record;
  },

  async removeCredential(kind) {
    const cfg = await vault.getMeta(META_KEY);
    if (!cfg) return;
    await vault.setMeta(META_KEY, {
      ...cfg,
      credentials: (cfg.credentials || []).filter((c) => c.kind !== kind),
    });
  },

  /**
   * Unlocks with an authenticator; `kind` narrows it to one method, omitting it
   * accepts anything registered. Throws a readable reason on failure. A
   * cancelled prompt is not a wrong PIN, so the failure counter is only ever
   * cleared here, never bumped.
   */
  async unlockWith(kind) {
    const cfg = await vault.getMeta(META_KEY);
    if (!cfg?.hash) return true;

    const records = (cfg.credentials || []).filter((c) => !kind || c.kind === kind);
    await webauthn.assert(records);

    await vault.setMeta(META_KEY, { ...cfg, failedAttempts: 0 });
    return true;
  },

  async failedAttempts() {
    const cfg = await vault.getMeta(META_KEY);
    return cfg?.failedAttempts || 0;
  },

  /** Records the moment the app went to the background. */
  async markBackgrounded() {
    const cfg = await vault.getMeta(META_KEY);
    if (!cfg) return;
    await vault.setMeta(META_KEY, { ...cfg, lastActiveAt: Date.now() });
  },

  /** True when enough idle time has passed that we should ask for the PIN. */
  async shouldLock() {
    const cfg = await vault.getMeta(META_KEY);
    if (!cfg?.hash) return false;

    const idleFor = Date.now() - (cfg.lastActiveAt || 0);
    return idleFor >= (cfg.autoLockSeconds ?? 300) * 1000;
  },
};
