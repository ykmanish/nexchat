import mongoose from 'mongoose';

/**
 * A joinable call, addressed by a short code instead of a conversation.
 *
 * Calls normally live inside a chat: you can only ring someone you already
 * share a conversation with. A link lifts that requirement for one call, so a
 * host can hand the code to somebody who is not in their contacts at all. The
 * link is the capability — anyone holding it can join while it is live, which
 * is why it expires, can be revoked, and can be capped.
 */
const callLinkSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    /** Optional home chat. Present when the link was made from inside one, so
     *  the call still shows up in that chat's history. */
    conversation: {
      type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', default: null,
    },

    name: { type: String, default: null, trim: true, maxlength: 80 },
    mode: { type: String, enum: ['audio', 'video'], default: 'video' },

    /** The live call this link is currently pointing at. A link outlives any
     *  single call: the first person to join starts a new one. */
    callId: { type: String, default: null },

    /** Whether people who are not the host wait to be let in. */
    approvalRequired: { type: Boolean, default: false },
    maxParticipants: { type: Number, default: 16, min: 2, max: 64 },

    expiresAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },

    joinCount: { type: Number, default: 0 },
    lastJoinedAt: { type: Date, default: null },
  },
  { timestamps: true, toJSON: { virtuals: true } }
);

/** Mongo drops the row itself once the link is past its date. */
callLinkSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

callLinkSchema.methods.isLive = function isLive() {
  if (this.revokedAt) return false;
  if (this.expiresAt && this.expiresAt.getTime() <= Date.now()) return false;
  return true;
};

export const CallLink = mongoose.model('CallLink', callLinkSchema);
