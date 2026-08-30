import QRCode from 'qrcode';
import { UAParser } from 'ua-parser-js';
import { User, Device, PreKey, LinkSession } from '../models/index.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { linkCode, shortId, randomToken, sha256 } from '../utils/ids.js';
import { issueTokens, hashToken } from '../services/token.js';
import { mailer } from '../services/mailer.js';
import { getIO } from '../sockets/io.js';
import { pushPublicKey, pushReady, pushTest, pushEphemeral, fcmReady } from '../services/push.js';

const LINK_TTL_MS = 2 * 60 * 1000; // a QR is only good for two minutes

/** Short, human-checkable fingerprint shown on both screens before approving. */
const fingerprintOf = (publicKey) =>
  sha256(publicKey)
    .slice(0, 12)
    .toUpperCase()
    .match(/.{1,4}/g)
    .join(' ');

function describe(req, provided = {}) {
  const ua = new UAParser(req.headers['user-agent'] || '');
  const browser = ua.getBrowser();
  const os = ua.getOS();
  const type = ua.getDevice().type;
  return {
    name: provided.name || [browser.name || 'Browser', 'on', os.name || 'device'].join(' '),
    platform: provided.platform || 'web',
    browser: browser.name ? [browser.name, browser.version].filter(Boolean).join(' ') : null,
    os: os.name ? [os.name, os.version].filter(Boolean).join(' ') : null,
    formFactor:
      provided.formFactor || (type === 'mobile' ? 'mobile' : type === 'tablet' ? 'tablet' : 'desktop'),
    ip: req.ip,
  };
}

/* ─────────────────────────── managing devices ─────────────────────────── */

export const listDevices = asyncHandler(async (req, res) => {
  const devices = await Device.find({ user: req.user._id, revokedAt: null })
    .select('deviceId name platform os browser formFactor isPrimary lastActiveAt createdAt linkedVia')
    .sort({ isPrimary: -1, createdAt: 1 })
    .lean();

  res.json({
    success: true,
    devices: devices.map((d) => ({ ...d, current: d.deviceId === req.deviceId })),
  });
});

export const renameDevice = asyncHandler(async (req, res) => {
  const device = await Device.findOneAndUpdate(
    { deviceId: req.params.deviceId, user: req.user._id, revokedAt: null },
    { name: String(req.body.name).slice(0, 60) },
    { new: true }
  );
  if (!device) throw ApiError.notFound('Device not found', 'NO_DEVICE');
  res.json({ success: true, device });
});

export const revokeDevice = asyncHandler(async (req, res) => {
  const { deviceId } = req.params;
  const device = await Device.findOne({ deviceId, user: req.user._id, revokedAt: null });
  if (!device) throw ApiError.notFound('Device not found', 'NO_DEVICE');

  device.revokedAt = new Date();
  device.refreshTokenHash = null;
  await device.save();
  await PreKey.deleteMany({ deviceId });

  getIO()?.to('device:' + deviceId).emit('device:revoked', { deviceId });

  res.json({ success: true, message: 'Device signed out' });
});

export const revokeAllOtherDevices = asyncHandler(async (req, res) => {
  const others = await Device.find({
    user: req.user._id,
    deviceId: { $ne: req.deviceId },
    revokedAt: null,
  });

  await Device.updateMany(
    { _id: { $in: others.map((d) => d._id) } },
    { revokedAt: new Date(), refreshTokenHash: null }
  );
  await PreKey.deleteMany({ deviceId: { $in: others.map((d) => d.deviceId) } });

  const io = getIO();
  others.forEach((d) => io?.to('device:' + d.deviceId).emit('device:revoked', { deviceId: d.deviceId }));

  res.json({ success: true, message: others.length + ' device(s) signed out' });
});

/**
 * What this server can deliver, and how.
 *
 * The browser needs `publicKey` to build a PushSubscription. The Android app
 * needs none of that — it reads `fcm` to know whether the server can reach it
 * while the app is closed, and says so on its notifications screen rather than
 * claiming push is on when only the socket transport is available.
 */
