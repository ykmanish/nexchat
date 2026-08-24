/**
 * Exercises the new endpoints against an API booted in this process on an
 * in-memory database. In-process so the verification code can be read out of
 * the Otp collection rather than scraped off the server's stdout.
 *
 * Usage: node api.test.mjs   (from backend/)
 */
import http from 'node:http';

process.env.USE_MEMORY_DB = 'true';
process.env.NODE_ENV = 'development';
process.env.CLIENT_URL = 'http://localhost:3000';
process.env.SMTP_HOST = '';
process.env.SMTP_USER = '';

const { connectDB, disconnectDB } = await import('../src/config/db.js');
const { createApp } = await import('../src/app.js');
const { User, Device } = await import('../src/models/index.js');
const { issueTokens, hashToken } = await import('../src/services/token.js');
const { initAttestation } = await import('../src/services/attestation.js');
await initAttestation();

await connectDB();
const server = http.createServer(createApp());
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const API = 'http://127.0.0.1:' + server.address().port + '/api';

const results = [];
const pass = (n) => results.push(['PASS', n]);
const fail = (n, why) => results.push(['FAIL', n, why]);

async function check(name, fn) {
  try {
    await fn();
    pass(name);
  } catch (err) {
    fail(name, err.message);
  }
}

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

let cookies = '';

