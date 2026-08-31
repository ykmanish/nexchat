import path from 'node:path';
import sharp from 'sharp';
import fs from 'node:fs/promises';
import { Story, User, Conversation } from '../models/index.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { uploadRoot } from '../middleware/upload.js';
import { getIO } from '../sockets/io.js';

const STORY_TTL_MS = 24 * 60 * 60 * 1000;

/** Attachments arrive already encrypted by the browser, so the server just
 *  parks the opaque bytes and hands back a URL. Names, MIME types and the
 *  decryption key all travel inside the message envelope instead. */
export const uploadFiles = asyncHandler(async (req, res) => {
  if (!req.files?.length) throw ApiError.badRequest('No files received', 'NO_FILES');

  const bucket = req.uploadBucket || 'media';
  const files = req.files.map((f) => ({
    id: path.basename(f.filename, path.extname(f.filename)),
    url: '/uploads/' + bucket + '/' + f.filename,
    size: f.size,
  }));

  res.status(201).json({ success: true, files });
});

export const deleteUpload = asyncHandler(async (req, res) => {
  const { bucket, filename } = req.params;
  if (!['media', 'stories', 'voice', 'posts'].includes(bucket) || filename.includes('..')) {
    throw ApiError.badRequest('Bad path', 'BAD_PATH');
  }
  await fs.unlink(path.join(uploadRoot, bucket, filename)).catch(() => {});
  res.json({ success: true });
});

/* ────────────────────────────── stories ────────────────────────────── */

export const createStory = asyncHandler(async (req, res) => {
  const {
    kind = 'image',
    body,
    keys = [],
    media = {},
    background = null,
    audience = 'contacts',
    audienceList = [],
  } = req.body;

  const story = await Story.create({
    user: req.user._id,
    kind,
    body,
    keys,
    media,
    background,
    audience,
    audienceList,
    expiresAt: new Date(Date.now() + STORY_TTL_MS),
  });

  const populated = await story.populate('user', 'name avatar avatarColor');

  // Anyone who can see the story should get it live: people who added you as a
  // contact, and everyone you actually share a conversation with.
  const recipients = await audienceFor(req.user._id);
  const io = getIO();
  recipients.forEach((id) =>
    io?.to('user:' + id).emit('story:new', {
      story: {
        ...populated.toJSON(),
        keys: populated.keys.filter((k) => String(k.user) === String(id)),
      },
    })
  );

  res.status(201).json({ success: true, story: populated.toJSON() });
});

/** Everyone entitled to see this person's status: their contacts plus anyone
 *  they share a conversation with. Returns a de-duplicated list of ids. */
async function audienceFor(userId) {
  const [byContact, convs] = await Promise.all([
    User.find({ contacts: userId }).select('_id').lean(),
    Conversation.find({ memberIds: userId }).select('memberIds').lean(),
  ]);

  const ids = new Set(byContact.map((u) => String(u._id)));
  convs.forEach((c) =>
    c.memberIds.forEach((m) => {
      if (String(m) !== String(userId)) ids.add(String(m));
    })
  );
  return [...ids];
}

export const listStories = asyncHandler(async (req, res) => {
  // Mirror of audienceFor, from the viewer's side.
  const convs = await Conversation.find({ memberIds: req.user._id }).select('memberIds').lean();
  const shared = new Set();
  convs.forEach((c) =>
    c.memberIds.forEach((m) => {
      if (String(m) !== String(req.user._id)) shared.add(String(m));
    })
  );
  (req.user.contacts || []).forEach((c) => shared.add(String(c)));
  const contactIds = [...shared];

  const stories = await Story.find({
    expiresAt: { $gt: new Date() },
    $or: [
      { user: req.user._id },
      {
        user: { $in: contactIds },
        $or: [
          { audience: 'contacts' },
          { audience: 'selected', audienceList: req.user._id },
          { audience: 'except', audienceList: { $ne: req.user._id } },
        ],
      },
    ],
  })
    .populate('user', 'name avatar avatarColor presence')
    .sort({ createdAt: 1 });

  // Roll up into one ring per author, newest last.
  const grouped = new Map();
  for (const s of stories) {
    const uid = String(s.user._id);
    if (!grouped.has(uid)) {
      grouped.set(uid, {
        user: s.user,
        isMine: uid === String(req.user._id),
        items: [],
        hasUnseen: false,
        latestAt: s.createdAt,
      });
    }
    const entry = grouped.get(uid);
    const seen = s.viewers.some((v) => String(v.user) === String(req.user._id));
    entry.items.push({
      ...s.toJSON(),
      keys: s.keys.filter((k) => String(k.user) === String(req.user._id)),
      seen,
      viewerCount: s.viewers.length,
    });
    if (!seen && !entry.isMine) entry.hasUnseen = true;
    entry.latestAt = s.createdAt;
  }

  const rings = [...grouped.values()].sort((a, b) => {
    if (a.isMine !== b.isMine) return a.isMine ? -1 : 1;
    if (a.hasUnseen !== b.hasUnseen) return a.hasUnseen ? -1 : 1;
    return new Date(b.latestAt) - new Date(a.latestAt);
  });

  res.json({ success: true, rings });
});

