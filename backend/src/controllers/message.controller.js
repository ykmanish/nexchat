import mongoose from 'mongoose';
import { Conversation, Message } from '../models/index.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { pageParams } from '../utils/paginate.js';
import { getIO } from '../sockets/io.js';
import {
  createMessage,
  hydrate,
  emitToMembers,
  requireMembership,
  SENDER_FIELDS,
  REPLY_POPULATE,
} from '../services/messaging.js';

/* ────────────────────────────── history ────────────────────────────── */

export const listMessages = asyncHandler(async (req, res) => {
  const conv = await requireMembership(req.params.conversationId, req.user._id);
  const { limit, before, after } = pageParams(req.query, { defaultLimit: 40, maxLimit: 100 });

  const me = conv.participantOf(req.user._id);

  const filter = {
    conversation: conv._id,
    deletedFor: { $ne: req.user._id },
    // Thread replies live in their own panel. Leaving them in the timeline was
    // the thing that made every previous attempt at threads feel like clutter.
    threadRoot: null,
  };
  if (me?.clearedAt) filter.createdAt = { $gt: me.clearedAt };
  if (before) {
    filter.createdAt = { ...(filter.createdAt || {}), $lt: new Date(before) };
  }
  if (after) {
    filter.createdAt = { ...(filter.createdAt || {}), $gt: new Date(after) };
  }

  const messages = await Message.find(filter)
    .populate('sender', SENDER_FIELDS)
    .populate(REPLY_POPULATE)
    .populate('reactions.user', 'name avatar avatarColor')
    .populate('system.actor', 'name avatar')
    .populate('system.targets', 'name avatar')
    .sort({ createdAt: -1 })
    .limit(limit + 1);

  const hasMore = messages.length > limit;
  const page = hasMore ? messages.slice(0, limit) : messages;

  res.json({
    success: true,
    messages: page.reverse().map((m) => hydrate(m, req.user._id)),
    hasMore,
    cursor: page.length ? page[0].createdAt : null,
  });
});

/**
 * One thread, oldest first. Small enough to send whole: a thread that needs
 * pagination has outgrown being a thread.
 */
export const listThread = asyncHandler(async (req, res) => {
  const root = await Message.findById(req.params.id);
  if (!root) throw ApiError.notFound('Message not found', 'NO_MESSAGE');

  const conv = await requireMembership(root.conversation, req.user._id);
  // Asking for a reply's thread should give you the thread it belongs to,
  // rather than an empty one.
  const rootId = root.threadRoot || root._id;

  const [rootDoc, replies] = await Promise.all([
    Message.findById(rootId)
      .populate('sender', SENDER_FIELDS)
      .populate(REPLY_POPULATE)
      .populate('reactions.user', 'name avatar avatarColor'),
    Message.find({
      conversation: conv._id,
      threadRoot: rootId,
      deletedFor: { $ne: req.user._id },
    })
      .populate('sender', SENDER_FIELDS)
      .populate('reactions.user', 'name avatar avatarColor')
      .sort({ createdAt: 1 })
      .limit(500),
  ]);

  if (!rootDoc) throw ApiError.notFound('Message not found', 'NO_MESSAGE');

  res.json({
    success: true,
    conversationId: String(conv._id),
    root: hydrate(rootDoc, req.user._id),
    replies: replies.map((m) => hydrate(m, req.user._id)),
    following: (rootDoc.thread?.participants || [])
      .map(String)
      .includes(String(req.user._id)),
  });
});

export const getMessage = asyncHandler(async (req, res) => {
  const msg = await Message.findById(req.params.id)
    .populate('sender', SENDER_FIELDS)
    .populate(REPLY_POPULATE);
  if (!msg) throw ApiError.notFound('Message not found', 'NO_MESSAGE');
  await requireMembership(msg.conversation, req.user._id);
  res.json({ success: true, message: hydrate(msg, req.user._id) });
});

/* ────────────────────────────── sending ────────────────────────────── */

export const sendMessage = asyncHandler(async (req, res) => {
  const { message, duplicate } = await createMessage({
    user: req.user,
    deviceId: req.deviceId,
    payload: req.body,
  });

  res.status(duplicate ? 200 : 201).json({
    success: true,
    duplicate,
    message: hydrate(message, req.user._id),
  });
});

/* ────────────────────────────── editing ────────────────────────────── */

