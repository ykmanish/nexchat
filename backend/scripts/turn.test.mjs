/**
 * Proves the TURN credential handed to a browser is short-lived and derived,
 * not a shared password.
 *
 * The failure this guards against is not a crash. Putting a static relay
 * username and password in the client bundle works perfectly — for your users
 * and for everyone else who opens devtools, who then get a free proxy running
 * on your IP address and billed to your account. coturn's answer is a secret
 * the client never receives: the username is an expiry, the password is an
 * HMAC of it, and the relay verifies the arithmetic. Getting the derivation
 * subtly wrong fails the same silent way — every call falls back to a direct
 * connection and the ones that needed the relay just hang.
 *
 * Run: node scripts/turn.test.mjs   (from backend/)
 */
process.env.NODE_ENV = 'test';
process.env.TURN_URLS = 'turn:relay.example.com:3478, turns:relay.example.com:5349';
process.env.TURN_SECRET = 'test-shared-secret';
process.env.TURN_TTL_SECONDS = '3600';

import crypto from 'node:crypto';

const { iceServers } = await import('../src/controllers/call.controller.js');

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

/** Calls the handler the way express would, and hands back what it sent. */
const ask = (userId = 'user-123') =>
  new Promise((resolve, reject) => {
    const res = { json: resolve };
    Promise.resolve(iceServers({ user: { id: userId } }, res, reject)).catch(reject);
  });

const relayOf = (body) => body.iceServers.find((s) => s.username);

await check('a relay is offered alongside STUN', async () => {
  const body = await ask();
  assert(body.relay === true, 'relay should be reported as available');
  assert(body.iceServers.length === 2, 'expected STUN entry plus relay entry');
  assert(
    body.iceServers[0].urls.every((u) => u.startsWith('stun:')),
    'the first entry should be the STUN servers'
  );
});

await check('both relay URLs survive, trimmed', async () => {
  const relay = relayOf(await ask());
  assert(
    JSON.stringify(relay.urls) ===
      JSON.stringify(['turn:relay.example.com:3478', 'turns:relay.example.com:5349']),
    'expected two trimmed URLs, got ' + JSON.stringify(relay.urls)
  );
});

await check('the username is an expiry in the future', async () => {
  const relay = relayOf(await ask());
  const [expiry, who] = relay.username.split(':');
  const secondsAway = Number(expiry) - Math.floor(Date.now() / 1000);
  assert(who === 'user-123', 'the user should be named in the username');
  assert(secondsAway > 3590 && secondsAway <= 3600, 'expiry was ' + secondsAway + 's away');
});

await check('the credential is an HMAC of the username, not the secret', async () => {
  const relay = relayOf(await ask());
  const expected = crypto
    .createHmac('sha1', 'test-shared-secret')
    .update(relay.username)
    .digest('base64');
  assert(relay.credential === expected, 'credential does not match coturn derivation');
  assert(
    !JSON.stringify(relay).includes('test-shared-secret'),
    'the shared secret must never reach the client'
  );
});

await check('two users get different credentials', async () => {
  const a = relayOf(await ask('alice'));
  const b = relayOf(await ask('bob'));
  assert(a.credential !== b.credential, 'credentials should be per-user');
});

await check('no secret configured means STUN only, honestly reported', async () => {
  /* A URL without a secret cannot be authenticated against, so offering it
     would produce a relay every call tries and every call fails on. */
  const { env } = await import('../src/config/env.js');
  const secret = env.turn.secret;
  env.turn.secret = '';
  try {
    const body = await ask();
    assert(body.relay === false, 'relay should be reported as unavailable');
    assert(body.iceServers.length === 1, 'only STUN should be offered');
  } finally {
    env.turn.secret = secret;
  }
});

await check('no URLs configured means STUN only', async () => {
  const { env } = await import('../src/config/env.js');
  const urls = env.turn.urls;
  env.turn.urls = '';
  try {
    const body = await ask();
    assert(body.relay === false, 'relay should be reported as unavailable');
    assert(!relayOf(body), 'no credential should be minted with nowhere to send it');
  } finally {
    env.turn.urls = urls;
  }
});

const failed = results.filter(([s]) => s === 'FAIL');
for (const [status, name, err] of results) {
  console.log(status === 'PASS' ? '  \u2713 ' + name : '  \u2717 ' + name + ' \u2014 ' + err);
}
console.log(
  '\n' + (results.length - failed.length) + '/' + results.length + ' checks passed'
);
process.exit(failed.length ? 1 : 0);
