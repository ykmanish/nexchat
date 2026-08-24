import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { UAParser } from 'ua-parser-js';
import { User, Device, PreKey, Otp } from '../models/index.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { numericCode, shortId, sha256 } from '../utils/ids.js';
import { mailer } from '../services/mailer.js';
import {
  issueTokens,
  hashToken,
  verifyRefreshToken,
  refreshCookieOptions,
} from '../services/token.js';
import { redeemTicket } from './passkey.controller.js';

const OTP_TTL_MS = 10 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 6;

const AVATAR_COLORS = [
  '#21C063', '#0EA5E9', '#8B5CF6', '#EC4899', '#F59E0B',
  '#14B8A6', '#6366F1', '#EF4444', '#10B981', '#64748B',
];
const pickColor = (seed) =>
  AVATAR_COLORS[crypto.createHash('md5').update(seed).digest()[0] % AVATAR_COLORS.length];

function describeDevice(req, provided = {}) {
  const ua = new UAParser(req.headers['user-agent'] || '');
  const browser = ua.getBrowser();
  const os = ua.getOS();
  const type = ua.getDevice().type;
  const formFactor = type === 'mobile' ? 'mobile' : type === 'tablet' ? 'tablet' : 'desktop';
  const browserLabel = browser.name ? [browser.name, browser.version].filter(Boolean).join(' ') : null;
  const osLabel = os.name ? [os.name, os.version].filter(Boolean).join(' ') : null;

  return {
    name: provided.name || [browser.name || 'Browser', 'on', os.name || 'device'].join(' '),
    platform: provided.platform || 'web',
    browser: browserLabel,
    os: osLabel,
    formFactor: provided.formFactor || formFactor,
    ip: req.ip,
  };
}

async function issueOtp(email, purpose, meta = null) {
  await Otp.updateMany({ email, purpose, consumedAt: null }, { consumedAt: new Date() });
  const code = numericCode(6);
  await Otp.create({
    email,
    codeHash: await bcrypt.hash(code, 8),
    purpose,
    meta,
    expiresAt: new Date(Date.now() + OTP_TTL_MS),
  });
  return code;
}

async function consumeOtp(email, code, purpose) {
  const otp = await Otp.findOne({ email, purpose, consumedAt: null }).sort({ createdAt: -1 });
  if (!otp) throw ApiError.badRequest('Request a new code', 'OTP_MISSING');
  if (otp.expiresAt < new Date()) throw ApiError.badRequest('That code expired', 'OTP_EXPIRED');
  if (otp.attempts >= MAX_OTP_ATTEMPTS) {
    throw ApiError.tooMany('Too many wrong codes. Request a new one.', 'OTP_LOCKED');
  }

  const ok = await bcrypt.compare(String(code), otp.codeHash);
  if (!ok) {
    otp.attempts += 1;
    await otp.save();
    const left = MAX_OTP_ATTEMPTS - otp.attempts;
    const noun = left === 1 ? 'try' : 'tries';
    throw ApiError.badRequest(
      left > 0 ? 'Incorrect code — ' + left + ' ' + noun + ' left' : 'Incorrect code',
      'OTP_INVALID'
    );
  }

  otp.consumedAt = new Date();
  await otp.save();
  return otp;
}

/** Registers a fresh device row plus its prekey batch for the given user. */
async function registerDevice({ req, user, keys, deviceInfo, linkedVia = 'login' }) {
  const info = describeDevice(req, deviceInfo);
  const deviceId = keys.deviceId || 'dev_' + shortId();

  const existingCount = await Device.countDocuments({ user: user._id, revokedAt: null });

  const device = await Device.create({
    user: user._id,
    deviceId,
    ...info,
    registrationId: keys.registrationId,
    identityPublicKey: keys.identityPublicKey,
    signingPublicKey: keys.signingPublicKey,
    signedPreKey: { ...keys.signedPreKey, createdAt: new Date() },
    isPrimary: existingCount === 0,
    linkedVia,
  });

  if (Array.isArray(keys.oneTimePreKeys) && keys.oneTimePreKeys.length) {
    await PreKey.insertMany(
      keys.oneTimePreKeys.map((k) => ({
        user: user._id,
        deviceId,
        keyId: k.keyId,
        publicKey: k.publicKey,
      })),
      { ordered: false }
    ).catch(() => {});
  }

  const { accessToken, refreshToken } = issueTokens({ userId: user._id, deviceId });
  device.refreshTokenHash = hashToken(refreshToken);
  await device.save();

  return { device, accessToken, refreshToken };
}

