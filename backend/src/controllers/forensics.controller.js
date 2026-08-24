import { Attestation } from '../models/index.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { attest, authority, attestationReady } from '../services/attestation.js';
import { logger } from '../utils/logger.js';

/**
 * Endpoints for the forensic export.
 *
 * Two of the three are deliberately unauthenticated. A verifier is a third party
 * — an examiner, an opposing expert, a court's technical assessor — who has the
 * file and no account, and evidence that can only be checked by someone holding
 * credentials in the system under examination is not independently verifiable at
 * all.
 */

/** Public: the key needed to check any attestation this server has issued. */
export const getAuthority = (_req, res) => {
  if (!attestationReady()) {
    throw ApiError.internal('Attestation is not configured', 'NO_AUTHORITY');
  }
  res.json({ success: true, authority: authority() });
};

/** Authenticated: counter-sign a root the exporting device has computed. */
export const createAttestation = asyncHandler(async (req, res) => {
  const { exportId, merkleRoot, recordCount = 0 } = req.body;

  const existing = await Attestation.findOne({ exportId });
  if (existing) {
    // Re-attesting the same id with a different root would let one identifier
    // stand for two different bodies of evidence.
    if (existing.merkleRoot !== merkleRoot) {
      throw ApiError.conflict('That export id is already attested to another root', 'ID_REUSED');
    }
    return res.json({ success: true, attestation: existing.publicView(), replayed: true });
  }

  const statement = await attest({ exportId, merkleRoot, recordCount });

  const record = await Attestation.create({
    exportId,
    merkleRoot,
    recordCount,
    user: req.user._id,
    deviceId: req.deviceId || null,
    serverTime: statement.serverTime,
    algorithm: statement.algorithm,
    signature: statement.signature,
  });

  logger.info('Attested export ' + exportId + ' (' + recordCount + ' records)');

  res.status(201).json({
    success: true,
    attestation: { ...record.publicView(), publicKey: statement.publicKey },
  });
});

/**
 * Public: confirm this server really did attest a given export.
 *
 * Keyed by the export id, which is random and only appears in the file, so this
 * discloses nothing to anyone who does not already hold the export.
 */
export const lookupAttestation = asyncHandler(async (req, res) => {
  const record = await Attestation.findOne({ exportId: req.params.exportId });
  if (!record) throw ApiError.notFound('No attestation on record', 'NO_ATTESTATION');
  res.json({ success: true, attestation: record.publicView(), authority: authority() });
});

/** Authenticated: what this account has exported, for its own audit trail. */
export const listMine = asyncHandler(async (req, res) => {
  const records = await Attestation.find({ user: req.user._id })
    .sort({ createdAt: -1 })
    .limit(100);

  res.json({
    success: true,
    attestations: records.map((r) => ({ ...r.publicView(), deviceId: r.deviceId })),
  });
});
