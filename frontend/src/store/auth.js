'use client';

import { create } from 'zustand';
import { api, tokens } from '@/lib/api';
import { connectSocket, disconnectSocket } from '@/lib/socket';
import { vault } from '@/lib/vault';
import * as e2ee from '@/lib/e2ee';
import * as passkeys from '@/lib/passkeys';
import * as C from '@/lib/crypto';
import { setSoundEnabled, setHapticsEnabled, setRingEnabled } from '@/lib/sound';
import { applyFontScale } from '@/lib/theme';
import { toast } from '@/store/ui';

export const useAuth = create((set, get) => ({
  user: null,
  device: null,
  devices: [],
  status: 'loading', // loading | authed | guest | locked
  error: null,

  /* ─── boot: restore the session and unlock local keys ─── */
  async bootstrap() {
    if (!tokens.access) {
      set({ status: 'guest' });
      return;
    }

    try {
      const { data } = await api.get('/auth/me');
      const unlocked = await e2ee.loadFromVault(data.user._id);

      applyPreferences(data.user);

      set({
        user: data.user,
        device: data.device,
        devices: data.devices || [],
        status: unlocked ? 'authed' : 'locked',
      });

      if (unlocked) {
        connectSocket();
        e2ee.replenishPreKeys();
      }
    } catch {
      tokens.clear();
      set({ status: 'guest', user: null });
    }
  },

  /* ─── sign up ─── */
  async register({ email, name, password }) {
    const { data } = await api.post('/auth/register', { email, name, password });
    return data;
  },

  /** Verifying the code is also when this device publishes its first keys. */
  async verifyEmail({ email, code, password }) {
    const bootstrapped = await e2ee.bootstrapAccount(password);

    const { data } = await api.post('/auth/verify-email', {
      email,
      code,
      keys: { account: bootstrapped.account, device: bootstrapped.device },
      device: describeThisDevice(),
    });

    tokens.set(data);

    await e2ee.persistAndUnlock({
      userId: data.user._id,
      accountPrivate: {
        identityPrivateKey: await exportPriv(bootstrapped._private.identityPrivateKey),
        signingPrivateKey: await exportSigningPriv(bootstrapped._private.signingPrivateKey),
      },
      accountPublic: bootstrapped.account,
      devicePrivate: bootstrapped._private.device,
    });

    applyPreferences(data.user);
    set({ user: data.user, device: data.device, status: 'authed', error: null });
    connectSocket(data.accessToken);
    return data;
  },

  /* ─── sign in ─── */
  async login({ email, password }) {
    // Round one hands back the wrapped identity so we can unlock it locally…
    const first = await api.post('/auth/login', { email, password });

    if (first.data.stage !== 'unlock') {
      throw new Error('Unexpected sign-in response');
    }

    const unwrapped = await e2ee.unlockWithPassword({
      encryptedIdentity: first.data.encryptedIdentity,
      password,
    });

    // …round two registers a brand-new key set for this device.
    const device = await e2ee.buildDeviceKeys();

    const { data } = await api.post('/auth/login', {
      email,
      password,
      keys: { device: device.publicBundle },
      device: describeThisDevice(),
    });

    tokens.set(data);

    await e2ee.persistAndUnlock({
      userId: data.user._id,
      accountPrivate: {
        identityPrivateKey: unwrapped.identityPrivateKey,
        signingPrivateKey: unwrapped.signingPrivateKey,
      },
      accountPublic: {
        identityPublicKey: data.user.identityPublicKey,
        signingPublicKey: data.user.signingPublicKey,
      },
      devicePrivate: device.privateBundle,
    });

    applyPreferences(data.user);
    set({ user: data.user, device: data.device, status: 'authed', error: null });
    connectSocket(data.accessToken);
    e2ee.replenishPreKeys();
    return data;
  },

  /**
   * Signs in with a passkey.
   *
   * Mirrors `login` in shape, with the assertion standing in for the password.
   * The wrinkle is the identity: a passkey proves who you are but does not by
   * itself hand over the key that decrypts history. Where the authenticator
   * supports PRF, `authenticate` has already unwrapped it and there is nothing
   * more to ask. Where it does not, this throws `NEEDS_PASSWORD` with the ticket
   * attached, so the caller can ask once and come back through
   * `passkeyLoginWithPassword` without a second sensor touch.
   */
  async passkeyLogin() {
    const proof = await passkeys.authenticate();

    if (proof.needsPassword) {
      const err = new Error('Enter your password once to unlock your chats on this device');
      err.code = 'NEEDS_PASSWORD';
      err.proof = proof;
      throw err;
    }

    return get().finishPasskeyLogin(proof, proof.identity);
  },

  /** The second attempt, once the password has been supplied. */
  async passkeyLoginWithPassword(proof, password) {
    const { raw } = await C.unwrapIdentity(proof.encryptedIdentity, password);
    return get().finishPasskeyLogin(proof, raw);
  },

  /** Shared tail: mint device keys, take the session, persist the identity. */
  async finishPasskeyLogin(proof, rawIdentity) {
    if (!rawIdentity?.identityPrivateKey) {
      throw new Error('Could not unlock your keys');
    }

    const device = await e2ee.buildDeviceKeys();
    const data = await passkeys.complete({
      ticket: proof.ticket,
      keys: { device: device.publicBundle },
      device: describeThisDevice(),
    });

    tokens.set(data);

    await e2ee.persistAndUnlock({
      userId: data.user._id,
      accountPrivate: {
        identityPrivateKey: rawIdentity.identityPrivateKey,
        signingPrivateKey: rawIdentity.signingPrivateKey,
      },
      accountPublic: {
        identityPublicKey: data.user.identityPublicKey,
        signingPublicKey: data.user.signingPublicKey,
      },
      devicePrivate: device.privateBundle,
    });

    applyPreferences(data.user);
    set({ user: data.user, device: data.device, status: 'authed', error: null });
    connectSocket(data.accessToken);
    e2ee.replenishPreKeys();
    return data;
  },

  /** Completes a QR link — keys arrive sealed from the trusted device. */
  async finishDeviceLink({ session, identity, devicePrivate }) {
    tokens.set(session);

    await e2ee.persistAndUnlock({
      userId: session.user._id,
      accountPrivate: {
        identityPrivateKey: identity.identityPrivateKey,
        signingPrivateKey: identity.signingPrivateKey,
      },
      accountPublic: {
        identityPublicKey: identity.identityPublicKey,
        signingPublicKey: identity.signingPublicKey,
      },
      devicePrivate,
    });

    applyPreferences(session.user);
    set({ user: session.user, device: session.device, status: 'authed', error: null });
    connectSocket(session.accessToken);
    e2ee.replenishPreKeys();
  },

  /** Password re-entry when the tab has keys on the server but not locally. */
  async unlock(password) {
    const { user } = get();
    const { data } = await api.get('/auth/identity', { params: { email: user.email } });

    const unwrapped = await e2ee.unlockWithPassword({
      encryptedIdentity: data.encryptedIdentity,
      password,
    });
    const device = await e2ee.buildDeviceKeys();

    await api.post('/keys/prekeys', {
      signedPreKey: device.publicBundle.signedPreKey,
      oneTimePreKeys: device.publicBundle.oneTimePreKeys,
    });

    await e2ee.persistAndUnlock({
      userId: user._id,
      accountPrivate: {
        identityPrivateKey: unwrapped.identityPrivateKey,
        signingPrivateKey: unwrapped.signingPrivateKey,
      },
      accountPublic: {
        identityPublicKey: user.identityPublicKey,
        signingPublicKey: user.signingPublicKey,
      },
      devicePrivate: device.privateBundle,
    });

    set({ status: 'authed' });
    connectSocket();
  },

  async logout({ wipe = true } = {}) {
    try {
      await api.post('/auth/logout');
    } catch {
      /* signing out locally matters more than the round-trip */
    }
    disconnectSocket();
    tokens.clear();
    if (wipe) await vault.wipe();
    await e2ee.forget();
    set({ user: null, device: null, devices: [], status: 'guest' });
  },

  /* ─── profile + preferences ─── */
  async updateProfile(patch) {
    const { data } = await api.patch('/users/me', patch);
    set({ user: data.user });
    return data.user;
  },

  /** Flips instantly, then reconciles — a toggle that waits on the network
   *  feels broken. On failure we put the old value back and say so. */
  async updateSettings(patch) {
    const previous = get().user?.settings;
    const merged = {
      ...previous,
      ...patch,
      notifications: { ...previous?.notifications, ...(patch.notifications || {}) },
    };

    set((s) => ({ user: { ...s.user, settings: merged } }));
    applyPreferences({ ...get().user, settings: merged });

    try {
      const { data } = await api.patch('/users/me/settings', patch);
      set((s) => ({ user: { ...s.user, settings: data.settings } }));
    } catch (err) {
      set((s) => ({ user: { ...s.user, settings: previous } }));
      applyPreferences({ ...get().user, settings: previous });
      toast.error(err.message || 'Could not save that setting');
    }
  },

  async updatePrivacy(patch) {
    const previous = get().user?.privacy;
    set((s) => ({ user: { ...s.user, privacy: { ...previous, ...patch } } }));

    try {
      const { data } = await api.patch('/users/me/privacy', patch);
      set((s) => ({ user: { ...s.user, privacy: data.privacy } }));
    } catch (err) {
      set((s) => ({ user: { ...s.user, privacy: previous } }));
      toast.error(err.message || 'Could not save that setting');
    }
  },

  async uploadAvatar(file) {
    const form = new FormData();
    form.append('avatar', file);
    const { data } = await api.post('/users/me/avatar', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    set({ user: data.user });
    return data.user;
  },

  async refreshDevices() {
    const { data } = await api.get('/devices');
    set({ devices: data.devices });
    return data.devices;
  },

  setUser: (user) => set({ user }),
}));

/* ────────────────────────────── helpers ────────────────────────────── */

function applyPreferences(user) {
  if (!user?.settings) return;
  setSoundEnabled(user.settings.sounds !== false);
  setHapticsEnabled(user.settings.haptics !== false);
  /* Ringing follows the Calls notification toggle, not the in-app sound one:
     that switch offers "Send, receive, and reaction tones", and a messenger
     whose calls stop ringing because you turned off the tap sounds is broken.
     Turning off Calls notifications is the deliberate way to silence them. */
  setRingEnabled(user.settings.notifications?.calls !== false);

  if (typeof document !== 'undefined') {
    document.documentElement.classList.toggle('reduce-motion', !!user.settings.reduceMotion);
    applyFontScale(user.settings.fontScale);
  }
}

export function describeThisDevice() {
  if (typeof navigator === 'undefined') return {};
  const ua = navigator.userAgent;
  const isMobileUA = /Android|iPhone|iPod/i.test(ua);
  const isTablet = /iPad|Tablet/i.test(ua);

  return {
    platform: 'web',
    formFactor: isTablet ? 'tablet' : isMobileUA ? 'mobile' : 'desktop',
  };
}

/* The bootstrap flow hands us CryptoKey objects; the vault stores base64. */
async function exportPriv(key) {
  const { crypto: C } = await import('@/lib/e2ee');
  return C.exportPrivateKey(key);
}
async function exportSigningPriv(key) {
  const { crypto: C } = await import('@/lib/e2ee');
  return C.exportPrivateKey(key);
}
