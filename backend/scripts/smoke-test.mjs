/**
 * End-to-end check of the NexChat crypto + API contract.
 *
 * Mirrors frontend/src/lib/crypto.js using Node's WebCrypto, so it exercises
 * the exact algorithms the browser uses: signup and email verification, key
 * distribution, encrypted send/receive, replies, reactions, groups and
 * communities, QR device linking, and access control.
 *
 * Verification codes are printed by the API, so run it with its output tee'd
 * to a file and point this at that file:
 *
 *   npm run dev:mem > server.log 2>&1
 *   node scripts/smoke-test.mjs server.log
 */
import fs from 'node:fs';

const API = process.env.API_URL || 'http://localhost:5000/api';
const LOG = process.argv[2];
const subtle = globalThis.crypto.subtle;

if (!LOG) {
  console.error('usage: node scripts/smoke-test.mjs <path-to-server-log>');
  process.exit(1);
}

const CURVE = { name: 'ECDH', namedCurve: 'P-256' };
const SIGN_CURVE = { name: 'ECDSA', namedCurve: 'P-256' };

const enc = new TextEncoder();
const dec = new TextDecoder();
const toB64 = (b) => Buffer.from(b instanceof Uint8Array ? b : new Uint8Array(b)).toString('base64');
const fromB64 = (s) => new Uint8Array(Buffer.from(s, 'base64'));
const rand = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));
const rid = () => toB64(rand(18)).replace(/[+/=]/g, '').slice(0, 22);

function concat(...arrays) {
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) { out.set(a, off); off += a.length; }
  return out;
}

const expPub = async (k) => toB64(await subtle.exportKey('raw', k));
const expPriv = async (k) => toB64(await subtle.exportKey('pkcs8', k));
const impEcdhPub = (b) => subtle.importKey('raw', fromB64(b), CURVE, true, []);
const impEcdhPriv = (b) => subtle.importKey('pkcs8', fromB64(b), CURVE, true, ['deriveBits']);
const impSignPriv = (b) => subtle.importKey('pkcs8', fromB64(b), SIGN_CURVE, true, ['sign']);

async function ecdhBits(priv, pub) {
  return new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: pub }, priv, 256));
}

async function hkdf(ikm, { salt = new Uint8Array(32), info = '', bits = 256 } = {}) {
  const base = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(
    await subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt, info: typeof info === 'string' ? enc.encode(info) : info },
      base, bits
    )
  );
}

async function aesEncrypt(rawKey, plaintext) {
  const key = await subtle.importKey('raw', rawKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const iv = rand(12);
  const data = typeof plaintext === 'string' ? enc.encode(plaintext) : plaintext;
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128 }, key, data);
  return { ciphertext: toB64(ct), iv: toB64(iv) };
}

async function aesDecrypt(rawKey, ct, iv) {
  const key = await subtle.importKey('raw', rawKey, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  return new Uint8Array(
    await subtle.decrypt({ name: 'AES-GCM', iv: fromB64(iv), tagLength: 128 }, key, fromB64(ct))
  );
}

async function sealTo(recipientPubB64, plaintext, info = 'NexChat-seal-v1') {
  const recipient = await impEcdhPub(recipientPubB64);
  const eph = await subtle.generateKey(CURVE, true, ['deriveBits']);
  const shared = await ecdhBits(eph.privateKey, recipient);
  const key = await hkdf(shared, { salt: fromB64(recipientPubB64).slice(0, 32), info });
  const { ciphertext, iv } = await aesEncrypt(key, plaintext);
  return { ciphertext, iv, ephemeralPublicKey: await expPub(eph.publicKey) };
}

async function openSealed(myPriv, sealed, myPubB64, info = 'NexChat-seal-v1') {
  const eph = await impEcdhPub(sealed.ephemeralPublicKey);
  const shared = await ecdhBits(myPriv, eph);
  const key = await hkdf(shared, { salt: fromB64(myPubB64).slice(0, 32), info });
  return aesDecrypt(key, sealed.ciphertext, sealed.iv);
}

async function wrapIdentity({ idPriv, signPriv }, password) {
  const salt = rand(16);
  const base = await subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const kekBits = await subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 250000, hash: 'SHA-256' }, base, 256);
  const payload = JSON.stringify({ v: 1, identityPrivateKey: idPriv, signingPrivateKey: signPriv });
  const { ciphertext, iv } = await aesEncrypt(new Uint8Array(kekBits), payload);
  return { ciphertext, iv, salt: toB64(salt), iterations: 250000 };
}

