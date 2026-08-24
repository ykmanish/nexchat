#!/usr/bin/env node
/**
 * Reconciles two forensic exports of the same conversation.
 *
 *   node reconcile-exports.mjs <a.chaxfx> <b.chaxfx> [--json]
 *
 * Why this exists. A single export proves integrity and origin but cannot
 * attribute a received message to its sender, because Chax messages carry no
 * sender signature and both parties hold the content key — so a recipient can
 * fabricate one that decrypts perfectly. That is deliberate deniability, and no
 * amount of hashing at export time gets around it.
 *
 * Two exports, from two different accounts, do get around it — partially and
 * honestly. Where both sides independently signed a record with the same message
 * id and the same content digest, neither could have produced that agreement
 * alone. Where they disagree, one of them is wrong and the report says which
 * record. Where only one side has a record at all, that is the shape a
 * fabrication takes, and it is called out as such rather than glossed over.
 *
 * The claim this tool supports is therefore: *corroborated by both parties*,
 * which is materially stronger than one export and still weaker than a
 * signature. Nothing here breaks deniability — it just measures agreement.
 *
 * Self-contained, like the verifier: an examiner needs Node and two files.
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

const bytesOf = (v) => (typeof v === 'string' ? enc.encode(v) : v);
const b64 = (b) => Buffer.from(b).toString('base64');
const unb64 = (s) => new Uint8Array(Buffer.from(s, 'base64'));

const digest = async (v) => new Uint8Array(await crypto.subtle.digest('SHA-256', bytesOf(v)));
const hashToB64 = async (v) => b64(await digest(v));

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
const leafHash = (d) => digest(prefixed(0x00, bytesOf(d)));
const nodeHash = (l, r) => digest(prefixed(0x01, l, r));

function splitPoint(n) {
  let k = 1;
  while (k * 2 < n) k *= 2;
  return k;
}
async function merkleRoot(leaves) {
  if (!leaves.length) return digest(new Uint8Array(0));
  if (leaves.length === 1) return leaves[0];
  const k = splitPoint(leaves.length);
  return nodeHash(await merkleRoot(leaves.slice(0, k)), await merkleRoot(leaves.slice(k)));
}

const verifySig = async (keyB64, sigB64, message) =>
  crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    await crypto.subtle.importKey(
      'raw', unb64(keyB64), { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify']
    ),
    unb64(sigB64),
    bytesOf(message)
  );

/**
 * Integrity gate. Reconciling files that have not themselves been checked would
 * measure agreement between two things that might each already be forged, so a
 * file that does not verify is refused rather than reported on.
 */
async function selfCheck(bundle, label) {
  const problems = [];
  if (bundle?.magic !== 'chax-forensic-export') problems.push('not a Chax forensic export');

  const { manifest = {}, records = [], signature = {} } = bundle || {};

  let prev = null;
  for (let i = 0; i < records.length; i += 1) {
    const { hash, content, ...header } = records[i];
    if (content !== undefined && (await hashToB64(canonical(content))) !== header.contentHash) {
      problems.push('record ' + i + ' body does not match its digest');
      break;
    }
    if ((await hashToB64(canonical(header))) !== hash || header.prevHash !== prev || header.seq !== i) {
      problems.push('hash chain breaks at record ' + i);
      break;
    }
    prev = hash;
  }

  const leaves = [];
  for (const r of records) leaves.push(await leafHash(canonical(r)));
  if (b64(await merkleRoot(leaves)) !== manifest.merkleRoot) problems.push('Merkle root mismatch');

  try {
    if (!(await verifySig(signature.publicKey, signature.value, canonical(manifest)))) {
      problems.push('manifest signature does not verify');
    }
  } catch {
    problems.push('manifest signature could not be checked');
  }

  return { label, ok: problems.length === 0, problems, manifest, records };
}

/* ──────────────────────────────── the run ──────────────────────────────── */

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const files = args.filter((a) => !a.startsWith('--'));

if (files.length !== 2) {
  console.error('usage: node reconcile-exports.mjs <a.chaxfx> <b.chaxfx> [--json]');
  process.exit(2);
}

