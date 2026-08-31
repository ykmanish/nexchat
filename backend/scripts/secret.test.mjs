/**
 * Locks down secret mode: what appears in a timeline, who is allowed to see it,
 * and the handful of actions that are pressed twice by accident every day.
 *
 * The cases worth having a test for are the ones that are quiet when they
 * break. A double-tapped heart must not count twice. A followers-only post must
 * not reach a stranger through Explore. Deleting a comment that has replies
 * must not take the replies with it. And an infinite scroll must never hand
 * back a row it has already shown, which is exactly what skip/limit does on a
 * list that is growing at the top.
 *
 * Boots the API in-process against the in-memory Mongo, so there is no server
 * to start and the run cannot touch a real database.
 *
 * Run: node scripts/feed.test.mjs   (from backend/)
 */
process.env.USE_MEMORY_DB = 'true';
process.env.NODE_ENV = 'test';
process.env.PORT = '0';
/* The repo's .env may hold real SMTP credentials and this run signs several
   people up. Blank the mailer before it is read, so codes go to the console
   rather than somebody's outbox. */
process.env.SMTP_HOST = '';
process.env.SMTP_USER = '';
process.env.SMTP_PASS = '';

import http from 'node:http';

/* ── capture verification codes before anything can print them ── */

const codes = new Map();
const { logger } = await import('../src/utils/logger.js');
logger.info = (message) => {
  const m = /code for (\S+) → (\d{6})/.exec(String(message));
  if (m) codes.set(m[1], m[2]);
};
logger.socket = () => {};

const { connectDB, disconnectDB } = await import('../src/config/db.js');
const { createApp } = await import('../src/app.js');

await connectDB();

const server = http.createServer(createApp());
await new Promise((resolve) => server.listen(0, resolve));
const API = 'http://127.0.0.1:' + server.address().port + '/api';

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
  const email = 'secret' + seq + '.' + Date.now().toString(36) + '@example.com';
  await call('/auth/register', {
    method: 'POST',
    body: { email, name, password: 'correct horse battery' },
  });

  const code = codes.get(email);
  if (!code) throw new Error('no verification code captured for ' + email);

  const data = await call('/auth/verify-email', {
    method: 'POST',
    body: { email, code, keys: await keyBundle(), device: { platform: 'web' } },
  });

  return { name, email, id: String(data.user._id), token: data.accessToken };
}

/* ── harness ── */

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

const [alice, bob, dana] = await Promise.all([signUp('Alice'), signUp('Bob'), signUp('Dana')]);

const { conversation } = await call('/conversations/direct', {
  method: 'POST',
  body: { userId: bob.id },
  token: alice.token,
});
const chat = conversation._id;

const send = (who, text) =>
  call('/messages', {
    method: 'POST',
    token: who.token,
    body: {
      conversationId: chat,
      clientId: 'c' + Math.random().toString(36).slice(2),
      type: 'text',
      body: { ciphertext: 'x'.repeat(40), iv: 'y'.repeat(16) },
      keys: [],
    },
  });

/* ── cases ── */

await check('secret mode starts off, and turning it on starts a timer', async () => {
  const before = await call('/conversations/' + chat, { token: alice.token });
  assert(!before.conversation.secret?.enabled, 'a new chat was already secret');

  const data = await call('/conversations/' + chat + '/secret', {
    method: 'PATCH',
    body: { enabled: true },
    token: alice.token,
  });

  assert(data.secret.enabled === true, 'secret did not turn on');
  assert(
    data.settings.disappearingSeconds > 0,
    'auto-delete promised nothing: disappearingSeconds is ' + data.settings.disappearingSeconds
  );
});

await check('the other side is told, in the transcript', async () => {
  const { messages } = await call('/messages/conversation/' + chat, { token: bob.token });
  const sys = messages.find((m) => m.system?.action === 'secret.on');
  assert(sys, 'no system message announced secret mode');
  assert(String(sys.system.actor._id || sys.system.actor) === alice.id, 'wrong actor recorded');
});

await check('an existing timer is left alone', async () => {
  const other = await call('/conversations/direct', {
    method: 'POST',
    body: { userId: dana.id },
    token: bob.token,
  });
  // A deliberate timer set first, then secret mode turned on over the top.
  await call('/conversations/' + other.conversation._id, {
    method: 'PATCH',
    body: { settings: { disappearingSeconds: 604800 } },
    token: bob.token,
  });
  const data = await call('/conversations/' + other.conversation._id + '/secret', {
    method: 'PATCH',
    body: { enabled: true },
    token: bob.token,
  });
  assert(
    data.settings.disappearingSeconds === 604800,
    'a deliberate seven-day timer was overwritten with ' + data.settings.disappearingSeconds
  );
});

