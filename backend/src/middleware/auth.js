import { verifyAccessToken } from '../services/token.js';
import { User } from '../models/User.js';
import { Device } from '../models/Device.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';

function extractToken(req) {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  if (req.cookies?.accessToken) return req.cookies.accessToken;
  return null;
}

export const authenticate = asyncHandler(async (req, _res, next) => {
  const token = extractToken(req);
  if (!token) throw ApiError.unauthorized('Sign in to continue', 'NO_TOKEN');

  let decoded;
  try {
    decoded = verifyAccessToken(token);
  } catch (err) {
    throw ApiError.unauthorized(
      err.name === 'TokenExpiredError' ? 'Session expired' : 'Invalid session',
      err.name === 'TokenExpiredError' ? 'TOKEN_EXPIRED' : 'BAD_TOKEN'
    );
  }

  const [user, device] = await Promise.all([
    User.findById(decoded.sub),
    Device.findOne({ deviceId: decoded.did, revokedAt: null }),
  ]);

  if (!user || user.disabledAt) throw ApiError.unauthorized('Account unavailable', 'NO_USER');
  if (!device) throw ApiError.unauthorized('This device was signed out', 'DEVICE_REVOKED');

  req.user = user;
  req.device = device;
  req.deviceId = decoded.did;

  Device.updateOne({ _id: device._id }, { lastActiveAt: new Date() }).catch(() => {});
  next();
});

/** Blocks routes that need a verified inbox (everything except the verify flow). */
export const requireVerified = (req, _res, next) => {
  if (!req.user?.emailVerified) {
    return next(ApiError.forbidden('Verify your email to continue', 'EMAIL_UNVERIFIED'));
  }
  next();
};

/** Populates req.user when a token is present, but never rejects. */
export const optionalAuth = asyncHandler(async (req, _res, next) => {
  const token = extractToken(req);
  if (!token) return next();
  try {
    const decoded = verifyAccessToken(token);
    req.user = await User.findById(decoded.sub);
    req.deviceId = decoded.did;
  } catch {
    /* ignore */
  }
  next();
});