const sessionPayload = (user, device, accessToken, refreshToken) => ({
  user: user.toJSON(),
  device: {
    deviceId: device.deviceId,
    name: device.name,
    platform: device.platform,
    formFactor: device.formFactor,
    isPrimary: device.isPrimary,
  },
  accessToken,
  refreshToken,
});

/* ────────────────────────────── controllers ────────────────────────────── */

export const checkEmail = asyncHandler(async (req, res) => {
  const email = String(req.query.email || '').toLowerCase().trim();
  const user = await User.findOne({ email }).select('emailVerified');
  res.json({
    success: true,
    available: !user,
    registered: !!user,
    verified: !!(user && user.emailVerified),
  });
});

export const checkUsername = asyncHandler(async (req, res) => {
  const username = String(req.query.username || '').toLowerCase().trim();
  const taken = await User.exists({ username });
  res.json({ success: true, available: !taken });
});

export const register = asyncHandler(async (req, res) => {
  const { email, name, password } = req.body;

  const existing = await User.findOne({ email });
  if (existing && existing.emailVerified) {
    throw ApiError.conflict('That email already has an account. Sign in instead.', 'EMAIL_TAKEN');
  }

  let user = existing;
  if (user) {
    // An unverified signup being retried — refresh the details in place.
    user.name = name;
    user.password = password;
    user.avatarColor = pickColor(email);
    await user.save();
  } else {
    user = await User.create({
      email,
      name,
      password,
      avatarColor: pickColor(email),
      securityCode: sha256(email).slice(0, 12).toUpperCase(),
    });
  }

  const code = await issueOtp(email, 'verify-email');
  await mailer.sendVerificationCode(email, code, name.split(' ')[0]);

  res.status(201).json({
    success: true,
    message: 'We sent a 6-digit code to ' + email,
    email,
    expiresIn: OTP_TTL_MS / 1000,
  });
});

export const resendCode = asyncHandler(async (req, res) => {
  const { email, purpose = 'verify-email' } = req.body;
  const user = await User.findOne({ email });

  if (purpose === 'verify-email') {
    if (!user) throw ApiError.notFound('No signup found for that email', 'NO_USER');
    if (user.emailVerified) {
      throw ApiError.badRequest('That email is already verified', 'ALREADY_VERIFIED');
    }
  }

  // Never leak whether an address exists on the reset path.
  if (user) {
    const code = await issueOtp(email, purpose);
    if (purpose === 'reset-password') await mailer.sendPasswordReset(email, code);
    else if (purpose === 'login') await mailer.sendLoginCode(email, code);
    else await mailer.sendVerificationCode(email, code, user.name.split(' ')[0]);
  }

  res.json({ success: true, message: 'Code sent to ' + email, expiresIn: OTP_TTL_MS / 1000 });
});

export const verifyEmail = asyncHandler(async (req, res) => {
  const { email, code, keys, device: deviceInfo } = req.body;

  const user = await User.findOne({ email });
  if (!user) throw ApiError.notFound('No signup found for that email', 'NO_USER');

  await consumeOtp(email, code, 'verify-email');

  user.emailVerified = true;
  user.identityPublicKey = keys.account.identityPublicKey;
  user.signingPublicKey = keys.account.signingPublicKey;
  user.encryptedIdentity = keys.account.encryptedIdentity;
  user.securityCode = sha256(keys.account.identityPublicKey).slice(0, 12).toUpperCase();
  user.lastLoginAt = new Date();
  await user.save();

  const { device, accessToken, refreshToken } = await registerDevice({
    req,
    user,
    keys: keys.device,
    deviceInfo,
  });

  res.cookie('refreshToken', refreshToken, refreshCookieOptions);
  res.status(200).json({
    success: true,
    ...sessionPayload(user, device, accessToken, refreshToken),
  });
});

