/**
 * Proves that a one-directional contact is still reachable.
 *
 * The bug this locks down: contacts are stored on one side only, so somebody who
 * added *you* — and who can therefore already message you — appeared nowhere in
 * New chat. The only route to them was the thread they had already started, and
 * from the outside that looks like a person the app has lost.
 *
 * The fix derives two more groups alongside the saved list, and the cases below
 * are the ones that matter: an inbound contact shows up, a shared chat shows up,
 * nobody appears in two groups at once, and blocking removes someone from all of
 * them.
 *
 * Boots the API in-process against the in-memory Mongo so it can read the
 * verification codes straight off the logger. No server to start, no log file to
 * tee, and the run cannot collide with a real database.
 *
 * Run: node scripts/contacts.test.mjs   (from backend/)
 */
process.env.USE_MEMORY_DB = 'true';
process.env.NODE_ENV = 'test';
process.env.PORT = '0';
/* The repo's .env may point at a real SMTP account, and this run signs several
   people up. Blank the mailer config before it is read so verification codes go
   to the console instead of somebody's outbox. */
process.env.SMTP_HOST = '';
process.env.SMTP_USER = '';
process.env.SMTP_PASS = '';

import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';

/**
 * The socket client comes from the web app rather than this package — it is a
 * browser dependency and the API has no business shipping one. The forensics
 * tests already reach across the same boundary for the same reason.
 */
const require = createRequire(import.meta.url);
let ioClient = null;
try {
  ioClient = require(
    path.resolve('../frontend/node_modules/socket.io-client/build/cjs/index.js')
  ).io;
} catch {
  /* The live-notification case is skipped rather than failing the run. */
}

/* ── capture the verification codes before anything can print them ── */

const codes = new Map();
const { logger } = await import('../src/utils/logger.js');
const realInfo = logger.info;
logger.info = (message) => {
  const m = /code for (\S+) → (\d{6})/.exec(String(message));
  if (m) codes.set(m[1], m[2]);
  // Silent: the point of the run is the assertions, not the API's chatter.
};

const { connectDB, disconnectDB } = await import('../src/config/db.js');
const { User } = await import('../src/models/User.js');
const { createApp } = await import('../src/app.js');
const { initSockets } = await import('../src/sockets/index.js');
const { initPush } = await import('../src/services/push.js');

logger.socket = () => {};

await connectDB();
initPush();

const server = http.createServer(createApp());
// Sockets are up because one of the cases below is about the live notification
// that tells the *other* person their reachable-people list has changed.
const io = initSockets(server);
await new Promise((resolve) => server.listen(0, resolve));
const ORIGIN = 'http://127.0.0.1:' + server.address().port;
const API = ORIGIN + '/api';

/* ── crypto, only as much as verify-email demands ── */

const subtle = globalThis.crypto.subtle;
const CURVE = { name: 'ECDH', namedCurve: 'P-256' };
const SIGN_CURVE = { name: 'ECDSA', namedCurve: 'P-256' };
const toB64 = (b) => Buffer.from(b instanceof Uint8Array ? b : new Uint8Array(b)).toString('base64');
const rand = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));
const expPub = async (k) => toB64(await subtle.exportKey('raw', k));

async function keyBundle() {
  const identity = await subtle.generateKey(CURVE, true, ['deriveBits']);
  const signing = await subtle.generateKey(SIGN_CURVE, true, ['sign', 'verify']);
  const preKey = await subtle.generateKey(CURVE, true, ['deriveBits']);
  const prePub = await expPub(preKey.publicKey);

  const signature = toB64(
    await subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      signing.privateKey,
      new Uint8Array(Buffer.from(prePub, 'base64'))
    )
  );

  const account = {
    identityPublicKey: await expPub(identity.publicKey),
    signingPublicKey: await expPub(signing.publicKey),
    // Opaque to the server, so random bytes of the right shape are honest here.
    encryptedIdentity: {
      ciphertext: toB64(rand(96)),
      iv: toB64(rand(12)),
      salt: toB64(rand(16)),
      iterations: 250000,
    },
  };

  const device = {
    registrationId: Math.floor(Math.random() * 16000) + 1,
    identityPublicKey: await expPub(identity.publicKey),
    signingPublicKey: await expPub(signing.publicKey),
    signedPreKey: { keyId: 1, publicKey: prePub, signature },
  };

  return { account, device };
}

/* ── talking to the API ── */

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
  if (!res.ok) {
    throw new Error(method + ' ' + path + ' → ' + res.status + ' ' + (data.message || ''));
  }
  return data;
}

