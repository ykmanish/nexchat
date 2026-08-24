'use client';

/**
 * The pure primitives a forensic export is built from: canonical JSON, SHA-256,
 * and an RFC 6962 Merkle tree.
 *
 * Separated from ./forensics deliberately. Everything here depends on nothing
 * but WebCrypto, which means the standalone verifier can hold a byte-identical
 * copy without dragging in the app — and a verifier that needs the application
 * it is checking is not much of an independent check.
 *
 * The copy in backend/scripts/verify-export.mjs is that duplicate. Duplication
 * is the right call for an evidence tool, but silent divergence between the two
 * would be a quiet disaster, so a conformance test asserts the two agree on
 * random input. Change one, change both, and the test will say so.
 */

const enc = new TextEncoder();

/**
 * Deterministic JSON: keys sorted, undefined dropped, no insignificant space.
 *
 * Signatures are over bytes, so signer and verifier have to agree byte for byte.
 * `JSON.stringify` preserves insertion order, which differs the moment anything
 * parses and re-serialises the object — the usual reason a signature that ought
 * to verify does not.
 */
export function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';

  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
}

const bytesOf = (input) => (typeof input === 'string' ? enc.encode(input) : input);

export const toBase64 = (bytes) => {
  let s = '';
  const view = new Uint8Array(bytes);
  for (let i = 0; i < view.length; i += 1) s += String.fromCharCode(view[i]);
  return btoa(s);
};

export const fromBase64 = (b64) => {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
};

export const digest = async (input) =>
  new Uint8Array(await crypto.subtle.digest('SHA-256', bytesOf(input)));

export const hashToB64 = async (input) => toBase64(await digest(input));

/* ─────────────────────────── Merkle, RFC 6962 ─────────────────────────── */

/**
 * Certificate Transparency hashing, not the Bitcoin variant.
 *
 * Two reasons, both about attacks the simpler version admits. Leaves are
 * prefixed 0x00 and interior nodes 0x01, so no leaf can be reinterpreted as a
 * node — without that separation a second tree can be built with the same root.
 * And odd rows are split rather than having their last node duplicated, which is
 * the ambiguity that let two distinct Bitcoin trees share a root.
 */
const LEAF = 0x00;
const NODE = 0x01;

const prefixed = (tag, ...parts) => {
  const total = parts.reduce((n, p) => n + p.length, 1);
  const out = new Uint8Array(total);
  out[0] = tag;
  let at = 1;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

export const leafHash = (data) => digest(prefixed(LEAF, bytesOf(data)));

export const nodeHash = (left, right) => digest(prefixed(NODE, left, right));

/** Largest power of two strictly below n — RFC 6962's split point. */
export function splitPoint(n) {
  let k = 1;
  while (k * 2 < n) k *= 2;
  return k;
}

/** Merkle root over leaf hashes. An empty list hashes to SHA-256 of nothing. */
export async function merkleRoot(leaves) {
  if (leaves.length === 0) return digest(new Uint8Array(0));
  if (leaves.length === 1) return leaves[0];

  const k = splitPoint(leaves.length);
  return nodeHash(await merkleRoot(leaves.slice(0, k)), await merkleRoot(leaves.slice(k)));
}

/**
 * The sibling hashes needed to walk one leaf back up to the root.
 *
 * This is what makes selective disclosure possible: hand over a single message
 * and its proof, and the recipient can confirm it belonged to the sealed set
 * without ever seeing the records around it.
 */
export async function inclusionProof(leaves, index) {
  if (leaves.length <= 1) return [];

  const k = splitPoint(leaves.length);
  if (index < k) {
    return [
      ...(await inclusionProof(leaves.slice(0, k), index)),
      { position: 'right', hash: toBase64(await merkleRoot(leaves.slice(k))) },
    ];
  }
  return [
    ...(await inclusionProof(leaves.slice(k), index - k)),
    { position: 'left', hash: toBase64(await merkleRoot(leaves.slice(0, k))) },
  ];
}

/** Replays a proof and reports whether it reaches the expected root. */
export async function verifyInclusion(leaf, proof, expectedRootB64) {
  let current = leaf;
  for (const step of proof) {
    const sibling = fromBase64(step.hash);
    current =
      step.position === 'left'
        ? await nodeHash(sibling, current)
        : await nodeHash(current, sibling);
  }
  return toBase64(current) === expectedRootB64;
}
