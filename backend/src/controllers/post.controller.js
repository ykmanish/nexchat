import path from 'node:path';
import fs from 'node:fs/promises';
import {
  Post,
  PostLike,
  PostView,
  SavedPost,
  Follow,
  User,
  Conversation,
} from '../models/index.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { uploadRoot } from '../middleware/upload.js';
import { getIO } from '../sockets/io.js';

const PAGE = 12;
const AUTHOR_FIELDS = 'name username avatar avatarColor about presence';

/* ────────────────────────────── pagination ──────────────────────────────
   Keyset, not skip/limit. A feed grows at the top while it is being read, so
   `skip` walks back over rows that have shifted underneath it — the reason
   infinite scrolls duplicate a card and swallow the one after it. A cursor
   anchored to (createdAt, _id) always resumes exactly where it left off. */

const encodeCursor = (doc) =>
  Buffer.from(new Date(doc.createdAt).toISOString() + '|' + doc._id).toString('base64url');

function decodeCursor(cursor) {
  if (!cursor) return null;
  try {
    const [iso, id] = Buffer.from(String(cursor), 'base64url').toString('utf8').split('|');
    const at = new Date(iso);
    if (Number.isNaN(at.getTime()) || !/^[a-f\d]{24}$/i.test(id)) return null;
    return { at, id };
  } catch {
    return null;
  }
}

const olderThan = (cursor) =>
  cursor
    ? {
        $or: [
          { createdAt: { $lt: cursor.at } },
          { createdAt: cursor.at, _id: { $lt: cursor.id } },
        ],
      }
    : {};

/* ────────────────────────────── text parsing ────────────────────────────── */

const HASHTAG = /#([\p{L}\p{N}_]{1,60})/gu;
const MENTION = /@([a-z0-9_.]{3,24})/gi;

const hashtagsIn = (text = '') =>
  [...new Set([...text.matchAll(HASHTAG)].map((m) => m[1].toLowerCase()))].slice(0, 30);

/** Resolves @handles to real accounts. Unknown handles are simply not links. */
async function mentionsIn(text = '') {
  const handles = [...new Set([...text.matchAll(MENTION)].map((m) => m[1].toLowerCase()))];
  if (!handles.length) return [];
  const users = await User.find({ username: { $in: handles.slice(0, 20) } })
    .select('_id')
    .lean();
  return users.map((u) => u._id);
}

/* ────────────────────────────── audience ──────────────────────────────
   Who this viewer is entitled to read. Following is the reading graph;
   contacts and shared conversations come along because somebody you already
   talk to is, in practice, somebody you follow. */

async function readableAuthors(viewer) {
  const [following, convs] = await Promise.all([
    Follow.find({ follower: viewer._id }).select('following').lean(),
    Conversation.find({ memberIds: viewer._id }).select('memberIds').lean(),
  ]);

  const ids = new Set([String(viewer._id)]);
  following.forEach((f) => ids.add(String(f.following)));
  (viewer.contacts || []).forEach((c) => ids.add(String(c)));
  convs.forEach((c) => c.memberIds.forEach((m) => ids.add(String(m))));
  return [...ids];
}

/** The audience clause for reading somebody else's posts. */
function audienceClause(viewerId, followingIds, contactIds) {
  return {
    $or: [
      { audience: 'public' },
      { audience: 'followers', author: { $in: followingIds } },
      { audience: 'contacts', author: { $in: contactIds } },
      { author: viewerId },
    ],
  };
}

/* ────────────────────────────── serialising ──────────────────────────────
   Everything a card needs, in one shape, with the viewer's own state folded
   in. Fetched in a fixed number of queries no matter how long the page is —
   the alternative is the N+1 that makes a feed feel broken on a slow link. */

