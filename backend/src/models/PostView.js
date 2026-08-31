import mongoose from 'mongoose';

/**
 * One row per person who has seen a post.
 *
 * A row rather than a bare counter because "views" has to mean something. An
 * unguarded increment counts a scroll past the same card six times as six
 * people, which makes the number worse than not showing one — the unique index
 * is what keeps it a count of people.
 *
 * Nothing reads these rows back. They exist to answer "has this person already
 * been counted", so the post's own `viewCount` can be trusted.
 */
const postViewSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    post: { type: mongoose.Schema.Types.ObjectId, ref: 'Post', required: true, index: true },
  },
  { timestamps: true }
);

postViewSchema.index({ user: 1, post: 1 }, { unique: true });

export const PostView = mongoose.model('PostView', postViewSchema);
