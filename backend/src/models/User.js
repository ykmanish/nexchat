import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const settingsSchema = new mongoose.Schema(
  {
    theme: { type: String, enum: ['system', 'light', 'dark'], default: 'system' },
    wallpaper: { type: String, default: 'doodle' },
    bubbleColor: { type: String, default: 'green' },
    sounds: { type: Boolean, default: true },
    haptics: { type: Boolean, default: true },
    enterToSend: { type: Boolean, default: true },
    reduceMotion: { type: Boolean, default: false },
    fontScale: { type: Number, default: 1, min: 0.85, max: 1.3 },
    notifications: {
      messages: { type: Boolean, default: true },
      groups: { type: Boolean, default: true },
      reactions: { type: Boolean, default: true },
      calls: { type: Boolean, default: true },
      previews: { type: Boolean, default: true },
    },
  },
  { _id: false }
);

const privacySchema = new mongoose.Schema(
  {
    lastSeen: { type: String, enum: ['everyone', 'contacts', 'nobody'], default: 'everyone' },
    avatar: { type: String, enum: ['everyone', 'contacts', 'nobody'], default: 'everyone' },
    about: { type: String, enum: ['everyone', 'contacts', 'nobody'], default: 'everyone' },
    readReceipts: { type: Boolean, default: true },
    typingIndicator: { type: Boolean, default: true },
    // When off, a received link is shown as a plain chip instead of asking the
    // server to resolve a card — the server never learns the user opened it.
    linkPreviews: { type: Boolean, default: true },
    groupAdd: { type: String, enum: ['everyone', 'contacts', 'nobody'], default: 'everyone' },
  },
  { _id: false }
);

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String, required: true, unique: true, lowercase: true, trim: true, index: true,
    },
    emailVerified: { type: Boolean, default: false },
    password: { type: String, required: true, select: false, minlength: 8 },

    name: { type: String, required: true, trim: true, maxlength: 60 },
    username: {
      type: String, unique: true, sparse: true, lowercase: true, trim: true,
      minlength: 3, maxlength: 24, match: /^[a-z0-9_.]+$/,
    },
    avatar: { type: String, default: null },
    avatarColor: { type: String, default: '#21C063' },
    about: { type: String, default: 'Available', maxlength: 160 },
    phone: { type: String, default: null, trim: true },

    presence: { type: String, enum: ['online', 'offline'], default: 'offline' },
    lastSeen: { type: Date, default: Date.now },

    contacts: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    blocked: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

    settings: { type: settingsSchema, default: () => ({}) },
    privacy: { type: privacySchema, default: () => ({}) },

    /** Account-level key material. Private halves are encrypted client-side
     *  with a key derived from the user's password — the server only ever
     *  stores opaque ciphertext. */
    identityPublicKey: { type: String, default: null },
    signingPublicKey: { type: String, default: null },
    encryptedIdentity: {
      ciphertext: { type: String, default: null },
      iv: { type: String, default: null },
      salt: { type: String, default: null },
      iterations: { type: Number, default: 250000 },
    },
    securityCode: { type: String, default: null },

    twoFactorEnabled: { type: Boolean, default: false },
    twoFactorPinHash: { type: String, default: null, select: false },

    disabledAt: { type: Date, default: null },
    lastLoginAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_doc, ret) {
        delete ret.password;
        delete ret.twoFactorPinHash;
        delete ret.__v;
        return ret;
      },
    },
  }
);

userSchema.index({ name: 'text', username: 'text' });

userSchema.pre('save', async function hashPassword(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

userSchema.methods.comparePassword = function comparePassword(candidate) {
  return bcrypt.compare(candidate, this.password);
};

/** Shape returned to *other* users — respects privacy settings. */
userSchema.methods.publicProfile = function publicProfile(viewerIsContact = false) {
  const allow = (rule) =>
    rule === 'everyone' || (rule === 'contacts' && viewerIsContact);

  return {
    id: this._id,
    _id: this._id,
    name: this.name,
    username: this.username,
    avatar: allow(this.privacy.avatar) ? this.avatar : null,
    avatarColor: this.avatarColor,
    about: allow(this.privacy.about) ? this.about : '',
    presence: allow(this.privacy.lastSeen) ? this.presence : 'offline',
    lastSeen: allow(this.privacy.lastSeen) ? this.lastSeen : null,
    identityPublicKey: this.identityPublicKey,
    signingPublicKey: this.signingPublicKey,
    securityCode: this.securityCode,
  };
};

export const User = mongoose.model('User', userSchema);