export const login = asyncHandler(async (req, res) => {
  const { email, password, keys, device: deviceInfo } = req.body;

  const user = await User.findOne({ email }).select('+password');
  if (!user) throw ApiError.unauthorized('Wrong email or password', 'BAD_CREDENTIALS');
  if (user.disabledAt) throw ApiError.forbidden('This account is disabled', 'DISABLED');

  const ok = await user.comparePassword(password);
  if (!ok) throw ApiError.unauthorized('Wrong email or password', 'BAD_CREDENTIALS');

  if (!user.emailVerified) {
    const code = await issueOtp(email, 'verify-email');
    await mailer.sendVerificationCode(email, code, user.name.split(' ')[0]);
    throw ApiError.forbidden('Verify your email — we sent you a new code', 'EMAIL_UNVERIFIED');
  }

  // Step one: hand back the wrapped identity so the client can unlock locally
  // and mint its device keys before we create a session.
  if (!keys) {
    return res.json({
      success: true,
      stage: 'unlock',
      encryptedIdentity: user.encryptedIdentity,
    });
  }

  const { device, accessToken, refreshToken } = await registerDevice({
    req,
    user,
    keys: keys.device,
    deviceInfo,
  });

  user.lastLoginAt = new Date();
  await user.save();

  const deviceCount = await Device.countDocuments({ user: user._id, revokedAt: null });
  if (deviceCount > 1) mailer.sendNewDeviceAlert(user.email, device).catch(() => {});

  res.cookie('refreshToken', refreshToken, refreshCookieOptions);
  res.json({
    success: true,
    ...sessionPayload(user, device, accessToken, refreshToken),
    encryptedIdentity: user.encryptedIdentity,
  });
});

/**
 * Finishes a passkey login.
 *
 * The assertion was already verified and traded for a ticket; by now the client
 * has unlocked its identity (from the PRF-wrapped copy, or with the password
 * once) and minted its device keys. All that is left is what a password login
 * does after `comparePassword`, which is why this reuses the same helper rather
 * than growing a parallel session path that could drift out of step.
 */
export const passkeyLoginComplete = asyncHandler(async (req, res) => {
  const { ticket, keys, device: deviceInfo } = req.body;
  if (!ticket) throw ApiError.badRequest('Missing ticket', 'NO_TICKET');
  if (!keys?.device) throw ApiError.badRequest('Device keys are required', 'NO_KEYS');

  const user = await redeemTicket(ticket);

  const { device, accessToken, refreshToken } = await registerDevice({
    req,
    user,
    keys: keys.device,
    deviceInfo,
    linkedVia: 'passkey',
  });

  user.lastLoginAt = new Date();
  await user.save();

  const deviceCount = await Device.countDocuments({ user: user._id, revokedAt: null });
  if (deviceCount > 1) mailer.sendNewDeviceAlert(user.email, device).catch(() => {});

  res.cookie('refreshToken', refreshToken, refreshCookieOptions);
  res.json({
    success: true,
    ...sessionPayload(user, device, accessToken, refreshToken),
    encryptedIdentity: user.encryptedIdentity,
  });
});

