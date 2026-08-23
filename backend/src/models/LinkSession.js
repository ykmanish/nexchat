import mongoose from 'mongoose';

/** Backs the "scan to link a device" flow.
 *  The new device posts an ephemeral public key + code; the already-trusted
 *  device scans it and drops off a blob only the new device can open. */
const linkSessionSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, index: true },
    ephemeralPublicKey: { type: String, required: true },
    fingerprint: { type: String, required: true },

    status: {
      type: String,
      enum: ['pending', 'scanned', 'approved', 'completed', 'rejected', 'expired'],
      default: 'pending',
      index: true,
    },

    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    approvedByDevice: { type: String, default: null },
    linkedDeviceId: { type: String, default: null },

    /** Sealed to the new device's ephemeral key — the server cannot read it. */
    payload: {
      ciphertext: { type: String, default: null },
      iv: { type: String, default: null },
      senderEphemeralKey: { type: String, default: null },
    },

    /** The new device's own key bundle, held until approval mints its row. */
    pendingDeviceKeys: { type: mongoose.Schema.Types.Mixed, default: null },

    newDevice: {
      name: String,
      platform: String,
      browser: String,
      os: String,
      formFactor: String,
      ip: String,
      /** SHA-256 of the claim token — proves who opened the session. */
      claimHash: String,
    },

    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

linkSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const LinkSession = mongoose.model('LinkSession', linkSessionSchema);
