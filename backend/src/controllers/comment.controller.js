import { Post, Comment, PostLike, User } from '../models/index.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { notify, encodeCursor, decodeCursor, olderThan, AUTHOR_FIELDS } from './post.controller.js';

const MENTION = /@([a-z0-9_.]{3,24})/gi;

async function mentionsIn(text = '') {
  const handles = [...new Set([...text.matchAll(MENTION)].map((m) => m[1].toLowerCase()))];
  if (!handles.length) return [];
  const users = await User.find({ username: { $in: handles.slice(0, 20) } })
    .select('_id')
    .lean();
  return users.map((u) => u._id);
}

/** Folds in the viewer's own likes, in one query for the whole page. */
async function shape(rows, viewer) {
  if (!rows.length) return [];

  const likes = await PostLike.find({
    user: viewer._id,
    comment: { $in: rows.map((r) => r._id) },
  })
    .select('comment')
    .lean();
  const liked = new Set(likes.map((l) => String(l.comment)));

  return rows.map((c) => ({
    _id: String(c._id),
    post: String(c.post),
    parent: c.parent ? String(c.parent) : null,
    author: c.author && {
      _id: String(c.author._id),
      name: c.author.name,
      username: c.author.username,
      avatar: c.author.avatar,
      avatarColor: c.author.avatarColor,
    },
    text: c.deletedAt ? '' : c.text,
    deleted: !!c.deletedAt,
    likeCount: c.likeCount,
    replyCount: c.replyCount,
    liked: liked.has(String(c._id)),
    isMine: String(c.author?._id || c.author) === String(viewer._id),
    createdAt: c.createdAt,
  }));
}

/**
 * Comments on a post, oldest first.
 *
 * Top-level only, plus the first two replies under each — which is what makes
 * a thread readable without opening it, and is why `replyCount` is stored
 * rather than counted. The rest arrive from `listReplies` on demand.
 */
export const listComments = asyncHandler(async (req, res) => {
  const post = await Post.findOne({ _id: req.params.id, deletedAt: null }).select('_id');
  if (!post) throw ApiError.notFound('Post not found', 'NO_POST');

  const cursor = decodeCursor(req.query.cursor);
  const limit = Math.min(Number(req.query.limit) || 20, 50);

  /* Newest-first here, unlike a chat: on a busy post the comment you want to
     see is the one that just arrived, not the one from three weeks ago. */
  const rows = await Comment.find({ post: post._id, parent: null, ...olderThan(cursor) })
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit + 1)
    .populate('author', AUTHOR_FIELDS)
    .lean();

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  const withReplies = page.filter((c) => c.replyCount > 0).map((c) => c._id);
  const replies = withReplies.length
    ? await Comment.find({ parent: { $in: withReplies } })
        .sort({ createdAt: 1 })
        .populate('author', AUTHOR_FIELDS)
        .lean()
    : [];

  const shapedReplies = await shape(replies, req.user);
  const byParent = new Map();
  shapedReplies.forEach((r) => {
    const list = byParent.get(r.parent) || [];
    // Two per thread is the preview; the count tells you there are more.
    if (list.length < 2) list.push(r);
    byParent.set(r.parent, list);
  });

  const comments = (await shape(page, req.user)).map((c) => ({
    ...c,
    replies: byParent.get(c._id) || [],
  }));

  res.json({
    success: true,
    comments,
    nextCursor: hasMore && page.length ? encodeCursor(page[page.length - 1]) : null,
  });
});

export const listReplies = asyncHandler(async (req, res) => {
  const rows = await Comment.find({ parent: req.params.commentId })
    .sort({ createdAt: 1 })
    .limit(100)
    .populate('author', AUTHOR_FIELDS)
    .lean();

  res.json({ success: true, replies: await shape(rows, req.user) });
});

