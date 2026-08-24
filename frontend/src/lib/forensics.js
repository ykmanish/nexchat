'use client';

import { api } from './api';
import { vault } from './vault';
import * as C from './crypto';
import * as e2ee from './e2ee';
import {
  canonical,
  hashToB64,
  leafHash,
  merkleRoot,
  inclusionProof,
  verifyInclusion,
  toBase64,
} from './forensics-core';

export { canonical, leafHash, merkleRoot, inclusionProof, verifyInclusion };

/**
 * Tamper-evident forensic export.
 *
 * An ordinary chat export is worthless as evidence: it is a text file, and
 * anybody can edit a text file. This produces something a third party can check
 * — every record hash-chained to the one before it, the whole set summarised by
 * a Merkle root, the root signed by the exporting device's key, and optionally
 * counter-signed by the server so the time is not just the exporter's own clock.
 *
 * ── What it proves ──────────────────────────────────────────────────────────
 *
 *   Integrity      Nothing has been added, removed or altered since export.
 *                  Any edit breaks the chain at a nameable record.
 *   Origin         A device holding this specific device signing key produced it.
 *   Anteriority    With a server attestation, the content existed no later than
 *                  the server's clock said — not the exporter's.
 *   Selectivity    A Merkle inclusion proof discloses one message and proves it
 *                  belonged to the sealed set, without revealing the rest.
 *
 * ── What it does NOT prove, and this is the important part ──────────────────
 *
 * It cannot attribute a *received* message to its sender. Messages here are
 * sealed with AES-GCM under a content key that both parties hold, and nothing
 * is signed by the sender. That makes the ciphertext authentic to anyone holding
 * the key — the recipient included — so a recipient can construct a message that
 * decrypts and authenticates perfectly.
 *
 * That is deniability, and it is deliberate: it is what stops a leaked
 * transcript being cryptographic proof against its author. The cost is that this
 * export is evidence of *what this device holds and asserts*, not of what the
 * other party said. An export that claimed otherwise would be worse than no
 * export at all, so the limitation travels inside the file and is restated by
 * the verifier.
 */

const MAGIC = 'chax-forensic-export';
const FORMAT_VERSION = 1;

/* ─────────────────────────── record building ─────────────────────────── */

/**
 * Turns one cached message into a record.
 *
 * `contentHash` covers the content separately from the record header, so a
 * record can be disclosed with its content redacted and still verify — the
 * header keeps its place in the chain while the body is withheld.
 */
async function buildRecord({ message, payload, seq, prevHash, meId }) {
  const content = {
    text: payload?.text ?? null,
    attachments: (payload?.attachments || []).map((a) => ({
      kind: a.kind,
      name: a.name ?? null,
      size: a.size ?? null,
      // The bytes are not included; their address and digest are enough to tie
      // an attachment to this record without bloating the file.
      url: a.url ?? null,
    })),
  };

  const contentHash = await hashToB64(canonical(content));

  const header = {
    seq,
    prevHash,
    messageId: String(message._id),
    conversationId: String(message.conversation || message.conversationId || ''),
    senderId: String(message.sender?._id || message.sender || ''),
    senderName: message.sender?.name ?? null,
    direction: String(message.sender?._id || message.sender) === String(meId) ? 'sent' : 'received',
    sentAt: message.createdAt,
    type: message.type || 'text',
    editedAt: message.editedAt ?? null,
    contentHash,
  };

  return { ...header, hash: await hashToB64(canonical(header)), content };
}

/* ──────────────────────────── the export ──────────────────────────── */

/**
 * Collects a conversation from the local vault and seals it.
 *
 * Reads the decrypted cache rather than re-fetching, because the cache is what
 * this device actually holds — and the honest claim of the export is exactly
 * that: what this device holds, not what the server says exists.
 */