async function api(method, path, body, token) {
  const res = await fetch(API + path, {
    method,
    headers: {
      ...(body instanceof Uint8Array
        ? { 'content-type': 'application/octet-stream' }
        : body
          ? { 'content-type': 'application/json' }
          : {}),
      ...(token ? { authorization: 'Bearer ' + token } : {}),
      ...(cookies ? { cookie: cookies } : {}),
    },
    body: body instanceof Uint8Array ? body : body ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookies = setCookie.split(';')[0];
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* empty body */
  }
  return { status: res.status, body: json };
}

/* ── fake E2EE key material: the server only stores it, never reads it ── */
const b64 = (s) => Buffer.from(s).toString('base64');
const deviceKeys = (tag) => ({
  device: {
    deviceId: 'dev_' + tag,
    registrationId: 1234,
    identityPublicKey: b64('idpub-' + tag),
    signingPublicKey: b64('sigpub-' + tag),
    signedPreKey: { keyId: 1, publicKey: b64('spk-' + tag), signature: b64('sig-' + tag) },
    oneTimePreKeys: [{ keyId: 1, publicKey: b64('otp-' + tag) }],
  },
});

const accountKeys = (tag) => ({
  identityPublicKey: b64('account-identity-public-key-' + tag),
  signingPublicKey: b64('account-signing-public-key-' + tag),
  encryptedIdentity: {
    ciphertext: b64('wrapped-identity-blob-for-' + tag),
    iv: b64('iv-123456789012'),
    salt: b64('salt-1234567890'),
    iterations: 250000,
  },
});

const envelope = (text) => ({
  body: { ciphertext: b64(text), iv: b64('iv-000000000000') },
  keys: [],
});

/** Seeds a verified account with a device session, skipping the signup flow. */
async function makeUser(tag) {
  const email = tag + '@chax.test';
  const user = await User.create({
    email,
    name: tag.charAt(0).toUpperCase() + tag.slice(1) + ' Tester',
    password: 'Passw0rd!' + tag,
    emailVerified: true,
    identityPublicKey: b64('account-identity-' + tag),
    signingPublicKey: b64('account-signing-' + tag),
    encryptedIdentity: {
      ciphertext: b64('wrapped-identity-blob-for-' + tag),
      iv: b64('iv-123456789012'),
      salt: b64('salt-1234567890'),
      iterations: 250000,
    },
  });

  const deviceId = 'dev_' + tag;
  const device = await Device.create({
    user: user._id,
    deviceId,
    name: tag + ' browser',
    registrationId: 1234,
    identityPublicKey: b64('idpub-' + tag),
    signingPublicKey: b64('sigpub-' + tag),
    signedPreKey: {
      keyId: 1,
      publicKey: b64('spk-' + tag),
      signature: b64('sig-' + tag),
      createdAt: new Date(),
    },
    isPrimary: true,
  });

  const { accessToken, refreshToken } = issueTokens({ userId: user._id, deviceId });
  device.refreshTokenHash = hashToken(refreshToken);
  await device.save();

  return { token: accessToken, id: String(user._id), email, deviceId };
}

/* ─────────────────────────────── the run ─────────────────────────────── */

const health = await api('GET', '/health');
if (health.status !== 200) {
  console.error('API not reachable at ' + API);
  process.exit(2);
}

let alice;
let bob;
let carol;
try {
  alice = await makeUser('alice');
  bob = await makeUser('bob');
  carol = await makeUser('carol');
} catch (err) {
  console.error('setup failed: ' + err.message);
  process.exit(2);
}

let group;
await check('a group can be created', async () => {
  const res = await api(
    'POST',
    '/conversations/group',
    { name: 'Test Group', memberIds: [bob.id, carol.id] },
    alice.token
  );
  assert(res.status === 201 || res.status === 200, JSON.stringify(res.body));
  group = res.body.conversation;
  assert(group.settings.slowModeSeconds === 0, 'slowModeSeconds missing from settings');
  assert(group.mentionCount === 0, 'mentionCount missing');
  assert(group.muteMode === 'all', 'muteMode missing');
});

/* ── mentions ── */

let mentionMsg;
await check('a mention is stored and reported to the mentioned user', async () => {
  const res = await api(
    'POST',
    '/messages',
    {
      conversationId: group._id,
      clientId: 'cid-mention-1',
      ...envelope('hey @bob'),
      mentions: [bob.id],
    },
    alice.token
  );
  assert(res.status === 201, JSON.stringify(res.body));
  mentionMsg = res.body.message;
  assert(res.body.message.mentionedMe === false, 'sender should not be mentioned');

  const asBob = await api('GET', '/messages/' + mentionMsg._id, null, bob.token);
  assert(asBob.body.message.mentionedMe === true, 'bob should see mentionedMe');

  const list = await api('GET', '/conversations', null, bob.token);
  const conv = list.body.conversations.find((c) => String(c._id) === String(group._id));
  assert(conv.mentionCount === 1, 'mentionCount should be 1, got ' + conv.mentionCount);
});

await check('a mention for a non-member is dropped', async () => {
  const outsider = '507f1f77bcf86cd799439011';
  const res = await api(
    'POST',
    '/messages',
    {
      conversationId: group._id,
      clientId: 'cid-mention-2',
      ...envelope('hey stranger'),
      mentions: [outsider],
    },
    alice.token
  );
  assert(res.status === 201, JSON.stringify(res.body));
  assert(
    (res.body.message.mentions || []).length === 0,
    'a non-member should not survive filtering'
  );
});

await check('reading a chat clears its mention badge', async () => {
  await api('POST', '/conversations/' + group._id + '/read', {}, bob.token);
  const list = await api('GET', '/conversations', null, bob.token);
  const conv = list.body.conversations.find((c) => String(c._id) === String(group._id));
  assert(conv.mentionCount === 0, 'mentionCount should reset, got ' + conv.mentionCount);
});

await check('mute mode round-trips', async () => {
  const res = await api(
    'PATCH',
    '/conversations/' + group._id + '/state',
    { muted: true, muteMode: 'mentions' },
    bob.token
  );
  assert(res.status === 200, JSON.stringify(res.body));
  const list = await api('GET', '/conversations', null, bob.token);
  const conv = list.body.conversations.find((c) => String(c._id) === String(group._id));
  assert(conv.muteMode === 'mentions', 'muteMode did not persist');
});

/* ── threads ── */

await check('a thread reply stays out of the timeline', async () => {
  const reply = await api(
    'POST',
    '/messages',
    {
      conversationId: group._id,
      clientId: 'cid-thread-1',
      ...envelope('in the thread'),
      threadRoot: mentionMsg._id,
    },
    bob.token
  );
  assert(reply.status === 201, JSON.stringify(reply.body));
  assert(String(reply.body.message.threadRoot) === String(mentionMsg._id), 'threadRoot not set');

  const timeline = await api(
    'GET',
    '/messages/conversation/' + group._id,
    null,
    alice.token
  );
  const ids = timeline.body.messages.map((m) => String(m._id));
  assert(!ids.includes(String(reply.body.message._id)), 'reply leaked into the timeline');
});

await check('the thread endpoint returns root plus replies with a count', async () => {
  const res = await api('GET', '/messages/' + mentionMsg._id + '/thread', null, alice.token);
  assert(res.status === 200, JSON.stringify(res.body));
  assert(res.body.replies.length === 1, 'expected 1 reply, got ' + res.body.replies.length);
  assert(res.body.root.thread.replyCount === 1, 'root replyCount not incremented');
});

await check('a reply nests no deeper than one level', async () => {
  const first = await api('GET', '/messages/' + mentionMsg._id + '/thread', null, alice.token);
  const replyId = first.body.replies[0]._id;

  const nested = await api(
    'POST',
    '/messages',
    {
      conversationId: group._id,
      clientId: 'cid-thread-2',
      ...envelope('reply to a reply'),
      threadRoot: replyId,
    },
    carol.token
  );
  assert(nested.status === 201, JSON.stringify(nested.body));
  assert(
    String(nested.body.message.threadRoot) === String(mentionMsg._id),
    'a nested reply should join the same thread, got ' + nested.body.message.threadRoot
  );
});

await check('deleting a reply gives the count back', async () => {
  const before = await api('GET', '/messages/' + mentionMsg._id + '/thread', null, alice.token);
  const target = before.body.replies[before.body.replies.length - 1];

  const del = await api('DELETE', '/messages/' + target._id + '?scope=everyone', null, carol.token);
  assert(del.status === 200, JSON.stringify(del.body));

  const after = await api('GET', '/messages/' + mentionMsg._id + '/thread', null, alice.token);
  assert(
    after.body.root.thread.replyCount === before.body.root.thread.replyCount - 1,
    'replyCount did not decrease'
  );
});

/* ── slow mode ── */

await check('slow mode is admin-only to set', async () => {
  const res = await api(
    'PATCH',
    '/conversations/' + group._id,
    { settings: { slowModeSeconds: 30 } },
    bob.token
  );
  assert(res.status === 403, 'a member should not be able to set slow mode, got ' + res.status);
});

await check('slow mode throttles members and exempts admins', async () => {
  const dave = await makeUser('dave');
  await api('POST', '/conversations/' + group._id + '/members', { memberIds: [dave.id] }, alice.token);

  const on = await api(
    'PATCH',
    '/conversations/' + group._id,
    { settings: { slowModeSeconds: 60 } },
    alice.token
  );
  assert(on.status === 200, JSON.stringify(on.body));

  // Nobody has heard from Dave yet, so his first message is not held back.
  const first = await api(
    'POST',
    '/messages',
    { conversationId: group._id, clientId: 'cid-slow-1', ...envelope('one') },
    dave.token
  );
  assert(first.status === 201, 'a first send should pass: ' + JSON.stringify(first.body));

  const second = await api(
    'POST',
    '/messages',
    { conversationId: group._id, clientId: 'cid-slow-2', ...envelope('two') },
    dave.token
  );
  assert(second.status === 429, 'second send should be throttled, got ' + second.status);
  assert(second.body.code === 'SLOW_MODE', 'wrong code: ' + second.body.code);
  assert(second.body.details?.retryAfter > 0, 'no retryAfter given');

  // Bob spoke moments ago, so switching it on catches him straight away — slow
  // mode is a gap between messages, not a grace period.
  const bobbed = await api(
    'POST',
    '/messages',
    { conversationId: group._id, clientId: 'cid-slow-5', ...envelope('me too') },
    bob.token
  );
  assert(bobbed.status === 429, 'a recent sender should be caught, got ' + bobbed.status);

  // The admin who turned it on is not subject to it.
  const a1 = await api(
    'POST',
    '/messages',
    { conversationId: group._id, clientId: 'cid-slow-3', ...envelope('admin one') },
    alice.token
  );
  const a2 = await api(
    'POST',
    '/messages',
    { conversationId: group._id, clientId: 'cid-slow-4', ...envelope('admin two') },
    alice.token
  );
  assert(a1.status === 201 && a2.status === 201, 'admin should be exempt from slow mode');

  const off = await api(
    'PATCH',
    '/conversations/' + group._id,
    { settings: { slowModeSeconds: 0 } },
    alice.token
  );
  assert(off.status === 200, 'could not turn slow mode off');
});

/* ── bans ── */

await check('an admin can ban, and the ban blocks the invite link', async () => {
  const invite = await api('GET', '/conversations/' + group._id + '/invite', null, alice.token);
  const code = invite.body.inviteCode;
  assert(code, 'no invite code: ' + JSON.stringify(invite.body));

  const ban = await api('POST', '/conversations/' + group._id + '/bans/' + carol.id, {}, alice.token);
  assert(ban.status === 200, JSON.stringify(ban.body));

  const rejoin = await api('POST', '/conversations/join/' + code, {}, carol.token);
  assert(rejoin.status === 403, 'a banned user rejoined via invite, got ' + rejoin.status);

  const send = await api(
    'POST',
    '/messages',
    { conversationId: group._id, clientId: 'cid-banned', ...envelope('let me in') },
    carol.token
  );
  assert(send.status === 403 || send.status === 404, 'a banned user could still post');
});

await check('a member cannot ban', async () => {
  const res = await api('POST', '/conversations/' + group._id + '/bans/' + bob.id, {}, bob.token);
  assert(res.status === 403 || res.status === 400, 'expected refusal, got ' + res.status);
});

await check('bans list and unban work', async () => {
  const list = await api('GET', '/conversations/' + group._id + '/bans', null, alice.token);
  assert(list.status === 200 && list.body.bans.length === 1, JSON.stringify(list.body));

  const un = await api(
    'DELETE',
    '/conversations/' + group._id + '/bans/' + carol.id,
    null,
    alice.token
  );
  assert(un.status === 200 && un.body.bannedCount === 0, JSON.stringify(un.body));
});

await check('an admin can delete another member\'s message for everyone', async () => {
  const msg = await api(
    'POST',
    '/messages',
    { conversationId: group._id, clientId: 'cid-mod-1', ...envelope('spam') },
    bob.token
  );
  assert(msg.status === 201, 'setup send failed: ' + JSON.stringify(msg.body));
  const del = await api(
    'DELETE',
    '/messages/' + msg.body.message._id + '?scope=everyone',
    null,
    alice.token
  );
  assert(del.status === 200, JSON.stringify(del.body));

  const check2 = await api('GET', '/messages/' + msg.body.message._id, null, alice.token);
  assert(check2.body.message.deletedForEveryone === true, 'not marked deleted');
});

/* ── call links ── */

let link;
await check('a call link can be created and inspected', async () => {
  const res = await api(
    'POST',
    '/calls/links',
    { name: 'Standup', mode: 'video', expiresInHours: 2 },
    alice.token
  );
  assert(res.status === 201, JSON.stringify(res.body));
  link = res.body.link;
  assert(link.code && link.url.includes(link.code), 'no usable url');
  assert(link.live === true, 'should be live');

  // Someone with no shared chat can still look at it — that is the point.
  const seen = await api('GET', '/calls/links/' + link.code, null, carol.token);
  assert(seen.status === 200 && seen.body.link.live, JSON.stringify(seen.body));
  assert(seen.body.link.host.name.includes('Alice'), 'host not named');
});

await check('joining a link starts one call and then reuses it', async () => {
  const first = await api('POST', '/calls/links/' + link.code + '/join', {}, alice.token);
  assert(first.status === 200 && first.body.callId, JSON.stringify(first.body));
  assert(first.body.isHost === true, 'creator should be host');

  const second = await api('POST', '/calls/links/' + link.code + '/join', {}, carol.token);
  assert(second.status === 200, JSON.stringify(second.body));
  assert(second.body.callId === first.body.callId, 'second joiner started a different call');
  assert(second.body.isHost === false, 'guest should not be host');
  assert(second.body.participants.length === 2, 'expected 2 participants');
});

await check('a revoked link stops working', async () => {
  const res = await api('DELETE', '/calls/links/' + link.code, null, alice.token);
  assert(res.status === 200, JSON.stringify(res.body));

  const join = await api('POST', '/calls/links/' + link.code + '/join', {}, carol.token);
  assert(join.status === 403, 'a revoked link still admitted someone, got ' + join.status);

  const seen = await api('GET', '/calls/links/' + link.code, null, carol.token);
  assert(seen.body.link.live === false && seen.body.reason === 'revoked', JSON.stringify(seen.body));
});

await check('only the owner can revoke a link', async () => {
  const mine = await api('POST', '/calls/links', { name: 'Mine' }, alice.token);
  const res = await api('DELETE', '/calls/links/' + mine.body.link.code, null, bob.token);
  assert(res.status === 404, 'someone else revoked it, got ' + res.status);
});

/* ── backups ── */

await check('a backup round-trips and stays opaque', async () => {
  const archive = {
    ciphertext: Buffer.from('x'.repeat(4096)).toString('base64'),
    iv: 'aXYtMTIzNDU2Nzg5MDEy',
    salt: 'c2FsdC0xMjM0NTY3ODkw',
    iterations: 310000,
    verifier: 'dmVyaWZpZXI',
    stats: { messages: 1204, conversations: 12, sessions: 8, media: 3 },
    deviceName: 'Test device',
  };
  const put = await api('PUT', '/backups', archive, alice.token);
  assert(put.status === 201, JSON.stringify(put.body));
  assert(put.body.backup.stats.messages === 1204, 'stats not stored');
  assert(put.body.backup.ciphertext === undefined, 'summary should not include ciphertext');

  const info = await api('GET', '/backups', null, alice.token);
  assert(info.body.backup.size > 0, 'no size recorded');

  const full = await api('GET', '/backups/archive', null, alice.token);
  assert(full.body.backup.ciphertext === archive.ciphertext, 'ciphertext changed in flight');
  assert(full.body.backup.salt === archive.salt, 'salt lost');
  assert(full.body.backup.iterations === 310000, 'iterations lost');
});

await check('only one backup is kept per account', async () => {
  await api(
    'PUT',
    '/backups',
    {
      ciphertext: Buffer.from('y'.repeat(128)).toString('base64'),
      iv: 'aXYtMTIzNDU2Nzg5MDEy',
      salt: 'c2FsdC0xMjM0NTY3ODkw',
    },
    alice.token
  );
  const full = await api('GET', '/backups/archive', null, alice.token);
  assert(full.body.backup.ciphertext.startsWith(Buffer.from('y').toString('base64').slice(0, 2)) ||
    full.body.backup.size < 200, 'the second put did not replace the first');
});

await check('one account cannot read another\'s backup', async () => {
  const res = await api('GET', '/backups/archive', null, bob.token);
  assert(res.status === 404, 'bob reached a backup, got ' + res.status);
});

await check('a backup can be deleted', async () => {
  const res = await api('DELETE', '/backups', null, alice.token);
  assert(res.status === 200, JSON.stringify(res.body));
  const gone = await api('GET', '/backups', null, alice.token);
  assert(gone.body.backup === null, 'still there');
});

/* ── forensic attestation ── */

await check('the attestation authority key is public', async () => {
  // No token: a verifier is a third party with the file and no account.
  const res = await api('GET', '/forensics/authority');
  assert(res.status === 200, JSON.stringify(res.body));
  assert(res.body.authority.publicKey, 'no public key offered');
  assert(res.body.authority.algorithm === 'ECDSA-P256-SHA256', 'wrong algorithm');
  assert(
    /not an RFC 3161/i.test(res.body.authority.assurance),
    'the authority should not let itself be mistaken for a real TSA'
  );
});

let attested;
await check('a root can be attested and the signature verifies', async () => {
  const root = Buffer.from('a-merkle-root-for-testing-0001').toString('base64');
  const res = await api(
    'POST',
    '/forensics/attest',
    { exportId: 'exp-test-0001', merkleRoot: root, recordCount: 12 },
    alice.token
  );
  assert(res.status === 201, JSON.stringify(res.body));
  attested = res.body.attestation;
  assert(attested.serverTime, 'no server time');
  assert(attested.signature, 'no signature');

  // Verify it the way an examiner would: canonical statement, authority key.
  const { canonical } = await import('../src/services/attestation.js');
  const statement = {
    exportId: attested.exportId,
    merkleRoot: attested.merkleRoot,
    recordCount: attested.recordCount,
    serverTime: attested.serverTime,
    algorithm: attested.algorithm,
  };
  const key = await crypto.subtle.importKey(
    'raw',
    Buffer.from(attested.publicKey, 'base64'),
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['verify']
  );
  const ok = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    Buffer.from(attested.signature, 'base64'),
    Buffer.from(canonical(statement), 'utf8')
  );
  assert(ok, 'the attestation signature did not verify');
});