export const vapidKey = asyncHandler(async (_req, res) => {
  res.json({
    success: true,
    enabled: pushReady(),
    publicKey: pushPublicKey(),
    /* Subscribing against a key that dies with the process is worse than not
       subscribing at all — the app would claim notifications were on and then
       quietly deliver none after the next deploy. The client says so instead. */
    ephemeral: pushEphemeral(),
    fcm: fcmReady(),
  });
});

export const updatePushSubscription = asyncHandler(async (req, res) => {
  await Device.updateOne(
    { deviceId: req.deviceId, user: req.user._id },
    { pushSubscription: req.body.subscription || null }
  );
  res.json({ success: true });
});

/**
 * Sends this device one notification, on request.
 *
 * Worth having as a real endpoint rather than a client-side `showNotification`
 * call: the local version proves only that the browser can draw a notification,
 * while this exercises the whole chain — VAPID keys, the push service, the
 * subscription, and the service worker's push handler. That is the chain that
 * breaks, and until now there was no way to tell which link had.
 */
export const testPush = asyncHandler(async (req, res) => {
  const result = await pushTest(req.user._id, req.deviceId);
  res.json({ success: result.sent > 0, ...result });
});

/* ──────────────────────── scan-to-link a new device ──────────────────────── */

/** Step 1 — the *new* device (a browser, usually) opens a link session. */
export const initLink = asyncHandler(async (req, res) => {
  const { ephemeralPublicKey, deviceKeys, device: deviceInfo } = req.body;

  const code = linkCode();
  const claimToken = randomToken(24);
  const fingerprint = fingerprintOf(ephemeralPublicKey);

  await LinkSession.create({
    code,
    ephemeralPublicKey,
    fingerprint,
    // The key bundle is stashed here so approval can mint the Device row
    // without a second round-trip to the new device.
    pendingDeviceKeys: deviceKeys,
    newDevice: { ...describe(req, deviceInfo), claimHash: sha256(claimToken) },
    expiresAt: new Date(Date.now() + LINK_TTL_MS),
  });

  const qrPayload = JSON.stringify({ v: 1, c: code, k: ephemeralPublicKey, f: fingerprint });
  const qrDataUrl = await QRCode.toDataURL(qrPayload, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 512,
    color: { dark: '#1D1D1F', light: '#00000000' },
  });

  res.status(201).json({
    success: true,
    code,
    claimToken,
    fingerprint,
    qrPayload,
    qrDataUrl,
    expiresAt: new Date(Date.now() + LINK_TTL_MS),
  });
});

/** Step 2 — the already-trusted device reads the QR and looks it up. */
export const scanLink = asyncHandler(async (req, res) => {
  const code = String(req.body.code || '').toUpperCase().trim();
  const session = await LinkSession.findOne({ code });

  if (!session) throw ApiError.notFound('That code is not valid', 'LINK_NOT_FOUND');
  if (session.expiresAt < new Date()) throw ApiError.badRequest('That code expired', 'LINK_EXPIRED');
  if (['completed', 'rejected'].includes(session.status)) {
    throw ApiError.badRequest('That code was already used', 'LINK_USED');
  }

  session.status = 'scanned';
  session.user = req.user._id;
  await session.save();

  getIO()?.to('link:' + code).emit('link:scanned', {
    code,
    by: { name: req.user.name, avatar: req.user.avatar },
  });

  res.json({
    success: true,
    session: {
      code,
      fingerprint: session.fingerprint,
      ephemeralPublicKey: session.ephemeralPublicKey,
      device: session.newDevice,
      expiresAt: session.expiresAt,
    },
  });
});

