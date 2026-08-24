/**
 * Tests the forensic export end to end.
 *
 * Three things are worth proving here, and they are not the same thing:
 *
 *   1. Conformance — the app's Merkle/canonicalisation code and the standalone
 *      verifier's duplicate of it agree. They are separate copies on purpose, so
 *      this is the test that stops them drifting apart silently.
 *   2. Detection — every class of tampering is caught, and caught at the right
 *      record. An integrity tool that says "something changed" is much less use
 *      than one that says where.
 *   3. Honesty — a file with no attestation still verifies for integrity, and
 *      an attestation for a different root is rejected rather than accepted as
 *      "well, it verified".
 *
 * Run: node scripts/forensics.test.mjs   (from backend/)
 */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const VERIFIER = path.resolve('scripts/verify-export.mjs');

/* The app's implementation, imported for real. It touches nothing but
   WebCrypto, which is exactly why it was split out of ./forensics. */
const coreUrl =
  'file://' +
  path.resolve('../frontend/src/lib/forensics-core.js').replace(/\\/g, '/');
const core = await import(coreUrl);

/* ─────────────────────────── local helpers ─────────────────────────── */

const b64 = (b) => Buffer.from(b).toString('base64');
const enc = new TextEncoder();

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

/** A second, independent canonicaliser — so this test is not just core vs core. */
function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
}

const sha = async (s) =>
  b64(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s))));

/* ───────────────────────── building a bundle ───────────────────────── */

const P256 = { name: 'ECDSA', namedCurve: 'P-256' };

async function rawPublic(key) {
  return b64(await crypto.subtle.exportKey('raw', key));
}

/**
 * Builds a bundle exactly as the app does, using the app's own core for the
 * hashing and tree so this exercises the real code path.
 */
async function makeBundle({ count = 9, attest = true, note = null } = {}) {
  const device = await crypto.subtle.generateKey(P256, true, ['sign', 'verify']);
  const server = await crypto.subtle.generateKey(P256, true, ['sign', 'verify']);

  const records = [];
  let prevHash = null;

  for (let i = 0; i < count; i += 1) {
    const content = { text: 'message number ' + i, attachments: [] };
    const header = {
      seq: i,
      prevHash,
      messageId: 'm' + i,
      conversationId: 'c1',
      senderId: i % 2 ? 'them' : 'me',
      senderName: i % 2 ? 'Them' : 'Me',
      direction: i % 2 ? 'received' : 'sent',
      sentAt: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
      type: 'text',
      editedAt: null,
      contentHash: await core.hashToB64(core.canonical(content)),
    };
    const hash = await core.hashToB64(core.canonical(header));
    records.push({ ...header, hash, content });
    prevHash = hash;
  }

  const leaves = [];
  for (const r of records) leaves.push(await core.leafHash(core.canonical(r)));
  const merkleRoot = b64(await core.merkleRoot(leaves));

  const exportId = 'exp' + b64(crypto.randomBytes(9)).replace(/[^a-zA-Z0-9]/g, '');
  const manifest = {
    exportId,
    magic: 'chax-forensic-export',
    formatVersion: 1,
    custody: {
      exporterUserId: 'user1',
      deviceId: 'dev_test',
      exportedAt: new Date().toISOString(),
      note,
    },
    scope: {
      conversationIds: ['c1'],
      recordCount: records.length,
      from: records[0]?.sentAt ?? null,
      to: records[records.length - 1]?.sentAt ?? null,
      mediaBytesIncluded: false,
    },
    algorithms: {
      hash: 'SHA-256',
      chain: 'prevHash over canonical record header',
      tree: 'RFC6962-SHA256',
      signature: 'ECDSA-P256-SHA256, IEEE-P1363',
      canonicalisation: 'sorted-key JSON, UTF-8',
    },
    merkleRoot,
    chainTip: prevHash,
  };

  const sign = async (key, message) =>
    b64(
      await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(message))
    );

  const bundle = {
    magic: 'chax-forensic-export',
    formatVersion: 1,
    manifest,
    records,
    signature: {
      alg: 'ECDSA-P256-SHA256',
      publicKey: await rawPublic(device.publicKey),
      value: await sign(device.privateKey, core.canonical(manifest)),
    },
    attestation: null,
    limitations: ['Test fixture.'],
  };

  if (attest) {
    const statement = {
      exportId,
      merkleRoot,
      recordCount: records.length,
      serverTime: new Date().toISOString(),
      algorithm: 'ECDSA-P256-SHA256',
    };
    bundle.attestation = {
      ...statement,
      signature: await sign(server.privateKey, canonical(statement)),
      publicKey: await rawPublic(server.publicKey),
    };
  }

  return bundle;
}

