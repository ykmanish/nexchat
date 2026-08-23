'use client';

import axios from 'axios';

export const API_ORIGIN = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';
export const API_BASE = API_ORIGIN + '/api';

export const api = axios.create({
  baseURL: API_BASE,
  withCredentials: true,
  timeout: 30_000,
});

const TOKEN_KEY = 'nexchat.access';
const REFRESH_KEY = 'nexchat.refresh';

export const tokens = {
  get access() {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(TOKEN_KEY);
  },
  get refresh() {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(REFRESH_KEY);
  },
  set({ accessToken, refreshToken }) {
    if (typeof window === 'undefined') return;
    if (accessToken) localStorage.setItem(TOKEN_KEY, accessToken);
    if (refreshToken) localStorage.setItem(REFRESH_KEY, refreshToken);
  },
  clear() {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_KEY);
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
            .post(
              API_BASE + '/auth/refresh',
              { refreshToken: tokens.refresh },
              { withCredentials: true }
            )
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

    // Normalise the shape so callers can always read `error.message`.
    const message =
      error.response?.data?.message ||
      (error.code === 'ECONNABORTED'
        ? 'That took too long — check your connection.'
        : error.message === 'Network Error'
          ? 'Cannot reach the server. Is the API running?'
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
  if (path.startsWith('http') || path.startsWith('blob:') || path.startsWith('data:')) return path;
  return API_ORIGIN + path;
};
