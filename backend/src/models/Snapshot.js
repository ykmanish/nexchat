import mongoose from 'mongoose';

/**
 * One encrypted history snapshot per account, shared between that account's
 * devices.
 *
 * A message is encrypted to the devices that existed when it was sent, so a
 * newly linked phone can never decrypt what came before it — which is why two
 * devices on one account can show different history. This is how they close
 * that gap: each pushes what it has decrypted, sealed under a key derived from
 * the account identity, and each pulls what the others left.
 *
 * The server is a locker, not a participant. It has no way to derive that key
 * and cannot tell this blob from noise. `stats` is only what the client claimed,
 * kept so the settings screen has something to describe, and trusted for
 * nothing.
 *
 * Deliberately a single slot rather than a log. A per-device history would grow
 * without bound and give the server a precise picture of which device was awake
 * when, which is exactly the metadata this design tries not to hand over.
 */
const snapshotSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true,
    },

    ciphertext: { type: String, required: true },
    iv: { type: String, required: true },
    algorithm: { type: String, default: 'AES-GCM-256' },

    /** Bumped on every write, so a device can tell "new" from "mine" cheaply. */
    version: { type: Number, default: 1 },

    size: { type: Number, default: 0 },
    stats: {
      messages: { type: Number, default: 0 },
      conversations: { type: Number, default: 0 },
      sessions: { type: Number, default: 0 },
    },

    /** Which device wrote it last — shown as "updated from your phone". */
    deviceId: { type: String, default: null },
    deviceName: { type: String, default: null },
  },
  { timestamps: true }
);

snapshotSchema.methods.info = function info() {
  return {
    version: this.version,
    size: this.size,
    stats: this.stats,
    deviceName: this.deviceName,
    updatedAt: this.updatedAt,
  };
};

export const Snapshot = mongoose.model('Snapshot', snapshotSchema);
