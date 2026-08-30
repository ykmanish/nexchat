/**
 * Cross-client message envelopes.
 *
 * `crypto-parity` proves the primitives agree. This proves the thing built out
 * of them does: a message composed the way the **web** client composes one is
 * opened the way the **native** client opens one, through both key slots, in
 * both directions, and across a ratchet that has advanced.
 *
 * The envelope shape is reproduced here rather than imported, because
 * `e2ee.js` on either side reaches for a live API and a filesystem. What is
 * under test is the protocol — which slots exist, what is sealed into each, and
 * how the message key is derived — and that is expressed in full below.
 *
 *   node scripts/envelope.test.mjs
 */

import { webcrypto } from 'node:crypto';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

globalThis.window = { crypto: webcrypto };
if (globalThis.crypto !== webcrypto) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}
globalThis.btoa = (s) => Buffer.from(s, 'binary').toString('base64');
globalThis.atob = (s) => Buffer.from(s, 'base64').toString('binary');

const stage = mkdtempSync(join(tmpdir(), 'chax-envelope-'));
const webCopy = join(stage, 'web-crypto.mjs');
writeFileSync(webCopy, readFileSync(resolve(here, '../../frontend/src/lib/crypto.js'), 'utf8'));

const W = await import(pathToFileURL(webCopy).href);
const N = await import(pathToFileURL(resolve(here, '../src/lib/crypto.js')).href);

const ACCOUNT_SLOT = 'account';

let passed = 0;
const failures = [];

const check = (name, ok, detail = '') => {
  if (ok) {
    passed += 1;
    console.log('  \x1b[32m✓\x1b[0m ' + name);
  } else {
    failures.push(name + (detail ? ' — ' + detail : ''));
    console.log('  \x1b[31m✗\x1b[0m ' + name + (detail ? ' — ' + detail : ''));
  }
};
const section = (t) => console.log('\n\x1b[1m' + t + '\x1b[0m');

/* ────────────────────── a person, on one client ────────────────────── */

async function makeAccount(C, label) {
  const identity = await C.generateEcdhKeyPair();
  const signing = await C.generateSigningKeyPair();
  return {
    label,
    C,
    identityPrivate: identity.privateKey,
    identityPublic: await C.exportPublicKey(identity.publicKey),
    signingPrivate: signing.privateKey,
    signingPublic: await C.exportPublicKey(signing.publicKey),
    devices: [],
  };
}

async function addDevice(account, deviceId) {
  const { C } = account;
  const identity = await C.generateEcdhKeyPair();
  const signing = await C.generateSigningKeyPair();
  const batch = await C.generatePreKeyBatch(signing.privateKey, { count: 4, startId: 1 });

  const device = {
    deviceId,
    identityPrivate: identity.privateKey,
    identityPublic: await C.exportPublicKey(identity.publicKey),
    signingPublic: await C.exportPublicKey(signing.publicKey),
    signedPreKey: batch.signedPreKey,
    signedPreKeyPrivate: batch.signedPreKeyPrivate,
    oneTimePreKeys: batch.oneTimePreKeys,
    preKeyPrivates: batch.privateKeys,
    sessions: new Map(),
  };

  account.devices.push(device);
  return device;
}

/* ───────────────── composing an envelope, as the client does ───────────────── */