async function unwrapIdentity(blob, password) {
  const base = await subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const kekBits = await subtle.deriveBits(
    { name: 'PBKDF2', salt: fromB64(blob.salt), iterations: blob.iterations || 250000, hash: 'SHA-256' },
    base, 256
  );
  const plain = await aesDecrypt(new Uint8Array(kekBits), blob.ciphertext, blob.iv);
  return JSON.parse(dec.decode(plain));
}

async function buildDeviceKeys() {
  const deviceId = 'dev_' + rid();
  const identity = await subtle.generateKey(CURVE, true, ['deriveBits']);
  const signing = await subtle.generateKey(SIGN_CURVE, true, ['sign', 'verify']);

  const otps = [];
  const privs = {};
  for (let i = 0; i < 5; i += 1) {
    const pair = await subtle.generateKey(CURVE, true, ['deriveBits']);
    otps.push({ keyId: i + 1, publicKey: await expPub(pair.publicKey) });
    privs[i + 1] = await expPriv(pair.privateKey);
  }

  const spk = await subtle.generateKey(CURVE, true, ['deriveBits']);
  const spkPub = await expPub(spk.publicKey);
  const sig = await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, signing.privateKey, enc.encode(spkPub));

  return {
    publicBundle: {
      deviceId,
      registrationId: Math.floor(Math.random() * 16000) + 1,
      identityPublicKey: await expPub(identity.publicKey),
      signingPublicKey: await expPub(signing.publicKey),
      signedPreKey: { keyId: 42, publicKey: spkPub, signature: toB64(sig) },
      oneTimePreKeys: otps,
    },
    privateBundle: {
      deviceId,
      identityPrivateKey: await expPriv(identity.privateKey),
      signedPreKeyPrivate: await expPriv(spk.privateKey),
      privateKeys: privs,
    },
  };
}

/* ────────────────────────────── http ────────────────────────────── */

async function call(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(method + ' ' + path + ' → ' + res.status + ' ' + (json.message || ''));
  }
  return json;
}