/** Writes a bundle and runs the standalone verifier over it. */
async function verify(bundle) {
  const file = path.join(os.tmpdir(), 'fx-' + Date.now() + '-' + Math.floor(performance.now()) + '.chaxfx');
  await fs.writeFile(file, JSON.stringify(bundle, null, 2));
  try {
    const { stdout } = await run(process.execPath, [VERIFIER, file, '--offline']);
    return { code: 0, out: stdout };
  } catch (err) {
    return { code: err.code ?? 1, out: (err.stdout || '') + (err.stderr || '') };
  } finally {
    await fs.unlink(file).catch(() => {});
  }
}

const failedChecks = (out) =>
  out.split('\n').filter((l) => l.includes('FAIL')).map((l) => l.trim());

/* ───────────────────────────── conformance ───────────────────────────── */

await check('the two Merkle implementations agree on random input', async () => {
  // Same algorithm, two separate copies — the app's and the verifier's. Rather
  // than importing the verifier (it is a script, not a module), the tree is
  // recomputed here from first principles and compared against the app's.
  const localLeaf = async (s) => {
    const bytes = enc.encode(s);
    const out = new Uint8Array(bytes.length + 1);
    out[0] = 0;
    out.set(bytes, 1);
    return new Uint8Array(await crypto.subtle.digest('SHA-256', out));
  };
  const localNode = async (l, r) => {
    const out = new Uint8Array(l.length + r.length + 1);
    out[0] = 1;
    out.set(l, 1);
    out.set(r, 1 + l.length);
    return new Uint8Array(await crypto.subtle.digest('SHA-256', out));
  };
  const localRoot = async (leaves) => {
    if (!leaves.length) return new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(0)));
    if (leaves.length === 1) return leaves[0];
    let k = 1;
    while (k * 2 < leaves.length) k *= 2;
    return localNode(await localRoot(leaves.slice(0, k)), await localRoot(leaves.slice(k)));
  };

  // Every size from 0 to 17 — the interesting cases are the non-powers of two,
  // which is exactly where the Bitcoin-style tree goes wrong.
  for (let n = 0; n <= 17; n += 1) {
    const items = Array.from({ length: n }, (_, i) => 'leaf-' + n + '-' + i);
    const mine = b64(await localRoot(await Promise.all(items.map(localLeaf))));
    const theirs = b64(await core.merkleRoot(await Promise.all(items.map((s) => core.leafHash(s)))));
    assert(mine === theirs, 'roots differ at n=' + n);
  }
});

await check('canonical JSON is order-independent', async () => {
  const a = { b: 1, a: { d: 4, c: [3, { f: 6, e: 5 }] } };
  const b = { a: { c: [3, { e: 5, f: 6 }], d: 4 }, b: 1 };
  assert(core.canonical(a) === core.canonical(b), 'key order changed the output');
  assert(core.canonical(a) === canonical(a), 'the two canonicalisers disagree');
  assert(core.canonical({ x: undefined, y: 1 }) === '{"y":1}', 'undefined was not dropped');
});

await check('inclusion proofs verify, and only for the right leaf', async () => {
  const items = Array.from({ length: 11 }, (_, i) => 'record-' + i);
  const leaves = await Promise.all(items.map((s) => core.leafHash(s)));
  const root = core.toBase64(await core.merkleRoot(leaves));

  for (let i = 0; i < items.length; i += 1) {
    const proof = await core.inclusionProof(leaves, i);
    assert(await core.verifyInclusion(leaves[i], proof, root), 'proof failed for leaf ' + i);
    // The same proof must not validate a different leaf, or selective
    // disclosure would prove nothing at all.
    const other = leaves[(i + 1) % items.length];
    assert(
      !(await core.verifyInclusion(other, proof, root)),
      'leaf ' + i + " proof also accepted its neighbour"
    );
  }
});

/* ──────────────────────────── happy path ──────────────────────────── */

await check('a clean export verifies', async () => {
  const { code, out } = await verify(await makeBundle());
  assert(code === 0, 'exit ' + code);
  assert(out.includes('Verified — all checks passed'), 'no clean verdict:\n' + out);
  assert(failedChecks(out).length === 0, 'unexpected failures: ' + failedChecks(out));
});

await check('the report restates what a PASS does not establish', async () => {
  const { out } = await verify(await makeBundle());
  assert(out.includes('does and does not establish'), 'limitations section missing');
});

await check('custody detail is reported', async () => {
  const { out } = await verify(await makeBundle({ note: 'Seized under warrant 12/2026' }));
  assert(out.includes('dev_test'), 'device id not shown');
  assert(out.includes('Seized under warrant 12/2026'), 'custody note not shown');
});

/* ──────────────────────────── tampering ──────────────────────────── */