let seq = 0;
async function signUp(name) {
  seq += 1;
  const email = 'contacts' + seq + '.' + Date.now().toString(36) + '@example.com';
  const password = 'correct horse battery';

  await call('/auth/register', { method: 'POST', body: { email, name, password } });

  const code = codes.get(email);
  if (!code) throw new Error('no verification code captured for ' + email);

  const keys = await keyBundle();
  const data = await call('/auth/verify-email', {
    method: 'POST',
    body: { email, code, keys, device: { platform: 'web' } },
  });

  return { name, email, id: data.user._id, token: data.accessToken };
}

const groupsFor = async (person) => {
  const data = await call('/users/contacts', { token: person.token });
  return {
    contacts: (data.contacts || []).map((p) => String(p._id)),
    addedYou: (data.addedYou || []).map((p) => String(p._id)),
    messaged: (data.messaged || []).map((p) => String(p._id)),
  };
};

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

const [alice, bob, carol, dave] = await Promise.all([
  signUp('Alice'),
  signUp('Bob'),
  signUp('Carol'),
  signUp('Dave'),
]);

await check('a saved contact appears in the saved list', async () => {
  await call('/users/contacts', { method: 'POST', token: alice.token, body: { userId: bob.id } });
  const g = await groupsFor(alice);
  assert(g.contacts.includes(bob.id), 'Bob is missing from Alice’s contacts');
});

await check('somebody who added you appears under "added you"', async () => {
  // The whole bug, in one assertion: Alice added Bob, and until now Bob had no
  // way to reach Alice from New chat at all.
  const g = await groupsFor(bob);
  assert(g.addedYou.includes(alice.id), 'Alice is missing from Bob’s "added you"');
  assert(!g.contacts.includes(alice.id), 'Alice was silently treated as a saved contact');
});

await check('saving them moves them out of "added you"', async () => {
  await call('/users/contacts', { method: 'POST', token: bob.token, body: { userId: alice.id } });
  const g = await groupsFor(bob);
  assert(g.contacts.includes(alice.id), 'Alice did not land in the saved list');
  assert(!g.addedYou.includes(alice.id), 'Alice is in two groups at once');
});

await check('someone you share a chat with is reachable', async () => {
  await call('/conversations/direct', {
    method: 'POST',
    token: alice.token,
    body: { userId: carol.id },
  });

  const g = await groupsFor(alice);
  assert(g.messaged.includes(carol.id), 'Carol is missing from "you have chatted with"');
  assert(!g.contacts.includes(carol.id), 'an unsaved chat partner was reported as a contact');

  // And symmetrically, from the side that never started the conversation.
  const back = await groupsFor(carol);
  assert(back.messaged.includes(alice.id), 'Alice is missing from Carol’s side');
});

await check('a saved contact is not repeated under a derived group', async () => {
  await call('/users/contacts', { method: 'POST', token: alice.token, body: { userId: carol.id } });
  const g = await groupsFor(alice);
  const appearances =
    (g.contacts.includes(carol.id) ? 1 : 0) +
    (g.addedYou.includes(carol.id) ? 1 : 0) +
    (g.messaged.includes(carol.id) ? 1 : 0);
  assert(appearances === 1, 'Carol appears in ' + appearances + ' groups');
});

await check('nobody ever appears in their own list', async () => {
  const g = await groupsFor(alice);
  const all = [...g.contacts, ...g.addedYou, ...g.messaged];
  assert(!all.includes(alice.id), 'Alice can start a chat with herself');
});

await check('blocking removes them from every group', async () => {
  await call('/conversations/direct', {
    method: 'POST',
    token: alice.token,
    body: { userId: dave.id },
  });
  await call('/users/contacts', { method: 'POST', token: alice.token, body: { userId: dave.id } });

  let g = await groupsFor(alice);
  assert(
    g.contacts.includes(dave.id) || g.messaged.includes(dave.id),
    'Dave was not reachable before the block, so the test proves nothing'
  );

  await call('/users/block/' + dave.id, { method: 'POST', token: alice.token });

  g = await groupsFor(alice);
  const all = [...g.contacts, ...g.addedYou, ...g.messaged];
  assert(!all.includes(dave.id), 'a blocked person is still offered');
});