export const addComment = asyncHandler(async (req, res) => {
  const { text, parent = null } = req.body;

  const post = await Post.findOne({ _id: req.params.id, deletedAt: null });
  if (!post) throw ApiError.notFound('Post not found', 'NO_POST');
  if (post.commentsDisabled) {
    throw ApiError.forbidden('Comments are turned off for this post', 'COMMENTS_OFF');
  }

  let root = null;
  if (parent) {
    root = await Comment.findOne({ _id: parent, post: post._id });
    if (!root) throw ApiError.notFound('Comment not found', 'NO_COMMENT');
    // One level of nesting: a reply to a reply attaches to their shared root.
    if (root.parent) root = await Comment.findById(root.parent);
    if (!root) throw ApiError.notFound('Comment not found', 'NO_COMMENT');
  }

  const comment = await Comment.create({
    post: post._id,
    author: req.user._id,
    parent: root?._id || null,
    text: text.trim(),
    mentions: await mentionsIn(text),
  });

  await Promise.all([
    Post.updateOne({ _id: post._id }, { $inc: { commentCount: 1 } }),
    root ? Comment.updateOne({ _id: root._id }, { $inc: { replyCount: 1 } }) : null,
  ]);

  notify(post.author, 'post:commented', { postId: String(post._id) }, req.user);
  if (root && String(root.author) !== String(post.author)) {
    notify(root.author, 'post:replied', { postId: String(post._id) }, req.user);
  }
  comment.mentions.forEach((id) =>
    notify(id, 'comment:mentioned', { postId: String(post._id) }, req.user)
  );

  const full = await Comment.findById(comment._id).populate('author', AUTHOR_FIELDS).lean();
  const [shaped] = await shape([full], req.user);

  res.status(201).json({
    success: true,
    comment: { ...shaped, replies: [] },
    commentCount: post.commentCount + 1,
  });
});

export const deleteComment = asyncHandler(async (req, res) => {
  const comment = await Comment.findById(req.params.commentId);
  if (!comment || comment.deletedAt) throw ApiError.notFound('Comment not found', 'NO_COMMENT');

  /* The post's author can clear anything under their own post — that is what
     moderating your own space means — and anyone can remove their own words. */
  const post = await Post.findById(comment.post).select('author commentCount');
  const mine = String(comment.author) === String(req.user._id);
  const ownsPost = post && String(post.author) === String(req.user._id);
  if (!mine && !ownsPost) throw ApiError.forbidden('Not your comment', 'NOT_AUTHOR');

  /* A comment with replies becomes a tombstone rather than vanishing: taking
     the root out from under a live thread would orphan every answer to it. */
  if (comment.replyCount > 0) {
    comment.deletedAt = new Date();
    comment.text = '';
    await comment.save();
  } else {
    await comment.deleteOne();
    if (comment.parent) {
      await Comment.updateOne({ _id: comment.parent }, { $inc: { replyCount: -1 } });
    }
  }

  await Promise.all([
    Post.updateOne({ _id: comment.post }, { $inc: { commentCount: -1 } }),
    PostLike.deleteMany({ comment: comment._id }),
  ]);

  res.json({ success: true });
});

export const likeComment = asyncHandler(async (req, res) => {
  const comment = await Comment.findById(req.params.commentId);
  if (!comment) throw ApiError.notFound('Comment not found', 'NO_COMMENT');

  const result = await PostLike.updateOne(
    { user: req.user._id, post: comment.post, comment: comment._id },
    { $setOnInsert: { user: req.user._id, post: comment.post, comment: comment._id } },
    { upsert: true }
  );

  if (result.upsertedCount) {
    await Comment.updateOne({ _id: comment._id }, { $inc: { likeCount: 1 } });
    notify(comment.author, 'comment:liked', { postId: String(comment.post) }, req.user);
  }

  res.json({
    success: true,
    liked: true,
    likeCount: comment.likeCount + (result.upsertedCount || 0),
  });
});

export const unlikeComment = asyncHandler(async (req, res) => {
  const comment = await Comment.findById(req.params.commentId);
  if (!comment) throw ApiError.notFound('Comment not found', 'NO_COMMENT');

  const { deletedCount } = await PostLike.deleteOne({
    user: req.user._id,
    comment: comment._id,
  });
  if (deletedCount) await Comment.updateOne({ _id: comment._id }, { $inc: { likeCount: -1 } });

  res.json({
    success: true,
    liked: false,
    likeCount: Math.max(0, comment.likeCount - (deletedCount || 0)),
  });
});