const load = async (f) => {
  try {
    return JSON.parse(await fs.readFile(f, 'utf8'));
  } catch (err) {
    console.error('Could not read ' + f + ': ' + err.message);
    process.exit(2);
  }
};

const A = await selfCheck(await load(files[0]), files[0]);
const B = await selfCheck(await load(files[1]), files[1]);

if (!A.ok || !B.ok) {
  const broken = [A, B].filter((s) => !s.ok);
  if (asJson) {
    console.log(JSON.stringify({ reconciled: false, reason: 'integrity', broken }, null, 2));
  } else {
    console.log('\nRefusing to reconcile — a file does not verify on its own.\n');
    for (const s of broken) {
      console.log('  ' + s.label);
      for (const p of s.problems) console.log('    · ' + p);
    }
    console.log('\nRun verify-export.mjs on each file first.\n');
  }
  process.exit(1);
}

/* ── independence: two exports from one account prove nothing ── */

const exporterA = A.manifest.custody?.exporterUserId;
const exporterB = B.manifest.custody?.exporterUserId;
const sameParty = String(exporterA) === String(exporterB);
const sameDevice = A.manifest.custody?.deviceId === B.manifest.custody?.deviceId;

/* ── the comparison, keyed by message id ── */

const index = (records) => {
  const m = new Map();
  for (const r of records) m.set(r.messageId, r);
  return m;
};

const ia = index(A.records);
const ib = index(B.records);
const allIds = [...new Set([...ia.keys(), ...ib.keys()])];

const corroborated = [];
const contradicted = [];
const onlyInA = [];
const onlyInB = [];
const directionOdd = [];

for (const id of allIds) {
  const ra = ia.get(id);
  const rb = ib.get(id);

  if (ra && !rb) {
    onlyInA.push(ra);
    continue;
  }
  if (rb && !ra) {
    onlyInB.push(rb);
    continue;
  }

  if (ra.contentHash === rb.contentHash) {
    corroborated.push({ id, sentAt: ra.sentAt, a: ra, b: rb });

    /* In a genuine pair every message is sent by one side and received by the
       other. Matching directions means the two files are not opposite ends of
       one conversation, whatever else they agree on. */
    if (ra.direction === rb.direction) directionOdd.push({ id, direction: ra.direction });
  } else {
    contradicted.push({
      id,
      sentAt: ra.sentAt,
      a: { hash: ra.contentHash, text: ra.content?.text ?? null },
      b: { hash: rb.contentHash, text: rb.content?.text ?? null },
    });
  }
}

/**
 * The forensically interesting asymmetry. A message one side claims to have
 * *received* that the other has no record of *sending* is the exact shape a
 * fabrication takes — and also the exact shape of an ordinary local deletion, so
 * it is reported as unresolved rather than as an accusation.
 */
const unmatchedReceived = [
  ...onlyInA.filter((r) => r.direction === 'received').map((r) => ({ side: 'A', ...r })),
  ...onlyInB.filter((r) => r.direction === 'received').map((r) => ({ side: 'B', ...r })),
];

const overlap = corroborated.length + contradicted.length;
const agreement = overlap ? corroborated.length / overlap : 0;

const summary = {
  reconciled: true,
  independent: !sameParty && !sameDevice,
  exporters: { a: exporterA, b: exporterB },
  devices: { a: A.manifest.custody?.deviceId, b: B.manifest.custody?.deviceId },
  counts: {
    inA: A.records.length,
    inB: B.records.length,
    corroborated: corroborated.length,
    contradicted: contradicted.length,
    onlyInA: onlyInA.length,
    onlyInB: onlyInB.length,
    unmatchedReceived: unmatchedReceived.length,
    directionAnomalies: directionOdd.length,
  },
  agreementOverOverlap: Number(agreement.toFixed(4)),
};

if (asJson) {
  console.log(
    JSON.stringify(
      { ...summary, contradicted, unmatchedReceived, directionAnomalies: directionOdd },
      null,
      2
    )
  );
  process.exit(contradicted.length || !summary.independent ? 1 : 0);
}

/* ──────────────────────────────── report ──────────────────────────────── */

const C = {
  reset: '\x1b[0m', red: '\x1b[31m', green: '\x1b[32m',
  yellow: '\x1b[33m', dim: '\x1b[2m', bold: '\x1b[1m',
};
const pad = (s, n) => String(s) + ' '.repeat(Math.max(0, n - String(s).length));

