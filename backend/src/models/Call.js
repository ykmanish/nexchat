import mongoose from 'mongoose';

const callSchema = new mongoose.Schema(
  {
    callId: { type: String, required: true, unique: true, index: true },
    /** Null for a call reached by link: there is no chat behind it, which is
     *  the entire point of a link. */
    conversation: {
      type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', default: null, index: true,
    },
    initiator: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    mode: { type: String, enum: ['audio', 'video'], default: 'audio' },
    status: {
      type: String,
      enum: ['ringing', 'active', 'ended', 'missed', 'declined'],
      default: 'ringing',
    },
    participants: {
      type: [
        {
          _id: false,
          user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
          deviceId: String,
          joinedAt: Date,
          leftAt: Date,
        },
      ],
      default: [],
    },
    startedAt: { type: Date, default: Date.now },
    answeredAt: { type: Date, default: null },
    endedAt: { type: Date, default: null },
    duration: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export const Call = mongoose.model('Call', callSchema);