export const editMessage = asyncHandler(async (req, res) => {
  const msg = await Message.findById(req.params.id);
  if (!msg) throw ApiError.notFound('Message not found', 'NO_MESSAGE');
  if (String(msg.sender) !== String(req.user._id)) {
    throw ApiError.forbidden('You can only edit your own messages', 'NOT_SENDER');
  }
  if (msg.deletedForEveryone) throw ApiError.badRequest('That message was deleted', 'DELETED');

  const ageMinutes = (Date.now() - msg.createdAt.getTime()) / 60000;
  if (ageMinutes > 15) throw ApiError.badRequest('Messages can only be edited for 15 minutes', 'TOO_OLD');

  msg.body = req.body.body;
  msg.keys = req.body.keys;
  msg.editedAt = new Date();
  msg.editCount += 1;
  await msg.save();

  const conv = await Conversation.findById(msg.conversation);
  const populated = await msg.populate([{ path: 'sender', select: SENDER_FIELDS }, REPLY_POPULATE]);
  emitToMembers(conv, populated, 'message:edited');

  res.json({ success: true, message: hydrate(populated, req.user._id) });
});

export const deleteMessage = asyncHandler(async (req, res) => {
  const forEveryone = String(req.query.scope || req.body.scope) === 'everyone';
  const msg = await Message.findById(req.params.id);
  if (!msg) throw ApiError.notFound('Message not found', 'NO_MESSAGE');

  const conv = await requireMembership(msg.conversation, req.user._id);

  if (forEveryone) {
    const isSender = String(msg.sender) === String(req.user._id);
    if (!isSender && !conv.isAdmin(req.user._id)) {
      throw ApiError.forbidden('You can only delete your own messages', 'NOT_SENDER');
    }

    msg.deletedForEveryone = true;
    msg.body = { ciphertext: null, iv: null };
    msg.keys = [];
    msg.attachments = [];
    msg.reactions = [];
    msg.mentions = [];
    msg.mentionsEveryone = false;
    await msg.save();

    // The root advertises a reply count; a deleted reply must stop being
    // counted, or the panel promises more than it can show.
    if (msg.threadRoot) {
      await Message.updateOne(
        { _id: msg.threadRoot, 'thread.replyCount': { $gt: 0 } },
        { $inc: { 'thread.replyCount': -1 } }
      );
    }

    getIO()?.to('conversation:' + conv._id).emit('message:deleted', {
      conversationId: String(conv._id),
      messageId: String(msg._id),
      scope: 'everyone',
      by: String(req.user._id),
    });
  } else {
    await Message.updateOne({ _id: msg._id }, { $addToSet: { deletedFor: req.user._id } });
    getIO()?.to('user:' + req.user._id).emit('message:deleted', {
      conversationId: String(conv._id),
      messageId: String(msg._id),
      scope: 'me',
    });
  }

  res.json({ success: true });
});

/** Bulk delete — the multi-select flow in the UI. */
export const deleteMany = asyncHandler(async (req, res) => {
  const { messageIds = [], scope = 'me' } = req.body;
  const ids = messageIds.filter((id) => mongoose.isValidObjectId(id)).slice(0, 200);
  if (!ids.length) throw ApiError.badRequest('No messages selected', 'NO_IDS');

  const messages = await Message.find({ _id: { $in: ids } });
  if (!messages.length) return res.json({ success: true, deleted: 0 });

  const conv = await requireMembership(messages[0].conversation, req.user._id);

  if (scope === 'everyone') {
    const mine = messages.filter(
      (m) => String(m.sender) === String(req.user._id) || conv.isAdmin(req.user._id)
    );
    await Message.updateMany(
      { _id: { $in: mine.map((m) => m._id) } },
      {
        deletedForEveryone: true,
        body: { ciphertext: null, iv: null },
        keys: [],
        attachments: [],
        reactions: [],
      }
    );
    mine.forEach((m) =>
      getIO()?.to('conversation:' + conv._id).emit('message:deleted', {
        conversationId: String(conv._id),
        messageId: String(m._id),
        scope: 'everyone',
      })
    );
    return res.json({ success: true, deleted: mine.length });
  }

  await Message.updateMany({ _id: { $in: ids } }, { $addToSet: { deletedFor: req.user._id } });
  res.json({ success: true, deleted: ids.length });
});

/* ────────────────────────────── reactions ────────────────────────────── */

