import mongoose from 'mongoose';

/**
 * A bookmark. Private by construction — the author is never told, and there is
 * no route that reads anyone's saves but your own.
 */
const savedPostSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    post: { type: mongoose.Schema.Types.ObjectId, ref: 'Post', required: true, index: true },
    collectionName: { type: String, default: 'All posts', maxlength: 60, trim: true },
  },
  { timestamps: true }
);

savedPostSchema.index({ user: 1, post: 1 }, { unique: true });
savedPostSchema.index({ user: 1, createdAt: -1 });

export const SavedPost = mongoose.model('SavedPost', savedPostSchema);