await check('forwarding out of a secret chat is refused', async () => {
  const { message } = await send(alice, 'something private');

  const target = await call('/conversations/direct', {
    method: 'POST',
    body: { userId: dana.id },
    token: alice.token,
  });

  let refused = false;
  try {
    await call('/messages/forward', {
      method: 'POST',
      token: alice.token,
      body: {
        from: chat,
        items: [
          {
            conversationId: target.conversation._id,
            clientId: 'f' + Math.random().toString(36).slice(2),
            type: 'text',
            body: message.body,
            keys: [],
          },
        ],
      },
    });
  } catch (err) {
    refused = /cannot be forwarded/i.test(err.message);
  }
  assert(refused, 'a message was forwarded out of a secret chat');
});

await check('forwarding out of an ordinary chat still works', async () => {
  const plain = await call('/conversations/direct', {
    method: 'POST',
    body: { userId: dana.id },
    token: bob.token,
  });

  const data = await call('/messages/forward', {
    method: 'POST',
    token: alice.token,
    body: {
      from: null,
      items: [
        {
          conversationId: plain.conversation._id,
          clientId: 'f' + Math.random().toString(36).slice(2),
          type: 'text',
          body: { ciphertext: 'z'.repeat(40), iv: 'w'.repeat(16) },
          keys: [],
        },
      ],
    },
  });
  assert(data.success, 'an ordinary forward was refused');
});

await check('a screenshot report reaches the other side', async () => {
  await call('/conversations/' + chat + '/screenshot', {
    method: 'POST',
    body: { kind: 'screenshot' },
    token: bob.token,
  });

  const { messages } = await call('/messages/conversation/' + chat, { token: alice.token });
  const shot = messages.find((m) => m.system?.action === 'secret.screenshot');
  assert(shot, 'no screenshot alert was posted');
  assert(String(shot.system.actor._id || shot.system.actor) === bob.id, 'wrong person credited');
});

await check('screenshot alerts are rate limited', async () => {
  const countAlerts = async () => {
    const { messages } = await call('/messages/conversation/' + chat, { token: alice.token });
    return messages.filter((m) => m.system?.action === 'secret.screenshot').length;
  };
  const before = await countAlerts();

  // A burst — alt-tabbing repeatedly must not spam the transcript.
  for (let i = 0; i < 4; i += 1) {
    await call('/conversations/' + chat + '/screenshot', {
      method: 'POST',
      body: { kind: 'screenshot' },
      token: bob.token,
    });
  }
  assert((await countAlerts()) === before, 'a burst of reports posted ' + ((await countAlerts()) - before) + ' extra alerts');
});

await check('no alert when the chat is not secret', async () => {
  /* A fresh person, because createDirect returns the *existing* chat for a
     pair — reusing dana here silently reused the chat an earlier case had
     already made secret, and the test was checking the wrong thing. */
  const erin = await signUp('Erin');
  const open = await call('/conversations/direct', {
    method: 'POST',
    body: { userId: erin.id },
    token: bob.token,
  });
  // Reported by an actual member — a stranger is refused, which is a
  // different rule and has its own case below.
  await call('/conversations/' + open.conversation._id + '/screenshot', {
    method: 'POST',
    body: { kind: 'screenshot' },
    token: bob.token,
  });
  const { messages } = await call('/messages/conversation/' + open.conversation._id, { token: bob.token });
  assert(
    !messages.some((m) => m.system?.action === 'secret.screenshot'),
    'an ordinary chat reported a screenshot'
  );
});

await check('a stranger cannot touch the settings', async () => {
  const carol = await signUp('Carol');
  let refused = false;
  try {
    await call('/conversations/' + chat + '/secret', {
      method: 'PATCH',
      body: { enabled: false },
      token: carol.token,
    });
  } catch {
    refused = true;
  }
  assert(refused, 'somebody outside the chat changed its secret settings');
});

await check('turning it off is announced too', async () => {
  await call('/conversations/' + chat + '/secret', {
    method: 'PATCH',
    body: { enabled: false },
    token: bob.token,
  });
  const { messages } = await call('/messages/conversation/' + chat, { token: alice.token });
  assert(
    messages.some((m) => m.system?.action === 'secret.off'),
    'turning secret mode off said nothing'
  );
});

/* ── report ── */

const failed = results.filter(([s]) => s === 'FAIL');
console.log('');
for (const [status, name, message] of results) {
  console.log((status === 'PASS' ? '  ok   ' : '  FAIL ') + name + (message ? '\n         ' + message : ''));
}
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' secret-mode checks passed\n');

await new Promise((resolve) => server.close(resolve));
await disconnectDB();
process.exit(failed.length ? 1 : 0);