export const toggleReaction = asyncHandler(async (req, res) => {
  const { emoji } = req.body;
  const msg = await Message.findById(req.params.id);
  if (!msg) throw ApiError.notFound('Message not found', 'NO_MESSAGE');

  const conv = await requireMembership(msg.conversation, req.user._id);

  const mine = msg.reactions.find((r) => String(r.user) === String(req.user._id));
  let action = 'added';

  if (mine && mine.emoji === emoji) {
    msg.reactions = msg.reactions.filter((r) => String(r.user) !== String(req.user._id));
    action = 'removed';
  } else if (mine) {
    mine.emoji = emoji;
    mine.at = new Date();
    action = 'changed';
  } else {
    msg.reactions.push({ user: req.user._id, emoji, at: new Date() });
  }
  await msg.save();

  const populated = await msg.populate('reactions.user', 'name avatar avatarColor');

  getIO()?.to('conversation:' + conv._id).emit('message:reaction', {
    conversationId: String(conv._id),
    messageId: String(msg._id),
    reactions: populated.reactions,
    action,
    by: String(req.user._id),
    emoji,
  });

  res.json({ success: true, reactions: populated.reactions, action });
});

/* ──────────────────────── star / pin / forward ──────────────────────── */

export const toggleStar = asyncHandler(async (req, res) => {
  const msg = await Message.findById(req.params.id);
  if (!msg) throw ApiError.notFound('Message not found', 'NO_MESSAGE');
  await requireMembership(msg.conversation, req.user._id);

  const starred = msg.starredBy.some((id) => String(id) === String(req.user._id));
  if (starred) {
    msg.starredBy = msg.starredBy.filter((id) => String(id) !== String(req.user._id));
  } else {
    msg.starredBy.push(req.user._id);
  }
  await msg.save();

  res.json({ success: true, starred: !starred });
});

export const listStarred = asyncHandler(async (req, res) => {
  const messages = await Message.find({
    starredBy: req.user._id,
    deletedFor: { $ne: req.user._id },
    deletedForEveryone: false,
  })
    .populate('sender', SENDER_FIELDS)
    .populate('conversation', 'name type avatar avatarColor participants')
    .sort({ createdAt: -1 })
    .limit(200);

  res.json({ success: true, messages: messages.map((m) => hydrate(m, req.user._id)) });
});

export const togglePin = asyncHandler(async (req, res) => {
  const msg = await Message.findById(req.params.id);
  if (!msg) throw ApiError.notFound('Message not found', 'NO_MESSAGE');

  const conv = await requireMembership(msg.conversation, req.user._id);
  if (conv.type !== 'direct' && !conv.isAdmin(req.user._id)) {
    throw ApiError.forbidden('Only admins can pin here', 'NOT_ADMIN');
  }

  msg.pinned = !msg.pinned;
  await msg.save();

  const set = new Set(conv.pinnedMessages.map(String));
  if (msg.pinned) set.add(String(msg._id));
  else set.delete(String(msg._id));
  conv.pinnedMessages = [...set];
  await conv.save();

  getIO()?.to('conversation:' + conv._id).emit('message:pinned', {
    conversationId: String(conv._id),
    messageId: String(msg._id),
    pinned: msg.pinned,
  });

  res.json({ success: true, pinned: msg.pinned });
});

