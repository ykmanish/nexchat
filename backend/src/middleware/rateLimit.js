import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';

const message = (msg) => ({ success: false, message: msg, code: 'RATE_LIMITED' });
const skip = () => !env.isProd && process.env.RATE_LIMIT_DEV !== 'true';

export const apiLimiter = rateLimit({
  windowMs: 60_000,
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: message('Slow down a moment, then try again.'),
  skip,
});

export const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: message('Too many attempts. Try again in a few minutes.'),
  skip,
});

export const otpLimiter = rateLimit({
  windowMs: 10 * 60_000,
  limit: 6,
  keyGenerator: (req) => (req.body?.email || req.ip || '').toLowerCase(),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: message('Too many codes requested. Wait a few minutes.'),
  skip,
});

export const uploadLimiter = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: message('Uploading too quickly.'),
  skip,
});