await check('an edited message body is caught', async () => {
  const bundle = await makeBundle();
  bundle.records[4].content.text = 'something else entirely';
  const { code, out } = await verify(bundle);
  assert(code === 1, 'a tampered file passed, exit ' + code);
  assert(out.includes('bodies match'), 'no body-digest check ran');
  assert(out.includes('record 4'), 'did not name record 4:\n' + out);
});

await check('a deleted record breaks the chain', async () => {
  const bundle = await makeBundle();
  bundle.records.splice(3, 1);
  const { code, out } = await verify(bundle);
  assert(code === 1, 'a deletion passed, exit ' + code);
  assert(out.includes('Hash chain'), 'chain not evaluated');
});

await check('reordering records is caught', async () => {
  const bundle = await makeBundle();
  [bundle.records[2], bundle.records[6]] = [bundle.records[6], bundle.records[2]];
  const { code } = await verify(bundle);
  assert(code === 1, 'a reordering passed');
});

await check('an inserted record is caught', async () => {
  const bundle = await makeBundle();
  bundle.records.splice(5, 0, { ...bundle.records[4], messageId: 'forged', seq: 5 });
  const { code } = await verify(bundle);
  assert(code === 1, 'an insertion passed');
});

await check('a rewritten manifest fails the device signature', async () => {
  const bundle = await makeBundle();
  bundle.manifest.custody.deviceId = 'dev_someone_else';
  const { code, out } = await verify(bundle);
  assert(code === 1, 'a rewritten manifest passed');
  assert(out.includes('Manifest signature verifies'), 'signature not checked');
});

await check('rebuilding the tree without re-signing is caught', async () => {
  // The subtle attack: edit a record and recompute the chain and root so the
  // file is internally consistent. Only the signature catches it.
  const bundle = await makeBundle();
  bundle.records[2].content.text = 'planted';
  bundle.records[2].contentHash = await core.hashToB64(core.canonical(bundle.records[2].content));

  let prev = bundle.records[1].hash;
  for (let i = 2; i < bundle.records.length; i += 1) {
    const { hash, content, ...header } = bundle.records[i];
    header.prevHash = prev;
    const fresh = await core.hashToB64(core.canonical(header));
    bundle.records[i] = { ...header, hash: fresh, content };
    prev = fresh;
  }

  const leaves = [];
  for (const r of bundle.records) leaves.push(await core.leafHash(core.canonical(r)));
  bundle.manifest.merkleRoot = core.toBase64(await core.merkleRoot(leaves));
  bundle.manifest.chainTip = prev;

  const { code, out } = await verify(bundle);
  assert(code === 1, 'a fully rebuilt forgery passed');
  assert(
    out.includes('FAIL') && out.includes('Manifest signature'),
    'the signature should be what catches this:\n' + out
  );
});

/* ────────────────────────── attestation claims ────────────────────────── */

await check('an unattested export still proves integrity', async () => {
  const { code, out } = await verify(await makeBundle({ attest: false }));
  // Integrity holds; only the weaker timestamp claim is unproven, so this must
  // not be reported as a forgery.
  assert(code === 0, 'an offline export was treated as failed, exit ' + code);
  assert(out.includes('Integrity intact'), 'wrong verdict for an unattested file:\n' + out);
  assert(out.includes('exporter device clock alone'), 'did not explain the weakened claim');
});

await check('an attestation for a different root is rejected', async () => {
  const bundle = await makeBundle();
  const other = await makeBundle({ count: 4 });
  bundle.attestation = other.attestation;
  const { out } = await verify(bundle);
  assert(
    out.includes('ATTESTATION IS FOR OTHER CONTENT'),
    'a mismatched attestation was not called out:\n' + out
  );
});

await check('a forged attestation signature is rejected', async () => {
  const bundle = await makeBundle();
  bundle.attestation.serverTime = new Date(Date.UTC(2020, 0, 1)).toISOString();
  const { out } = await verify(bundle);
  const failures = failedChecks(out).join(' ');
  assert(
    failures.includes('attestation signature'),
    'backdating the server time was not caught:\n' + out
  );
});

await check('a non-export file is refused cleanly', async () => {
  const { out } = await verify({ hello: 'world' });
  assert(out.includes('FAIL'), 'garbage was accepted');
  assert(!out.includes('undefined is not'), 'crashed instead of reporting:\n' + out);
});

/* ───────────────── the app's own build(), end to end ───────────────── */

/**
 * Everything above verifies fixtures this file constructed. That leaves the gap
 * that matters most: whether the *application's* export path produces something
 * the verifier accepts. So this runs the real src/lib/forensics.js — real record
 * construction, real manifest, real device signature — against fake storage, and
 * feeds the result to the real verifier.
 */
