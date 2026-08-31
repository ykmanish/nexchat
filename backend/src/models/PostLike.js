import mongoose from 'mongoose';

/**
 * One row per like, for a post *or* a comment.
 *
 * An array of user ids on the post itself would be simpler right up until a
 * post does well, at which point every read of that post drags a hundred
 * thousand ids across the wire to answer one question: did *I* like this. The
 * row keeps that question a single indexed lookup and the count on the post.
 *
 * `comment` is null for a post like, which is exactly what the unique index
 * needs: one like per person per target, whichever kind of target it is.
 */
const postLikeSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    post: { type: mongoose.Schema.Types.ObjectId, ref: 'Post', required: true, index: true },
    comment: { type: mongoose.Schema.Types.ObjectId, ref: 'Comment', default: null },
  },
  { timestamps: true }
);

postLikeSchema.index({ user: 1, post: 1, comment: 1 }, { unique: true });
/* "Who liked this", newest first — the likes sheet. */
postLikeSchema.index({ post: 1, comment: 1, createdAt: -1 });

export const PostLike = mongoose.model('PostLike', postLikeSchema);
