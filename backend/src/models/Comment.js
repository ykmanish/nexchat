import mongoose from 'mongoose';

/**
 * A comment, or a reply to one.
 *
 * One level of nesting only, which is what both references this feed borrows
 * from settled on: `parent` always points at a top-level comment, never at
 * another reply. Arbitrary depth reads badly on a phone and makes the "N
 * replies" affordance impossible to size.
 */
const commentSchema = new mongoose.Schema(
  {
    post: { type: mongoose.Schema.Types.ObjectId, ref: 'Post', required: true, index: true },
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    parent: { type: mongoose.Schema.Types.ObjectId, ref: 'Comment', default: null, index: true },

    /* Required only while the comment is alive. A deleted comment with replies
       under it stays as a tombstone with its text cleared — see the controller —
       and a flat `required: true` rejected exactly that save. */
    text: {
      type: String,
      required: [
        function hasTextUnlessDeleted() {
          return !this.deletedAt;
        },
        'Say something first',
      ],
      maxlength: 1000,
      trim: true,
      default: '',
    },
    mentions: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

    likeCount: { type: Number, default: 0, min: 0 },
    replyCount: { type: Number, default: 0, min: 0 },

    /* Soft delete, so a reply thread does not lose its root and orphan itself.
       The row survives as a tombstone and renders as "comment deleted". */
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

/* Top-level comments are read oldest-first under one post; replies are read
   oldest-first under one parent. Both are this index. */
commentSchema.index({ post: 1, parent: 1, createdAt: 1 });

export const Comment = mongoose.model('Comment', commentSchema);
