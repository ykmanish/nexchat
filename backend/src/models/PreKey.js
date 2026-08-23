import mongoose from 'mongoose';

/** One-time prekeys. Consumed (deleted) the first time someone starts a
 *  session with this device, giving forward secrecy for the initial message. */
const preKeySchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    deviceId: { type: String, required: true, index: true },
    keyId: { type: Number, required: true },
    publicKey: { type: String, required: true },
    consumedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

preKeySchema.index({ deviceId: 1, keyId: 1 }, { unique: true });
preKeySchema.index({ deviceId: 1, consumedAt: 1 });

export const PreKey = mongoose.model('PreKey', preKeySchema);
