import mongoose from 'mongoose';

/** The per-recipient-device wrapping of the content key.
 *  A message is encrypted **once** with a random content key (CEK); that CEK
 *  is then sealed separately to every device in the conversation. */
const keySlotSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    deviceId: { type: String, required: true },
    ciphertext: { type: String, required: true },
    iv: { type: String, required: true },
    /** Present only on the first message of a session (X3DH handshake). */
    ephemeralPublicKey: { type: String, default: null },
    preKeyId: { type: Number, default: null },
    signedPreKeyId: { type: Number, default: null },
    /** Symmetric-ratchet position, so out-of-order delivery still decrypts. */
    counter: { type: Number, default: 0 },
    sessionId: { type: String, default: null },
  },
  { _id: false }
);

const receiptSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    deliveredAt: { type: Date, default: null },
    readAt: { type: Date, default: null },
    playedAt: { type: Date, default: null },
  },
  { _id: false }
);

const attachmentSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    kind: {
      type: String,
      enum: ['image', 'video', 'audio', 'voice', 'file', 'sticker', 'gif'],
      required: true,
    },
    url: { type: String, required: true },
    size: { type: Number, default: 0 },
    width: { type: Number, default: null },
    height: { type: Number, default: null },
    duration: { type: Number, default: null },
    /** Tiny encrypted preview so the bubble can show a blur while loading. */
    thumbnail: { type: String, default: null },
    waveform: { type: [Number], default: undefined },
  },
  { _id: false }
);

const messageSchema = new mongoose.Schema(
  {
    conversation: {
      type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true, index: true,
    },
    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    senderDeviceId: { type: String, default: null },

    /** Client-generated so optimistic sends dedupe cleanly on reconnect. */
    clientId: { type: String, required: true, index: true },
    seq: { type: Number, default: 0, index: true },

    type: {
      type: String,
      enum: [
        'text', 'image', 'video', 'audio', 'voice', 'file', 'sticker', 'gif',
        'location', 'contact', 'poll', 'system', 'call',
      ],
      default: 'text',
    },

    /** AES-GCM ciphertext of the whole payload. Server never holds the key. */
    body: {
      ciphertext: { type: String, default: null },
      iv: { type: String, default: null },
      algorithm: { type: String, default: 'AES-GCM-256' },
    },
    keys: { type: [keySlotSchema], default: [] },

    attachments: { type: [attachmentSchema], default: [] },

    replyTo: { type: mongoose.Schema.Types.ObjectId, ref: 'Message', default: null },
    forwardedFrom: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    forwardScore: { type: Number, default: 0 },

    /** Threads. A reply names the message it hangs under; the root carries the
     *  counters so a chat list or a bubble can show "12 replies" without
     *  counting rows. Replies are kept out of the main timeline — the thread
     *  panel is the only place they appear. */
    threadRoot: { type: mongoose.Schema.Types.ObjectId, ref: 'Message', default: null, index: true },
    thread: {
      replyCount: { type: Number, default: 0 },
      lastReplyAt: { type: Date, default: null },
      /** Everyone who has posted in the thread, for "you are following this". */
      participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    },

    /** Who was @-named. The names themselves are inside the encrypted body —
     *  only the ids are out here, because routing a notification to the right
     *  person is something the server has to be able to do. That does tell the
     *  server who was mentioned in a group, which is the price of the feature. */
    mentions: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true }],
    mentionsEveryone: { type: Boolean, default: false },

    reactions: {
      type: [
        {
          _id: false,
          user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
          emoji: String,
          at: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },

    receipts: { type: [receiptSchema], default: [] },

    editedAt: { type: Date, default: null },
    editCount: { type: Number, default: 0 },

    /** Poll tallies. Only indexes are stored — the question and the option
     *  labels live inside the encrypted body, so the server counts votes
     *  without ever knowing what is being voted on. */
    poll: {
      optionCount: { type: Number, default: 0 },
      multiple: { type: Boolean, default: false },
      closed: { type: Boolean, default: false },
      votes: {
        type: [
          {
            _id: false,
            user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
            option: { type: Number },
            at: { type: Date, default: Date.now },
          },
        ],
        default: [],
      },
    },

    /** View-once media: readable once per recipient, then burned for everyone. */
    viewOnce: { type: Boolean, default: false },
    viewOnceOpened: { type: Boolean, default: false },
    viewedBy: {
      type: [
        {
          _id: false,
          user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
          at: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },

    deletedForEveryone: { type: Boolean, default: false },
    deletedFor: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    starredBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    pinned: { type: Boolean, default: false },

    /** Plaintext, server-authored membership/system events. */
    system: {
      action: { type: String, default: null },
      actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      targets: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
      meta: { type: mongoose.Schema.Types.Mixed, default: null },
    },

    call: {
      callId: { type: String, default: null },
      mode: { type: String, enum: ['audio', 'video'], default: null },
      status: {
        type: String,
        enum: ['ringing', 'answered', 'missed', 'declined', 'ended'],
        default: null,
      },
      duration: { type: Number, default: 0 },
    },

    expiresAt: { type: Date, default: null },
  },
  { timestamps: true, toJSON: { virtuals: true } }
);

messageSchema.index({ conversation: 1, createdAt: -1 });
messageSchema.index({ conversation: 1, seq: -1 });
messageSchema.index({ clientId: 1, sender: 1 }, { unique: true });
messageSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

/** Strip key slots that don't belong to the requesting device. */
messageSchema.methods.forDevice = function forDevice(userId, deviceId) {
  const obj = this.toJSON();
  obj.keys = (obj.keys || []).filter(
    (k) => String(k.user) === String(userId) && (!deviceId || k.deviceId === deviceId)
  );
  return obj;
};

export const Message = mongoose.model('Message', messageSchema);
