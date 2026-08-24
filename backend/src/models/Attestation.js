import mongoose from 'mongoose';

/**
 * A record that this server saw a forensic export's Merkle root at a given time.
 *
 * Kept for a reason beyond bookkeeping: it is a second, independent channel of
 * verification. A file can be edited, including its embedded attestation — but
 * an examiner can ask this server directly whether it ever attested that root,
 * and compare. An export whose attestation is not on record here is either
 * forged or was produced offline, and either answer is informative.
 *
 * Only the root is stored. It is a hash of a hash tree; the server has no way to
 * recover a single message from it, and never held the messages in the first
 * place.
 */
const attestationSchema = new mongoose.Schema(
  {
    exportId: { type: String, required: true, unique: true, index: true },
    merkleRoot: { type: String, required: true, index: true },
    recordCount: { type: Number, default: 0 },

    /** Who asked. Never returned by the public lookup. */
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    deviceId: { type: String, default: null },

    serverTime: { type: Date, required: true },
    algorithm: { type: String, required: true },
    signature: { type: String, required: true },
  },
  { timestamps: true }
);

attestationSchema.index({ user: 1, createdAt: -1 });

/** The shape a third party may see: enough to check, nothing about who. */
attestationSchema.methods.publicView = function publicView() {
  return {
    exportId: this.exportId,
    merkleRoot: this.merkleRoot,
    recordCount: this.recordCount,
    serverTime: this.serverTime,
    algorithm: this.algorithm,
    signature: this.signature,
  };
};

export const Attestation = mongoose.model('Attestation', attestationSchema);
