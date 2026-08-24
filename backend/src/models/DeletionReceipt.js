import mongoose from 'mongoose';

/**
 * A signed statement from one device that it actually deleted a message.
 *
 * "Delete for everyone" is, in every messenger, an unverifiable promise: the
 * sender is shown a tombstone and has to take on faith that the bytes went
 * anywhere. This makes the claim checkable. Each recipient device signs a
 * receipt with the same key it signs forensic exports with, and the server
 * verifies that signature against the public key it already holds for that
 * device before storing anything.
 *
 * Two properties are worth the extra fields:
 *
 *   Non-repudiation. The receipt is signed by the device, so a recipient cannot
 *   later deny having confirmed — and equally, the server cannot manufacture a
 *   confirmation, because it has no private key to sign one with.
 *
 *   Completeness. Receipts are hash-chained per device per conversation, so a
 *   server that quietly drops one leaves a visible gap. Without the chain,
 *   selectively withholding receipts would be undetectable.
 *
 * What it does not prove: that no copy survives outside the app — a screenshot,
 * a backup, another person's export. It attests that this device's own stored
 * copy is gone, which is the most any software can honestly claim.
 */
const receiptSchema = new mongoose.Schema(
  {
    message: { type: mongoose.Schema.Types.ObjectId, ref: 'Message', required: true, index: true },
    conversation: {
      type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true, index: true,
    },

    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    deviceId: { type: String, required: true },

    /** The device's own clock — it signed this, so it is its assertion. */
    deletedAt: { type: Date, required: true },

    /** Previous receipt hash from this device in this conversation; null first. */
    prevHash: { type: String, default: null },
    hash: { type: String, required: true },

    algorithm: { type: String, default: 'ECDSA-P256-SHA256' },
    signature: { type: String, required: true },
    /** Recorded as used, so a later key rotation cannot silently invalidate it. */
    publicKey: { type: String, required: true },
  },
  { timestamps: true }
);

/* One receipt per device per message. A device confirming twice is a retry, not
   two deletions. */
receiptSchema.index({ message: 1, deviceId: 1 }, { unique: true });
receiptSchema.index({ conversation: 1, deviceId: 1, createdAt: 1 });

receiptSchema.methods.publicView = function publicView() {
  return {
    messageId: String(this.message),
    deviceId: this.deviceId,
    userId: String(this.user),
    deletedAt: this.deletedAt,
    prevHash: this.prevHash,
    hash: this.hash,
    algorithm: this.algorithm,
    signature: this.signature,
    publicKey: this.publicKey,
    recordedAt: this.createdAt,
  };
};

export const DeletionReceipt = mongoose.model('DeletionReceipt', receiptSchema);