await check("the app's own build() produces a verifiable export", async () => {
  const libDir = path.resolve('../frontend/src/lib');
  const temp = [];

  const write = async (name, contents) => {
    const file = path.join(libDir, name);
    await fs.writeFile(file, contents);
    temp.push(file);
    return file;
  };

  try {
    // crypto.js insists on window.crypto.subtle; Node's WebCrypto satisfies it.
    globalThis.window = { crypto: globalThis.crypto };

    const device = await crypto.subtle.generateKey(P256, true, ['sign', 'verify']);
    const pkcs8 = b64(await crypto.subtle.exportKey('pkcs8', device.privateKey));
    const authority = await crypto.subtle.generateKey(P256, true, ['sign', 'verify']);

    const messages = Array.from({ length: 7 }, (_, i) => ({
      messageId: 'msg-' + i,
      conversationId: 'conv-1',
      createdAt: new Date(Date.UTC(2026, 1, 2, 9, i)).toISOString(),
      payload: {
        text: 'real build path, message ' + i,
        attachments: i === 3 ? [{ kind: 'image', name: 'p.jpg', size: 2048, url: '/uploads/media/x.bin' }] : [],
        message: { sender: { _id: i % 2 ? 'peer' : 'user-1', name: i % 2 ? 'Peer' : 'Me' }, type: 'text' },
      },
    }));

    await write(
      '.fx-vault.mjs',
      `export const vault = {
         activeUserId: async () => 'user-1',
         loadIdentity: async () => ({ deviceId: 'dev_e2e', deviceSigningPrivateKey: ${JSON.stringify(pkcs8)} }),
         conversationCache: async () => (${JSON.stringify(messages)}),
       };`
    );

    await write('.fx-e2ee.mjs', 'export const isUnlocked = () => true;');

    // A stand-in authority that signs exactly as the server does, so the
    // attestation branch of build() is exercised rather than skipped.
    await write(
      '.fx-api.mjs',
      `import { canonical } from './forensics-core.js';
       const key = await crypto.subtle.importKey(
         'pkcs8',
         Uint8Array.from(atob(${JSON.stringify(b64(await crypto.subtle.exportKey('pkcs8', authority.privateKey)))}), c => c.charCodeAt(0)),
         { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']
       );
       const pub = ${JSON.stringify(b64(await crypto.subtle.exportKey('raw', authority.publicKey)))};
       export const api = {
         post: async (_url, body) => {
           const statement = {
             exportId: body.exportId,
             merkleRoot: body.merkleRoot,
             recordCount: body.recordCount,
             serverTime: new Date().toISOString(),
             algorithm: 'ECDSA-P256-SHA256',
           };
           const sig = await crypto.subtle.sign(
             { name: 'ECDSA', hash: 'SHA-256' }, key,
             new TextEncoder().encode(canonical(statement))
           );
           let s = ''; new Uint8Array(sig).forEach(b => { s += String.fromCharCode(b); });
           return { data: { attestation: { ...statement, signature: btoa(s), publicKey: pub } } };
         },
       };`
    );

    const source = await fs.readFile(path.join(libDir, 'forensics.js'), 'utf8');
    const shimmed = source
      .replace("from './api'", "from './.fx-api.mjs'")
      .replace("from './vault'", "from './.fx-vault.mjs'")
      .replace("from './e2ee'", "from './.fx-e2ee.mjs'")
      .replaceAll("from './crypto'", "from './crypto.js'")
      .replaceAll("from './forensics-core'", "from './forensics-core.js'");

    const shim = await write('.forensics.undertest.mjs', shimmed);
    const app = await import('file://' + shim.replace(/\\/g, '/'));

    const bundle = await app.build({ conversationIds: ['conv-1'], note: 'end-to-end' });

    assert(bundle.manifest.scope.recordCount === 7, 'wrong record count: ' + bundle.manifest.scope.recordCount);
    assert(bundle.records[0].prevHash === null, 'the first record should open the chain');
    assert(bundle.attestation, 'the attestation branch did not run');
    assert(bundle.limitations.length > 0, 'the file carries no limitations');

    const { code, out } = await verify(bundle);
    assert(code === 0, 'the verifier rejected a genuine export (exit ' + code + '):\n' + out);
    assert(out.includes('Verified — all checks passed'), 'no clean verdict:\n' + out);

    // And the same bundle with one character changed must fail.
    bundle.records[5].content.text += '!';
    const tampered = await verify(bundle);
    assert(tampered.code === 1, 'a tampered genuine export still passed');
  } finally {
    delete globalThis.window;
    await Promise.all(temp.map((f) => fs.unlink(f).catch(() => {})));
  }
});

/* ───────────────────────────── report ───────────────────────────── */

for (const [state, name, why] of results) {
  console.log(`${state}  ${name}${why ? '\n        ↳ ' + why : ''}`);
}
const failed = results.filter(([s]) => s === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
