import mongoose from 'mongoose';

/**
 * A feed post.
 *
 * Deliberately *not* end-to-end encrypted, unlike every message and story in
 * this app. A feed is a broadcast: the audience is open-ended and grows after
 * the fact, so there is no recipient set to seal a key to — a follower who
 * arrives tomorrow could never read what was posted today. Encrypting to
 * "everyone" is not encryption, it is ceremony, and pretending otherwise would
 * be worse than saying so plainly. Reach is controlled by `audience` instead,
 * and the UI is explicit that a post is public where a chat is not.
 *
 * Counters live on the document rather than being counted on read. A feed is
 * read far more often than it is written, and `countDocuments` on likes for
 * every card in a scroll is the classic way to make one.
 */

const mediaSchema = new mongoose.Schema(
  {
    _id: false,
    kind: { type: String, enum: ['image', 'video'], default: 'image' },
    url: { type: String, required: true },
    /* A tiny, heavily-blurred data URI inlined into the response. It is what
       fills the frame while the real bytes are still in flight, which is the
       difference between a feed that settles and one that jumps. */
    placeholder: { type: String, default: null },
    thumbnail: { type: String, default: null },
    width: { type: Number, default: null },
    height: { type: Number, default: null },
    duration: { type: Number, default: null },
    size: { type: Number, default: 0 },
    alt: { type: String, default: '', maxlength: 420 },
  },
  { _id: false }
);

const postSchema = new mongoose.Schema(
  {
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    kind: { type: String, enum: ['image', 'video', 'text'], default: 'text' },
    text: { type: String, default: '', maxlength: 2200, trim: true },
    media: { type: [mediaSchema], default: [] },

    /** Everything derived from `text` at write time, so reading never re-parses. */
    hashtags: { type: [String], default: [], index: true },
    mentions: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    location: { type: String, default: null, maxlength: 120 },

    /* public   — anyone signed in, and the engine of Explore
       followers — people who follow you
       contacts — the messaging graph, i.e. the people you already talk to */
    audience: { type: String, enum: ['public', 'followers', 'contacts'], default: 'public' },

    /** Set for a repost. With `text`, it is a quote; without, a plain boost. */
    repostOf: { type: mongoose.Schema.Types.ObjectId, ref: 'Post', default: null, index: true },

    likeCount: { type: Number, default: 0, min: 0 },
    commentCount: { type: Number, default: 0, min: 0 },
    saveCount: { type: Number, default: 0, min: 0 },
    repostCount: { type: Number, default: 0, min: 0 },
    shareCount: { type: Number, default: 0, min: 0 },
    viewCount: { type: Number, default: 0, min: 0 },

    commentsDisabled: { type: Boolean, default: false },
    /** The author's own counts stay visible to them; everyone else sees none. */
    hideCounts: { type: Boolean, default: false },
    pinned: { type: Boolean, default: false },

    editedAt: { type: Date, default: null },
    /* Soft delete. A repost points at this document, and hard-deleting it would
       leave a hole in somebody else's timeline with nothing to render in it. */
    deletedAt: { type: Date, default: null, index: true },
  },
  { timestamps: true }
);

/* The home timeline reads "posts by these authors, newest first" and Explore
   reads "public posts, newest first". Both are covered here; the compound index
   also serves the keyset pagination, which sorts on the same two fields. */
postSchema.index({ author: 1, createdAt: -1 });
postSchema.index({ createdAt: -1, _id: -1 });
postSchema.index({ audience: 1, createdAt: -1 });
postSchema.index({ hashtags: 1, createdAt: -1 });
postSchema.index({ text: 'text' });

export const Post = mongoose.model('Post', postSchema);
