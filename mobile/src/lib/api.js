import axios from 'axios';
import * as SecureStore from 'expo-secure-store';
import { API_BASE, API_ORIGIN } from './config';

export { API_ORIGIN, API_BASE };

export const api = axios.create({
  baseURL: API_BASE,
  timeout: 30_000,
});

const TOKEN_KEY = 'chax.access';
const REFRESH_KEY = 'chax.refresh';

/**
 * Tokens live in the keystore, mirrored in memory.
 *
 * The web client reads localStorage synchronously inside an axios request
 * interceptor. SecureStore is async and interceptors cannot wait on it without
 * making every request pay a keystore round trip, so the values are read once at
 * launch and kept in memory; the keystore is only touched on write. `hydrate`
 * has to finish before the first authenticated request, which is why boot
 * awaits it.
 */
let memo = { access: null, refresh: null };

export const tokens = {
  get access() {
    return memo.access;
  },
  get refresh() {
    return memo.refresh;
  },

  async hydrate() {
    try {
      const [access, refresh] = await Promise.all([
        SecureStore.getItemAsync(TOKEN_KEY),
        SecureStore.getItemAsync(REFRESH_KEY),
      ]);
      memo = { access: access || null, refresh: refresh || null };
    } catch {
      memo = { access: null, refresh: null };
    }
    return memo;
  },

  set({ accessToken, refreshToken }) {
    if (accessToken) {
      memo.access = accessToken;
      SecureStore.setItemAsync(TOKEN_KEY, accessToken).catch(() => {});
    }
    if (refreshToken) {
      memo.refresh = refreshToken;
      SecureStore.setItemAsync(REFRESH_KEY, refreshToken).catch(() => {});
    }
  },

  clear() {
    memo = { access: null, refresh: null };
    SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {});
    SecureStore.deleteItemAsync(REFRESH_KEY).catch(() => {});
  },
};

api.interceptors.request.use((config) => {
  const token = tokens.access;
  if (token) config.headers.Authorization = 'Bearer ' + token;
  return config;
});

/* ── one refresh in flight at a time; everything else queues behind it ── */
let refreshing = null;
const onSessionLost = [];

export const onUnauthorized = (fn) => {
  onSessionLost.push(fn);
  return () => {
    const i = onSessionLost.indexOf(fn);
    if (i >= 0) onSessionLost.splice(i, 1);
  };
};

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    const status = error.response?.status;
    const code = error.response?.data?.code;

    const isRefreshable =
      status === 401 &&
      !original?._retried &&
      !original?.url?.includes('/auth/refresh') &&
      !original?.url?.includes('/auth/login');

    if (isRefreshable) {
      original._retried = true;
      try {
        if (!refreshing) {
          refreshing = axios
            .post(API_BASE + '/auth/refresh', { refreshToken: tokens.refresh })
            .then((res) => {
              tokens.set(res.data);
              return res.data.accessToken;
            })
            .finally(() => {
              refreshing = null;
            });
        }

        const fresh = await refreshing;
        original.headers.Authorization = 'Bearer ' + fresh;
        return api(original);
      } catch {
        tokens.clear();
        onSessionLost.forEach((fn) => fn(code));
      }
    }

    if (status === 401 && code === 'DEVICE_REVOKED') {
      tokens.clear();
      onSessionLost.forEach((fn) => fn(code));
    }

    const message =
      error.response?.data?.message ||
      (error.code === 'ECONNABORTED'
        ? 'That took too long — check your connection.'
        : error.message === 'Network Error'
          ? 'Cannot reach Chax. Check your connection.'
          : 'Something went wrong.');

    return Promise.reject(
      Object.assign(new Error(message), {
        status,
        code,
        details: error.response?.data?.details,
        original: error,
      })
    );
  }
);

export const mediaUrl = (path) => {
  if (!path) return null;
  if (path.startsWith('http') || path.startsWith('data:') || path.startsWith('file:')) return path;
  return API_ORIGIN + path;
};
