import { create } from 'zustand';
import * as Device from 'expo-device';
import { api, tokens } from '../lib/api';
import { connectSocket, disconnectSocket } from '../lib/socket';
import { vault } from '../lib/vault';
import * as e2ee from '../lib/e2ee';
import { setHapticsEnabled } from '../lib/feedback';
import { toast } from './ui';

export const useAuth = create((set, get) => ({
  user: null,
  device: null,
  devices: [],
  status: 'loading', // loading | authed | guest | locked
  error: null,

  /* ─── boot: restore the session and unlock local keys ─── */
  async bootstrap() {
    // Unlike the web client, the tokens are not readable synchronously — they
    // live in the Android keystore — so the first authenticated request has to
    // wait for them.
    await tokens.hydrate();

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
    } catch (err) {
      // A network blip must not sign somebody out. Only an answer from the
      // server saying the session is gone should clear it — otherwise opening
      // the app on a train would wipe the keys and force a password re-entry.
      if (err.status === 401) {
        tokens.clear();
        set({ status: 'guest', user: null });
      } else {
        const unlocked = await e2ee.loadFromVault(await vault.activeUserId());
        set({ status: unlocked ? 'authed' : 'guest', error: err.message });
        if (unlocked) connectSocket();
      }
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
        identityPrivateKey: bootstrapped._private.identityPrivateKey,
        signingPrivateKey: bootstrapped._private.signingPrivateKey,
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

  /** Password re-entry when the account has keys on the server but not here. */
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

  async uploadAvatar(asset) {
    const form = new FormData();
    form.append('avatar', {
      uri: asset.uri,
      name: asset.fileName || 'avatar.jpg',
      type: asset.mimeType || 'image/jpeg',
    });

    // No Content-Type by hand — see the note in lib/upload.js: setting it
    // drops the multipart boundary and the server sees no file.
    const { data } = await api.post('/users/me/avatar', form);
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
  setHapticsEnabled(user.settings.haptics !== false);
}

/**
 * What this device tells the server about itself.
 *
 * The web client guesses from a user-agent string. Here the answers are known
 * outright, and `platform: 'android'` is the one that matters — it is how the
 * devices screen can show a phone as a phone, and how the push service knows
 * to route through FCM rather than to a browser endpoint.
 */
export function describeThisDevice() {
  return {
    name: [Device.brand, Device.modelName].filter(Boolean).join(' ') || 'Android device',
    platform: 'android',
    os: ['Android', Device.osVersion].filter(Boolean).join(' '),
    formFactor: Device.deviceType === Device.DeviceType.TABLET ? 'tablet' : 'mobile',
  };
}
