import mongoose from 'mongoose';

/**
 * The follow graph, kept deliberately separate from `User.contacts`.
 *
 * Contacts are the *messaging* graph: people you are willing to be in a chat
 * with. Following is the *reading* graph: whose posts you want in your
 * timeline. Conflating the two would mean saving somebody's number silently
 * subscribes you to everything they post, and unfollowing a noisy acquaintance
 * would delete them from the address book. They are different relationships and
 * they get different rows.
 */
const followSchema = new mongoose.Schema(
  {
    follower: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    following: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  },
  { timestamps: true }
);

followSchema.index({ follower: 1, following: 1 }, { unique: true });
followSchema.index({ following: 1, createdAt: -1 });

export const Follow = mongoose.model('Follow', followSchema);
