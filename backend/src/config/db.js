import mongoose from 'mongoose';
import dns from 'node:dns';
import { env } from './env.js';
import { logger } from '../utils/logger.js';

let memoryServer = null;

/**
 * Windows and some ISP resolvers return SRV records for `mongodb+srv://` URIs
 * unreliably, which surfaces as `querySrv ETIMEOUT` / `ENOTFOUND`. Preferring
 * IPv4 and resolving through a public DNS server fixes it.
 *
 * This only kicks in for SRV URIs — overriding the resolver globally would
 * break a local mongod, a VPN, or any internal hostname. Set DNS_SERVERS in
 * .env to use different servers, or `off` to leave the system resolver alone.
 */
function tuneDnsFor(uri) {
  // Safe everywhere: only changes the order of an already-resolved lookup.
  dns.setDefaultResultOrder('ipv4first');

  if (!uri.startsWith('mongodb+srv://')) return;

  const configured = (process.env.DNS_SERVERS || '').trim();
  if (configured.toLowerCase() === 'off') return;

  const servers = configured
    ? configured.split(',').map((s) => s.trim()).filter(Boolean)
    : ['8.8.8.8', '8.8.4.4', '1.1.1.1'];

  try {
    dns.setServers(servers);
    logger.info('DNS → ' + servers.join(', ') + ' (for SRV lookup)');
  } catch (err) {
    logger.warn('Could not set DNS servers: ' + err.message);
  }
}

export async function connectDB() {
  let uri = env.mongoUri;

  if (env.useMemoryDb) {
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    memoryServer = await MongoMemoryServer.create();
    uri = memoryServer.getUri('nexchat');
    logger.warn('Using in-memory MongoDB — data is wiped on restart.');
  } else {
    tuneDnsFor(uri);
  }

  mongoose.set('strictQuery', true);

  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: env.useMemoryDb ? 30000 : 8000,
      maxPoolSize: 25,
    });
  } catch (err) {
    logger.error('MongoDB connection failed: ' + err.message);

    if (/querySrv|ENOTFOUND|EAI_AGAIN|ETIMEOUT/i.test(err.message)) {
      logger.error(
        'That looks like a DNS failure resolving the Atlas SRV record. Check the '
          + 'hostname in MONGODB_URI, try DNS_SERVERS=1.1.1.1 in .env, or use the '
          + 'non-SRV "mongodb://host1,host2,host3/..." connection string Atlas offers.'
      );
    } else if (/Authentication failed|bad auth/i.test(err.message)) {
      logger.error('The username or password in MONGODB_URI was rejected.');
    } else if (/IP address is not allowed|not whitelisted/i.test(err.message)) {
      logger.error('Add your current IP to the Atlas Network Access allow-list.');
    } else {
      logger.error(
        'Start a local mongod, set MONGODB_URI to an Atlas cluster, or run `npm run dev:mem`.'
      );
    }

    throw err;
  }

  logger.success(`MongoDB connected → ${mongoose.connection.name}`);

  mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));
  mongoose.connection.on('reconnected', () => logger.success('MongoDB reconnected'));
}

export async function disconnectDB() {
  await mongoose.connection.close();
  if (memoryServer) await memoryServer.stop();
}