async function encryptEnvelope({ from, fromDevice, recipients, payload }) {
  const { C } = from;
  const cek = await C.generateAesKey();
  const body = await C.aesEncrypt(cek, JSON.stringify(payload));
  const keys = [];

  for (const recipient of recipients) {
    // 1. Account slot — readable by any device they own, now or later.
    const sealed = await C.sealTo(recipient.identityPublic, cek);
    keys.push({
      user: recipient.label,
      deviceId: ACCOUNT_SLOT,
      ciphertext: sealed.ciphertext,
      iv: sealed.iv,
      ephemeralPublicKey: sealed.ephemeralPublicKey,
      counter: 0,
    });

    // 2. Device slots — a ratcheting session per device.
    for (const device of recipient.devices) {
      const sessionKey = recipient.label + ':' + device.deviceId;
      let session = fromDevice.sessions.get(sessionKey);

      if (!session) {
        const started = await C.initiateSession({
          myIdentityPrivate: fromDevice.identityPrivate,
          theirIdentityPublic: device.identityPublic,
          theirSignedPreKeyPublic: device.signedPreKey.publicKey,
          theirOneTimePreKeyPublic: device.oneTimePreKeys[0].publicKey,
        });
        session = {
          rootKey: started.rootKey,
          ephemeralPublicKey: started.ephemeralPublicKey,
          preKeyId: device.oneTimePreKeys[0].keyId,
          sendCounter: 0,
        };
        fromDevice.sessions.set(sessionKey, session);
      }

      const chain0 = await C.chainRoot(session.rootKey, fromDevice.deviceId);
      const { messageKey } = await C.messageKeyAt(chain0, session.sendCounter);
      const wrapped = await C.aesEncrypt(messageKey, cek);

      keys.push({
        user: recipient.label,
        deviceId: device.deviceId,
        ciphertext: wrapped.ciphertext,
        iv: wrapped.iv,
        ephemeralPublicKey: session.ephemeralPublicKey,
        preKeyId: session.preKeyId,
        counter: session.sendCounter,
      });

      session.sendCounter += 1;
    }
  }

  return { body, keys, senderDeviceId: fromDevice.deviceId };
}

/* ───────────────── opening it, as the other client does ───────────────── */

async function decryptViaDeviceSlot({ as, asDevice, message, senderIdentityPublic }) {
  const { C } = as;
  const slot = message.keys.find((k) => k.deviceId === asDevice.deviceId);
  if (!slot) throw new Error('no device slot');

  const sessionKey = 'peer:' + message.senderDeviceId;
  let session = asDevice.sessions.get(sessionKey);

  if (!session) {
    const accepted = await C.acceptSession({
      myIdentityPrivate: asDevice.identityPrivate,
      mySignedPreKeyPrivate: await C.importEcdhPrivate(asDevice.signedPreKeyPrivate),
      myOneTimePreKeyPrivate:
        slot.preKeyId != null
          ? await C.importEcdhPrivate(asDevice.preKeyPrivates[slot.preKeyId])
          : null,
      theirIdentityPublic: senderIdentityPublic,
      theirEphemeralPublic: slot.ephemeralPublicKey,
    });
    session = { rootKey: accepted.rootKey };
    asDevice.sessions.set(sessionKey, session);
  }

  const chain0 = await C.chainRoot(session.rootKey, message.senderDeviceId);
  const { messageKey } = await C.messageKeyAt(chain0, slot.counter || 0);
  const cek = await C.aesDecrypt(messageKey, slot.ciphertext, slot.iv);
  return JSON.parse(await C.aesDecryptToString(cek, message.body.ciphertext, message.body.iv));
}

async function decryptViaAccountSlot({ as, message }) {
  const { C } = as;
  const slot = message.keys.find((k) => k.deviceId === ACCOUNT_SLOT);
  const cek = await C.openSealed(as.identityPrivate, slot, as.identityPublic);
  return JSON.parse(await C.aesDecryptToString(cek, message.body.ciphertext, message.body.iv));
}

/* ────────────────────────────── the tests ────────────────────────────── */

section('Browser writes, phone reads');
{
  const alice = await makeAccount(W, 'alice');
  const aliceLaptop = await addDevice(alice, 'dev_laptop');

  const bob = await makeAccount(N, 'bob');
  const bobPhone = await addDevice(bob, 'dev_phone');

  const payload = { text: 'Meet at six? 🍜', attachments: [] };

  const message = await encryptEnvelope({
    from: alice,
    fromDevice: aliceLaptop,
    recipients: [bob],
    payload,
  });

  check('an account slot and a device slot are produced', message.keys.length === 2);

  const viaDevice = await decryptViaDeviceSlot({
    as: bob,
    asDevice: bobPhone,
    message,
    senderIdentityPublic: aliceLaptop.identityPublic,
  });
  check('phone opens the device slot', viaDevice.text === payload.text);

  const viaAccount = await decryptViaAccountSlot({ as: bob, message });
  check('phone opens the account slot', viaAccount.text === payload.text);
}

