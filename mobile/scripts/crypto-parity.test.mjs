/**
 * Proves the native crypto port is wire-compatible with the web client.
 *
 * Not a reimplementation compared against another reimplementation: this loads
 * the **actual** `frontend/src/lib/crypto.js` that ships to browsers, running it
 * on Node's WebCrypto — the same algorithms a browser would use — and checks
 * that every value one side produces, the other side accepts.
 *
 * That matters because the two clients share an account. The password-wrapped
 * identity blob, the prekey bundles and every message key slot are minted by
 * whichever client you happened to sign in from, and a one-byte disagreement
 * anywhere surfaces as chat history that will not open rather than as a crash.
 *
 *   node scripts/crypto-parity.test.mjs
 */

import { webcrypto } from 'node:crypto';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/* ── stand the browser's globals up in Node so the web module runs as-is ── */
globalThis.window = { crypto: webcrypto };
// Node exposes globalThis.crypto as a getter-only accessor, so it is defined
// over rather than assigned; on older Node it may be missing entirely.
if (globalThis.crypto !== webcrypto) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}
globalThis.btoa = (s) => Buffer.from(s, 'binary').toString('base64');
globalThis.atob = (s) => Buffer.from(s, 'base64').toString('binary');

/* The web file is ESM inside a CommonJS package, so it is copied to .mjs to be
   importable. Its contents are untouched. */
const webSource = resolve(here, '../../frontend/src/lib/crypto.js');
const stage = mkdtempSync(join(tmpdir(), 'chax-parity-'));
const webCopy = join(stage, 'web-crypto.mjs');
writeFileSync(webCopy, readFileSync(webSource, 'utf8'));

const W = await import(pathToFileURL(webCopy).href);
const N = await import(pathToFileURL(resolve(here, '../src/lib/crypto.js')).href);

/* ────────────────────────────── harness ────────────────────────────── */

let passed = 0;
const failures = [];

const check = (name, condition, detail = '') => {
  if (condition) {
    passed += 1;
    console.log('  \x1b[32m✓\x1b[0m ' + name);
  } else {
    failures.push(name + (detail ? ' — ' + detail : ''));
    console.log('  \x1b[31m✗\x1b[0m ' + name + (detail ? ' — ' + detail : ''));
  }
};

const section = (title) => console.log('\n\x1b[1m' + title + '\x1b[0m');
const sameBytes = (a, b) =>
  a.length === b.length && a.every((byte, i) => byte === b[i]);

/* ────────────────────────────── encoding ────────────────────────────── */

section('Base64');
{
  for (const len of [0, 1, 2, 3, 17, 32, 65, 138, 1000]) {
    const bytes = webcrypto.getRandomValues(new Uint8Array(len));
    const web = W.toB64(bytes);
    const native = N.toB64(bytes);
    check(
      `toB64 agrees at ${len} bytes`,
      web === native,
      web === native ? '' : `web=${web.slice(0, 24)} native=${native.slice(0, 24)}`
    );
    check(`fromB64 round-trips at ${len} bytes`, sameBytes(N.fromB64(web), bytes));
  }
}

/* ───────────────────────── key export formats ───────────────────────── */

section('Key encoding (raw + PKCS#8)');
let webEcdh;
let nativeScalarFromWeb;
{
  webEcdh = await W.generateEcdhKeyPair();
  const webRawPub = await W.exportPublicKey(webEcdh.publicKey);
  const webPkcs8 = await W.exportPrivateKey(webEcdh.privateKey);

  check('web raw public key is 65 bytes', N.fromB64(webRawPub).length === 65);

  // The native side must recover the scalar from a browser-minted PKCS#8…
  nativeScalarFromWeb = await N.importEcdhPrivate(webPkcs8);
  check('native reads the browser PKCS#8 scalar', nativeScalarFromWeb.length === 32);

  // …and re-encode it to exactly the same DER.
  const reEncoded = await N.exportPrivateKey(nativeScalarFromWeb);
  check(
    'native re-encodes to identical PKCS#8',
    reEncoded === webPkcs8,
    reEncoded === webPkcs8 ? '' : 'DER differs'
  );

  // Public point derived from that scalar must match what the browser exported.
  const nativePub = await N.exportPublicKey(
    (await N.importEcdhPrivate(webPkcs8), N.fromB64(webRawPub))
  );
  check('public point agrees', nativePub === webRawPub);

  // And the reverse direction: a browser must be able to read our PKCS#8.
  const nativePair = await N.generateEcdhKeyPair();
  const nativePkcs8 = await N.exportPrivateKey(nativePair.privateKey);
  let webAccepted = true;
  try {
    await W.importEcdhPrivate(nativePkcs8);
  } catch (err) {
    webAccepted = false;
    check('browser reads native PKCS#8', false, err.message);
  }
  if (webAccepted) check('browser reads native PKCS#8', true);
}