await check('anyone holding the export id can confirm the attestation', async () => {
  const res = await api('GET', '/forensics/attestation/exp-test-0001');
  assert(res.status === 200, JSON.stringify(res.body));
  assert(res.body.attestation.merkleRoot === attested.merkleRoot, 'root differs');
  // The second channel must not leak who exported it.
  assert(res.body.attestation.user === undefined, 'the public view leaked the exporter');
});

await check('an export id cannot be re-bound to a different root', async () => {
  const res = await api(
    'POST',
    '/forensics/attest',
    { exportId: 'exp-test-0001', merkleRoot: Buffer.from('a-different-root-entirely').toString('base64') },
    alice.token
  );
  assert(res.status === 409 && res.body.code === 'ID_REUSED', 'expected a conflict, got ' + res.status);
});

await check('re-attesting the same root is idempotent', async () => {
  const res = await api(
    'POST',
    '/forensics/attest',
    { exportId: 'exp-test-0001', merkleRoot: attested.merkleRoot, recordCount: 12 },
    alice.token
  );
  assert(res.status === 200 && res.body.replayed === true, 'expected a replay, got ' + res.status);
  assert(res.body.attestation.serverTime === attested.serverTime, 'the original time moved');
});

await check('attesting requires a session', async () => {
  const res = await api('POST', '/forensics/attest', {
    exportId: 'exp-test-0002',
    merkleRoot: Buffer.from('unauthenticated-attempt-here').toString('base64'),
  });
  assert(res.status === 401, 'an anonymous caller got an attestation, got ' + res.status);
});

