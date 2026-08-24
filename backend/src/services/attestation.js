import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

/**
 * The attestation authority: a signing key the server uses to counter-sign
 * forensic export roots.
 *
 * The problem it solves is narrow and real. An export signed only by the
 * exporting device proves integrity and origin, but its timestamp is the
 * exporter's own clock — which the exporter controls, so it establishes nothing
 * about *when*. A counter-signature from a second party fixes an upper bound:
 * the content existed no later than the moment this server saw its root.
 *
 * Deliberately not a full RFC 3161 Time-Stamping Authority. A real TSA is a
 * trusted third party with an audited clock, and that is the correct answer for
 * evidence intended for court. This is the same shape at lower assurance —
 * useful, honest about being first-party, and a natural place to plug a real TSA
 * in later. The export format records which authority signed it so the two are
 * never confused.
 *
 * Only the root is ever sent here. The server attests to a hash it cannot invert
 * and never sees the messages behind it.
 */

const ALGORITHM = 'ECDSA-P256-SHA256';
const CURVE = { name: 'ECDSA', namedCurve: 'P-256' };

let keyPair = null;
let publicKeyB64 = null;

/**
 * Loads the configured key, or mints an ephemeral one and says so loudly.
 *
 * A regenerated key invalidates every attestation ever issued — nothing already
 * signed can be verified again — so running without a persisted key is only
 * acceptable in development, and the warning has to be impossible to miss.
 */
export async function initAttestation() {
  const configured = process.env.FORENSIC_ATTEST_KEY;

  if (configured) {
    try {
      const privateKey = await crypto.subtle.importKey(
        'pkcs8',
        Buffer.from(configured, 'base64'),
        CURVE,
        true,
        ['sign']
      );
      keyPair = { privateKey };
      publicKeyB64 = await derivePublic(privateKey);
      logger.success('Forensic attestation key loaded');
      return;
    } catch (err) {
      logger.error('FORENSIC_ATTEST_KEY could not be read: ' + err.message);
    }
  }

  const generated = await crypto.subtle.generateKey(CURVE, true, ['sign', 'verify']);
  keyPair = generated;
  publicKeyB64 = Buffer.from(
    await crypto.subtle.exportKey('raw', generated.publicKey)
  ).toString('base64');

  const pkcs8 = Buffer.from(await crypto.subtle.exportKey('pkcs8', generated.privateKey));
  logger.warn('No FORENSIC_ATTEST_KEY set — generated a temporary one.');
  logger.warn('Every attestation signed with it becomes unverifiable on restart.');
  logger.warn('Add this to backend/.env before relying on any export:');
  logger.warn('  FORENSIC_ATTEST_KEY=' + pkcs8.toString('base64'));
}

/** Recovers the public half from a pkcs8 private key, via JWK. */
async function derivePublic(privateKey) {
  const jwk = await crypto.subtle.exportKey('jwk', privateKey);
  delete jwk.d;
  jwk.key_ops = ['verify'];
  const pub = await crypto.subtle.importKey('jwk', jwk, CURVE, true, ['verify']);
  return Buffer.from(await crypto.subtle.exportKey('raw', pub)).toString('base64');
}

/**
 * Deterministic JSON, matching the client's canonical form exactly.
 *
 * Both sides sign bytes, so both sides must agree byte-for-byte on what those
 * bytes are. Insertion-order JSON is the usual reason a signature that should
 * verify does not.
 */
export function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';

  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
}

export const authority = () => ({
  name: env.appName + ' attestation authority',
  kind: 'first-party',
  algorithm: ALGORITHM,
  publicKey: publicKeyB64,
  /** Stated so a verifier does not mistake this for an audited TSA. */
  assurance:
    'First-party timestamp. Establishes that this server saw the root at the stated time; it is not an RFC 3161 Time-Stamping Authority.',
});

/** Signs the attested statement and returns it whole. */
export async function attest({ exportId, merkleRoot, recordCount }) {
  if (!keyPair) throw new Error('Attestation is not configured');

  const statement = {
    exportId,
    merkleRoot,
    recordCount,
    serverTime: new Date().toISOString(),
    algorithm: ALGORITHM,
  };

  const signature = Buffer.from(
    await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      keyPair.privateKey,
      Buffer.from(canonical(statement), 'utf8')
    )
  ).toString('base64');

  return { ...statement, signature, publicKey: publicKeyB64 };
}

export const attestationReady = () => !!keyPair;
