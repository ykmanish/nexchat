import http from 'node:http';
import { env } from './config/env.js';
import { connectDB, disconnectDB } from './config/db.js';
import { createApp } from './app.js';
import { initSockets } from './sockets/index.js';
import { presence } from './services/presence.js';
import { initPush } from './services/push.js';
import { initAttestation } from './services/attestation.js';
import { logger } from './utils/logger.js';

async function start() {
  await connectDB();
  await presence.resetAll();
  initPush();
  await initAttestation();

  const app = createApp();
  const server = http.createServer(app);
  initSockets(server);

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      logger.error('Port ' + env.port + ' is already in use.');
      logger.error(
        'Another Chax API is probably still running. Stop it, or set PORT to something else in .env.'
      );
    } else {
      logger.error('Server error: ' + err.message);
    }
    process.exit(1);
  });

  server.listen(env.port, () => {
    const line = '─'.repeat(46);
    console.log('\n\x1b[33m' + line + '\x1b[0m');
    console.log('  \x1b[1m' + env.appName + ' API\x1b[0m  ·  ' + env.nodeEnv);
    console.log('  http://localhost:' + env.port + '/api');
    console.log('  websocket ready  ·  cors → ' + env.clientUrl);
    console.log('\x1b[33m' + line + '\x1b[0m\n');
  });

  const shutdown = async (signal) => {
    logger.warn(signal + ' received — shutting down');
    server.close(async () => {
      await disconnectDB();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection: ' + reason);
  });

  // Staying alive after an uncaught exception leaves the process in an unknown
  // state — and, on a bind failure, holding nothing while looking healthy.
  // Log it, then let the supervisor restart us.
  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception: ' + err.message);
    console.error(err.stack);
    server.close(() => process.exit(1));
    setTimeout(() => process.exit(1), 3000).unref();
  });
}

start().catch((err) => {
  logger.error('Failed to start: ' + err.message);
  process.exit(1);
});