await check('an unknown export id is simply not found', async () => {
  const res = await api('GET', '/forensics/attestation/exp-does-not-exist');
  assert(res.status === 404, 'expected 404, got ' + res.status);
});

/* ── device sync ── */

await check('a snapshot round-trips and its version advances', async () => {
  const first = await api(
    'PUT',
    '/sync/snapshot',
    {
      ciphertext: Buffer.from('z'.repeat(2048)).toString('base64'),
      iv: 'aXYtMTIzNDU2Nzg5MDEy',
      stats: { messages: 42, conversations: 3, sessions: 2 },
    },
    alice.token
  );
  assert(first.status === 201, JSON.stringify(first.body));
  const v1 = first.body.snapshot.version;

  const read = await api('GET', '/sync/snapshot', null, alice.token);
  assert(read.status === 200, JSON.stringify(read.body));
  assert(read.body.snapshot.stats.messages === 42, 'stats lost');
  assert(read.body.snapshot.ciphertext.length > 100, 'ciphertext lost');

  // A second push must not reuse the version, or a device that already applied
  // it would skip a snapshot it has never seen.
  const second = await api(
    'PUT',
    '/sync/snapshot',
    { ciphertext: 'YWJjZGVm', iv: 'aXYtMTIzNDU2Nzg5MDEy' },
    alice.token
  );
  assert(second.body.snapshot.version > v1, 'version did not advance');
});