function codeFor(email) {
  const log = fs.readFileSync(LOG, 'utf8');
  const matches = [...log.matchAll(/(?:Verification|Login|Password reset) code for (\S+) → (\d{6})/g)];
  const mine = matches.filter((m) => m[1] === email);
  if (!mine.length) throw new Error('No OTP found in the server log for ' + email);
  return mine[mine.length - 1][2];
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* ────────────────────────────── the run ────────────────────────────── */

async function signUp(name, email, password) {
  await call('/auth/register', { method: 'POST', body: { email, name, password } });
  await wait(400);
  const code = codeFor(email);

  const identity = await subtle.generateKey(CURVE, true, ['deriveBits']);
  const signing = await subtle.generateKey(SIGN_CURVE, true, ['sign', 'verify']);
  const idPriv = await expPriv(identity.privateKey);
  const signPriv = await expPriv(signing.privateKey);

  const account = {
    identityPublicKey: await expPub(identity.publicKey),
    signingPublicKey: await expPub(signing.publicKey),
    encryptedIdentity: await wrapIdentity({ idPriv, signPriv }, password),
  };

  const device = await buildDeviceKeys();

  const res = await call('/auth/verify-email', {
    method: 'POST',
    body: { email, code, keys: { account, device: device.publicBundle }, device: { platform: 'web' } },
  });

  return {
    name, email, password,
    user: res.user,
    token: res.accessToken,
    account,
    identityPrivate: await impEcdhPriv(idPriv),
    identityPrivateB64: idPriv,
    device,
  };
}

/** Fan a payload out: one account slot per recipient. */
async function encryptFor(payload, recipients) {
  const cek = rand(32);
  const body = await aesEncrypt(cek, JSON.stringify(payload));
  const keys = [];

  for (const r of recipients) {
    const sealed = await sealTo(r.identityPublicKey, cek);
    keys.push({
      user: r.userId,
      deviceId: 'account',
      ciphertext: sealed.ciphertext,
      iv: sealed.iv,
      ephemeralPublicKey: sealed.ephemeralPublicKey,
      counter: 0,
    });
  }
  return { body, keys };
}

async function decryptMessage(message, me) {
  const slot = (message.keys || []).find((k) => k.deviceId === 'account');
  if (!slot) throw new Error('No account key slot addressed to this user');
  const cek = await openSealed(me.identityPrivate, slot, me.account.identityPublicKey);
  const plain = await aesDecrypt(cek, message.body.ciphertext, message.body.iv);
  return JSON.parse(dec.decode(plain));
}

const ok = (label) => console.log('  \x1b[32m✓\x1b[0m ' + label);

async function main() {
  const stamp = Date.now().toString(36);
  console.log('\n\x1b[1mNexChat end-to-end check\x1b[0m\n');

  console.log('auth');
  const alice = await signUp('Alice Rivera', 'alice.' + stamp + '@example.com', 'correct-horse-8');
  ok('registered + verified Alice, device published ' + alice.device.publicBundle.oneTimePreKeys.length + ' prekeys');
  const bob = await signUp('Bob Chen', 'bob.' + stamp + '@example.com', 'battery-staple-9');
  ok('registered + verified Bob');

  // Password unlock path (what a second browser does).
  const blob = await call('/auth/identity?email=' + encodeURIComponent(alice.email));
  const unwrapped = await unwrapIdentity(blob.encryptedIdentity, alice.password);
  if (unwrapped.identityPrivateKey !== alice.identityPrivateB64) {
    throw new Error('Password-unwrapped identity did not match the original');
  }
  ok('identity re-opens with the password (new-device unlock path)');

  console.log('\ncontacts + conversation');
  await call('/users/contacts', { method: 'POST', token: alice.token, body: { email: bob.email } });
  ok('Alice added Bob as a contact');

  const found = await call('/users/search?q=' + encodeURIComponent('Bob'), { token: alice.token });
  if (!found.users.length) throw new Error('Search returned nobody');
  ok('directory search found ' + found.users.length + ' match(es)');

  const conv = await call('/conversations/direct', {
    method: 'POST', token: alice.token, body: { userId: bob.user._id },
  });
  const conversationId = conv.conversation._id;
  ok('direct conversation created');

  console.log('\nkey distribution');
  const bundle = await call('/keys/' + bob.user._id, { token: alice.token });
  if (!bundle.bundle.devices.length) throw new Error('Bob has no device bundles');
  if (!bundle.bundle.devices[0].oneTimePreKey) throw new Error('No one-time prekey was handed out');
  ok('fetched Bob bundle, consumed one-time prekey #' + bundle.bundle.devices[0].oneTimePreKey.keyId);

  const roster = await call('/keys/roster?userIds=' + bob.user._id, { token: alice.token });
  ok('device roster returned ' + roster.roster[bob.user._id].length + ' device(s)');

  console.log('\nmessaging');
  const secret = 'Meet me at 7 — the code is ' + stamp;
  const recipients = [
    { userId: alice.user._id, identityPublicKey: alice.account.identityPublicKey },
    { userId: bob.user._id, identityPublicKey: bob.account.identityPublicKey },
  ];

  const envelope = await encryptFor({ text: secret, attachments: [] }, recipients);
  const sent = await call('/messages', {
    method: 'POST', token: alice.token,
    body: { conversationId, clientId: 'c' + rid(), type: 'text', ...envelope },
  });
  ok('Alice sent an encrypted message (' + envelope.keys.length + ' key slots)');

  // What does the server actually hold?
  const stored = sent.message;
  if (JSON.stringify(stored).includes(secret)) {
    throw new Error('PLAINTEXT LEAKED — the server response contains the message text');
  }
  ok('server response contains no plaintext (ciphertext only)');

  const inbox = await call('/messages/conversation/' + conversationId, { token: bob.token });
  if (!inbox.messages.length) throw new Error('Bob received nothing');

  const decrypted = await decryptMessage(inbox.messages[0], bob);
  if (decrypted.text !== secret) {
    throw new Error('Round-trip mismatch: got "' + decrypted.text + '"');
  }
  ok('Bob decrypted it correctly: "' + decrypted.text.slice(0, 40) + '…"');

  const mine = await call('/messages/conversation/' + conversationId, { token: alice.token });
  const selfDecrypted = await decryptMessage(mine.messages[0], alice);
  if (selfDecrypted.text !== secret) throw new Error('Alice cannot read her own message');
  ok('Alice can read her own sent message (multi-device path)');

  // Bob replies.
  const reply = 'Understood. See you then.';
  const replyEnvelope = await encryptFor({ text: reply, attachments: [] }, recipients);
  await call('/messages', {
    method: 'POST', token: bob.token,
    body: {
      conversationId, clientId: 'c' + rid(), type: 'text',
      ...replyEnvelope, replyTo: inbox.messages[0]._id,
    },
  });
  const back = await call('/messages/conversation/' + conversationId, { token: alice.token });
  const replyMsg = back.messages.find((m) => m.replyTo);
  if (!replyMsg) throw new Error('Reply did not come back with replyTo set');
  const replyPlain = await decryptMessage(replyMsg, alice);
  if (replyPlain.text !== reply) throw new Error('Reply round-trip mismatch');
  ok('Bob replied, Alice decrypted, replyTo preserved');

  console.log('\nmessage actions');
  await call('/messages/' + replyMsg._id + '/reactions', {
    method: 'POST', token: alice.token, body: { emoji: '👍' },
  });
  ok('reaction added');

  await call('/messages/' + replyMsg._id + '/star', { method: 'POST', token: alice.token });
  const starred = await call('/messages/starred', { token: alice.token });
  if (!starred.messages.length) throw new Error('Star did not persist');
  ok('star persisted (' + starred.messages.length + ' starred)');

  await call('/conversations/' + conversationId + '/read', { method: 'POST', token: bob.token });
  ok('read receipts recorded');

  console.log('\ngroups');
  const group = await call('/conversations/group', {
    method: 'POST', token: alice.token,
    body: { name: 'Weekend trip', about: 'Planning', memberIds: [bob.user._id] },
  });
  if (group.conversation.memberCount !== 2) throw new Error('Group membership is wrong');
  ok('group created with ' + group.conversation.memberCount + ' members');

  const community = await call('/conversations/community', {
    method: 'POST', token: alice.token,
    body: { name: 'Neighbourhood', memberIds: [bob.user._id] },
  });
  if (!community.generalId) throw new Error('Community did not get a General room');
  ok('community created with its General room');

  console.log('\ndevice linking');
  const linkEph = await subtle.generateKey(CURVE, true, ['deriveBits']);
  const linkEphPub = await expPub(linkEph.publicKey);
  const newDevice = await buildDeviceKeys();

  const init = await call('/devices/link/init', {
    method: 'POST',
    body: { ephemeralPublicKey: linkEphPub, deviceKeys: newDevice.publicBundle, device: { platform: 'web' } },
  });
  ok('link session opened, code ' + init.code + ' (QR ' + init.qrDataUrl.slice(0, 24) + '…)');

  const scanned = await call('/devices/link/scan', {
    method: 'POST', token: alice.token, body: { code: init.code },
  });
  if (scanned.session.fingerprint !== init.fingerprint) throw new Error('Fingerprint mismatch');
  ok('Alice scanned it — fingerprints match (' + init.fingerprint + ')');

  const sealedIdentity = await sealTo(
    scanned.session.ephemeralPublicKey,
    JSON.stringify({
      v: 1,
      userId: alice.user._id,
      identityPrivateKey: alice.identityPrivateB64,
      identityPublicKey: alice.account.identityPublicKey,
    }),
    'NexChat-link-v1'
  );
  await call('/devices/link/approve', {
    method: 'POST', token: alice.token,
    body: {
      code: init.code,
      payload: {
        ciphertext: sealedIdentity.ciphertext,
        iv: sealedIdentity.iv,
        senderEphemeralKey: sealedIdentity.ephemeralPublicKey,
      },
    },
  });
  ok('Alice approved — keys sealed to the new device');

  const claimed = await call('/devices/link/claim', {
    method: 'POST', body: { code: init.code, claimToken: init.claimToken },
  });
  if (!claimed.ready) throw new Error('Claim was not ready');

  const opened = JSON.parse(
    dec.decode(
      await openSealed(
        linkEph.privateKey,
        {
          ciphertext: claimed.payload.ciphertext,
          iv: claimed.payload.iv,
          ephemeralPublicKey: claimed.payload.senderEphemeralKey,
        },
        linkEphPub,
        'NexChat-link-v1'
      )
    )
  );
  if (opened.identityPrivateKey !== alice.identityPrivateB64) {
    throw new Error('Linked device received the wrong identity key');
  }
  ok('new device opened the sealed payload and holds Alice identity');

  // The whole point: the linked device can now read the history.
  const linkedRead = await call('/messages/conversation/' + conversationId, {
    token: claimed.accessToken,
  });
  const onLinked = await decryptMessage(linkedRead.messages[0], {
    identityPrivate: await impEcdhPriv(opened.identityPrivateKey),
    account: { identityPublicKey: opened.identityPublicKey },
  });
  if (onLinked.text !== secret) throw new Error('Linked device could not read history');
  ok('linked device decrypted the earlier history');

  const devices = await call('/devices', { token: alice.token });
  ok('Alice now has ' + devices.devices.length + ' active devices');

  console.log('\nsecond direct chat');
  const carol = await signUp('Carol Diaz', 'carol.' + stamp + '@example.com', 'hunter2-hunter2');
  const conv2 = await call('/conversations/direct', {
    method: 'POST', token: alice.token, body: { userId: carol.user._id },
  });
  if (!conv2.conversation._id || conv2.conversation._id === conversationId) {
    throw new Error('Second direct conversation was not created');
  }
  ok('a second direct chat opens (no unique-index collision on inviteCode)');

  const again = await call('/conversations/direct', {
    method: 'POST', token: alice.token, body: { userId: bob.user._id },
  });
  if (again.conversation._id !== conversationId) {
    throw new Error('Reopening a direct chat returned a different conversation');
  }
  ok('reopening an existing direct chat reuses it');

  console.log('\nabuse guards');
  let rejected = false;
  try {
    await call('/messages/conversation/' + conversationId, { token: null });
  } catch { rejected = true; }
  if (!rejected) throw new Error('Unauthenticated read was allowed');
  ok('unauthenticated read rejected');

  let blocked = false;
  try {
    await call('/messages/conversation/' + conversationId, { token: carol.token });
  } catch { blocked = true; }
  if (!blocked) throw new Error('An outsider could read the conversation');
  ok('outsider cannot read a conversation they are not in');

  console.log('\n\x1b[32m\x1b[1mAll checks passed.\x1b[0m\n');
}

main().catch((err) => {
  console.error('\n\x1b[31m✗ ' + err.message + '\x1b[0m\n');
  process.exit(1);
});