console.log('\n' + C.bold + 'Two-sided export reconciliation' + C.reset);
console.log(C.dim + '  A  ' + files[0] + C.reset);
console.log(C.dim + '  B  ' + files[1] + C.reset + '\n');

console.log('  Both files verify independently.');

if (sameParty) {
  console.log(
    C.red +
      '  Both exports come from the SAME account. Agreement between them\n' +
      '  establishes nothing about attribution — one party controls both.' +
      C.reset
  );
} else if (sameDevice) {
  console.log(C.red + '  Both exports come from the same device.' + C.reset);
} else {
  console.log(
    C.green +
      '  Independent parties: ' + exporterA + ' and ' + exporterB +
      C.reset
  );
}

console.log('\n' + C.bold + 'Agreement' + C.reset);
const row = (colour, label, n, note) =>
  console.log('  ' + colour + pad(n, 5) + C.reset + '  ' + pad(label, 26) + C.dim + (note || '') + C.reset);

row(C.green, 'corroborated', corroborated.length, 'same id, same content digest, both signed');
row(contradicted.length ? C.red : C.dim, 'contradicted', contradicted.length, 'same id, different content');
row(C.yellow, 'only in A', onlyInA.length, '');
row(C.yellow, 'only in B', onlyInB.length, '');

if (overlap) {
  console.log(
    '\n  Agreement over the overlap: ' +
      C.bold + (agreement * 100).toFixed(1) + '%' + C.reset +
      C.dim + ' (' + corroborated.length + ' of ' + overlap + ')' + C.reset
  );
}

if (contradicted.length) {
  console.log('\n' + C.bold + C.red + 'Contradictions' + C.reset);
  for (const c of contradicted.slice(0, 20)) {
    console.log('  ' + C.dim + c.sentAt + '  ' + c.id + C.reset);
    console.log('    A: ' + JSON.stringify(c.a.text));
    console.log('    B: ' + JSON.stringify(c.b.text));
  }
  if (contradicted.length > 20) console.log('  … and ' + (contradicted.length - 20) + ' more');
}

if (unmatchedReceived.length) {
  console.log('\n' + C.bold + C.yellow + 'Received but unmatched' + C.reset);
  console.log(
    C.dim +
      '  Claimed as received by one side, absent from the other. Consistent with\n' +
      '  fabrication, and equally consistent with an ordinary local deletion — so\n' +
      '  unresolved, not an accusation.' +
      C.reset
  );
  for (const r of unmatchedReceived.slice(0, 20)) {
    console.log(
      '  ' + r.side + '  ' + C.dim + r.sentAt + C.reset + '  ' + JSON.stringify(r.content?.text ?? null)
    );
  }
  if (unmatchedReceived.length > 20) {
    console.log('  … and ' + (unmatchedReceived.length - 20) + ' more');
  }
}

if (directionOdd.length) {
  console.log(
    '\n' + C.yellow + '  ' + directionOdd.length +
      ' record(s) are marked the same direction on both sides — these files may\n' +
      '  not be opposite ends of one conversation.' + C.reset
  );
}

console.log('\n' + C.bold + 'What this establishes' + C.reset);
if (!summary.independent) {
  console.log(C.dim + '  Nothing about attribution. Both exports trace to one party.' + C.reset);
} else if (!overlap) {
  console.log(C.dim + '  Nothing — the two exports have no messages in common.' + C.reset);
} else {
  console.log(
    C.dim +
      '  ' + corroborated.length + ' message(s) were independently signed by both\n' +
      '  parties with identical content. Neither party could produce that\n' +
      '  agreement alone, so those records are corroborated rather than merely\n' +
      '  asserted. This is stronger than a single export and weaker than a sender\n' +
      '  signature: it shows both sides hold the same record, not that a\n' +
      '  particular person composed it.' +
      C.reset
  );
}
console.log(
  C.dim +
    '  A one-sided record proves nothing either way. Absence has innocent causes\n' +
    '  — local deletion, non-delivery, a device that joined later.' +
    C.reset + '\n'
);

process.exit(contradicted.length || !summary.independent ? 1 : 0);
