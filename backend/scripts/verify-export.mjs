#!/usr/bin/env node
/**
 * Independent verifier for a Chax forensic export (.chaxfx).
 *
 *   node verify-export.mjs <file> [--authority <url>] [--offline]
 *
 * Self-contained on purpose. It imports nothing but Node built-ins, so an
 * examiner can run it against a file without installing the application, and a
 * verifier that needed the system under examination would not be independent.
 *
 * That means the Merkle and canonicalisation code here duplicates
 * frontend/src/lib/forensics-core.js. The duplication is deliberate; silent
 * divergence between the two would not be, so backend/scripts/forensics.test.mjs
 * asserts both implementations agree on random input.
 *
 * What a PASS means is stated at the end of every run, because the interesting
 * question about this file is not whether it verifies — it is what verifying
 * actually establishes.
 */
import fs from 'node:fs/promises';
import crypto from 'node:crypto';

/* ─────────────────────────────── primitives ─────────────────────────────── */

const enc = new TextEncoder();

function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
}

const bytesOf = (input) => (typeof input === 'string' ? enc.encode(input) : input);
const b64 = (bytes) => Buffer.from(bytes).toString('base64');
const unb64 = (s) => new Uint8Array(Buffer.from(s, 'base64'));

const digest = async (input) =>
  new Uint8Array(await crypto.subtle.digest('SHA-256', bytesOf(input)));
const hashToB64 = async (input) => b64(await digest(input));

const prefixed = (tag, ...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 1));
  out[0] = tag;
  let at = 1;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

const leafHash = (data) => digest(prefixed(0x00, bytesOf(data)));
const nodeHash = (l, r) => digest(prefixed(0x01, l, r));

function splitPoint(n) {
  let k = 1;
  while (k * 2 < n) k *= 2;
  return k;
}

async function merkleRoot(leaves) {
  if (leaves.length === 0) return digest(new Uint8Array(0));
  if (leaves.length === 1) return leaves[0];
  const k = splitPoint(leaves.length);
  return nodeHash(await merkleRoot(leaves.slice(0, k)), await merkleRoot(leaves.slice(k)));
}

/** Raw P-256 point (65 bytes, 0x04-prefixed) to a verifying key. */
async function importP256(rawB64) {
  return crypto.subtle.importKey(
    'raw',
    unb64(rawB64),
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['verify']
  );
}

const verifySig = async (keyB64, sigB64, message) =>
  crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    await importP256(keyB64),
    unb64(sigB64),
    bytesOf(message)
  );

/* ─────────────────────────────── reporting ─────────────────────────────── */

const checks = [];
const record = (ok, label, detail) => checks.push({ ok, label, detail });

const C = {
  reset: '\x1b[0m', red: '\x1b[31m', green: '\x1b[32m',
  yellow: '\x1b[33m', dim: '\x1b[2m', bold: '\x1b[1m',
};

/* ──────────────────────────────── the run ──────────────────────────────── */

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const offline = args.includes('--offline');

/* Guarded, because indexOf returns -1 when the flag is absent and args[-1 + 1]
   is the filename — which would then be fetched as if it were a URL. */
const flagAt = args.indexOf('--authority');
const authorityUrl = flagAt >= 0 ? args[flagAt + 1] : null;

if (!file) {
  console.error('usage: node verify-export.mjs <file.chaxfx> [--authority <url>] [--offline]');
  process.exit(2);
}

let bundle;
try {
  bundle = JSON.parse(await fs.readFile(file, 'utf8'));
} catch (err) {
  console.error('Could not read that file as JSON: ' + err.message);
  process.exit(2);
}

/* 1 ── envelope */
record(
  bundle.magic === 'chax-forensic-export',
  'File is a Chax forensic export',
  bundle.magic || '(no magic field)'
);
record(
  bundle.formatVersion === 1,
  'Format version is understood',
  'v' + bundle.formatVersion
);

const { manifest = {}, records = [], signature = {}, attestation } = bundle;

/* 2 ── per-record hashes and the chain between them.
       Reported by index, because "something was altered" is far less useful to
       an examiner than "record 41 does not match its own hash". */
let chainOk = true;
let contentOk = true;
let prev = null;
const firstBreak = { chain: null, content: null };

for (let i = 0; i < records.length; i += 1) {
  const r = records[i];
  const { hash, content, ...header } = r;

  if (content !== undefined) {
    const expected = await hashToB64(canonical(content));
    if (expected !== header.contentHash && contentOk) {
      contentOk = false;
      firstBreak.content = i;
    }
  }

  const recomputed = await hashToB64(canonical(header));
  if (recomputed !== hash || header.prevHash !== prev || header.seq !== i) {
    if (chainOk) {
      chainOk = false;
      firstBreak.chain = i;
    }
  }
  prev = hash;
}

record(
  chainOk,
  'Hash chain is intact across ' + records.length + ' record(s)',
  chainOk ? 'no gaps, reorderings or edits' : 'first mismatch at record ' + firstBreak.chain
);
record(
  contentOk,
  'Message bodies match their recorded digests',
  contentOk ? 'all present bodies verify' : 'first mismatch at record ' + firstBreak.content
);
record(
  manifest.chainTip === (records.length ? records[records.length - 1].hash : null),
  'Manifest chain tip matches the last record',
  manifest.chainTip || '(empty export)'
);

