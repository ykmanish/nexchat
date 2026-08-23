import mongoose from 'mongoose';

const participantSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: ['member', 'admin', 'owner'], default: 'member' },
    joinedAt: { type: Date, default: Date.now },
    addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    // per-participant chat state
    pinned: { type: Boolean, default: false },
    muted: { type: Boolean, default: false },
    mutedUntil: { type: Date, default: null },
    archived: { type: Boolean, default: false },
    unreadCount: { type: Number, default: 0 },
    lastReadAt: { type: Date, default: null },
    lastReadMessage: { type: mongoose.Schema.Types.ObjectId, ref: 'Message', default: null },
    clearedAt: { type: Date, default: null },
    draft: { type: String, default: '' },
    leftAt: { type: Date, default: null },
    wallpaper: { type: String, default: null },
  },
  { _id: false }
);

const conversationSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['direct', 'group', 'community', 'channel'],
      required: true,
      index: true,
    },
    name: { type: String, default: null, trim: true, maxlength: 80 },
    about: { type: String, default: '', maxlength: 500 },
    avatar: { type: String, default: null },
    avatarColor: { type: String, default: '#21C063' },

    participants: [participantSchema],
    /** Denormalised for fast "my chats" queries. */
    memberIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true }],

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    /** Communities group several chats together (see the "New Community" flow). */
    parentCommunity: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', default: null },
    isAnnouncement: { type: Boolean, default: false },

    // No default: a `sparse` index still indexes explicit nulls, so every
    // direct chat would collide. Leaving it undefined keeps it out of the index.
    inviteCode: { type: String },
    inviteEnabled: { type: Boolean, default: true },

    lastMessage: { type: mongoose.Schema.Types.ObjectId, ref: 'Message', default: null },
    lastMessageAt: { type: Date, default: Date.now, index: true },
    /** Monotonic per-conversation sequence — clients use it to detect gaps. */
    seq: { type: Number, default: 0 },

    pinnedMessages: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Message' }],

    settings: {
      whoCanSend: { type: String, enum: ['everyone', 'admins'], default: 'everyone' },
      whoCanEditInfo: { type: String, enum: ['everyone', 'admins'], default: 'admins' },
      whoCanAddMembers: { type: String, enum: ['everyone', 'admins'], default: 'everyone' },
      disappearingSeconds: { type: Number, default: 0 },
      approvalRequired: { type: Boolean, default: false },
    },
  },
  { timestamps: true, toJSON: { virtuals: true } }
);

conversationSchema.index({ memberIds: 1, lastMessageAt: -1 });
conversationSchema.index(
  { inviteCode: 1 },
  { unique: true, partialFilterExpression: { inviteCode: { $type: 'string' } } }
);
conversationSchema.index({ name: 'text' });

conversationSchema.methods.participantOf = function participantOf(userId) {
  return this.participants.find((p) => String(p.user._id || p.user) === String(userId));
};

conversationSchema.methods.isAdmin = function isAdmin(userId) {
  const p = this.participantOf(userId);
  return !!p && (p.role === 'admin' || p.role === 'owner');
};

conversationSchema.methods.syncMemberIds = function syncMemberIds() {
  this.memberIds = this.participants
    .filter((p) => !p.leftAt)
    .map((p) => p.user._id || p.user);
};

export const Conversation = mongoose.model('Conversation', conversationSchema);