section('Phone writes, browser reads');
{
  const bob = await makeAccount(N, 'bob');
  const bobPhone = await addDevice(bob, 'dev_phone');

  const alice = await makeAccount(W, 'alice');
  const aliceLaptop = await addDevice(alice, 'dev_laptop');

  const payload = { text: 'On my way', attachments: [{ url: '/u/1', kind: 'image' }] };

  const message = await encryptEnvelope({
    from: bob,
    fromDevice: bobPhone,
    recipients: [alice],
    payload,
  });

  const viaDevice = await decryptViaDeviceSlot({
    as: alice,
    asDevice: aliceLaptop,
    message,
    senderIdentityPublic: bobPhone.identityPublic,
  });
  check('browser opens the device slot', viaDevice.text === payload.text);
  check('attachment metadata survives', viaDevice.attachments[0].url === '/u/1');

  const viaAccount = await decryptViaAccountSlot({ as: alice, message });
  check('browser opens the account slot', viaAccount.text === payload.text);
}

section('A ratchet that has advanced');
{
  const alice = await makeAccount(W, 'alice');
  const aliceLaptop = await addDevice(alice, 'dev_laptop');
  const bob = await makeAccount(N, 'bob');
  const bobPhone = await addDevice(bob, 'dev_phone');

  const sent = [];
  for (let i = 0; i < 5; i += 1) {
    sent.push(
      await encryptEnvelope({
        from: alice,
        fromDevice: aliceLaptop,
        recipients: [bob],
        payload: { text: 'message ' + i },
      })
    );
  }

  const counters = sent.map((m) => m.keys.find((k) => k.deviceId === 'dev_phone').counter);
  check('the send counter advances', counters.join(',') === '0,1,2,3,4');

  // Out of order on purpose: a chat that only decrypts in arrival order is one
  // that loses messages whenever the network reorders them.
  for (const index of [3, 0, 4, 1, 2]) {
    const opened = await decryptViaDeviceSlot({
      as: bob,
      asDevice: bobPhone,
      message: sent[index],
      senderIdentityPublic: aliceLaptop.identityPublic,
    });
    check('message ' + index + ' opens out of order', opened.text === 'message ' + index);
  }
}

section("A second device that did not exist when the message was sent");
{
  const alice = await makeAccount(W, 'alice');
  const aliceLaptop = await addDevice(alice, 'dev_laptop');
  const bob = await makeAccount(N, 'bob');
  await addDevice(bob, 'dev_phone');

  const message = await encryptEnvelope({
    from: alice,
    fromDevice: aliceLaptop,
    recipients: [bob],
    payload: { text: 'history' },
  });

  // Bob installs the app on a tablet afterwards. It has no session and no
  // device slot — the account slot is the whole reason history is readable.
  const tablet = await addDevice(bob, 'dev_tablet');
  check('the new device has no slot of its own', !message.keys.some((k) => k.deviceId === tablet.deviceId));

  const opened = await decryptViaAccountSlot({ as: bob, message });
  check('it still reads the message through the account slot', opened.text === 'history');
}

section('Tampering');
{
  const alice = await makeAccount(W, 'alice');
  const aliceLaptop = await addDevice(alice, 'dev_laptop');
  const bob = await makeAccount(N, 'bob');

  const message = await encryptEnvelope({
    from: alice,
    fromDevice: aliceLaptop,
    recipients: [bob],
    payload: { text: 'original' },
  });

  const flipped = JSON.parse(JSON.stringify(message));
  const bytes = N.fromB64(flipped.body.ciphertext);
  bytes[4] ^= 0xff;
  flipped.body.ciphertext = N.toB64(bytes);

  let rejected = false;
  try {
    await decryptViaAccountSlot({ as: bob, message: flipped });
  } catch {
    rejected = true;
  }
  check('a flipped bit in the body is rejected', rejected);

  const stranger = await makeAccount(N, 'mallory');
  let cannotRead = false;
  try {
    await decryptViaAccountSlot({ as: stranger, message });
  } catch {
    cannotRead = true;
  }
  check('somebody else cannot open it', cannotRead);
}

console.log('\n' + '─'.repeat(60));
if (failures.length) {
  console.log(`\x1b[31m${failures.length} failed\x1b[0m, ${passed} passed\n`);
  failures.forEach((f) => console.log('  · ' + f));
  process.exit(1);
}
console.log(`\x1b[32mAll ${passed} checks passed.\x1b[0m Envelopes cross clients intact.\n`);