export const viewStory = asyncHandler(async (req, res) => {
  const story = await Story.findById(req.params.id);
  if (!story) throw ApiError.notFound('Story not found', 'NO_STORY');

  const already = story.viewers.some((v) => String(v.user) === String(req.user._id));
  if (!already && String(story.user) !== String(req.user._id)) {
    story.viewers.push({ user: req.user._id, at: new Date() });
    await story.save();

    getIO()?.to('user:' + story.user).emit('story:viewed', {
      storyId: String(story._id),
      viewer: { id: req.user._id, name: req.user.name, avatar: req.user.avatar },
    });
  }

  res.json({ success: true, viewers: story.viewers.length });
});

export const storyViewers = asyncHandler(async (req, res) => {
  const story = await Story.findById(req.params.id).populate(
    'viewers.user',
    'name avatar avatarColor privacy'
  );
  if (!story) throw ApiError.notFound('Story not found', 'NO_STORY');
  if (String(story.user) !== String(req.user._id)) {
    throw ApiError.forbidden('Only the author can see this', 'NOT_AUTHOR');
  }

  /* Someone who turned read receipts off is counted but not named — the same
     bargain as message ticks. `total` therefore stays honest while `viewers`
     only carries the people who allow it. */
  const named = story.viewers.filter((v) => v.user?.privacy?.readReceipts !== false);

  res.json({
    success: true,
    total: story.viewers.length,
    hidden: story.viewers.length - named.length,
    viewers: named.map((v) => ({
      at: v.at,
      user: {
        _id: v.user._id,
        name: v.user.name,
        avatar: v.user.avatar,
        avatarColor: v.user.avatarColor,
      },
    })),
  });
});

export const deleteStory = asyncHandler(async (req, res) => {
  const story = await Story.findOne({ _id: req.params.id, user: req.user._id });
  if (!story) throw ApiError.notFound('Story not found', 'NO_STORY');

  if (story.media?.url?.startsWith('/uploads/stories/')) {
    fs.unlink(path.join(uploadRoot, 'stories', path.basename(story.media.url))).catch(() => {});
  }
  await story.deleteOne();

  res.json({ success: true });
});

export const reactToStory = asyncHandler(async (req, res) => {
  const { emoji } = req.body;
  const story = await Story.findById(req.params.id);
  if (!story) throw ApiError.notFound('Story not found', 'NO_STORY');

  const mine = story.reactions.find((r) => String(r.user) === String(req.user._id));
  if (mine) mine.emoji = emoji;
  else story.reactions.push({ user: req.user._id, emoji });
  await story.save();

  getIO()?.to('user:' + story.user).emit('story:reaction', {
    storyId: String(story._id),
    emoji,
    by: { id: req.user._id, name: req.user.name },
  });

  res.json({ success: true });
});

/* ────────────────────────────── feed media ──────────────────────────────
   Unlike a chat attachment, a post's picture arrives as plaintext — see the
   note on the Post model for why — which means the server can and should do
   the work the browser would otherwise have to: normalise the orientation,
   cap the dimensions, re-encode to WebP, and produce the blurred placeholder
   that holds the card's shape while the real image loads.

   Video is passed through untouched. Transcoding needs ffmpeg, which is not a
   dependency of this project, and shipping a half-transcode would be worse
   than shipping none. */

const POST_MAX_EDGE = 1440;
const PLACEHOLDER_EDGE = 20;

export const uploadPostMedia = asyncHandler(async (req, res) => {
  if (!req.files?.length) throw ApiError.badRequest('No files received', 'NO_FILES');

  const out = [];

  for (const file of req.files) {
    if (file.mimetype.startsWith('video/')) {
      out.push({
        kind: 'video',
        url: '/uploads/posts/' + path.basename(file.path),
        size: file.size,
        width: null,
        height: null,
        placeholder: null,
      });
      continue;
    }

    const name = 'p_' + path.basename(file.filename, path.extname(file.filename)) + '.webp';
    const target = path.join(uploadRoot, 'posts', name);

    try {
      const resized = await sharp(file.path, { animated: true })
        .rotate()
        .resize({
          width: POST_MAX_EDGE,
          height: POST_MAX_EDGE,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: 84 })
        .toFile(target);

      /* Twenty pixels wide, inlined into the JSON. It costs well under a
         kilobyte and it is the difference between a feed that settles into
         place and one that jumps every time a picture lands. */
      const placeholder = await sharp(file.path)
        .rotate()
        .resize(PLACEHOLDER_EDGE, PLACEHOLDER_EDGE, { fit: 'inside' })
        .blur(1.4)
        .webp({ quality: 40 })
        .toBuffer();

      out.push({
        kind: 'image',
        url: '/uploads/posts/' + name,
        width: resized.width,
        height: resized.height,
        size: resized.size,
        placeholder: 'data:image/webp;base64,' + placeholder.toString('base64'),
      });

      await fs.unlink(file.path).catch(() => {});
    } catch {
      /* An exotic codec sharp will not open is not a reason to lose the post.
         Keep the original bytes and let the browser have a go at them. */
      out.push({
        kind: 'image',
        url: '/uploads/posts/' + path.basename(file.path),
        size: file.size,
        width: null,
        height: null,
        placeholder: null,
      });
    }
  }

  res.status(201).json({ success: true, files: out });
});
