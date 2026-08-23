import mongoose from 'mongoose';

const otpSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, lowercase: true, index: true },
    codeHash: { type: String, required: true },
    purpose: {
      type: String,
      enum: ['verify-email', 'login', 'reset-password', 'change-email'],
      required: true,
    },
    attempts: { type: Number, default: 0 },
    consumedAt: { type: Date, default: null },
    meta: { type: mongoose.Schema.Types.Mixed, default: null },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
otpSchema.index({ email: 1, purpose: 1, consumedAt: 1 });

export const Otp = mongoose.model('Otp', otpSchema);
