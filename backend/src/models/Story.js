import mongoose from 'mongoose';

const storySchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    kind: { type: String, enum: ['image', 'video', 'text'], default: 'image' },

    body: { ciphertext: String, iv: String },
    keys: {
      type: [
        {
          _id: false,
          user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
          deviceId: String,
          ciphertext: String,
          iv: String,
          ephemeralPublicKey: { type: String, default: null },
          counter: { type: Number, default: 0 },
        },
      ],
      default: [],
    },

    media: {
      url: String,
      thumbnail: String,
      width: Number,
      height: Number,
      duration: Number,
      size: Number,
    },
    background: { type: String, default: null },
    caption: { type: String, default: null },

    audience: { type: String, enum: ['contacts', 'selected', 'except'], default: 'contacts' },
    audienceList: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

    viewers: {
      type: [
        {
          _id: false,
          user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
          at: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
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

    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

storySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const Story = mongoose.model('Story', storySchema);