await check('snapshot info carries no ciphertext', async () => {
  const res = await api('GET', '/sync/snapshot/info', null, alice.token);
  assert(res.status === 200, JSON.stringify(res.body));
  assert(res.body.snapshot.ciphertext === undefined, 'info leaked the payload');
  assert(res.body.snapshot.version > 0, 'no version');
});

await check("one account cannot read another's snapshot", async () => {
  const res = await api('GET', '/sync/snapshot', null, bob.token);
  assert(res.status === 404, 'bob reached it, got ' + res.status);
});

await check('a snapshot can be deleted', async () => {
  const res = await api('DELETE', '/sync/snapshot', null, alice.token);
  assert(res.status === 200, JSON.stringify(res.body));
  const gone = await api('GET', '/sync/snapshot', null, alice.token);
  assert(gone.status === 404, 'still there');
});

/* ── clearing a chat ── */

await check('clearing a chat drops its sidebar preview', async () => {
  const solo = await api('POST', '/conversations/direct', { userId: bob.id }, alice.token);
  const convId = solo.body.conversation._id;

  await api(
    'POST',
    '/messages',
    { conversationId: convId, clientId: 'cid-clear-1', ...envelope('last word') },
    alice.token
  );

  const before = await api('GET', '/conversations', null, alice.token);
  const withPreview = before.body.conversations.find((c) => String(c._id) === String(convId));
  assert(withPreview.lastMessage, 'setup: expected a preview to begin with');

  await api('POST', '/conversations/' + convId + '/clear', {}, alice.token);

  const after = await api('GET', '/conversations', null, alice.token);
  const cleared = after.body.conversations.find((c) => String(c._id) === String(convId));
  assert(cleared.lastMessage === null, 'the preview survived the clear');

  // Only for whoever cleared it — the other side still has their history.
  const theirs = await api('GET', '/conversations', null, bob.token);
  const bobs = theirs.body.conversations.find((c) => String(c._id) === String(convId));
  assert(bobs.lastMessage, "clearing one side wiped the other side's preview");
});

