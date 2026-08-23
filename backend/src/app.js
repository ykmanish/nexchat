import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import hpp from 'hpp';
import mongoSanitize from 'express-mongo-sanitize';
import mongoose from 'mongoose';
import path from 'node:path';

import { env, rootDir } from './config/env.js';
import routes from './routes/index.js';
import { notFound, errorHandler } from './middleware/error.js';
import { apiLimiter } from './middleware/rateLimit.js';

export function createApp() {
  const app = express();

  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  const origins = env.clientUrl.split(',').map((s) => s.trim());

  app.use(
    helmet({
      // Uploads are opaque encrypted blobs fetched cross-origin by the app.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      contentSecurityPolicy: false,
    })
  );
  app.use(
    cors({
      origin(origin, cb) {
        if (!origin || origins.includes(origin) || !env.isProd) return cb(null, true);
        cb(new Error('Blocked by CORS'));
      },
      credentials: true,
      exposedHeaders: ['X-Total-Count'],
    })
  );

  app.use(compression());
  app.use(express.json({ limit: '12mb' }));
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));
  app.use(cookieParser());
  app.use(mongoSanitize());
  app.use(hpp());

  if (!env.isProd) {
    morgan.token('short', (req) => req.originalUrl.slice(0, 60));
    app.use(morgan(':method :short :status :response-time[0]ms', { skip: (req) => req.method === 'OPTIONS' }));
  }

  app.get('/api/health', (_req, res) =>
    res.json({
      success: true,
      status: 'ok',
      uptime: Math.round(process.uptime()),
      db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
      time: new Date().toISOString(),
    })
  );

  // Encrypted attachments — the bytes here are useless without a message key.
  app.use(
    '/uploads',
    express.static(path.resolve(rootDir, env.upload.dir), {
      maxAge: '30d',
      immutable: true,
      setHeaders: (res) => res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin'),
    })
  );

  app.use('/api', apiLimiter, routes);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
