/**
 * Tests two-sided export reconciliation.
 *
 * The distinction that matters here and is easy to get wrong: a *contradiction*
 * is two independently valid exports that disagree about the same message id —
 * meaning one side altered its record before signing. That is not the same as a
 * tampered file, which fails its own integrity check and must be refused
 * outright rather than reconciled. Both cases are tested, separately.
 *
 * Run: node scripts/reconcile.test.mjs   (from backend/)
 */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const TOOL = path.resolve('scripts/reconcile-exports.mjs');

const core = await import(
  'file://' + path.resolve('../frontend/src/lib/forensics-core.js').replace(/\\/g, '/')
);

const b64 = (b) => Buffer.from(b).toString('base64');
const enc = new TextEncoder();
const P256 = { name: 'ECDSA', namedCurve: 'P-256' };

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

/* ─────────────────── building a valid export for one party ─────────────────── */

const ALICE = 'user-alice';
const BOB = 'user-bob';

/**
 * A conversation as one side saw it. `messages` are [id, author, text]; the
 * direction is derived from who is exporting, which is what makes two exports of
 * the same conversation mirror images of each other.
 */
async function exportFor({ me, deviceId, messages, exporterUserId = null }) {
  const device = await crypto.subtle.generateKey(P256, true, ['sign', 'verify']);

  const records = [];
  let prevHash = null;

  for (let i = 0; i < messages.length; i += 1) {
    const [id, author, text] = messages[i];
    const content = { text, attachments: [] };
    const header = {
      seq: i,
      prevHash,
      messageId: id,
      conversationId: 'conv-1',
      senderId: author,
      senderName: author === ALICE ? 'Alice' : 'Bob',
      direction: author === me ? 'sent' : 'received',
      sentAt: new Date(Date.UTC(2026, 3, 1, 9, i)).toISOString(),
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

  const manifest = {
    exportId: 'exp-' + b64(crypto.randomBytes(8)).replace(/[^a-zA-Z0-9]/g, ''),
    magic: 'chax-forensic-export',
    formatVersion: 1,
    custody: {
      exporterUserId: exporterUserId || me,
      deviceId,
      exportedAt: new Date().toISOString(),
      note: null,
    },
    scope: {
      conversationIds: ['conv-1'],
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
    merkleRoot: b64(await core.merkleRoot(leaves)),
    chainTip: prevHash,
  };

  return {
    magic: 'chax-forensic-export',
    formatVersion: 1,
    manifest,
    records,
    signature: {
      alg: 'ECDSA-P256-SHA256',
      publicKey: b64(await crypto.subtle.exportKey('raw', device.publicKey)),
      value: b64(
        await crypto.subtle.sign(
          { name: 'ECDSA', hash: 'SHA-256' },
          device.privateKey,
          enc.encode(core.canonical(manifest))
        )
      ),
    },
    attestation: null,
    limitations: ['Test fixture.'],
  };
}

/** The conversation both sides genuinely shared. */
const AGREED = [
  ['m0', ALICE, 'Did you approve the invoice?'],
  ['m1', BOB, 'Not yet, the total looks wrong.'],
  ['m2', ALICE, 'It is 40,000 as agreed.'],
  ['m3', BOB, 'I will check and confirm.'],
];

async function reconcile(a, b, extra = []) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rec-'));
  const fa = path.join(dir, 'a.chaxfx');
  const fb = path.join(dir, 'b.chaxfx');
  await fs.writeFile(fa, JSON.stringify(a, null, 2));
  await fs.writeFile(fb, JSON.stringify(b, null, 2));

  try {
    const { stdout } = await run(process.execPath, [TOOL, fa, fb, ...extra]);
    return { code: 0, out: stdout };
  } catch (err) {
    return { code: err.code ?? 1, out: (err.stdout || '') + (err.stderr || '') };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

const jsonOf = (out) => JSON.parse(out.slice(out.indexOf('{')));

/* ──────────────────────────────── cases ──────────────────────────────── */

await check('two honest exports corroborate every message', async () => {
  const a = await exportFor({ me: ALICE, deviceId: 'dev-a', messages: AGREED });
  const b = await exportFor({ me: BOB, deviceId: 'dev-b', messages: AGREED });

  const { code, out } = await reconcile(a, b, ['--json']);
  const r = jsonOf(out);

  assert(code === 0, 'honest pair reported a problem, exit ' + code);
  assert(r.independent === true, 'independent parties not recognised');
  assert(r.counts.corroborated === 4, 'expected 4 corroborated, got ' + r.counts.corroborated);
  assert(r.counts.contradicted === 0, 'invented a contradiction');
  assert(r.agreementOverOverlap === 1, 'agreement should be 1, got ' + r.agreementOverOverlap);
});

await check('mirrored directions are recognised as one conversation', async () => {
  const a = await exportFor({ me: ALICE, deviceId: 'dev-a', messages: AGREED });
  const b = await exportFor({ me: BOB, deviceId: 'dev-b', messages: AGREED });
  const r = jsonOf((await reconcile(a, b, ['--json'])).out);
  assert(
    r.counts.directionAnomalies === 0,
    'a genuine pair should have no direction anomalies, got ' + r.counts.directionAnomalies
  );
});

await check('two exports from the same account establish nothing', async () => {
  // Both sides controlled by one party — agreement is meaningless.
  const a = await exportFor({ me: ALICE, deviceId: 'dev-a1', messages: AGREED });
  const b = await exportFor({ me: ALICE, deviceId: 'dev-a2', messages: AGREED });

  const { code, out } = await reconcile(a, b);
  assert(code === 1, 'same-account reconciliation should not pass, exit ' + code);
  assert(out.includes('SAME account'), 'did not call out the shared account:\n' + out);
  assert(out.includes('establishes nothing'), 'did not withdraw the attribution claim');
});

await check('an altered record shows as a contradiction, not a pass', async () => {
  // Bob signs a different version of m2 — a valid file, dishonest content.
  const tweaked = AGREED.map((m) => (m[0] === 'm2' ? ['m2', ALICE, 'It is 400,000 as agreed.'] : m));

  const a = await exportFor({ me: ALICE, deviceId: 'dev-a', messages: AGREED });
  const b = await exportFor({ me: BOB, deviceId: 'dev-b', messages: tweaked });

  const { code, out } = await reconcile(a, b);
  assert(code === 1, 'a contradiction should not exit 0');
  assert(out.includes('Contradictions'), 'no contradiction section:\n' + out);
  assert(out.includes('40,000') && out.includes('400,000'), 'did not show both versions');

  const r = jsonOf((await reconcile(a, b, ['--json'])).out);
  assert(r.counts.contradicted === 1, 'expected 1 contradiction, got ' + r.counts.contradicted);
  assert(r.counts.corroborated === 3, 'the other three should still corroborate');
  assert(r.agreementOverOverlap === 0.75, 'agreement should be 0.75, got ' + r.agreementOverOverlap);
});

await check('a fabricated received message is flagged as unmatched', async () => {
  // Alice claims a message from Bob that Bob has no record of sending.
  const invented = [...AGREED, ['m9', BOB, 'Fine, go ahead and pay it.']];

  const a = await exportFor({ me: ALICE, deviceId: 'dev-a', messages: invented });
  const b = await exportFor({ me: BOB, deviceId: 'dev-b', messages: AGREED });

  const { out } = await reconcile(a, b);
  assert(out.includes('Received but unmatched'), 'no unmatched section:\n' + out);
  assert(out.includes('go ahead and pay it'), 'did not surface the disputed text');
  // And it must not be presented as proof of fabrication.
  assert(out.includes('equally consistent with an ordinary local deletion'), 'overstated the finding');

  const r = jsonOf((await reconcile(a, b, ['--json'])).out);
  assert(r.counts.unmatchedReceived === 1, 'expected 1 unmatched, got ' + r.counts.unmatchedReceived);
  assert(r.counts.onlyInA === 1, 'expected 1 only-in-A');
});

await check("a sender's own extra message is not treated as suspicious", async () => {
  // Alice has a message she sent that Bob never received. Ordinary, not a
  // fabrication — it must not land in the unmatched-received bucket.
  const extra = [...AGREED, ['m8', ALICE, 'Also, please cc finance.']];

  const a = await exportFor({ me: ALICE, deviceId: 'dev-a', messages: extra });
  const b = await exportFor({ me: BOB, deviceId: 'dev-b', messages: AGREED });

  const r = jsonOf((await reconcile(a, b, ['--json'])).out);
  assert(r.counts.onlyInA === 1, 'expected 1 only-in-A');
  assert(r.counts.unmatchedReceived === 0, 'a sent message was misfiled as unmatched-received');
});

await check('a file that fails its own integrity is refused', async () => {
  const a = await exportFor({ me: ALICE, deviceId: 'dev-a', messages: AGREED });
  const b = await exportFor({ me: BOB, deviceId: 'dev-b', messages: AGREED });
  b.records[2].content.text = 'edited after signing';

  const { code, out } = await reconcile(a, b);
  assert(code === 1, 'a broken file was reconciled anyway');
  assert(out.includes('Refusing to reconcile'), 'did not refuse:\n' + out);
  assert(out.includes('verify-export'), 'did not point at the verifier');
});

await check('exports with nothing in common say so', async () => {
  const a = await exportFor({ me: ALICE, deviceId: 'dev-a', messages: AGREED });
  const b = await exportFor({
    me: BOB,
    deviceId: 'dev-b',
    messages: [['z0', BOB, 'Totally different conversation.']],
  });

  const { out } = await reconcile(a, b);
  assert(out.includes('no messages in common'), 'did not report the empty overlap:\n' + out);
});

await check('the JSON mode is machine-readable', async () => {
  const a = await exportFor({ me: ALICE, deviceId: 'dev-a', messages: AGREED });
  const b = await exportFor({ me: BOB, deviceId: 'dev-b', messages: AGREED });
  const r = jsonOf((await reconcile(a, b, ['--json'])).out);

  for (const key of ['reconciled', 'independent', 'exporters', 'devices', 'counts', 'agreementOverOverlap']) {
    assert(key in r, 'missing key: ' + key);
  }
  assert(r.exporters.a === ALICE && r.exporters.b === BOB, 'exporters not reported');
});

await check('two arguments are required', async () => {
  try {
    await run(process.execPath, [TOOL, 'only-one.chaxfx']);
    throw new Error('accepted a single file');
  } catch (err) {
    assert((err.stderr || '').includes('usage:'), 'no usage message');
  }
});

/* ───────────────────────────── report ───────────────────────────── */

for (const [state, name, why] of results) {
  console.log(`${state}  ${name}${why ? '\n        ↳ ' + why : ''}`);
}
const failed = results.filter(([s]) => s === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