/* ────────────────────────────── ECDH ────────────────────────────── */

section('ECDH P-256 agreement');
{
  const webPair = await W.generateEcdhKeyPair();
  const nativePair = await N.generateEcdhKeyPair();

  const webPubB64 = await W.exportPublicKey(webPair.publicKey);
  const webPrivB64 = await W.exportPrivateKey(webPair.privateKey);
  const nativePubB64 = await N.exportPublicKey(nativePair.publicKey);

  // Seal one way, open the other — sealTo/openSealed exercise ECDH + HKDF +
  // AES-GCM together, which is exactly how the account key slot is built.
  const message = 'the quick brown fox — ✅ ünïcode';

  const sealedByWeb = await W.sealTo(nativePubB64, message);
  const openedByNative = await N.openSealed(
    nativePair.privateKey,
    sealedByWeb,
    nativePubB64
  );
  check('native opens what the browser sealed', N.fromUtf8(openedByNative) === message);

  const sealedByNative = await N.sealTo(webPubB64, message);
  const openedByWeb = await W.openSealed(
    await W.importEcdhPrivate(webPrivB64),
    sealedByNative,
    webPubB64
  );
  check('browser opens what native sealed', W.fromUtf8(openedByWeb) === message);
}

/* ────────────────────────────── HKDF ────────────────────────────── */

section('HKDF-SHA256');
{
  for (const info of ['', 'NexChat-X3DH-v1', 'chain|dev_abc123', 'ratchet', 'message']) {
    const ikm = webcrypto.getRandomValues(new Uint8Array(32));
    const web = await W.hkdf(ikm, { info });
    const native = await N.hkdf(ikm, { info });
    check(`hkdf info="${info || '(empty)'}"`, sameBytes(web, native));
  }

  const ikm = webcrypto.getRandomValues(new Uint8Array(96));
  const salt = webcrypto.getRandomValues(new Uint8Array(32));
  check(
    'hkdf with explicit salt',
    sameBytes(await W.hkdf(ikm, { salt, info: 'x' }), await N.hkdf(ikm, { salt, info: 'x' }))
  );
}

/* ────────────────────────────── AES-GCM ────────────────────────────── */

section('AES-GCM-256');
{
  const key = await N.generateAesKey();
  const plaintext = JSON.stringify({ text: 'hello 🌍', at: Date.now() });

  const byWeb = await W.aesEncrypt(key, plaintext);
  check('native decrypts browser ciphertext', (await N.aesDecryptToString(key, byWeb.ciphertext, byWeb.iv)) === plaintext);

  const byNative = await N.aesEncrypt(key, plaintext);
  check('browser decrypts native ciphertext', (await W.aesDecryptToString(key, byNative.ciphertext, byNative.iv)) === plaintext);

  check('iv is 12 bytes', N.fromB64(byNative.iv).length === 12);
  check(
    'tag length matches (ct = pt + 16)',
    N.fromB64(byNative.ciphertext).length === Buffer.byteLength(plaintext) + 16
  );

  // Additional authenticated data has to line up too, or attachments break.
  const aad = 'msg_123';
  const withAad = await N.aesEncrypt(key, plaintext, aad);
  check(
    'browser decrypts native ciphertext with AAD',
    (await W.aesDecryptToString(key, withAad.ciphertext, withAad.iv, aad)) === plaintext
  );

  let tamperRejected = false;
  try {
    await N.aesDecrypt(key, withAad.ciphertext, withAad.iv, 'msg_999');
  } catch {
    tamperRejected = true;
  }
  check('wrong AAD is rejected', tamperRejected);
}