export const refresh = asyncHandler(async (req, res) => {
  const token = (req.cookies && req.cookies.refreshToken) || (req.body && req.body.refreshToken);
  if (!token) throw ApiError.unauthorized('No refresh token', 'NO_REFRESH');

  let decoded;
  try {
    decoded = verifyRefreshToken(token);
  } catch {
    throw ApiError.unauthorized('Session expired — sign in again', 'REFRESH_EXPIRED');
  }

  const device = await Device.findOne({ deviceId: decoded.did, revokedAt: null }).select(
    '+refreshTokenHash'
  );
  if (!device || device.refreshTokenHash !== hashToken(token)) {
    throw ApiError.unauthorized('Session expired — sign in again', 'REFRESH_REUSED');
  }

  const user = await User.findById(decoded.sub);
  if (!user || user.disabledAt) throw ApiError.unauthorized('Account unavailable', 'NO_USER');

  const { accessToken, refreshToken } = issueTokens({
    userId: user._id,
    deviceId: device.deviceId,
  });
  device.refreshTokenHash = hashToken(refreshToken);
  device.lastActiveAt = new Date();
  await device.save();

  res.cookie('refreshToken', refreshToken, refreshCookieOptions);
  res.json({ success: true, accessToken, refreshToken, user: user.toJSON() });
});

export const logout = asyncHandler(async (req, res) => {
  if (req.device) {
    req.device.refreshTokenHash = null;
    req.device.revokedAt = new Date();
    await req.device.save();
    await PreKey.deleteMany({ deviceId: req.device.deviceId });
  }
  res.clearCookie('refreshToken', { ...refreshCookieOptions, maxAge: undefined });
  res.json({ success: true, message: 'Signed out' });
});

export const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;
  const user = await User.findOne({ email });
  if (user) {
    const code = await issueOtp(email, 'reset-password');
    await mailer.sendPasswordReset(email, code);
  }
  res.json({
    success: true,
    message: 'If ' + email + ' has an account, a reset code is on its way.',
    expiresIn: OTP_TTL_MS / 1000,
  });
});

export const resetPassword = asyncHandler(async (req, res) => {
  const { email, code, password, encryptedIdentity } = req.body;

  const user = await User.findOne({ email }).select('+password');
  if (!user) throw ApiError.badRequest('Request a new code', 'NO_USER');

  await consumeOtp(email, code, 'reset-password');

  user.password = password;
  if (encryptedIdentity) {
    // Identity blob re-wrapped under the new password by the client.
    user.encryptedIdentity = encryptedIdentity;
  }
  await user.save();

  // A password reset invalidates every session.
  await Device.updateMany(
    { user: user._id, revokedAt: null },
    { revokedAt: new Date(), refreshTokenHash: null }
  );

  res.json({ success: true, message: 'Password updated — sign in with your new password.' });
});

/** Fetched before a reset so the client can re-wrap keys it can still open. */
export const getIdentityBlob = asyncHandler(async (req, res) => {
  const email = String(req.query.email || '').toLowerCase().trim();
  const user = await User.findOne({ email }).select('encryptedIdentity identityPublicKey');
  if (!user) throw ApiError.notFound('No account for that email', 'NO_USER');
  res.json({
    success: true,
    encryptedIdentity: user.encryptedIdentity,
    identityPublicKey: user.identityPublicKey,
  });
});

export const me = asyncHandler(async (req, res) => {
  const devices = await Device.find({ user: req.user._id, revokedAt: null })
    .select(
      'deviceId name platform os browser formFactor isPrimary lastActiveAt createdAt linkedVia'
    )
    .sort({ createdAt: 1 });

  res.json({
    success: true,
    user: req.user.toJSON(),
    device: { deviceId: req.deviceId },
    devices,
    encryptedIdentity: req.user.encryptedIdentity,
  });
});

export const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword, encryptedIdentity } = req.body;
  const user = await User.findById(req.user._id).select('+password');

  const ok = await user.comparePassword(currentPassword);
  if (!ok) throw ApiError.badRequest('Current password is incorrect', 'BAD_PASSWORD');

  user.password = newPassword;
  if (encryptedIdentity) user.encryptedIdentity = encryptedIdentity;
  await user.save();

  // Keep this device signed in, drop the rest.
  await Device.updateMany(
    { user: user._id, deviceId: { $ne: req.deviceId }, revokedAt: null },
    { revokedAt: new Date(), refreshTokenHash: null }
  );

  res.json({ success: true, message: 'Password changed. Other devices were signed out.' });
});