async function hydrate(posts, viewer) {
  if (!posts.length) return [];

  const ids = posts.map((p) => p._id);
  const originals = posts.map((p) => p.repostOf?._id).filter(Boolean);
  const allIds = [...ids, ...originals];
  const authorIds = [
    ...new Set(
      posts
        .flatMap((p) => [String(p.author?._id), String(p.repostOf?.author?._id)])
        .filter((id) => id && id !== 'undefined')
    ),
  ];

  const [likes, saves, reposts, follows] = await Promise.all([
    PostLike.find({ user: viewer._id, post: { $in: allIds }, comment: null })
      .select('post')
      .lean(),
    SavedPost.find({ user: viewer._id, post: { $in: allIds } }).select('post').lean(),
    Post.find({ author: viewer._id, repostOf: { $in: allIds }, deletedAt: null })
      .select('repostOf')
      .lean(),
    Follow.find({ follower: viewer._id, following: { $in: authorIds } })
      .select('following')
      .lean(),
  ]);

  const liked = new Set(likes.map((l) => String(l.post)));
  const saved = new Set(saves.map((s) => String(s.post)));
  const reposted = new Set(reposts.map((r) => String(r.repostOf)));
  const followed = new Set(follows.map((f) => String(f.following)));

  const shape = (post) => {
    if (!post) return null;
    const id = String(post._id);
    const authorId = String(post.author?._id || post.author);
    const mine = authorId === String(viewer._id);

    /* Hiding counts hides them from everyone but the author — the author still
       needs to see their own numbers, which is the whole point of the toggle. */
    const counts =
      post.hideCounts && !mine
        ? { likeCount: null, saveCount: null }
        : { likeCount: post.likeCount, saveCount: post.saveCount };

    return {
      _id: id,
      author: post.author && {
        _id: authorId,
        name: post.author.name,
        username: post.author.username,
        avatar: post.author.avatar,
        avatarColor: post.author.avatarColor,
        about: post.author.about,
        isFollowing: followed.has(authorId),
        isMe: mine,
      },
      kind: post.kind,
      text: post.deletedAt ? '' : post.text,
      media: post.deletedAt ? [] : post.media,
      hashtags: post.hashtags,
      location: post.location,
      audience: post.audience,
      ...counts,
      commentCount: post.commentCount,
      repostCount: post.repostCount,
      shareCount: post.shareCount,
      viewCount: post.viewCount,
      commentsDisabled: post.commentsDisabled,
      hideCounts: post.hideCounts,
      pinned: post.pinned,
      deleted: !!post.deletedAt,
      liked: liked.has(id),
      saved: saved.has(id),
      reposted: reposted.has(id),
      isMine: mine,
      editedAt: post.editedAt,
      createdAt: post.createdAt,
    };
  };

  return posts.map((p) => ({
    ...shape(p),
    repostOf: p.repostOf ? shape(p.repostOf) : null,
  }));
}

const populated = (query) =>
  query.populate('author', AUTHOR_FIELDS).populate({
    path: 'repostOf',
    populate: { path: 'author', select: AUTHOR_FIELDS },
  });

/* ────────────────────────────── the timeline ────────────────────────────── */

/**
 * Home feed: everyone you follow, everyone you talk to, and yourself.
 *
 * A brand-new account follows nobody, and an empty feed is the fastest way to
 * lose one. So when there is nothing from the reading graph the response falls
 * back to recent public posts and says so with `discover: true` — the client
 * labels that section honestly rather than passing it off as follows.
 */
export const homeFeed = asyncHandler(async (req, res) => {
  const cursor = decodeCursor(req.query.cursor);
  const limit = Math.min(Number(req.query.limit) || PAGE, 30);

  const authors = await readableAuthors(req.user);
  const followingIds = authors.filter((id) => id !== String(req.user._id));

  /* Whether there is anybody to read, not whether the last query happened to
     come back empty. Those are different questions, and answering the wrong one
     had a nasty edge: the fallback used to fire only when the result set was
     empty, so the moment a new account published its first post the result set
     stopped being empty and the feed collapsed to that one post — posting
     something emptied your feed. What decides this is the reading graph. */
  const discover = followingIds.length === 0;

  const base = discover
    ? { deletedAt: null, audience: 'public', author: { $nin: req.user.blocked || [] } }
    : {
        deletedAt: null,
        author: { $in: authors, $nin: req.user.blocked || [] },
        ...audienceClause(req.user._id, followingIds, req.user.contacts || []),
      };

  const docs = await populated(
    Post.find({ ...base, ...olderThan(cursor) })
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit + 1)
  );

  const hasMore = docs.length > limit;
  const page = hasMore ? docs.slice(0, limit) : docs;

  res.json({
    success: true,
    discover,
    posts: await hydrate(page, req.user),
    nextCursor: hasMore && page.length ? encodeCursor(page[page.length - 1]) : null,
  });
});