/** Step 3 — the trusted device seals the account identity to the new device. */
export const approveLink = asyncHandler(async (req, res) => {
  const code = String(req.body.code || '').toUpperCase().trim();
  const { payload } = req.body;

  const session = await LinkSession.findOne({ code });
  if (!session) throw ApiError.notFound('That code is not valid', 'LINK_NOT_FOUND');
  if (session.expiresAt < new Date()) throw ApiError.badRequest('That code expired', 'LINK_EXPIRED');
  if (session.status === 'completed') throw ApiError.badRequest('Already linked', 'LINK_USED');
  if (session.user && String(session.user) !== String(req.user._id)) {
    throw ApiError.forbidden('That session belongs to another account', 'LINK_MISMATCH');
  }

  const keys = session.pendingDeviceKeys;
  if (!keys) throw ApiError.badRequest('The new device did not publish its keys', 'LINK_NO_KEYS');

  const deviceId = keys.deviceId || 'dev_' + shortId();
  const info = session.newDevice || {};

  const device = await Device.create({
    user: req.user._id,
    deviceId,
    name: info.name || 'Linked device',
    platform: info.platform || 'web',
    browser: info.browser,
    os: info.os,
    formFactor: info.formFactor || 'desktop',
    ip: info.ip,
    registrationId: keys.registrationId,
    identityPublicKey: keys.identityPublicKey,
    signingPublicKey: keys.signingPublicKey,
    signedPreKey: { ...keys.signedPreKey, createdAt: new Date() },
    isPrimary: false,
    linkedVia: 'qr',
  });

  if (Array.isArray(keys.oneTimePreKeys) && keys.oneTimePreKeys.length) {
    await PreKey.insertMany(
      keys.oneTimePreKeys.map((k) => ({
        user: req.user._id,
        deviceId,
        keyId: k.keyId,
        publicKey: k.publicKey,
      })),
      { ordered: false }
    ).catch(() => {});
  }

  session.status = 'approved';
  session.user = req.user._id;
  session.approvedByDevice = req.deviceId;
  session.payload = payload;
  session.linkedDeviceId = deviceId;
  await session.save();

  getIO()?.to('link:' + code).emit('link:approved', { code });
  // Every existing device should start fanning keys out to the newcomer.
  getIO()?.to('user:' + req.user._id).emit('devices:changed', { userId: req.user._id });

  mailer.sendNewDeviceAlert(req.user.email, device).catch(() => {});

  res.json({ success: true, deviceId, message: 'Device linked' });
});

export const rejectLink = asyncHandler(async (req, res) => {
  const code = String(req.body.code || '').toUpperCase().trim();
  const session = await LinkSession.findOne({ code });
  if (!session) throw ApiError.notFound('That code is not valid', 'LINK_NOT_FOUND');

  session.status = 'rejected';
  await session.save();

  getIO()?.to('link:' + code).emit('link:rejected', { code });
  res.json({ success: true, message: 'Link request declined' });
});

/** Step 4 — the new device claims its session with the token only it holds. */
export const claimLink = asyncHandler(async (req, res) => {
  const code = String(req.body.code || '').toUpperCase().trim();
  const { claimToken } = req.body;

  const session = await LinkSession.findOne({ code });
  if (!session) throw ApiError.notFound('That code is not valid', 'LINK_NOT_FOUND');
  if (session.newDevice?.claimHash !== sha256(String(claimToken))) {
    throw ApiError.forbidden('Invalid claim token', 'LINK_BAD_CLAIM');
  }
  if (session.status === 'rejected') throw ApiError.forbidden('Link declined', 'LINK_REJECTED');
  if (session.status !== 'approved') {
    return res.json({ success: true, status: session.status, ready: false });
  }

  const deviceId = session.linkedDeviceId;
  const device = await Device.findOne({ deviceId, revokedAt: null });
  const user = await User.findById(session.user);
  if (!device || !user) throw ApiError.notFound('Link session is incomplete', 'LINK_BROKEN');

  const { accessToken, refreshToken } = issueTokens({ userId: user._id, deviceId });
  device.refreshTokenHash = hashToken(refreshToken);
  await device.save();

  session.status = 'completed';
  await session.save();

  res.json({
    success: true,
    ready: true,
    status: 'completed',
    user: user.toJSON(),
    device: {
      deviceId: device.deviceId,
      name: device.name,
      platform: device.platform,
      formFactor: device.formFactor,
      isPrimary: false,
    },
    accessToken,
    refreshToken,
    payload: session.payload,
  });
});

export const linkStatus = asyncHandler(async (req, res) => {
  const code = String(req.params.code || '').toUpperCase().trim();
  const session = await LinkSession.findOne({ code }).select('status expiresAt fingerprint');
  if (!session) throw ApiError.notFound('That code is not valid', 'LINK_NOT_FOUND');
  res.json({
    success: true,
    status: session.expiresAt < new Date() ? 'expired' : session.status,
    expiresAt: session.expiresAt,
  });
});
