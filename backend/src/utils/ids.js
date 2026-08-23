import { customAlphabet } from 'nanoid';
import crypto from 'node:crypto';

const READABLE = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I, O to avoid confusion
const LOWER = 'abcdefghijklmnopqrstuvwxyz0123456789';

export const linkCode = customAlphabet(READABLE, 8);
export const shortId = customAlphabet(LOWER, 12);
export const inviteCode = customAlphabet(READABLE, 10);

export const numericCode = (len = 6) => {
  let out = '';
  while (out.length < len) out += crypto.randomInt(0, 10);
  return out;
};

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
export const sha256 = (v) => crypto.createHash('sha256').update(v).digest('hex');