/** Explore: public posts only, and the one place a stranger's work surfaces. */
export const explore = asyncHandler(async (req, res) => {
  const cursor = decodeCursor(req.query.cursor);
  const limit = Math.min(Number(req.query.limit) || 24, 48);
  const q = String(req.query.q || '').trim();

  const filter = {
    deletedAt: null,
    audience: 'public',
    author: { $ne: req.user._id, $nin: req.user.blocked || [] },
    ...olderThan(cursor),
  };

  if (q) {
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$and = [
      { $or: [{ text: new RegExp(escaped, 'i') }, { hashtags: q.replace(/^#/, '').toLowerCase() }] },
    ];
  }

  const docs = await populated(
    Post.find(filter).sort({ createdAt: -1, _id: -1 }).limit(limit + 1)
  );

  const hasMore = docs.length > limit;
  const page = hasMore ? docs.slice(0, limit) : docs;

  res.json({
    success: true,
    posts: await hydrate(page, req.user),
    nextCursor: hasMore && page.length ? encodeCursor(page[page.length - 1]) : null,
  });
});

export const byUser = asyncHandler(async (req, res) => {
  const cursor = decodeCursor(req.query.cursor);
  const limit = Math.min(Number(req.query.limit) || 18, 48);

  const author = await User.findById(req.params.userId).select(AUTHOR_FIELDS + ' contacts');
  if (!author) throw ApiError.notFound('Account not found', 'NO_USER');

  const mine = String(author._id) === String(req.user._id);
  const [follows, counts] = await Promise.all([
    mine ? null : Follow.findOne({ follower: req.user._id, following: author._id }).lean(),
    Promise.all([
      Follow.countDocuments({ following: author._id }),
      Follow.countDocuments({ follower: author._id }),
      Post.countDocuments({ author: author._id, deletedAt: null }),
    ]),
  ]);

  /* Somebody's grid is readable exactly as far as their posts are: public
     always, followers-only if you follow them, contacts if you are one. */
  const isContact = (author.contacts || []).some((c) => String(c) === String(req.user._id));
  const audience = mine
    ? {}
    : {
        $or: [
          { audience: 'public' },
          ...(follows ? [{ audience: 'followers' }] : []),
          ...(isContact ? [{ audience: 'contacts' }] : []),
        ],
      };

  const docs = await populated(
    Post.find({ author: author._id, deletedAt: null, ...audience, ...olderThan(cursor) })
      .sort({ pinned: -1, createdAt: -1, _id: -1 })
      .limit(limit + 1)
  );

  const hasMore = docs.length > limit;
  const page = hasMore ? docs.slice(0, limit) : docs;

  res.json({
    success: true,
    profile: {
      _id: String(author._id),
      name: author.name,
      username: author.username,
      avatar: author.avatar,
      avatarColor: author.avatarColor,
      about: author.about,
      presence: author.presence,
      isMe: mine,
      isFollowing: !!follows,
      followerCount: counts[0],
      followingCount: counts[1],
      postCount: counts[2],
    },
    posts: await hydrate(page, req.user),
    nextCursor: hasMore && page.length ? encodeCursor(page[page.length - 1]) : null,
  });
});

export const savedPosts = asyncHandler(async (req, res) => {
  const cursor = decodeCursor(req.query.cursor);
  const limit = Math.min(Number(req.query.limit) || 18, 48);

  const rows = await SavedPost.find({ user: req.user._id, ...olderThan(cursor) })
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit + 1)
    .lean();

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  const docs = await populated(
    Post.find({ _id: { $in: page.map((r) => r.post) }, deletedAt: null })
  );
  // Preserve save order, which is not post order.
  const order = new Map(page.map((r, i) => [String(r.post), i]));
  docs.sort((a, b) => order.get(String(a._id)) - order.get(String(b._id)));

  res.json({
    success: true,
    posts: await hydrate(docs, req.user),
    nextCursor: hasMore && page.length ? encodeCursor(page[page.length - 1]) : null,
  });
});

export const getPost = asyncHandler(async (req, res) => {
  const post = await populated(Post.findById(req.params.id));
  if (!post || post.deletedAt) throw ApiError.notFound('Post not found', 'NO_POST');

  const [shaped] = await hydrate([post], req.user);
  res.json({ success: true, post: shaped });
});

/* ────────────────────────────── writing ────────────────────────────── */

export const createPost = asyncHandler(async (req, res) => {
  const {
    text = '',
    media = [],
    audience = 'public',
    location = null,
    commentsDisabled = false,
    hideCounts = false,
    repostOf = null,
  } = req.body;

  if (!text.trim() && !media.length && !repostOf) {
    throw ApiError.badRequest('Write something or add a photo', 'EMPTY_POST');
  }

  let original = null;
  if (repostOf) {
    original = await Post.findById(repostOf);
    if (!original || original.deletedAt) throw ApiError.notFound('Post not found', 'NO_POST');
    /* Boosting a boost boosts what it points at, not the wrapper — otherwise
       chains of empty reposts accumulate and none of them says anything. */
    if (original.repostOf) original = await Post.findById(original.repostOf);
    if (!original) throw ApiError.notFound('Post not found', 'NO_POST');
  }

  const post = await Post.create({
    author: req.user._id,
    kind: media.length ? media[0].kind || 'image' : 'text',
    text: text.trim(),
    media,
    hashtags: hashtagsIn(text),
    mentions: await mentionsIn(text),
    location,
    audience,
    commentsDisabled,
    hideCounts,
    repostOf: original?._id || null,
  });

  if (original) {
    await Post.updateOne({ _id: original._id }, { $inc: { repostCount: 1 } });
    notify(original.author, 'post:reposted', { postId: String(original._id) }, req.user);
    await publishStats(original._id);
  }

  post.mentions.forEach((id) =>
    notify(id, 'post:mentioned', { postId: String(post._id) }, req.user)
  );

  const full = await populated(Post.findById(post._id));
  const [shaped] = await hydrate([full], req.user);

  // Everyone reading this account gets the card without a refresh.
  const readers = await Follow.find({ following: req.user._id }).select('follower').lean();
  const io = getIO();
  readers.forEach((f) => io?.to('user:' + f.follower).emit('post:new', { post: shaped }));

  res.status(201).json({ success: true, post: shaped });
});

export const updatePost = asyncHandler(async (req, res) => {
  const post = await Post.findOne({ _id: req.params.id, author: req.user._id, deletedAt: null });
  if (!post) throw ApiError.notFound('Post not found', 'NO_POST');

  const { text, audience, location, commentsDisabled, hideCounts, pinned } = req.body;

  if (text !== undefined && text.trim() !== post.text) {
    post.text = text.trim();
    post.hashtags = hashtagsIn(text);
    post.mentions = await mentionsIn(text);
    post.editedAt = new Date();
  }
  if (audience !== undefined) post.audience = audience;
  if (location !== undefined) post.location = location;
  if (commentsDisabled !== undefined) post.commentsDisabled = commentsDisabled;
  if (hideCounts !== undefined) post.hideCounts = hideCounts;

  if (pinned !== undefined) {
    // One pinned post at a time, the way a pinned tweet works.
    if (pinned) await Post.updateMany({ author: req.user._id }, { pinned: false });
    post.pinned = pinned;
  }

  await post.save();

  const full = await populated(Post.findById(post._id));
  const [shaped] = await hydrate([full], req.user);
  res.json({ success: true, post: shaped });
});

export const deletePost = asyncHandler(async (req, res) => {
  const post = await Post.findOne({ _id: req.params.id, author: req.user._id, deletedAt: null });
  if (!post) throw ApiError.notFound('Post not found', 'NO_POST');

  post.deletedAt = new Date();
  await post.save();

  if (post.repostOf) {
    await Post.updateOne({ _id: post.repostOf }, { $inc: { repostCount: -1 } });
  }

  /* The rows that exist only to answer "did I like this" are worthless once the
     post is gone, and unlike the post itself nothing points at them. */
  await Promise.all([
    PostLike.deleteMany({ post: post._id }),
    SavedPost.deleteMany({ post: post._id }),
  ]);

  // Uploaded media is ours to clean up; a soft-deleted post never shows it again.
  for (const item of post.media) {
    for (const url of [item.url, item.thumbnail]) {
      if (url?.startsWith('/uploads/posts/')) {
        fs.unlink(path.join(uploadRoot, 'posts', path.basename(url))).catch(() => {});
      }
    }
  }

  getIO()?.emit('post:deleted', { postId: String(post._id) });
  res.json({ success: true });
});

/* ────────────────────────────── reactions ──────────────────────────────
   Every one of these is written to be safe when it arrives twice, because on a
   feed it will: a double-tap and a tap on the heart race each other, and a
   phone on a bad connection retries. The unique index decides who wins, and the
   counter only moves when a row actually changed. */

export const likePost = asyncHandler(async (req, res) => {
  const post = await Post.findOne({ _id: req.params.id, deletedAt: null });
  if (!post) throw ApiError.notFound('Post not found', 'NO_POST');

  const result = await PostLike.updateOne(
    { user: req.user._id, post: post._id, comment: null },
    { $setOnInsert: { user: req.user._id, post: post._id, comment: null } },
    { upsert: true }
  );

  if (result.upsertedCount) {
    await Post.updateOne({ _id: post._id }, { $inc: { likeCount: 1 } });
    notify(post.author, 'post:liked', { postId: String(post._id) }, req.user);
    broadcastStats(post._id, { likeCount: post.likeCount + 1 });
  }

  res.json({
    success: true,
    liked: true,
    likeCount: post.likeCount + (result.upsertedCount || 0),
  });
});

export const unlikePost = asyncHandler(async (req, res) => {
  const post = await Post.findOne({ _id: req.params.id, deletedAt: null });
  if (!post) throw ApiError.notFound('Post not found', 'NO_POST');

  const { deletedCount } = await PostLike.deleteOne({
    user: req.user._id,
    post: post._id,
    comment: null,
  });
  if (deletedCount) {
    await Post.updateOne({ _id: post._id }, { $inc: { likeCount: -1 } });
    broadcastStats(post._id, { likeCount: Math.max(0, post.likeCount - 1) });
  }

  res.json({
    success: true,
    liked: false,
    likeCount: Math.max(0, post.likeCount - (deletedCount || 0)),
  });
});

export const postLikers = asyncHandler(async (req, res) => {
  const cursor = decodeCursor(req.query.cursor);
  const rows = await PostLike.find({ post: req.params.id, comment: null, ...olderThan(cursor) })
    .sort({ createdAt: -1, _id: -1 })
    .limit(41)
    .populate('user', AUTHOR_FIELDS)
    .lean();

  const hasMore = rows.length > 40;
  const page = hasMore ? rows.slice(0, 40) : rows;

  const follows = await Follow.find({
    follower: req.user._id,
    following: { $in: page.map((r) => r.user?._id).filter(Boolean) },
  })
    .select('following')
    .lean();
  const followed = new Set(follows.map((f) => String(f.following)));

  res.json({
    success: true,
    users: page
      .filter((r) => r.user)
      .map((r) => ({
        _id: String(r.user._id),
        name: r.user.name,
        username: r.user.username,
        avatar: r.user.avatar,
        avatarColor: r.user.avatarColor,
        about: r.user.about,
        isFollowing: followed.has(String(r.user._id)),
        isMe: String(r.user._id) === String(req.user._id),
      })),
    nextCursor: hasMore && page.length ? encodeCursor(page[page.length - 1]) : null,
  });
});

export const savePost = asyncHandler(async (req, res) => {
  const post = await Post.findOne({ _id: req.params.id, deletedAt: null });
  if (!post) throw ApiError.notFound('Post not found', 'NO_POST');

  const result = await SavedPost.updateOne(
    { user: req.user._id, post: post._id },
    { $setOnInsert: { user: req.user._id, post: post._id } },
    { upsert: true }
  );
  if (result.upsertedCount) {
    await Post.updateOne({ _id: post._id }, { $inc: { saveCount: 1 } });
    broadcastStats(post._id, { saveCount: post.saveCount + 1 });
  }

  res.json({ success: true, saved: true });
});

export const unsavePost = asyncHandler(async (req, res) => {
  const { deletedCount } = await SavedPost.deleteOne({ user: req.user._id, post: req.params.id });
  if (deletedCount) {
    await Post.updateOne({ _id: req.params.id }, { $inc: { saveCount: -1 } });
    await publishStats(req.params.id);
  }
  res.json({ success: true, saved: false });
});

/** Undo a boost — soft-deletes my repost of this post, not the post. */
export const unrepost = asyncHandler(async (req, res) => {
  const repost = await Post.findOne({
    author: req.user._id,
    repostOf: req.params.id,
    deletedAt: null,
  });
  if (!repost) return res.json({ success: true, reposted: false });

  repost.deletedAt = new Date();
  await repost.save();
  await Post.updateOne({ _id: req.params.id }, { $inc: { repostCount: -1 } });
  await publishStats(req.params.id);

  res.json({ success: true, reposted: false });
});

/** Records that a link left the app. Counted, never attributed to a person. */
export const sharePost = asyncHandler(async (req, res) => {
  const post = await Post.findOneAndUpdate(
    { _id: req.params.id, deletedAt: null },
    { $inc: { shareCount: 1 } },
    { new: true }
  );
  if (!post) throw ApiError.notFound('Post not found', 'NO_POST');
  broadcastStats(post._id, { shareCount: post.shareCount });
  res.json({ success: true, shareCount: post.shareCount });
});

/* ────────────────────────────── discovery ────────────────────────────── */

export const trendingTags = asyncHandler(async (_req, res) => {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const tags = await Post.aggregate([
    { $match: { deletedAt: null, audience: 'public', createdAt: { $gte: since } } },
    { $unwind: '$hashtags' },
    { $group: { _id: '$hashtags', posts: { $sum: 1 }, likes: { $sum: '$likeCount' } } },
    { $sort: { posts: -1, likes: -1 } },
    { $limit: 12 },
  ]);

  res.json({
    success: true,
    tags: tags.map((t) => ({ tag: t._id, posts: t.posts, likes: t.likes })),
  });
});

/* ────────────────────────────── notifications ──────────────────────────────
   Fire-and-forget, and never to yourself: liking your own post should not ping
   your own other tabs. */

export function notify(userId, event, payload, actor) {
  if (!userId || String(userId) === String(actor._id)) return;
  getIO()
    ?.to('user:' + userId)
    .emit(event, {
      ...payload,
      by: {
        _id: String(actor._id),
        name: actor.name,
        username: actor.username,
        avatar: actor.avatar,
        avatarColor: actor.avatarColor,
      },
      at: new Date().toISOString(),
    });
}

export { hydrate, populated, encodeCursor, decodeCursor, olderThan, AUTHOR_FIELDS };

/**
 * One post, for somebody who is not signed in.
 *
 * A shared link that demands an account before it will show anything is a
 * broken link as far as the person who received it is concerned. Public posts
 * therefore open for anyone; the reply, like and follow controls are what ask
 * for an account.
 *
 * Deliberately narrow: `audience: 'public'` only, no viewer state, and none of
 * the counts an author chose to hide. Anything else needs a session.
 */
export const sharedPost = asyncHandler(async (req, res) => {
  const post = await populated(Post.findById(req.params.id));
  if (!post || post.deletedAt) throw ApiError.notFound('Post not found', 'NO_POST');

  // A signed-in reader gets the ordinary shape, with their own likes and saves.
  if (req.user) {
    const [shaped] = await hydrate([post], req.user);
    return res.json({ success: true, post: shaped, viewerSignedIn: true });
  }

  if (post.audience !== 'public') {
    throw ApiError.forbidden('This post is not public', 'NOT_PUBLIC');
  }

  const shape = (p) =>
    p && {
      _id: String(p._id),
      author: p.author && {
        _id: String(p.author._id),
        name: p.author.name,
        username: p.author.username,
        avatar: p.author.avatar,
        avatarColor: p.author.avatarColor,
      },
      kind: p.kind,
      text: p.text,
      media: p.media,
      hashtags: p.hashtags,
      location: p.location,
      audience: p.audience,
      likeCount: p.hideCounts ? null : p.likeCount,
      commentCount: p.commentCount,
      repostCount: p.repostCount,
      commentsDisabled: p.commentsDisabled,
      editedAt: p.editedAt,
      createdAt: p.createdAt,
      // No viewer state to report — there is no viewer.
      liked: false,
      saved: false,
      reposted: false,
      isMine: false,
    };

  res.json({
    success: true,
    viewerSignedIn: false,
    post: { ...shape(post), repostOf: post.repostOf ? shape(post.repostOf) : null },
  });
});

/* ────────────────────────────── live counters ──────────────────────────────
   Every number on a card is broadcast the moment it moves, so two people
   looking at the same post watch the same figures.

   Broadcast rather than sent to the author's room, which is what the
   notification events do. Those answer "something happened to your post" and
   belong to one person; a counter is what everybody currently looking at that
   card is reading, and sending it only to the author left every other reader
   on a stale number until they reloaded.

   Only counts travel. `liked` and `saved` are answers to "did *I*", and one
   person's yes is not another's. */

function broadcastStats(postId, counts) {
  getIO()?.emit('post:stats', { postId: String(postId), ...counts });
}

/** Re-reads the counters straight from the document and publishes them. */
async function publishStats(postId) {
  const fresh = await Post.findById(postId)
    .select('likeCount commentCount repostCount shareCount saveCount viewCount')
    .lean();
  if (!fresh) return;

  broadcastStats(postId, {
    likeCount: fresh.likeCount,
    commentCount: fresh.commentCount,
    repostCount: fresh.repostCount,
    shareCount: fresh.shareCount,
    saveCount: fresh.saveCount,
    viewCount: fresh.viewCount,
  });
}

/**
 * Records that somebody has seen this post.
 *
 * Counted once per person, ever — the unique index on (user, post) decides,
 * and the counter only moves when a row was actually inserted. Scrolling the
 * same card past twice is one view, which is the only reading of the number
 * that is worth showing.
 *
 * Answers 204 either way. The client fires this and forgets it; there is
 * nothing useful it could do with a failure.
 */
export const viewPost = asyncHandler(async (req, res) => {
  const result = await PostView.updateOne(
    { user: req.user._id, post: req.params.id },
    { $setOnInsert: { user: req.user._id, post: req.params.id } },
    { upsert: true }
  );

  if (result.upsertedCount) {
    const post = await Post.findOneAndUpdate(
      { _id: req.params.id, deletedAt: null },
      { $inc: { viewCount: 1 } },
      { new: true, projection: 'viewCount' }
    );
    if (post) broadcastStats(post._id, { viewCount: post.viewCount });
  }

  res.status(204).end();
});

export { publishStats, broadcastStats };