export async function build({ conversationIds = [], attest = true, note = null } = {}) {
  if (!e2ee.isUnlocked()) throw new Error('Your keys are locked. Sign in again.');

  const me = await vault.activeUserId();
  const identity = await vault.loadIdentity(me);
  if (!identity?.deviceSigningPrivateKey) throw new Error('This device has no signing key');

  /* Gather, then order by time. A hash chain implies a sequence, so the
     sequence has to be defined by something other than iteration order or two
     exports of the same data would not agree. */
  const collected = [];
  for (const id of conversationIds) {
    const rows = await vault.conversationCache(id, 10_000);
    for (const row of rows) {
      collected.push({
        message: { ...(row.payload?.message || {}), _id: row.messageId, conversation: id, createdAt: row.createdAt },
        payload: row.payload,
      });
    }
  }

  collected.sort(
    (a, b) =>
      new Date(a.message.createdAt) - new Date(b.message.createdAt) ||
      String(a.message._id).localeCompare(String(b.message._id))
  );

  const records = [];
  let prevHash = null;
  for (let i = 0; i < collected.length; i += 1) {
    const record = await buildRecord({ ...collected[i], seq: i, prevHash, meId: me });
    records.push(record);
    prevHash = record.hash;
  }

  const leaves = await Promise.all(records.map((r) => leafHash(canonical(r))));
  const root = toBase64(await merkleRoot(leaves));

  const exportId = C.randomId();
  const manifest = {
    exportId,
    magic: MAGIC,
    formatVersion: FORMAT_VERSION,
    custody: {
      exporterUserId: String(me),
      deviceId: identity.deviceId,
      exportedAt: new Date().toISOString(),
      note: note || null,
    },
    scope: {
      conversationIds: conversationIds.map(String),
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
    merkleRoot: root,
    chainTip: prevHash,
  };

  const signingKey = await C.importSigningPrivate(identity.deviceSigningPrivateKey);
  const signature = {
    alg: 'ECDSA-P256-SHA256',
    // The device's own public key travels with the file so the signature can be
    // checked offline. A verifier unwilling to trust the file fetches the same
    // key for this deviceId from the server and compares the two.
    publicKey: await devicePublicKey(identity.deviceSigningPrivateKey),
    value: await C.sign(signingKey, canonical(manifest)),
  };

  let attestation = null;
  if (attest) {
    try {
      const { data } = await api.post('/forensics/attest', {
        exportId,
        merkleRoot: root,
        recordCount: records.length,
      });
      attestation = data.attestation;
    } catch {
      // A missing attestation weakens the timestamp claim but not the integrity
      // claim, so an offline export is still worth producing.
      attestation = null;
    }
  }

  return {
    magic: MAGIC,
    formatVersion: FORMAT_VERSION,
    manifest,
    records,
    signature,
    attestation,
    limitations: LIMITATIONS,
  };
}

/**
 * Recovers the public half of the device signing key.
 *
 * The vault keeps only the private key, so this round-trips it through JWK and
 * strips the private scalar. Cheaper and more honest than asking the server for
 * it: the file should carry the key that actually made the signature.
 */
async function devicePublicKey(pkcs8B64) {
  const priv = await crypto.subtle.importKey(
    'pkcs8',
    C.fromB64(pkcs8B64),
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign']
  );

  const jwk = await crypto.subtle.exportKey('jwk', priv);
  delete jwk.d;
  jwk.key_ops = ['verify'];

  const pub = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['verify']
  );
  return C.toB64(await crypto.subtle.exportKey('raw', pub));
}

/**
 * Stated inside every file, so the limits travel with the evidence rather than
 * living in documentation nobody reads.
 */
export const LIMITATIONS = [
  'Proves integrity of these records since export, and that a device holding the named signing key produced them.',
  'Does NOT prove that a received message was authored by the named sender. Messages are sealed under a content key both parties hold and carry no sender signature, so a recipient can construct a message that decrypts correctly. This deniability is a deliberate property of the messaging protocol.',
  'Sent messages are self-asserted by the exporting device and are not independently corroborated by this file.',
  'Covers only what this device had decrypted and retained. Messages deleted locally, or never delivered to this device, are absent and their absence is not evidence.',
  'Without a server attestation, the export time is the exporting device clock and is not independently established.',
  'Attachment bytes are not included; only their address, kind and size are recorded.',
];

/* ───────────────────────────── file output ───────────────────────────── */

export async function exportToFile(options = {}) {
  const bundle = await build(options);

  const name =
    'chax-forensic-' +
    new Date().toISOString().slice(0, 19).replace(/[:T]/g, '') +
    '.chaxfx';

  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);

  return { name, size: blob.size, bundle };
}

/** Counts and range, for the sheet to describe what an export would contain. */
export async function preview(conversationIds = []) {
  let count = 0;
  let from = null;
  let to = null;

  for (const id of conversationIds) {
    const rows = await vault.conversationCache(id, 10_000);
    count += rows.length;
    for (const row of rows) {
      const at = new Date(row.createdAt);
      if (!from || at < from) from = at;
      if (!to || at > to) to = at;
    }
  }

  return { count, from, to };
}