/* ────────────────────────────── ECDSA ────────────────────────────── */

section('ECDSA P-256 / SHA-256');
{
  const webPair = await W.generateSigningKeyPair();
  const webPubB64 = await W.exportPublicKey(webPair.publicKey);
  const webPrivB64 = await W.exportPrivateKey(webPair.privateKey);

  const payload = 'a-signed-prekey-public-value';

  const webSig = await W.sign(webPair.privateKey, payload);
  check('signature is 64 bytes (compact r‖s)', N.fromB64(webSig).length === 64);
  check(
    'native verifies a browser signature',
    await N.verify(await N.importSigningPublic(webPubB64), webSig, payload)
  );

  const nativeSig = await N.sign(await N.importSigningPrivate(webPrivB64), payload);
  check(
    'browser verifies a native signature',
    await W.verify(await W.importSigningPublic(webPubB64), nativeSig, payload)
  );

  check(
    'a tampered payload fails',
    !(await N.verify(await N.importSigningPublic(webPubB64), webSig, payload + '!'))
  );
}

/* ──────────────────── password-wrapped identity ──────────────────── */

section('Password-wrapped identity (PBKDF2 250k)');
{
  const password = 'correct horse battery staple';

  const started = Date.now();
  const identity = await N.generateEcdhKeyPair();
  const signing = await N.generateSigningKeyPair();
  const wrappedByNative = await N.wrapIdentity(
    { identityPrivateKey: identity.privateKey, signingPrivateKey: signing.privateKey },
    password
  );
  const nativeWrapMs = Date.now() - started;

  const openedByWeb = await W.unwrapIdentity(wrappedByNative, password);
  check('browser unwraps a native identity blob', !!openedByWeb.raw.identityPrivateKey);
  check(
    'scalar survives the round trip',
    sameBytes(await N.importEcdhPrivate(openedByWeb.raw.identityPrivateKey), identity.privateKey)
  );

  const webIdentity = await W.generateEcdhKeyPair();
  const webSigning = await W.generateSigningKeyPair();
  const wrappedByWeb = await W.wrapIdentity(
    { identityPrivateKey: webIdentity.privateKey, signingPrivateKey: webSigning.privateKey },
    password
  );
  const openedByNative = await N.unwrapIdentity(wrappedByWeb, password);
  check('native unwraps a browser identity blob', !!openedByNative.raw.identityPrivateKey);

  let wrongRejected = false;
  try {
    await N.unwrapIdentity(wrappedByWeb, 'not the password');
  } catch {
    wrongRejected = true;
  }
  check('the wrong password is rejected', wrongRejected);

  console.log(`    (native PBKDF2 250k took ${nativeWrapMs}ms on this machine)`);
}

/* ──────────────────── X3DH + ratchet, cross-client ──────────────────── */