await check('removing a contact keeps them reachable if a chat exists', async () => {
  // Carol and Alice have a conversation, so unsaving her must not hide her.
  await call('/users/contacts/' + carol.id, { method: 'DELETE', token: alice.token });
  const g = await groupsFor(alice);
  assert(!g.contacts.includes(carol.id), 'Carol is still saved');
  assert(g.messaged.includes(carol.id), 'unsaving Carol made the chat unreachable');
});

await check('an unverified account that added you is not offered', async () => {
  /* Written against the database rather than the API on purpose. An unverified
     account cannot call `POST /users/contacts` at all — `requireVerified` stops
     it — so the only way to produce this state through the front door is to
     verify first, which would defeat the test. Planting the row directly is
     what actually exercises the `emailVerified` filter on the reverse lookup,
     and without that filter a half-finished signup would be offered as a real
     person to chat to. */
  const ghostEmail = 'ghost.' + Date.now().toString(36) + '@example.com';
  await call('/auth/register', {
    method: 'POST',
    body: { email: ghostEmail, name: 'Ghost', password: 'correct horse battery' },
  });

  const ghost = await User.findOne({ email: ghostEmail });
  assert(ghost, 'the unverified account was not created');
  assert(!ghost.emailVerified, 'the account under test is verified, so it proves nothing');

  ghost.contacts.push(alice.id);
  await ghost.save();

  const g = await groupsFor(alice);
  const all = [...g.contacts, ...g.addedYou, ...g.messaged];
  assert(!all.includes(String(ghost._id)), 'an unverified account is offered as a person to chat to');
});

await check('the conversation payload reports whether the peer is saved', async () => {
  const { conversation } = await call('/conversations/direct', {
    method: 'POST',
    token: bob.token,
    body: { userId: alice.id },
  });
  assert(
    conversation.peerIsContact === true,
    'Bob saved Alice, but the chat still calls her a stranger'
  );

  const other = await call('/conversations/direct', {
    method: 'POST',
    token: carol.token,
    body: { userId: bob.id },
  });
  assert(
    other.conversation.peerIsContact === false,
    'an unsaved peer was reported as a contact — the save bar would never show'
  );
});

await check('the person being added hears about it without a reload', async () => {
  if (!ioClient) throw new Error('socket.io-client unavailable — run npm install in ../frontend');

  /* The half that is easy to forget. Saving a contact updates the saver's own
     list, but the *other* person has just become reachable from New chat and has
     no way to know — so before this event they only found out on their next
     reload, which reads as the app having lost somebody. */
  const target = await signUp('Heard');
  const socket = ioClient(ORIGIN, {
    auth: { token: target.token },
    transports: ['websocket'],
    reconnection: false,
  });

  const heard = new Promise((resolve, reject) => {
    socket.once('contacts:changed', resolve);
    socket.once('connect_error', reject);
    setTimeout(() => reject(new Error('no contacts:changed arrived within 4s')), 4000);
  });
  await new Promise((resolve, reject) => {
    socket.once('ready', resolve);
    socket.once('connect_error', reject);
    setTimeout(() => reject(new Error('socket never became ready')), 4000);
  });

  await call('/users/contacts', {
    method: 'POST',
    token: alice.token,
    body: { userId: target.id },
  });

  const payload = await heard;
  assert(
    String(payload.userId) === String(alice.id),
    'the event named ' + payload.userId + ' rather than the person who did the adding'
  );

  // And the derived group really did change, which is what the event is for.
  const g = await groupsFor(target);
  assert(g.addedYou.includes(alice.id), 'the event fired but the list did not change');

  socket.close();
});

/* ── report ── */

logger.info = realInfo;

const failed = results.filter((r) => r[0] === 'FAIL');
results.forEach(([status, name, why]) => {
  console.log((status === 'PASS' ? '  ok  ' : '  FAIL') + '  ' + name + (why ? ' — ' + why : ''));
});
console.log(
  '\n' + (results.length - failed.length) + '/' + results.length + ' contact-reachability checks passed'
);

/* Reported before teardown, deliberately. A closing socket triggers a presence
   write, and closing the database underneath that in-flight write throws — which
   would bury a perfectly good set of results under an unrelated stack trace. */
await shutdown();
process.exit(failed.length ? 1 : 0);

async function shutdown() {
  try {
    // socket.io owns the websockets and has to go first, or close() hangs.
    await new Promise((resolve) => io.close(resolve));
    // Disconnect handlers write presence back to the database; let them land.
    await new Promise((resolve) => setTimeout(resolve, 250));
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    await disconnectDB();
  } catch {
    /* the run is already reported; a messy teardown is not a failure */
  }
}
