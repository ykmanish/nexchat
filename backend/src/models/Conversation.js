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
    /** How deep the mute goes. 'mentions' is what makes a busy group bearable:
     *  silent for ordinary traffic, still rings when someone @-names you. */
    muteMode: { type: String, enum: ['all', 'mentions'], default: 'all' },
    archived: { type: Boolean, default: false },
    unreadCount: { type: Number, default: 0 },
    /** Counted separately from unreadCount so the chat list can show an @ badge
     *  that survives "mark as read" on the ordinary unread count. */
    mentionCount: { type: Number, default: 0 },
    /** Last send, for slow mode. Not lastMessageAt — that moves for everyone. */
    lastSentAt: { type: Date, default: null },
    lastReadAt: { type: Date, default: null },
    lastReadMessage: { type: mongoose.Schema.Types.ObjectId, ref: 'Message', default: null },
    clearedAt: { type: Date, default: null },
    /**
     * When this person deleted the chat, or null.
     *
     * Distinct from `clearedAt`, which only hides the sidebar preview. A deleted
     * direct chat has to vanish from the list entirely and come back when
     * something new happens — and that could not be expressed by comparing
     * `clearedAt` against `lastMessageAt`, because a conversation is created
     * with `lastMessageAt` already set to now, so reopening a deleted chat would
     * have left it hidden while you were sitting in it.
     *
     * Set by `deleteConversation`, and cleared in exactly two places: a new
     * message arriving, and the chat being deliberately reopened.
     */
    deletedAt: { type: Date, default: null },
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
      /** Minimum gap between one member's messages. Admins are exempt. */
      slowModeSeconds: { type: Number, default: 0, min: 0, max: 21600 },
    },

    /**
     * Secret mode.
     *
     * Every chat here is already end-to-end encrypted, so this is not about
     * the wire — it is about what the *devices* at each end are allowed to do
     * with a message once it has arrived. Forwarding it on, keeping it after
     * it was read, showing it on a lock screen, quietly photographing it.
     *
     * Kept as its own object rather than a single boolean because the pieces
     * are genuinely separable: somebody may want a chat that never appears in
     * a notification but does not vanish, or the reverse.
     */
    secret: {
      enabled: { type: Boolean, default: false },
      /** Tell the other side when this device suspects a screen capture. */
      screenshotAlerts: { type: Boolean, default: true },
      /** Notifications say "New message" and nothing else. */
      hideNotifications: { type: Boolean, default: true },
      /** Refuse to forward, star or quote a message out of this chat. */
      blockForwarding: { type: Boolean, default: true },
      /** Who turned it on, and when — so the banner can say so honestly. */
      enabledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      enabledAt: { type: Date, default: null },
    },

    /** Removed and barred from coming back — a plain kick leaves nothing to
     *  stop the same person walking in through the invite link again. */
    bans: [
      {
        _id: false,
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
        reason: { type: String, default: null, maxlength: 200 },
        at: { type: Date, default: Date.now },
      },
    ],
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

conversationSchema.methods.isBanned = function isBanned(userId) {
  return (this.bans || []).some((b) => String(b.user._id || b.user) === String(userId));
};

conversationSchema.methods.syncMemberIds = function syncMemberIds() {
  this.memberIds = this.participants
    .filter((p) => !p.leftAt)
    .map((p) => p.user._id || p.user);
};

export const Conversation = mongoose.model('Conversation', conversationSchema);