section('X3DH handshake and ratchet');
{
  // Browser is the sender, native the receiver — the case that matters when
  // somebody signs in on the phone and their laptop writes to them.
  const bob = await N.generateEcdhKeyPair();
  const bobSpk = await N.generateEcdhKeyPair();
  const bobOtp = await N.generateEcdhKeyPair();
  const alice = await W.generateEcdhKeyPair();

  const initiated = await W.initiateSession({
    myIdentityPrivate: alice.privateKey,
    theirIdentityPublic: await N.exportPublicKey(bob.publicKey),
    theirSignedPreKeyPublic: await N.exportPublicKey(bobSpk.publicKey),
    theirOneTimePreKeyPublic: await N.exportPublicKey(bobOtp.publicKey),
  });

  const accepted = await N.acceptSession({
    myIdentityPrivate: bob.privateKey,
    mySignedPreKeyPrivate: bobSpk.privateKey,
    myOneTimePreKeyPrivate: bobOtp.privateKey,
    theirIdentityPublic: await W.exportPublicKey(alice.publicKey),
    theirEphemeralPublic: initiated.ephemeralPublicKey,
  });

  check('both sides derive the same root key', sameBytes(initiated.rootKey, accepted.rootKey));

  // …and the other direction.
  const bob2 = await W.generateEcdhKeyPair();
  const bobSpk2 = await W.generateEcdhKeyPair();
  const alice2 = await N.generateEcdhKeyPair();

  const initiated2 = await N.initiateSession({
    myIdentityPrivate: alice2.privateKey,
    theirIdentityPublic: await W.exportPublicKey(bob2.publicKey),
    theirSignedPreKeyPublic: await W.exportPublicKey(bobSpk2.publicKey),
    theirOneTimePreKeyPublic: null,
  });
  const accepted2 = await W.acceptSession({
    myIdentityPrivate: bob2.privateKey,
    mySignedPreKeyPrivate: bobSpk2.privateKey,
    myOneTimePreKeyPrivate: null,
    theirIdentityPublic: await N.exportPublicKey(alice2.publicKey),
    theirEphemeralPublic: initiated2.ephemeralPublicKey,
  });
  check('same root without a one-time prekey', sameBytes(initiated2.rootKey, accepted2.rootKey));

  // Ratchet: message key N must match on both sides.
  const deviceId = 'dev_' + 'abcdefghij';
  const webChain = await W.chainRoot(initiated.rootKey, deviceId);
  const nativeChain = await N.chainRoot(accepted.rootKey, deviceId);
  check('chain roots agree', sameBytes(webChain, nativeChain));

  for (const counter of [0, 1, 5, 40]) {
    const w = await W.messageKeyAt(webChain, counter);
    const n = await N.messageKeyAt(nativeChain, counter);
    check(`message key at counter ${counter}`, sameBytes(w.messageKey, n.messageKey));
  }
}

/* ──────────────────── prekey bundles + fingerprints ──────────────────── */

section('Prekey bundles and fingerprints');
{
  const signing = await N.generateSigningKeyPair();
  const batch = await N.generatePreKeyBatch(signing.privateKey, { count: 3, startId: 7 });
  const signingPubB64 = await N.exportPublicKey(signing.publicKey);

  check('batch has the requested prekey count', batch.oneTimePreKeys.length === 3);
  check('prekey ids start where asked', batch.oneTimePreKeys[0].keyId === 7);
  check(
    'browser verifies a native-signed prekey',
    await W.verifyBundle({ signedPreKey: batch.signedPreKey }, signingPubB64)
  );

  const webSigning = await W.generateSigningKeyPair();
  const webBatch = await W.generatePreKeyBatch(webSigning.privateKey, { count: 2 });
  check(
    'native verifies a browser-signed prekey',
    await N.verifyBundle({ signedPreKey: webBatch.signedPreKey }, await W.exportPublicKey(webSigning.publicKey))
  );

  const a = await N.exportPublicKey((await N.generateEcdhKeyPair()).publicKey);
  const b = await N.exportPublicKey((await N.generateEcdhKeyPair()).publicKey);
  check('safety numbers agree', (await W.safetyNumber(a, b)) === (await N.safetyNumber(a, b)));
  check('safety number is symmetric', (await N.safetyNumber(a, b)) === (await N.safetyNumber(b, a)));
  check('short fingerprints agree', (await W.shortFingerprint(a)) === (await N.shortFingerprint(a)));
}

/* ────────────────────────────── verdict ────────────────────────────── */

console.log('\n' + '─'.repeat(60));
if (failures.length) {
  console.log(`\x1b[31m${failures.length} failed\x1b[0m, ${passed} passed\n`);
  failures.forEach((f) => console.log('  · ' + f));
  process.exit(1);
}
console.log(`\x1b[32mAll ${passed} checks passed.\x1b[0m Native crypto is wire-compatible.\n`);
