/**
 * Proves that a backgrounded device is still pushed to.
 *
 * The bug this locks down is the reason notifications did not arrive. Web Push
 * was skipped for any device holding a live socket, on the reasoning that it had
 * already received the message over the websocket. That reasoning is wrong on a
 * phone: a backgrounded PWA keeps its socket open for as long as the OS allows
 * while the browser freezes the tab's JavaScript, so the message was delivered
 * to something that drew nothing, and no notification was sent. It then appeared
 * the instant the app was opened — which from the outside is indistinguishable
 * from a notification that never came.
 *
 * The fix is a device-level foreground flag the client reports, and the cases
 * below pin down each half of it: a device that says it is hidden becomes a push
 * target, one that says it is visible does not, and anything that never reports
 * either way keeps the old behaviour so an older client is not broken.
 *
 * Run: node scripts/pushdelivery.test.mjs   (from backend/)
 */
process.env.USE_MEMORY_DB = 'true';
process.env.NODE_ENV = 'test';
/* The repo's .env may point at a real SMTP account. A test that signs four
   people up must not send four real emails to example.com, so the mailer is
   pushed onto its console-only path before config is read. */
process.env.SMTP_HOST = '';
process.env.SMTP_USER = '';
process.env.SMTP_PASS = '';

import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';

/**
 * The socket client comes from the web app rather than this package.
 *
 * It is a browser dependency and the API has no business shipping it — but this
 * test has to behave like a real client, and the whole point is the message the
 * *browser* sends. Resolving it out of ../frontend keeps the API's dependency
 * list honest, and the forensics tests already reach across the same boundary
 * for the same reason.
 */
const require = createRequire(import.meta.url);
let ioClient;
try {
  ioClient = require(
    path.resolve('../frontend/node_modules/socket.io-client/build/cjs/index.js')
  ).io;
} catch {
  console.log('  skip  socket.io-client not found — run npm install in ../frontend first');
  process.exit(0);
}

/* ── capture verification codes before anything prints them ── */

const codes = new Map();
const { logger } = await import('../src/utils/logger.js');
logger.info = (message) => {
  const m = /code for (\S+) → (\d{6})/.exec(String(message));
  if (m) codes.set(m[1], m[2]);
};
logger.warn = () => {};
logger.socket = () => {};

const trace = (step) => {
  if (process.env.TRACE) console.log('    · ' + step);
};

const { connectDB, disconnectDB } = await import('../src/config/db.js');
const { createApp } = await import('../src/app.js');
const { initSockets } = await import('../src/sockets/index.js');
const { presence } = await import('../src/services/presence.js');
const { initPush } = await import('../src/services/push.js');

trace('connecting to the in-memory database');
await connectDB();
initPush();

trace('starting the server');
const server = http.createServer(createApp());
/* Kept, because socket.io holds its own engine and its own open handles — the
   HTTP server closing is not enough to let the process exit. */
const io = initSockets(server);
await new Promise((resolve) => server.listen(0, resolve));
trace('listening');

const PORT = server.address().port;
const ORIGIN = 'http://127.0.0.1:' + PORT;
const API = ORIGIN + '/api';

/* ── the little bit of crypto verify-email insists on ── */

const subtle = globalThis.crypto.subtle;
const CURVE = { name: 'ECDH', namedCurve: 'P-256' };
const SIGN_CURVE = { name: 'ECDSA', namedCurve: 'P-256' };
const toB64 = (b) => Buffer.from(b instanceof Uint8Array ? b : new Uint8Array(b)).toString('base64');
const rand = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));
const expPub = async (k) => toB64(await subtle.exportKey('raw', k));