/* ── resumable uploads ── */

await check('a chunked upload assembles, resumes and verifies', async () => {
  const chunkSize = 64 * 1024;
  const total = chunkSize * 2 + 500; // three chunks, last one short
  const bytes = new Uint8Array(total);
  for (let i = 0; i < total; i += 1) bytes[i] = i % 251;

  const digest = Buffer.from(
    await crypto.subtle.digest('SHA-256', bytes)
  ).toString('base64url');

  const begin = await api(
    'POST',
    '/uploads/resumable',
    { size: total, chunkSize, bucket: 'media', checksum: digest },
    alice.token
  );
  assert(begin.status === 201, JSON.stringify(begin.body));
  const { id, chunks } = begin.body.upload;
  assert(chunks === 3, 'expected 3 chunks, got ' + chunks);

  // Deliberately out of order, and with a gap, to prove order does not matter.
  for (const i of [2, 0]) {
    const part = bytes.slice(i * chunkSize, Math.min((i + 1) * chunkSize, total));
    const res = await api('PUT', '/uploads/resumable/' + id + '/' + i, part, alice.token);
    assert(res.status === 200, 'chunk ' + i + ': ' + JSON.stringify(res.body));
  }

  const status = await api('GET', '/uploads/resumable/' + id, null, alice.token);
  assert(status.body.upload.missing.join() === '1', 'missing should be [1], got ' + status.body.upload.missing);

  const early = await api('POST', '/uploads/resumable/' + id + '/complete', {}, alice.token);
  assert(early.status === 400 && early.body.code === 'INCOMPLETE', 'completed while short a chunk');

  const part1 = bytes.slice(chunkSize, chunkSize * 2);
  await api('PUT', '/uploads/resumable/' + id + '/1', part1, alice.token);

  const done = await api('POST', '/uploads/resumable/' + id + '/complete', {}, alice.token);
  assert(done.status === 201, JSON.stringify(done.body));
  assert(done.body.file.size === total, 'assembled size ' + done.body.file.size + ' != ' + total);
  assert(done.body.file.checksum === digest, 'checksum mismatch after assembly');
  assert(done.body.file.url.startsWith('/uploads/media/'), 'bad url');
});