/** Forwarding re-encrypts on the client, so this just records the new copies. */
export const forwardMessages = asyncHandler(async (req, res) => {
  const { items = [], from = null } = req.body;
  if (!items.length) throw ApiError.badRequest('Nothing to forward', 'NO_ITEMS');

  /* Nothing leaves a secret chat.
     The bodies are ciphertext, so the server cannot tell what is being
     forwarded or where it came from — the client says. That makes this a rule
     an honest client keeps rather than one the server enforces, which is the
     same bargain as every "do not forward" feature in every messenger: a
     modified client can copy anything it is able to read. It is worth having
     because it stops the ordinary case, and the app says exactly this instead
     of promising more. */
  if (from) {
    const source = await Conversation.findById(from).select('secret memberIds');
    const mine = source && source.memberIds.some((m) => String(m) === String(req.user._id));
    if (mine && source.secret?.enabled && source.secret?.blockForwarding !== false) {
      throw ApiError.forbidden('Messages in a secret chat cannot be forwarded', 'SECRET_NO_FORWARD');
    }
  }

  const created = [];

  for (const item of items.slice(0, 60)) {
    const conv = await Conversation.findOne({
      _id: item.conversationId,
      memberIds: req.user._id,
    });
    if (!conv) continue;

    conv.seq += 1;
    const msg = await Message.create({
      conversation: conv._id,
      sender: req.user._id,
      senderDeviceId: req.deviceId,
      clientId: item.clientId,
      seq: conv.seq,
      type: item.type || 'text',
      body: item.body,
      keys: item.keys || [],
      attachments: item.attachments || [],
      forwardedFrom: item.forwardedFrom || null,
      forwardScore: (item.forwardScore || 0) + 1,
      receipts: conv.participants
        .filter((p) => !p.leftAt && String(p.user) !== String(req.user._id))
        .map((p) => ({ user: p.user })),
    });

    conv.lastMessage = msg._id;
    conv.lastMessageAt = msg.createdAt;
    conv.participants.forEach((p) => {
      if (!p.leftAt && String(p.user) !== String(req.user._id)) p.unreadCount += 1;
    });
    await conv.save();

    const populated = await msg.populate({ path: 'sender', select: SENDER_FIELDS });
    emitToMembers(conv, populated);
    created.push(hydrate(populated, req.user._id));
  }

  res.status(201).json({ success: true, messages: created, count: created.length });
});

/* ────────────────────────────── polls ────────────────────────────── */

/** Casts or clears a vote. Single-choice polls replace the previous pick. */
export const votePoll = asyncHandler(async (req, res) => {
  const { option } = req.body;

  const msg = await Message.findById(req.params.id);
  if (!msg) throw ApiError.notFound('Message not found', 'NO_MESSAGE');
  if (msg.type !== 'poll') throw ApiError.badRequest('That is not a poll', 'NOT_POLL');
  if (msg.poll.closed) throw ApiError.badRequest('This poll is closed', 'POLL_CLOSED');

  const conv = await requireMembership(msg.conversation, req.user._id);

  if (option < 0 || option >= msg.poll.optionCount) {
    throw ApiError.badRequest('No such option', 'BAD_OPTION');
  }

  const mine = msg.poll.votes.filter((v) => String(v.user) === String(req.user._id));
  const already = mine.find((v) => v.option === option);

  if (already) {
    // Tapping your own choice again clears it.
    msg.poll.votes = msg.poll.votes.filter(
      (v) => !(String(v.user) === String(req.user._id) && v.option === option)
    );
  } else {
    if (!msg.poll.multiple) {
      msg.poll.votes = msg.poll.votes.filter((v) => String(v.user) !== String(req.user._id));
    }
    msg.poll.votes.push({ user: req.user._id, option, at: new Date() });
  }

  await msg.save();
  const populated = await msg.populate('poll.votes.user', 'name avatar avatarColor');

  getIO()?.to('conversation:' + conv._id).emit('poll:updated', {
    conversationId: String(conv._id),
    messageId: String(msg._id),
    poll: populated.poll,
  });

  res.json({ success: true, poll: populated.poll });
});

/** The poll author can stop it accepting new votes. */
export const closePoll = asyncHandler(async (req, res) => {
  const msg = await Message.findById(req.params.id);
  if (!msg) throw ApiError.notFound('Message not found', 'NO_MESSAGE');
  if (String(msg.sender) !== String(req.user._id)) {
    throw ApiError.forbidden('Only the author can close a poll', 'NOT_AUTHOR');
  }

  const conv = await requireMembership(msg.conversation, req.user._id);
  msg.poll.closed = true;
  await msg.save();

  getIO()?.to('conversation:' + conv._id).emit('poll:updated', {
    conversationId: String(conv._id),
    messageId: String(msg._id),
    poll: msg.poll,
  });

  res.json({ success: true });
});

/* ────────────────────────────── view once ────────────────────────────── */

/**
 * Records that this person opened a view-once message and hands back the
 * envelope one final time. Once every recipient has opened it the ciphertext
 * and keys are destroyed, so it cannot be recovered by anyone — sender included.
 */