async function keyBundle() {
  const identity = await subtle.generateKey(CURVE, true, ['deriveBits']);
  const signing = await subtle.generateKey(SIGN_CURVE, true, ['sign', 'verify']);
  const pre = await subtle.generateKey(CURVE, true, ['deriveBits']);
  const prePub = await expPub(pre.publicKey);
  const signature = toB64(
    await subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      signing.privateKey,
      new Uint8Array(Buffer.from(prePub, 'base64'))
    )
  );
  const pub = await expPub(identity.publicKey);
  const signPub = await expPub(signing.publicKey);

  return {
    account: {
      identityPublicKey: pub,
      signingPublicKey: signPub,
      encryptedIdentity: {
        ciphertext: toB64(rand(96)),
        iv: toB64(rand(12)),
        salt: toB64(rand(16)),
        iterations: 250000,
      },
    },
    device: {
      registrationId: 7,
      identityPublicKey: pub,
      signingPublicKey: signPub,
      signedPreKey: { keyId: 1, publicKey: prePub, signature },
    },
  };
}

async function call(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(method + ' ' + path + ' → ' + res.status + ' ' + (data.message || ''));
  return data;
}

let seq = 0;
async function signUp(name) {
  seq += 1;
  const email = 'push' + seq + '.' + Date.now().toString(36) + '@example.com';
  await call('/auth/register', {
    method: 'POST',
    body: { email, name, password: 'correct horse battery' },
  });
  const code = codes.get(email);
  if (!code) throw new Error('no code captured for ' + email);

  const data = await call('/auth/verify-email', {
    method: 'POST',
    body: { email, code, keys: await keyBundle(), device: { platform: 'web' } },
  });
  return { name, email, id: data.user._id, token: data.accessToken, deviceId: data.device.deviceId };
}

/**
 * Signs the same account in again, which registers a second device.
 *
 * Not the same as opening a second tab: a tab reuses the stored token, so it
 * shares the device id baked into it. Only a fresh login mints a new one, and a
 * new device id is what the foreground flag is keyed on.
 */
async function addDevice(person) {
  const data = await call('/auth/login', {
    method: 'POST',
    body: {
      email: person.email,
      password: 'correct horse battery',
      keys: { device: (await keyBundle()).device },
      device: { platform: 'web', formFactor: 'desktop' },
    },
  });
  return { token: data.accessToken, deviceId: data.device.deviceId };
}

/** A connected socket, resolved once the server has said `ready`. */
function connect(token) {
  return new Promise((resolve, reject) => {
    const socket = ioClient(ORIGIN, {
      auth: { token },
      transports: ['websocket'],
      reconnection: false,
    });
    socket.once('ready', () => resolve(socket));
    socket.once('connect_error', reject);
    setTimeout(() => reject(new Error('socket never became ready')), 8000);
  });
}

/** Lets the server finish handling whatever was just emitted. */
const settle = () => new Promise((r) => setTimeout(r, 120));

/* ── cases ── */

const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push(['PASS', name]);
  } catch (err) {
    results.push(['FAIL', name, err.message]);
  }
};
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

trace('signing up');
const alice = await signUp('Alice');
trace('connecting a socket');
const socket = await connect(alice.token);
trace('socket ready');

await check('a freshly connected device counts as on screen', async () => {
  assert(presence.isForeground(alice.deviceId), 'a new connection was treated as hidden');
  assert(
    presence.attentiveDevicesOf(alice.id).includes(alice.deviceId),
    'a new connection is not in the attentive set'
  );
});

await check('a device that reports hidden becomes a push target', async () => {
  socket.emit('app:visibility', 'hidden');
  await settle();

  assert(!presence.isForeground(alice.deviceId), 'the device still claims to be on screen');
  assert(
    !presence.attentiveDevicesOf(alice.id).includes(alice.deviceId),
    'a hidden device is still being skipped for push — this is the original bug'
  );
  // Still connected, though: presence must not flip to offline.
  assert(presence.isOnline(alice.id), 'a backgrounded device was reported as offline');
});

await check('coming back to the foreground stops the pushes', async () => {
  socket.emit('app:visibility', 'visible');
  await settle();

  assert(presence.isForeground(alice.deviceId), 'the device is still marked hidden');
  assert(
    presence.attentiveDevicesOf(alice.id).includes(alice.deviceId),
    'a visible device would be double-notified'
  );
});

