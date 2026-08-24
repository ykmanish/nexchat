import mongoose from 'mongoose';

/**
 * A WebAuthn credential that can sign in to the account.
 *
 * Distinct from the app lock's authenticators, which never leave the browser:
 * these are verified here, against a challenge this server issued, and they
 * mint a real session. Only the public key is stored, which is the whole point
 * of the protocol — a stolen database cannot be replayed as a login.
 *
 * The E2EE identity is a separate problem. Signing in proves who you are; it
 * does not hand over the key that decrypts your history, which is wrapped
 * under the account password. When the authenticator supports the PRF
 * extension we can wrap a second copy of the identity under a secret only that
 * authenticator can reproduce, and a brand-new device needs no password at all.
 * Without PRF the password is still asked for once, on first use of a device.
 */
const passkeySchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    /** Base64URL credential id, as the browser reports it. */
    credentialId: { type: String, required: true, unique: true, index: true },
    publicKey: { type: String, required: true }, // base64url COSE key
    counter: { type: Number, default: 0 },

    transports: { type: [String], default: [] },
    deviceType: { type: String, enum: ['singleDevice', 'multiDevice'], default: 'singleDevice' },
    backedUp: { type: Boolean, default: false },

    name: { type: String, default: 'Passkey', maxlength: 60 },
    /** What the browser looked like when it was added, for the settings list. */
    addedFrom: { type: String, default: null },

    /** Identity key sealed under the authenticator's PRF output. Opaque here:
     *  the server has neither the PRF secret nor any way to ask for it. */
    identityWrapper: {
      ciphertext: { type: String, default: null },
      iv: { type: String, default: null },
      salt: { type: String, default: null },
    },

    lastUsedAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
  },
  { timestamps: true, toJSON: { virtuals: true } }
);

passkeySchema.index({ user: 1, revokedAt: 1 });

passkeySchema.methods.summary = function summary() {
  return {
    id: String(this._id),
    credentialId: this.credentialId,
    name: this.name,
    addedFrom: this.addedFrom,
    deviceType: this.deviceType,
    backedUp: this.backedUp,
    /** Tells the client whether this passkey can unlock history on its own. */
    unlocksIdentity: !!this.identityWrapper?.ciphertext,
    lastUsedAt: this.lastUsedAt,
    createdAt: this.createdAt,
  };
};

export const Passkey = mongoose.model('Passkey', passkeySchema);

/**
 * One in-flight WebAuthn challenge. Kept server-side and single-use, because a
 * challenge the client is trusted to remember is not a challenge.
 */
const challengeSchema = new mongoose.Schema(
  {
    challenge: { type: String, required: true, index: true },
    /** 'ticket' is the short-lived hand-off between proving who you are and
     *  being handed a session — see loginVerify. */
    purpose: { type: String, enum: ['register', 'login', 'ticket'], required: true },
    /** Null for a login: discoverable credentials tell us who they are. */
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    consumedAt: { type: Date, default: null },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

challengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const WebAuthnChallenge = mongoose.model('WebAuthnChallenge', challengeSchema);
