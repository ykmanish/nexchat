import mongoose from 'mongoose';
import { Conversation, Message } from '../models/index.js';
import { ApiError } from '../utils/ApiError.js';
import { getIO } from '../sockets/io.js';
import { pushNewMessage } from './push.js';

const SENDER_FIELDS = 'name username avatar avatarColor presence';

const REPLY_POPULATE = {
  path: 'replyTo',
  select: 'sender type body keys attachments createdAt deletedForEveryone system',
  populate: { path: 'sender', select: 'name avatar avatarColor' },
};

/** Key slots are per-recipient — hand each user only the ones they can open. */
export function hydrate(msgDoc, userId) {
  const json = msgDoc.toJSON ? msgDoc.toJSON() : msgDoc;
  const narrow = (m) => ({
    ...m,
    keys: (m.keys || []).filter((k) => String(k.user) === String(userId)),
  });

  const out = narrow(json);
  if (out.replyTo && typeof out.replyTo === 'object' && out.replyTo.keys) {
    out.replyTo = narrow(out.replyTo);
  }
  out.starred = (json.starredBy || []).some((id) => String(id) === String(userId));
  delete out.starredBy;
  return out;
}

export function emitToMembers(conv, msgDoc, event = 'message:new', extra = {}) {
  const io = getIO();
  if (!io) return;

  for (const p of conv.participants || []) {
    if (p.leftAt) continue;
    const uid = String(p.user._id || p.user);
    io.to('user:' + uid).emit(event, {
      conversationId: String(conv._id),
      message: hydrate(msgDoc, uid),
      ...extra,
    });
  }
}

export async function requireMembership(conversationId, userId) {
  if (!mongoose.isValidObjectId(conversationId)) {
    throw ApiError.badRequest('Bad conversation id', 'BAD_ID');
  }
  const conv = await Conversation.findOne({ _id: conversationId, memberIds: userId });
  if (!conv) throw ApiError.notFound('Conversation not found', 'NO_CONVERSATION');
  return conv;
}

/**
 * Persists one encrypted message and fans it out.
 * Shared by the REST route and the socket fast path so both behave identically.
 */
export async function createMessage({ user, deviceId, payload }) {
  const {
    conversationId,
    clientId,
    type = 'text',
    body,
    keys = [],
    attachments = [],
    replyTo = null,
    forwardedFrom = null,
    forwardScore = 0,
    expiresIn = null,
    viewOnce = false,
    poll = null,
  } = payload;

  if (!clientId) throw ApiError.badRequest('clientId is required', 'NO_CLIENT_ID');

  const conv = await requireMembership(conversationId, user._id);

  if (conv.settings.whoCanSend === 'admins' && !conv.isAdmin(user._id)) {
    throw ApiError.forbidden('Only admins can post here', 'READ_ONLY');
  }

  // Optimistic clients retry on reconnect — return the original, not a dupe.
  const existing = await Message.findOne({ clientId, sender: user._id });
  if (existing) {
    const populated = await existing.populate([
      { path: 'sender', select: SENDER_FIELDS },
      REPLY_POPULATE,
    ]);
    return { conv, message: populated, duplicate: true };
  }

  const others = conv.participants.filter(
    (p) => !p.leftAt && String(p.user) !== String(user._id)
  );

  const ttl = expiresIn ?? conv.settings.disappearingSeconds;

  conv.seq += 1;

  const msg = await Message.create({
    conversation: conv._id,
    sender: user._id,
    senderDeviceId: deviceId,
    clientId,
    seq: conv.seq,
    type,
    body,
    keys,
    attachments,
    replyTo: replyTo && mongoose.isValidObjectId(replyTo) ? replyTo : null,
    forwardedFrom,
    forwardScore,
    viewOnce,
    ...(poll ? { poll: { optionCount: poll.optionCount, multiple: !!poll.multiple } } : {}),
    receipts: others.map((p) => ({ user: p.user })),
    expiresAt: ttl > 0 ? new Date(Date.now() + ttl * 1000) : null,
  });

  conv.lastMessage = msg._id;
  conv.lastMessageAt = msg.createdAt;
  conv.participants.forEach((p) => {
    if (p.leftAt) return;
    if (String(p.user) === String(user._id)) {
      p.unreadCount = 0;
      p.lastReadAt = new Date();
    } else {
      p.unreadCount += 1;
      if (p.archived) p.archived = false; // a new message un-archives the chat
    }
  });
  await conv.save();

  const populated = await Message.findById(msg._id)
    .populate('sender', SENDER_FIELDS)
    .populate(REPLY_POPULATE);

  emitToMembers(conv, populated);

  const io = getIO();
  conv.participants
    .filter((p) => !p.leftAt)
    .forEach((p) =>
      io?.to('user:' + p.user).emit('conversation:bump', {
        conversationId: String(conv._id),
        lastMessageAt: conv.lastMessageAt,
        unreadCount: p.unreadCount,
        senderId: String(user._id),
      })
    );

  // Anyone without a live socket gets a push instead. Best effort — a failed
  // notification must never fail the send.
  pushNewMessage({
    conversation: conv,
    message: populated,
    sender: user,
    recipients: others.map((p) => ({ userId: p.user })),
  }).catch(() => {});

  return { conv, message: populated, duplicate: false };
}

export { SENDER_FIELDS, REPLY_POPULATE };
