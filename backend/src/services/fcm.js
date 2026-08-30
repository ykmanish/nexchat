import fs from 'fs';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

/**
 * Firebase Cloud Messaging, for the Android app.
 *
 * The web client subscribes through the Push API and is delivered to by
 * `web-push`; a native app cannot receive that, so its device token is sent
 * here instead. Both live side by side in `Device.pushSubscription`,
 * discriminated by a `type` field, and `push.js` picks the transport per device.
 *
 * Deliberately dependency-free. The official `firebase-admin` package pulls in
 * a large tree for what is, at this scale, one signed JWT exchanged for an
 * access token and one HTTPS POST — and `jsonwebtoken` is already here for
 * session tokens.
 *
 * Configure with a service-account JSON from the Firebase console:
 *
 *   FCM_SERVICE_ACCOUNT=/etc/chax/firebase-service-account.json
 *
 * or, for a container that would rather not mount a file, the same JSON inline
 * in FCM_SERVICE_ACCOUNT_JSON.
 */

const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

let account = null;
let ready = false;

export function initFcm() {
  const { serviceAccountPath, serviceAccountJson } = env.fcm;

  let raw = serviceAccountJson;
  if (!raw && serviceAccountPath) {
    try {
      raw = fs.readFileSync(serviceAccountPath, 'utf8');
    } catch (err) {
      logger.warn('FCM disabled: could not read ' + serviceAccountPath + ' — ' + err.message);
      return;
    }
  }

  if (!raw) {
    logger.warn('FCM not configured — the Android app will fall back to its socket transport.');
    return;
  }

  try {
    const parsed = JSON.parse(raw);
    if (!parsed.client_email || !parsed.private_key || !parsed.project_id) {
      throw new Error('missing client_email, private_key or project_id');
    }
    account = parsed;
    ready = true;
    logger.success('FCM ready (project ' + parsed.project_id + ')');
  } catch (err) {
    logger.error('FCM disabled: service account is not valid JSON — ' + err.message);
  }
}

export const fcmReady = () => ready;

/* ────────────────────────── access tokens ────────────────────────── */

let cached = { token: null, expiresAt: 0 };
let inFlight = null;

/**
 * Google's access tokens last an hour; this refreshes at fifty-five minutes and
 * shares one request between concurrent callers, so a burst of notifications
 * does not become a burst of token exchanges.
 */
async function accessToken() {
  if (cached.token && Date.now() < cached.expiresAt) return cached.token;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const now = Math.floor(Date.now() / 1000);
    const assertion = jwt.sign(
      {
        iss: account.client_email,
        scope: SCOPE,
        aud: OAUTH_TOKEN_URL,
        iat: now,
        exp: now + 3600,
      },
      account.private_key,
      { algorithm: 'RS256' }
    );

    const res = await fetch(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
    });

    if (!res.ok) {
      throw new Error('FCM token exchange failed: ' + res.status + ' ' + (await res.text()));
    }

    const data = await res.json();
    cached = {
      token: data.access_token,
      expiresAt: Date.now() + Math.max(60, (data.expires_in || 3600) - 300) * 1000,
    };
    return cached.token;
  })().finally(() => {
    inFlight = null;
  });

  return inFlight;
}

/* ────────────────────────────── sending ────────────────────────────── */

/**
 * Sends one message to one device token.
 *
 * Data-only, with no `notification` block. That is the important choice: a
 * message carrying `notification` is drawn by the system directly, and the app
 * never gets the chance to fill in the text from its local cache or attach the
 * reply action. Data-only wakes the app's background handler instead, which is
 * what makes replying from the shade possible at all.
 *
 * `priority: high` for the same reason the web path asks for high urgency —
 * FCM batches normal-priority messages under Doze, and minutes late is within
 * spec for everything except a chat message.
 *
 * Returns `{ ok }`, or `{ ok: false, gone: true }` when the token has been
 * retired, which is the caller's cue to forget it.
 */
export async function sendToToken(token, payload, { collapseKey = null, ttlSeconds = 3600 } = {}) {
  if (!ready) return { ok: false, reason: 'FCM is not configured' };

  // Every value in an FCM data payload must be a string.
  const data = {};
  Object.entries(payload || {}).forEach(([key, value]) => {
    if (value === null || value === undefined) return;
    data[key] = typeof value === 'string' ? value : JSON.stringify(value);
  });

  const message = {
    message: {
      token,
      data,
      android: {
        priority: 'HIGH',
        ttl: ttlSeconds + 's',
        ...(collapseKey ? { collapse_key: collapseKey } : {}),
      },
    },
  };

  try {
    const bearer = await accessToken();
    const res = await fetch(
      'https://fcm.googleapis.com/v1/projects/' + account.project_id + '/messages:send',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + bearer,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(message),
      }
    );

    if (res.ok) return { ok: true };

    const body = await res.text();

    /* 404 with UNREGISTERED, or 400 with INVALID_ARGUMENT on the token, means
       the app was uninstalled or the token rotated. Keeping it would mean
       retrying a dead endpoint on every message forever. */
    const gone =
      res.status === 404 ||
      body.includes('UNREGISTERED') ||
      body.includes('registration-token-not-registered');

    if (!gone) logger.warn('FCM send failed (' + res.status + '): ' + body.slice(0, 240));
    return { ok: false, gone, reason: body.slice(0, 240) };
  } catch (err) {
    logger.warn('FCM send error: ' + err.message);
    return { ok: false, reason: err.message };
  }
}
