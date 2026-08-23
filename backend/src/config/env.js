import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const bool = (v, d = false) => (v === undefined ? d : String(v).toLowerCase() === 'true');
const int = (v, d) => (v === undefined || v === '' ? d : Number.parseInt(v, 10));

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  isProd: process.env.NODE_ENV === 'production',
  port: int(process.env.PORT, 5000),
  appName: process.env.APP_NAME || 'Chax',
  clientUrl: process.env.CLIENT_URL || 'http://localhost:3000',

  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/nexchat',
  useMemoryDb: bool(process.env.USE_MEMORY_DB, false),

  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET || 'dev_access_secret_change_me',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'dev_refresh_secret_change_me',
    accessTtl: process.env.ACCESS_TOKEN_TTL || '30m',
    refreshTtl: process.env.REFRESH_TOKEN_TTL || '60d',
  },

  mail: {
    host: process.env.SMTP_HOST || '',
    port: int(process.env.SMTP_PORT, 587),
    secure: bool(process.env.SMTP_SECURE, false),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.MAIL_FROM || 'Chax <no-reply@nexchat.app>',
  },

  upload: {
    maxMb: int(process.env.MAX_UPLOAD_MB, 50),
    dir: process.env.UPLOAD_DIR || 'uploads',
  },

  push: {
    publicKey: process.env.VAPID_PUBLIC_KEY || '',
    privateKey: process.env.VAPID_PRIVATE_KEY || '',
    subject: process.env.VAPID_SUBJECT || 'mailto:no-reply@nexchat.app',
  },
};

export const rootDir = path.resolve(__dirname, '../..');