export const openViewOnce = asyncHandler(async (req, res) => {
  const msg = await Message.findById(req.params.id).populate('sender', SENDER_FIELDS);
  if (!msg) throw ApiError.notFound('Message not found', 'NO_MESSAGE');
  if (!msg.viewOnce) throw ApiError.badRequest('That is not a view-once message', 'NOT_VIEW_ONCE');

  const conv = await requireMembership(msg.conversation, req.user._id);

  const isSender = String(msg.sender._id) === String(req.user._id);
  if (isSender) throw ApiError.forbidden('You cannot open your own view-once media', 'IS_SENDER');
  if (msg.viewOnceOpened) throw ApiError.badRequest('That has already been opened', 'ALREADY_OPENED');

  const already = msg.viewedBy.some((v) => String(v.user) === String(req.user._id));
  if (already) throw ApiError.badRequest('You have already opened this', 'ALREADY_OPENED');

  // Hand back the payload before it is destroyed.
  const payload = hydrate(msg, req.user._id);

  msg.viewedBy.push({ user: req.user._id, at: new Date() });

  const recipients = conv.participants.filter(
    (p) => !p.leftAt && String(p.user) !== String(msg.sender._id)
  );
  const everyoneSaw = recipients.every((p) =>
    msg.viewedBy.some((v) => String(v.user) === String(p.user))
  );

  if (everyoneSaw) {
    msg.viewOnceOpened = true;
    msg.body = { ciphertext: null, iv: null };
    msg.keys = [];
    msg.attachments = [];
  }
  await msg.save();

  getIO()?.to('conversation:' + conv._id).emit('message:viewed-once', {
    conversationId: String(conv._id),
    messageId: String(msg._id),
    by: String(req.user._id),
    burned: msg.viewOnceOpened,
  });

  res.json({ success: true, message: payload, burned: msg.viewOnceOpened });
});

/* ────────────────────────────── receipts ────────────────────────────── */

export const markDelivered = asyncHandler(async (req, res) => {
  const { messageIds = [] } = req.body;
  const ids = messageIds.filter((id) => mongoose.isValidObjectId(id)).slice(0, 300);
  if (!ids.length) return res.json({ success: true, updated: 0 });

  const now = new Date();
  const result = await Message.updateMany(
    { _id: { $in: ids }, 'receipts.user': req.user._id, 'receipts.deliveredAt': null },
    { $set: { 'receipts.$[slot].deliveredAt': now } },
    { arrayFilters: [{ 'slot.user': req.user._id, 'slot.deliveredAt': null }] }
  );

  if (result.modifiedCount) {
    const touched = await Message.find({ _id: { $in: ids } }).select('conversation').lean();
    const convIds = [...new Set(touched.map((m) => String(m.conversation)))];
    const io = getIO();
    convIds.forEach((cid) =>
      io?.to('conversation:' + cid).emit('message:delivered', {
        conversationId: cid,
        messageIds: ids,
        userId: String(req.user._id),
        deliveredAt: now,
      })
    );
  }

  res.json({ success: true, updated: result.modifiedCount });
});

/* ────────────────────────────── media & search ────────────────────────────── */

export const listMedia = asyncHandler(async (req, res) => {
  const conv = await requireMembership(req.params.conversationId, req.user._id);
  const kinds = String(req.query.kinds || 'image,video')
    .split(',')
    .map((s) => s.trim());

  const messages = await Message.find({
    conversation: conv._id,
    deletedForEveryone: false,
    deletedFor: { $ne: req.user._id },
    'attachments.kind': { $in: kinds },
  })
    .populate('sender', SENDER_FIELDS)
    .sort({ createdAt: -1 })
    .limit(Math.min(Number(req.query.limit) || 60, 200));

  res.json({ success: true, messages: messages.map((m) => hydrate(m, req.user._id)) });
});

/** Content is encrypted, so search runs on the client. This endpoint pulls a
 *  bounded window of recent messages for the client to decrypt and scan. */
export const searchWindow = asyncHandler(async (req, res) => {
  const conversationIds = String(req.query.conversationIds || '')
    .split(',')
    .filter((id) => mongoose.isValidObjectId(id));

  const filter = {
    deletedForEveryone: false,
    deletedFor: { $ne: req.user._id },
    type: { $ne: 'system' },
  };

  if (conversationIds.length) {
    filter.conversation = { $in: conversationIds };
  } else {
    const convs = await Conversation.find({ memberIds: req.user._id }).select('_id').lean();
    filter.conversation = { $in: convs.map((c) => c._id) };
  }

  const messages = await Message.find(filter)
    .populate('sender', SENDER_FIELDS)
    .sort({ createdAt: -1 })
    .limit(Math.min(Number(req.query.limit) || 400, 1500));

  res.json({ success: true, messages: messages.map((m) => hydrate(m, req.user._id)) });
});
