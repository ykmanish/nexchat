import mongoose from 'mongoose';

/**
 * An encrypted archive of one account's local history.
 *
 * The message cache lives in the browser, which makes "clear site data" and
 * "lost laptop" the same event: the ciphertext on the server is still there,
 * but the keys to read it are not. A backup is the client's own vault —
 * identity, ratchet sessions and decrypted messages — sealed with a key derived
 * from a passphrase the user picks and this server never sees.
 *
 * Storing it here is a convenience, not a trust change. Everything below is
 * either opaque ciphertext or metadata the server already knows (how big, how
 * many messages, when). The KDF parameters are stored in the clear on purpose:
 * restoring needs them, and they reveal nothing.
 */
const backupSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    /** Bumped when the on-disk format changes, so an old archive can be read
     *  by a newer client instead of being rejected. */
    formatVersion: { type: Number, default: 1 },

    ciphertext: { type: String, required: true },
    iv: { type: String, required: true },
    salt: { type: String, required: true },
    iterations: { type: Number, default: 310000 },
    algorithm: { type: String, default: 'AES-GCM-256' },

    /** Verifies the passphrase before a large decrypt is attempted, and lets
     *  the UI say "wrong passphrase" rather than "corrupt archive". */
    verifier: { type: String, default: null },

    size: { type: Number, default: 0 },
    /** Counts only. Enough for "1,204 messages, 12 chats" in the UI. */
    stats: {
      messages: { type: Number, default: 0 },
      conversations: { type: Number, default: 0 },
      sessions: { type: Number, default: 0 },
      media: { type: Number, default: 0 },
    },

    deviceId: { type: String, default: null },
    deviceName: { type: String, default: null },
  },
  { timestamps: true, toJSON: { virtuals: true } }
);

backupSchema.index({ user: 1, createdAt: -1 });

backupSchema.methods.summary = function summary() {
  return {
    id: String(this._id),
    formatVersion: this.formatVersion,
    size: this.size,
    stats: this.stats,
    deviceName: this.deviceName,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

export const Backup = mongoose.model('Backup', backupSchema);
