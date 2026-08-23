import mongoose from 'mongoose';

/** One row per logged-in client (phone, browser tab group, tablet…).
 *  Every device owns its own key pair so a compromised session can be
 *  revoked without rotating the whole account. */
const deviceSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    deviceId: { type: String, required: true, unique: true, index: true },
    name: { type: String, default: 'Unknown device' },
    platform: { type: String, default: 'web' },
    browser: { type: String, default: null },
    os: { type: String, default: null },
    formFactor: { type: String, enum: ['mobile', 'tablet', 'desktop'], default: 'desktop' },

    registrationId: { type: Number, required: true },
    identityPublicKey: { type: String, required: true },
    signingPublicKey: { type: String, required: true },
    signedPreKey: {
      keyId: Number,
      publicKey: String,
      signature: String,
      createdAt: Date,
    },

    isPrimary: { type: Boolean, default: false },
    linkedVia: { type: String, enum: ['login', 'qr'], default: 'login' },

    refreshTokenHash: { type: String, default: null, select: false },
    ip: { type: String, default: null },
    lastActiveAt: { type: Date, default: Date.now },
    pushSubscription: { type: mongoose.Schema.Types.Mixed, default: null },

    revokedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

deviceSchema.index({ user: 1, revokedAt: 1 });

deviceSchema.methods.toBundle = function toBundle() {
  return {
    deviceId: this.deviceId,
    registrationId: this.registrationId,
    identityPublicKey: this.identityPublicKey,
    signingPublicKey: this.signingPublicKey,
    signedPreKey: this.signedPreKey,
  };
};

export const Device = mongoose.model('Device', deviceSchema);