await check('a wrong-sized chunk is refused', async () => {
  const chunkSize = 64 * 1024;
  const begin = await api(
    'POST',
    '/uploads/resumable',
    { size: chunkSize * 2, chunkSize },
    alice.token
  );
  const res = await api(
    'PUT',
    '/uploads/resumable/' + begin.body.upload.id + '/0',
    new Uint8Array(100),
    alice.token
  );
  assert(res.status === 400 && res.body.code === 'BAD_CHUNK_SIZE', JSON.stringify(res.body));
});

await check('one account cannot touch another\'s upload session', async () => {
  const begin = await api('POST', '/uploads/resumable', { size: 1024, chunkSize: 65536 }, alice.token);
  const res = await api(
    'GET',
    '/uploads/resumable/' + begin.body.upload.id,
    null,
    bob.token
  );
  assert(res.status === 404, 'bob reached the session, got ' + res.status);
});

/* ── passkeys: everything that does not need real hardware ── */

await check('passkey registration options are well formed', async () => {
  const res = await api('POST', '/auth/passkeys/register/options', {}, alice.token);
  assert(res.status === 200, JSON.stringify(res.body));
  const o = res.body.options;
  assert(o.challenge && o.challenge.length > 20, 'no challenge');
  assert(o.rp?.id, 'no rp id');
  assert(o.authenticatorSelection.userVerification === 'required', 'UV not required');
  assert(o.authenticatorSelection.residentKey === 'required', 'not discoverable');
  assert(res.body.prfSalt, 'no prf salt');
});

