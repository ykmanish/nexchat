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

  // The mention ids are needed to decide this, but the recipient only needs the
  // answer, so the list itself does not have to go out to everyone.
  out.mentionedMe =
    !!json.mentionsEveryone ||
    (json.mentions || []).some((id) => String(id._id || id) === String(userId));

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
 * Everything that can stop a member posting, in the order a person would ask
 * it: are you allowed here at all, is the room locked, and are you going too
 * fast. Admins are exempt from slow mode — it is a crowd-control tool, and the
 * people holding the tool need to be able to talk over it.
 */
function assertMayPost(conv, user) {
  if (conv.isBanned(user._id)) {
    throw ApiError.forbidden('You were removed from this chat', 'BANNED');
  }

  const admin = conv.isAdmin(user._id);

  if (conv.settings.whoCanSend === 'admins' && !admin) {
    throw ApiError.forbidden('Only admins can post here', 'READ_ONLY');
  }

  const gap = conv.settings.slowModeSeconds || 0;
  if (!gap || admin) return;

  const me = conv.participantOf(user._id);
  const last = me?.lastSentAt?.getTime();
  if (!last) return;

  const waitMs = last + gap * 1000 - Date.now();
  if (waitMs <= 0) return;

  const seconds = Math.ceil(waitMs / 1000);
  const err = ApiError.tooMany(
    'Slow mode is on — wait ' + seconds + (seconds === 1 ? ' second' : ' seconds'),
    'SLOW_MODE'
  );
  err.details = { retryAfter: seconds, slowModeSeconds: gap };
  throw err;
}

/**
 * Narrows a client-supplied mention list to people actually in the room. The
 * ids come from the sender, so they are a request, not a fact — an unfiltered
 * list would be a way to ring anyone on the service.
 */
function resolveMentions(conv, senderId, ids = [], everyone = false) {
  const members = new Set((conv.memberIds || []).map(String));
  const unique = [
    ...new Set(
      (Array.isArray(ids) ? ids : [])
        .filter((id) => mongoose.isValidObjectId(id))
        .map(String)
        .filter((id) => members.has(id))
    ),
  ].slice(0, 128);

  // @everyone is a group affordance, and in a big room it is a loud one, so it
  // is admins-only for anything larger than a handful of people.
  const mayAddressAll =
    everyone &&
    conv.type !== 'direct' &&
    (conv.memberIds.length <= 8 || conv.isAdmin(senderId));
  return { mentions: unique, mentionsEveryone: !!mayAddressAll };
}

/** Validates a thread root and returns it, or null for a top-level message. */
async function resolveThreadRoot(conv, threadRoot) {
  if (!threadRoot || !mongoose.isValidObjectId(threadRoot)) return null;

  const root = await Message.findById(threadRoot).select('conversation threadRoot');
  if (!root) throw ApiError.notFound('That message is gone', 'NO_THREAD_ROOT');
  if (String(root.conversation) !== String(conv._id)) {
    throw ApiError.badRequest('That message is in another chat', 'WRONG_CONVERSATION');
  }
  // One level only. A reply to a reply joins the same thread rather than
  // starting a nested one, which keeps the panel a flat list.
  return root.threadRoot || root._id;
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
    threadRoot: threadRootId = null,
    mentions: mentionIds = [],
    mentionsEveryone = false,
  } = payload;

  if (!clientId) throw ApiError.badRequest('clientId is required', 'NO_CLIENT_ID');

  const conv = await requireMembership(conversationId, user._id);
  assertMayPost(conv, user);

  const threadRoot = await resolveThreadRoot(conv, threadRootId);
  const { mentions, mentionsEveryone: pingedAll } = resolveMentions(
    conv,
    user._id,
    mentionIds,
    mentionsEveryone
  );

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
    threadRoot,
    mentions,
    mentionsEveryone: pingedAll,
    receipts: others.map((p) => ({ user: p.user })),
    expiresAt: ttl > 0 ? new Date(Date.now() + ttl * 1000) : null,
  });

  const pinged = new Set(pingedAll ? others.map((p) => String(p.user)) : mentions);

  // A thread reply deliberately does not move the chat to the top of the list
  // or bump its preview: the timeline would then advertise a message that is
  // not in it. The root's counters carry the news instead.
  if (!threadRoot) {
    conv.lastMessage = msg._id;
    conv.lastMessageAt = msg.createdAt;
  }

  conv.participants.forEach((p) => {
    if (p.leftAt) return;
    if (String(p.user) === String(user._id)) {
      p.lastSentAt = msg.createdAt;
      if (threadRoot) return;
      p.unreadCount = 0;
      p.lastReadAt = new Date();
      return;
    }
    if (pinged.has(String(p.user))) p.mentionCount += 1;
    if (threadRoot) return;
    p.unreadCount += 1;
    if (p.archived) p.archived = false; // a new message un-archives the chat
  });
  await conv.save();

  if (threadRoot) {
    await Message.updateOne(
      { _id: threadRoot },
      {
        $inc: { 'thread.replyCount': 1 },
        $set: { 'thread.lastReplyAt': msg.createdAt },
        $addToSet: { 'thread.participants': user._id },
      }
    );
  }

  const populated = await Message.findById(msg._id)
    .populate('sender', SENDER_FIELDS)
    .populate(REPLY_POPULATE);

  emitToMembers(conv, populated, threadRoot ? 'message:thread-reply' : 'message:new', {
    ...(threadRoot ? { threadRoot: String(threadRoot) } : {}),
  });

  const io = getIO();
  conv.participants
    .filter((p) => !p.leftAt)
    .forEach((p) =>
      io?.to('user:' + p.user).emit('conversation:bump', {
        conversationId: String(conv._id),
        lastMessageAt: conv.lastMessageAt,
        unreadCount: p.unreadCount,
        mentionCount: p.mentionCount,
        senderId: String(user._id),
        isThreadReply: !!threadRoot,
      })
    );

  // Anyone without a live socket gets a push instead. Best effort — a failed
  // notification must never fail the send.
  const audience = threadRoot
    ? await threadAudience(threadRoot, others, pinged)
    : others.map((p) => ({ userId: p.user }));

  pushNewMessage({
    conversation: conv,
    message: populated,
    sender: user,
    recipients: audience,
    mentioned: pinged,
    threadRoot,
  }).catch(() => {});

  return { conv, message: populated, duplicate: false };
}

/**
 * A thread reply is not for the whole room — it goes to whoever is already in
 * the thread (root author included) plus anyone it names.
 */
async function threadAudience(threadRoot, others, pinged) {
  const root = await Message.findById(threadRoot).select('sender thread.participants');
  const following = new Set(
    [root?.sender, ...(root?.thread?.participants || [])].filter(Boolean).map(String)
  );
  return others
    .filter((p) => following.has(String(p.user)) || pinged.has(String(p.user)))
    .map((p) => ({ userId: p.user }));
}

export { SENDER_FIELDS, REPLY_POPULATE };