/* 3 ── Merkle root */
const leaves = [];
for (const r of records) leaves.push(await leafHash(canonical(r)));
const recomputedRoot = b64(await merkleRoot(leaves));

record(
  recomputedRoot === manifest.merkleRoot,
  'Merkle root matches the manifest',
  recomputedRoot === manifest.merkleRoot
    ? recomputedRoot
    : 'recomputed ' + recomputedRoot + ', manifest says ' + manifest.merkleRoot
);
record(
  manifest.scope?.recordCount === records.length,
  'Declared record count matches what is present',
  manifest.scope?.recordCount + ' declared, ' + records.length + ' found'
);

/* 4 ── the exporting device's signature over the manifest */
let deviceSigOk = false;
try {
  deviceSigOk = await verifySig(signature.publicKey, signature.value, canonical(manifest));
} catch (err) {
  deviceSigOk = false;
}
record(
  deviceSigOk,
  'Manifest signature verifies against the embedded device key',
  'device ' + (manifest.custody?.deviceId || 'unknown')
);

/* 5 ── the server's counter-signature over the root */
if (!attestation) {
  record(
    false,
    'Server attestation present',
    'absent — the export time is the exporter device clock alone'
  );
} else {
  const statement = {
    exportId: attestation.exportId,
    merkleRoot: attestation.merkleRoot,
    recordCount: attestation.recordCount,
    serverTime: attestation.serverTime,
    algorithm: attestation.algorithm,
  };

  /* Prefer a key fetched from the authority over the one in the file. A file
     that carries both the signature and the key used to check it proves only
     internal consistency. */
  let authorityKey = attestation.publicKey;
  let keySource = 'embedded in file';

  if (!offline && authorityUrl) {
    try {
      const res = await fetch(authorityUrl.replace(/\/+$/, '') + '/api/forensics/authority');
      const json = await res.json();
      authorityKey = json.authority?.publicKey || authorityKey;
      keySource = 'fetched from ' + authorityUrl;
    } catch (err) {
      keySource = 'embedded (authority unreachable: ' + err.message + ')';
    }
  }

  let attestOk = false;
  try {
    attestOk = await verifySig(authorityKey, attestation.signature, canonical(statement));
  } catch {
    attestOk = false;
  }

  record(attestOk, 'Server attestation signature verifies', keySource);
  record(
    attestation.merkleRoot === manifest.merkleRoot,
    'Attested root is the root of this file',
    attestation.merkleRoot === manifest.merkleRoot ? 'same root' : 'ATTESTATION IS FOR OTHER CONTENT'
  );

  /* An independent second channel: ask the server whether it remembers. */
  if (!offline && authorityUrl) {
    try {
      const res = await fetch(
        authorityUrl.replace(/\/+$/, '') + '/api/forensics/attestation/' + attestation.exportId
      );
      const json = await res.json();
      const onRecord = json.attestation;
      record(
        !!onRecord && onRecord.merkleRoot === manifest.merkleRoot,
        'Authority independently confirms this root',
        onRecord ? 'server holds the same root, attested ' + onRecord.serverTime : 'not on record'
      );
    } catch (err) {
      record(false, 'Authority independently confirms this root', 'lookup failed: ' + err.message);
    }
  }
}

/* ──────────────────────────────── output ──────────────────────────────── */

const pad = (s, n) => s + ' '.repeat(Math.max(0, n - s.length));
console.log('\n' + C.bold + 'Chax forensic export — verification' + C.reset);
console.log(C.dim + file + C.reset + '\n');

for (const c of checks) {
  const mark = c.ok ? C.green + '  PASS' : C.red + '  FAIL';
  console.log(mark + C.reset + '  ' + pad(c.label, 52) + C.dim + c.detail + C.reset);
}

const failed = checks.filter((c) => !c.ok);
const integrity = checks
  .slice(0, 8)
  .every((c) => c.ok);

console.log('');
if (!failed.length) {
  console.log(C.green + C.bold + '  Verified — all checks passed.' + C.reset);
} else if (integrity) {
  console.log(
    C.yellow + C.bold + '  Integrity intact; ' + failed.length + ' weaker claim(s) unproven.' + C.reset
  );
} else {
  console.log(C.red + C.bold + '  FAILED — this file has been altered or is not authentic.' + C.reset);
}

/* Custody, so the report is self-describing. */
console.log('\n' + C.bold + 'Chain of custody' + C.reset);
console.log('  Export id     ' + (manifest.exportId || '—'));
console.log('  Exported by   user ' + (manifest.custody?.exporterUserId || '—'));
console.log('  From device   ' + (manifest.custody?.deviceId || '—'));
console.log('  Device clock  ' + (manifest.custody?.exportedAt || '—'));
console.log('  Server clock  ' + (attestation?.serverTime || 'not attested'));
console.log('  Records       ' + records.length + ' spanning ' +
  (manifest.scope?.from || '—') + ' … ' + (manifest.scope?.to || '—'));
if (manifest.custody?.note) console.log('  Note          ' + manifest.custody.note);

/* The part that matters most, and the part a tool like this usually omits. */
console.log('\n' + C.bold + 'What a PASS does and does not establish' + C.reset);
for (const line of bundle.limitations || []) {
  console.log(C.dim + '  · ' + line + C.reset);
}
console.log('');

process.exit(failed.length && !integrity ? 1 : 0);