await check('a boolean is accepted as well as the string', async () => {
  // The client sends a string, but a boolean is the obvious thing for anything
  // else to send and silently ignoring it would mean silently no notifications.
  socket.emit('app:visibility', false);
  await settle();
  assert(!presence.isForeground(alice.deviceId), 'false was not understood as hidden');

  socket.emit('app:visibility', true);
  await settle();
  assert(presence.isForeground(alice.deviceId), 'true was not understood as visible');
});

await check('a hidden phone is pushed to while a visible laptop is not', async () => {
  // The case the flag exists for: a phone in a pocket and a laptop in front of
  // you. The laptop already showed the message over its socket, so pushing to it
  // would double-notify; the phone showed nothing, so it must be pushed.
  const laptopDevice = await addDevice(alice);
  const laptop = await connect(laptopDevice.token);
  await settle();

  assert(
    laptopDevice.deviceId !== alice.deviceId,
    'the second sign-in reused the first device id, so this proves nothing'
  );

  socket.emit('app:visibility', 'hidden');
  await settle();

  const attentive = presence.attentiveDevicesOf(alice.id);
  assert(!attentive.includes(alice.deviceId), 'the hidden phone would still be skipped');
  assert(attentive.includes(laptopDevice.deviceId), 'the visible laptop would be double-notified');
  assert(presence.hasAttentiveDevice(alice.id), 'the account looks unattended when it is not');

  laptop.close();
  await settle();

  // With the laptop gone, nothing on this account is being watched.
  assert(
    !presence.hasAttentiveDevice(alice.id),
    'the account still looks watched after its only visible device left'
  );
});

await check('two tabs on one device settle on the last report', async () => {
  /* Documenting a real limit rather than pretending it away. Two tabs share the
     token stored in the browser, so they share a device id, and the flag is a
     single value — whichever tab reported last wins. That is survivable because
     it fails in the safe direction: if the hidden tab wins we push, and the
     service worker then suppresses the notification because it can see a visible
     window. The alternative — tracking per socket — would mean a phone with a
     stale socket never getting pushed at all, which is the bug being fixed. */
  const secondTab = await connect(alice.token);
  await settle();

  secondTab.emit('app:visibility', 'visible');
  await settle();
  assert(presence.isForeground(alice.deviceId), 'a visible tab did not clear the flag');

  socket.emit('app:visibility', 'hidden');
  await settle();
  assert(!presence.isForeground(alice.deviceId), 'the last report did not win');

  secondTab.close();
  await settle();
});

await check('disconnecting forgets the flag', async () => {
  // Otherwise a device that was hidden when it dropped would come back marked
  // hidden and get pushes it should not — and the set would leak entries.
  socket.emit('app:visibility', 'hidden');
  await settle();
  socket.close();
  await settle();

  assert(presence.isForeground(alice.deviceId), 'the hidden flag outlived the connection');
  assert(presence.attentiveDevicesOf(alice.id).length === 0, 'a closed device is still listed');
});

/* ── report ── */

const failed = results.filter((r) => r[0] === 'FAIL');
results.forEach(([status, name, why]) => {
  console.log((status === 'PASS' ? '  ok  ' : '  FAIL') + '  ' + name + (why ? ' — ' + why : ''));
});
console.log(
  '\n' + (results.length - failed.length) + '/' + results.length + ' push-delivery checks passed'
);

/* Reported before teardown, deliberately. A closing socket triggers a presence
   write, and closing the database underneath that in-flight write throws — which
   would bury a perfectly good set of results under an unrelated stack trace. */
trace('shutting down');
try {
  // Order matters, and getting it wrong is a hang rather than an error: socket.io
  // first (it owns the websockets), then the presence writes its disconnect
  // handlers start, then any lingering HTTP connection, then the database.
  await new Promise((resolve) => io.close(resolve));
  await new Promise((resolve) => setTimeout(resolve, 250));
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  await disconnectDB();
} catch {
  /* the run is already reported; a messy teardown is not a failure */
}
trace('down');
process.exit(failed.length ? 1 : 0);