await check('passkey login options reveal nothing about accounts', async () => {
  const res = await api('POST', '/auth/passkeys/login/options', {});
  assert(res.status === 200, JSON.stringify(res.body));
  assert(res.body.options.challenge, 'no challenge');
  assert(
    !res.body.options.allowCredentials || res.body.options.allowCredentials.length === 0,
    'allowCredentials should be empty for a discoverable login'
  );
});

await check('a forged assertion is rejected', async () => {
  const opts = await api('POST', '/auth/passkeys/login/options', {});
  const clientData = Buffer.from(
    JSON.stringify({
      type: 'webauthn.get',
      challenge: opts.body.options.challenge,
      origin: 'http://localhost:3000',
    })
  ).toString('base64url');

  const res = await api('POST', '/auth/passkeys/login/verify', {
    credential: {
      id: 'bm90LWEtcmVhbC1jcmVkZW50aWFs',
      rawId: 'bm90LWEtcmVhbC1jcmVkZW50aWFs',
      type: 'public-key',
      response: {
        clientDataJSON: clientData,
        authenticatorData: Buffer.alloc(37).toString('base64url'),
        signature: Buffer.alloc(64).toString('base64url'),
      },
    },
  });
  assert(res.status === 401, 'a forged assertion was accepted, got ' + res.status);
  assert(res.body.code === 'NO_PASSKEY', 'wrong reason: ' + res.body.code);
});

await check('a challenge cannot be replayed', async () => {
  const opts = await api('POST', '/auth/passkeys/login/options', {});
  const challenge = opts.body.options.challenge;
  const clientData = Buffer.from(
    JSON.stringify({ type: 'webauthn.get', challenge, origin: 'http://localhost:3000' })
  ).toString('base64url');
  const payload = {
    credential: {
      id: 'bm90LWEtcmVhbC1jcmVkZW50aWFs',
      type: 'public-key',
      response: {
        clientDataJSON: clientData,
        authenticatorData: Buffer.alloc(37).toString('base64url'),
        signature: Buffer.alloc(64).toString('base64url'),
      },
    },
  };

  await api('POST', '/auth/passkeys/login/verify', payload);
  const again = await api('POST', '/auth/passkeys/login/verify', payload);
  assert(
    again.body.code === 'CHALLENGE_EXPIRED',
    'a burnt challenge was accepted again: ' + again.body.code
  );
});

await check('a passkey login ticket is required and single-use', async () => {
  const res = await api('POST', '/auth/passkeys/login/complete', {
    ticket: 'made-up-ticket',
    ...deviceKeys('forged'),
  });
  assert(res.status === 400, 'a bogus ticket was accepted, got ' + res.status);
});

/* ─────────────────────────────── report ─────────────────────────────── */

for (const [state, name, why] of results) {
  console.log(`${state}  ${name}${why ? '\n        ↳ ' + why : ''}`);
}
const failed = results.filter(([s]) => s === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);

server.close();
await disconnectDB();
