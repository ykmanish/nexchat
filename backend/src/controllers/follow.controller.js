import { Follow, Post, User, Conversation } from '../models/index.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { notify, AUTHOR_FIELDS } from './post.controller.js';

const shapeUser = (user, { isFollowing = false, isMe = false } = {}) => ({
  _id: String(user._id),
  name: user.name,
  username: user.username,
  avatar: user.avatar,
  avatarColor: user.avatarColor,
  about: user.about,
  presence: user.presence,
  isFollowing,
  isMe,
});

export const follow = asyncHandler(async (req, res) => {
  if (String(req.params.userId) === String(req.user._id)) {
    throw ApiError.badRequest('You cannot follow yourself', 'SELF_FOLLOW');
  }

  const target = await User.findById(req.params.userId).select(AUTHOR_FIELDS);
  if (!target) throw ApiError.notFound('Account not found', 'NO_USER');
  if ((req.user.blocked || []).some((b) => String(b) === String(target._id))) {
    throw ApiError.badRequest('Unblock this account first', 'BLOCKED');
  }

  const result = await Follow.updateOne(
    { follower: req.user._id, following: target._id },
    { $setOnInsert: { follower: req.user._id, following: target._id } },
    { upsert: true }
  );

  if (result.upsertedCount) notify(target._id, 'follow:new', {}, req.user);

  const followerCount = await Follow.countDocuments({ following: target._id });
  res.json({ success: true, isFollowing: true, followerCount });
});

export const unfollow = asyncHandler(async (req, res) => {
  await Follow.deleteOne({ follower: req.user._id, following: req.params.userId });
  const followerCount = await Follow.countDocuments({ following: req.params.userId });
  res.json({ success: true, isFollowing: false, followerCount });
});

export const followers = asyncHandler(async (req, res) => {
  const rows = await Follow.find({ following: req.params.userId })
    .sort({ createdAt: -1 })
    .limit(200)
    .populate('follower', AUTHOR_FIELDS)
    .lean();

  const ids = rows.map((r) => r.follower?._id).filter(Boolean);
  const mine = await Follow.find({ follower: req.user._id, following: { $in: ids } })
    .select('following')
    .lean();
  const followed = new Set(mine.map((f) => String(f.following)));

  res.json({
    success: true,
    users: rows
      .filter((r) => r.follower)
      .map((r) =>
        shapeUser(r.follower, {
          isFollowing: followed.has(String(r.follower._id)),
          isMe: String(r.follower._id) === String(req.user._id),
        })
      ),
  });
});

export const following = asyncHandler(async (req, res) => {
  const rows = await Follow.find({ follower: req.params.userId })
    .sort({ createdAt: -1 })
    .limit(200)
    .populate('following', AUTHOR_FIELDS)
    .lean();

  const ids = rows.map((r) => r.following?._id).filter(Boolean);
  const mine = await Follow.find({ follower: req.user._id, following: { $in: ids } })
    .select('following')
    .lean();
  const followed = new Set(mine.map((f) => String(f.following)));

  res.json({
    success: true,
    users: rows
      .filter((r) => r.following)
      .map((r) =>
        shapeUser(r.following, {
          isFollowing: followed.has(String(r.following._id)),
          isMe: String(r.following._id) === String(req.user._id),
        })
      ),
  });
});

/**
 * Who to follow.
 *
 * Ranked by how connected they already are to this account rather than by how
 * popular they are in general, because "people you actually know" is a far
 * better first feed than "people with the most followers". In order:
 *
 *   1. people you already talk to but do not read
 *   2. people your follows follow — the friend-of-a-friend ring
 *   3. accounts that post publicly, so a brand-new account still sees someone
 */
export const suggestions = asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 8, 24);

  const [alreadyFollowing, convs] = await Promise.all([
    Follow.find({ follower: req.user._id }).select('following').lean(),
    Conversation.find({ memberIds: req.user._id }).select('memberIds').lean(),
  ]);

  const skip = new Set([
    String(req.user._id),
    ...alreadyFollowing.map((f) => String(f.following)),
    ...(req.user.blocked || []).map(String),
  ]);

  const ranked = new Map();
  const add = (id, score, reason) => {
    const key = String(id);
    if (skip.has(key)) return;
    const prev = ranked.get(key);
    if (!prev || prev.score < score) ranked.set(key, { score, reason });
  };

  convs.forEach((c) => c.memberIds.forEach((m) => add(m, 3, 'You chat with them')));
  (req.user.contacts || []).forEach((c) => add(c, 4, 'In your contacts'));

  const followIds = alreadyFollowing.map((f) => f.following);
  if (followIds.length) {
    const second = await Follow.find({ follower: { $in: followIds } })
      .select('following')
      .limit(400)
      .lean();
    second.forEach((f) => add(f.following, 2, 'Followed by people you follow'));
  }

  // Still thin — fall back to accounts that actually post.
  if (ranked.size < limit) {
    const active = await Post.aggregate([
      { $match: { deletedAt: null, audience: 'public' } },
      { $group: { _id: '$author', posts: { $sum: 1 } } },
      { $sort: { posts: -1 } },
      { $limit: limit * 4 },
    ]);
    active.forEach((a) => add(a._id, 1, 'Posts publicly'));
  }

  const top = [...ranked.entries()]
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, limit);

  const users = await User.find({ _id: { $in: top.map(([id]) => id) }, emailVerified: true })
    .select(AUTHOR_FIELDS)
    .lean();

  const meta = new Map(top);
  res.json({
    success: true,
    users: users
      .map((u) => ({ ...shapeUser(u), reason: meta.get(String(u._id))?.reason || '' }))
      .sort(
        (a, b) => (meta.get(b._id)?.score || 0) - (meta.get(a._id)?.score || 0)
      ),
  });
});

/** Search accounts by name or handle, with follow state folded in. */
export const searchPeople = asyncHandler(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json({ success: true, users: [] });

  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rx = new RegExp(escaped, 'i');

  const users = await User.find({
    _id: { $ne: req.user._id, $nin: req.user.blocked || [] },
    emailVerified: true,
    $or: [{ name: rx }, { username: rx }],
  })
    .select(AUTHOR_FIELDS)
    .limit(24)
    .lean();

  const mine = await Follow.find({
    follower: req.user._id,
    following: { $in: users.map((u) => u._id) },
  })
    .select('following')
    .lean();
  const followed = new Set(mine.map((f) => String(f.following)));

  res.json({
    success: true,
    users: users.map((u) => shapeUser(u, { isFollowing: followed.has(String(u._id)) })),
  });
});
