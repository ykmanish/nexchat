import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { env } from '../config/env.js';

export const signAccessToken = (payload) =>
  jwt.sign(payload, env.jwt.accessSecret, { expiresIn: env.jwt.accessTtl, issuer: 'nexchat' });

export const signRefreshToken = (payload) =>
  jwt.sign(payload, env.jwt.refreshSecret, { expiresIn: env.jwt.refreshTtl, issuer: 'nexchat' });

export const verifyAccessToken = (token) =>
  jwt.verify(token, env.jwt.accessSecret, { issuer: 'nexchat' });

export const verifyRefreshToken = (token) =>
  jwt.verify(token, env.jwt.refreshSecret, { issuer: 'nexchat' });

export const hashToken = (token) =>
  crypto.createHash('sha256').update(token).digest('hex');

export function issueTokens({ userId, deviceId }) {
  const accessToken = signAccessToken({ sub: String(userId), did: deviceId, typ: 'access' });
  const refreshToken = signRefreshToken({ sub: String(userId), did: deviceId, typ: 'refresh' });
  return { accessToken, refreshToken };
}

export const refreshCookieOptions = {
  httpOnly: true,
  sameSite: env.isProd ? 'none' : 'lax',
  secure: env.isProd,
  path: '/api/auth',
  maxAge: 1000 * 60 * 60 * 24 * 60,
};
