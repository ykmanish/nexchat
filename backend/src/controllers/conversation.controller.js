import mongoose from 'mongoose';
import { Conversation, Message, User } from '../models/index.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { inviteCode as makeInviteCode } from '../utils/ids.js';
import { getIO } from '../sockets/io.js';

const POPULATE_USER = 'name username avatar avatarColor about presence lastSeen identityPublicKey securityCode privacy';

/**
 * Applies a user's privacy settings to the copy of them we are about to send
 * to someone else.
 *
 * `User.publicProfile()` does this, but it is a document method and the
 * conversation payload is built from `toObject()` plain objects — so the raw
 * populated user was going out untouched and "Nobody" was never honoured
 * anywhere a conversation was rendered.
 */
function visibleUser(user, viewer) {
  if (!user) return user;

  const privacy = user.privacy || {};
  const isSelf = String(user._id) === String(viewer?._id || viewer);
  const contacts = (viewer?.contacts || []).map((c) => String(c.user || c));
  const isContact = contacts.includes(String(user._id));

  const allow = (rule) =>
    isSelf || rule === undefined || rule === 'everyone' || (rule === 'contacts' && isContact);

  return {
    _id: user._id,
    id: user._id,
    name: user.name,
    username: user.username,
    avatar: allow(privacy.avatar) ? user.avatar : null,
    avatarColor: user.avatarColor,
    about: allow(privacy.about) ? user.about || '' : '',
    presence: allow(privacy.lastSeen) ? user.presence : 'offline',
    lastSeen: allow(privacy.lastSeen) ? user.lastSeen : null,
    identityPublicKey: user.identityPublicKey,
    securityCode: user.securityCode,
    // Needed by the client so it can hide ticks for people who turned
    // read receipts off.
    readReceipts: privacy.readReceipts !== false,
  };
}

/** Reshapes a conversation into the flat form the client renders from. */
export function serialize(conv, userId, viewer = null) {
  const doc = conv.toObject ? conv.toObject() : conv;
  const me = (doc.participants || []).find((p) => String(p.user?._id || p.user) === String(userId));

  const others = (doc.participants || []).filter(
    (p) => String(p.user?._id || p.user) !== String(userId)
  );

  const seenBy = viewer || { _id: userId, contacts: [] };
  const peer = doc.type === 'direct' ? visibleUser(others[0]?.user, seenBy) : null;

  /* `lastMessage` is one field shared by everyone in the chat, but clearing is
     per-person — so it cannot simply be nulled. Hiding it for whoever cleared
     past it is what stops a cleared chat still showing its last line in the
     sidebar, which is what "clear" is supposed to have dealt with. */
  const clearedAt = me?.clearedAt ? new Date(me.clearedAt) : null;
  const clearedPastLast =
    clearedAt && doc.lastMessageAt && new Date(doc.lastMessageAt) <= clearedAt;

  return {
    id: doc._id,
    _id: doc._id,
    type: doc.type,
    name: doc.type === 'direct' ? peer?.name || 'Unknown' : doc.name,
    avatar: doc.type === 'direct' ? peer?.avatar || null : doc.avatar,
    avatarColor: doc.type === 'direct' ? peer?.avatarColor || '#F4C430' : doc.avatarColor,
    about: doc.type === 'direct' ? peer?.about || '' : doc.about,
    peer: peer || null,
    participants: (doc.participants || []).map((p) => ({
      user: visibleUser(p.user, seenBy),
      role: p.role,
      joinedAt: p.joinedAt,
      leftAt: p.leftAt,
    })),
    memberCount: (doc.participants || []).filter((p) => !p.leftAt).length,
    createdBy: doc.createdBy,
    parentCommunity: doc.parentCommunity,
    isAnnouncement: doc.isAnnouncement,
    lastMessage: clearedPastLast ? null : doc.lastMessage || null,
    lastMessageAt: doc.lastMessageAt,
    seq: doc.seq,
    pinnedMessages: doc.pinnedMessages || [],
    inviteCode: doc.inviteCode,
    settings: doc.settings,
    bannedCount: (doc.bans || []).length,

    /* First-contact signal, where most scams begin. Free: `lastSentAt` is
       already on the participant record for slow mode, so "they messaged me and
       I have never replied" needs no extra query. */
    neverReplied: !me?.lastSentAt,
    peerIsContact:
      doc.type === 'direct' && peer
        ? (seenBy.contacts || []).some((c) => String(c) === String(peer._id))
        : false,
    // per-viewer state
    unreadCount: me?.unreadCount ?? 0,
    mentionCount: me?.mentionCount ?? 0,
    pinned: me?.pinned ?? false,
    muted: me?.muted ?? false,
    mutedUntil: me?.mutedUntil ?? null,
    muteMode: me?.muteMode ?? 'all',
    archived: me?.archived ?? false,
    draft: me?.draft ?? '',
    lastReadAt: me?.lastReadAt ?? null,
    clearedAt: me?.clearedAt ?? null,
    wallpaper: me?.wallpaper ?? null,
    role: me?.role ?? 'member',
    isAdmin: me?.role === 'admin' || me?.role === 'owner',
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

async function loadConversation(id, userId, { populate = true } = {}) {
  if (!mongoose.isValidObjectId(id)) throw ApiError.badRequest('Bad conversation id', 'BAD_ID');

  let query = Conversation.findOne({ _id: id, memberIds: userId });
  if (populate) {
    query = query
      .populate('participants.user', POPULATE_USER)
      .populate({ path: 'lastMessage', populate: { path: 'sender', select: 'name avatar' } });
  }

  const conv = await query;
  if (!conv) throw ApiError.notFound('Conversation not found', 'NO_CONVERSATION');
  return conv;
}

/** Server-authored membership events — plaintext by design. */
async function postSystemMessage(conv, action, actorId, targets = [], meta = null) {
  conv.seq += 1;
  const msg = await Message.create({
    conversation: conv._id,
    sender: actorId,
    clientId: 'sys_' + conv._id + '_' + conv.seq,
    seq: conv.seq,
    type: 'system',
    system: { action, actor: actorId, targets, meta },
  });

  conv.lastMessage = msg._id;
  conv.lastMessageAt = new Date();
  await conv.save();

  const populated = await msg.populate([
    { path: 'system.actor', select: 'name avatar' },
    { path: 'system.targets', select: 'name avatar' },
  ]);

  getIO()?.to('conversation:' + conv._id).emit('message:new', {
    conversationId: String(conv._id),
    message: populated.toJSON(),
  });

  return msg;
}

/* ────────────────────────────── read paths ────────────────────────────── */

export const listConversations = asyncHandler(async (req, res) => {
  const { archived, type, limit = 60, skip = 0 } = req.query;

  const filter = { memberIds: req.user._id };
  if (type) filter.type = type;

  let convs = await Conversation.find(filter)
    .populate('participants.user', POPULATE_USER)
    .populate({ path: 'lastMessage', populate: { path: 'sender', select: 'name avatar' } })
    .sort({ lastMessageAt: -1 })
    .limit(Math.min(Number(limit), 200))
    .skip(Number(skip));

  let out = convs.map((c) => serialize(c, req.user._id, req.user));

  const wantArchived = String(archived) === 'true';
  out = out.filter((c) => c.archived === wantArchived);

  // Pinned chats float to the top, then by recency.
  out.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return new Date(b.lastMessageAt) - new Date(a.lastMessageAt);
  });

  res.json({ success: true, conversations: out });
});

export const getConversation = asyncHandler(async (req, res) => {
  const conv = await loadConversation(req.params.id, req.user._id);
  res.json({ success: true, conversation: serialize(conv, req.user._id, req.user) });
});

/* ────────────────────────────── create paths ────────────────────────────── */

export const createDirect = asyncHandler(async (req, res) => {
  const { userId } = req.body;
  if (String(userId) === String(req.user._id)) {
    throw ApiError.badRequest('You cannot start a chat with yourself', 'SELF_CHAT');
  }

  const peer = await User.findById(userId);
  if (!peer) throw ApiError.notFound('That person does not exist', 'NO_USER');
  if (peer.blocked?.some((b) => String(b) === String(req.user._id))) {
    throw ApiError.forbidden('You cannot message this person', 'BLOCKED');
  }

  let conv = await Conversation.findOne({
    type: 'direct',
    memberIds: { $all: [req.user._id, peer._id], $size: 2 },
  })
    .populate('participants.user', POPULATE_USER)
    .populate('lastMessage');

  if (!conv) {
    conv = await Conversation.create({
      type: 'direct',
      createdBy: req.user._id,
      participants: [
        { user: req.user._id, role: 'member' },
        { user: peer._id, role: 'member' },
      ],
      memberIds: [req.user._id, peer._id],
    });
    conv = await conv.populate('participants.user', POPULATE_USER);

    getIO()?.to('user:' + peer._id).emit('conversation:new', {
      conversation: serialize(conv, peer._id),
    });
  }

  res.status(201).json({ success: true, conversation: serialize(conv, req.user._id, req.user) });
});

export const createGroup = asyncHandler(async (req, res) => {
  const { name, about = '', memberIds = [], avatar = null, parentCommunity = null } = req.body;

  const unique = [...new Set(memberIds.map(String))].filter(
    (id) => id !== String(req.user._id) && mongoose.isValidObjectId(id)
  );

  const members = await User.find({ _id: { $in: unique } }).select('_id');

  const conv = await Conversation.create({
    type: 'group',
    name,
    about,
    avatar,
    createdBy: req.user._id,
    parentCommunity,
    inviteCode: makeInviteCode(),
    participants: [
      { user: req.user._id, role: 'owner' },
      ...members.map((m) => ({ user: m._id, role: 'member', addedBy: req.user._id })),
    ],
    memberIds: [req.user._id, ...members.map((m) => m._id)],
  });

  await postSystemMessage(conv, 'group.created', req.user._id, [], { name });

  const populated = await Conversation.findById(conv._id)
    .populate('participants.user', POPULATE_USER)
    .populate('lastMessage');

  const io = getIO();
  members.forEach((m) =>
    io?.to('user:' + m._id).emit('conversation:new', {
      conversation: serialize(populated, m._id),
    })
  );

  res.status(201).json({ success: true, conversation: serialize(populated, req.user._id, req.user) });
});

export const createCommunity = asyncHandler(async (req, res) => {
  const { name, about = '', memberIds = [], avatar = null } = req.body;

  const unique = [...new Set(memberIds.map(String))].filter(
    (id) => id !== String(req.user._id) && mongoose.isValidObjectId(id)
  );
  const members = await User.find({ _id: { $in: unique } }).select('_id');

  const community = await Conversation.create({
    type: 'community',
    name,
    about,
    avatar,
    createdBy: req.user._id,
    inviteCode: makeInviteCode(),
    participants: [
      { user: req.user._id, role: 'owner' },
      ...members.map((m) => ({ user: m._id, role: 'member', addedBy: req.user._id })),
    ],
    memberIds: [req.user._id, ...members.map((m) => m._id)],
    settings: { whoCanSend: 'admins', whoCanEditInfo: 'admins' },
    isAnnouncement: true,
  });

  // Every community opens with a general room alongside its announcements feed.
  const general = await Conversation.create({
    type: 'group',
    name: 'General',
    about: 'Everyone in ' + name,
    createdBy: req.user._id,
    parentCommunity: community._id,
    inviteCode: makeInviteCode(),
    participants: community.participants.map((p) => ({ user: p.user, role: p.role })),
    memberIds: community.memberIds,
  });

  await postSystemMessage(community, 'community.created', req.user._id, [], { name });

  const populated = await Conversation.findById(community._id)
    .populate('participants.user', POPULATE_USER)
    .populate('lastMessage');

  const io = getIO();
  members.forEach((m) =>
    io?.to('user:' + m._id).emit('conversation:new', { conversation: serialize(populated, m._id) })
  );

  res.status(201).json({
    success: true,
    conversation: serialize(populated, req.user._id, req.user),
    generalId: general._id,
  });
});

/* ────────────────────────────── mutations ────────────────────────────── */

export const updateConversation = asyncHandler(async (req, res) => {
  const conv = await loadConversation(req.params.id, req.user._id);
  const { name, about, avatar, settings } = req.body;
  const editsIdentity = name !== undefined || about !== undefined || avatar !== undefined;

  // A direct chat has no name of its own, but its settings — disappearing
  // messages especially — are still editable by either participant.
  if (conv.type === 'direct' && editsIdentity) {
    throw ApiError.badRequest('Direct chats cannot be renamed', 'DIRECT');
  }

  if (
    conv.type !== 'direct' &&
    conv.settings.whoCanEditInfo === 'admins' &&
    !conv.isAdmin(req.user._id)
  ) {
    throw ApiError.forbidden('Only admins can edit this chat', 'NOT_ADMIN');
  }

  if (name !== undefined) conv.name = name;
  if (about !== undefined) conv.about = about;
  if (avatar !== undefined) conv.avatar = avatar;

  if (settings) {
    // whoCanEditInfo governs the chat's identity, not its moderation controls.
    // A group that lets everyone rename it should still not let everyone
    // silence it, so these are gated separately.
    const restricted = ['whoCanSend', 'whoCanEditInfo', 'whoCanAddMembers', 'slowModeSeconds', 'approvalRequired'];
    const touchesModeration = restricted.some((k) => settings[k] !== undefined);
    if (conv.type !== 'direct' && touchesModeration && !conv.isAdmin(req.user._id)) {
      throw ApiError.forbidden('Only admins can change this', 'NOT_ADMIN');
    }
    if (settings.slowModeSeconds !== undefined) {
      const gap = Number(settings.slowModeSeconds);
      if (!Number.isFinite(gap) || gap < 0 || gap > 21600) {
        throw ApiError.badRequest('Slow mode must be between 0 and 6 hours', 'BAD_SLOW_MODE');
      }
      settings.slowModeSeconds = Math.round(gap);
    }
    Object.assign(conv.settings, settings);
  }
  await conv.save();

  if (settings?.slowModeSeconds !== undefined) {
    await postSystemMessage(conv, 'group.slowMode', req.user._id, [], {
      seconds: conv.settings.slowModeSeconds,
    });
  }

  if (name !== undefined) await postSystemMessage(conv, 'group.renamed', req.user._id, [], { name });

  const payload = serialize(conv, req.user._id, req.user);
  getIO()?.to('conversation:' + conv._id).emit('conversation:updated', {
    conversationId: String(conv._id),
    patch: { name: conv.name, about: conv.about, avatar: conv.avatar, settings: conv.settings },
  });

  res.json({ success: true, conversation: payload });
});

export const addMembers = asyncHandler(async (req, res) => {
  const conv = await loadConversation(req.params.id, req.user._id);
  if (conv.type === 'direct') throw ApiError.badRequest('Not a group', 'DIRECT');

  if (conv.settings.whoCanAddMembers === 'admins' && !conv.isAdmin(req.user._id)) {
    throw ApiError.forbidden('Only admins can add members', 'NOT_ADMIN');
  }

  const ids = [...new Set((req.body.memberIds || []).map(String))].filter((id) =>
    mongoose.isValidObjectId(id)
  );
  const existing = new Set(conv.memberIds.map(String));

  // Adding a banned person back would let any member undo an admin's decision.
  // Naming one explicitly is an error; sweeping one up in a bulk add is not, so
  // it is filtered rather than rejected.
  const banned = ids.filter((id) => conv.isBanned(id));
  if (banned.length && banned.length === ids.length) {
    throw ApiError.forbidden('That person is banned from this chat', 'BANNED');
  }

  const wanted = ids.filter((id) => !existing.has(id) && !conv.isBanned(id));
  const toAdd = await User.find({ _id: { $in: wanted } }).select('_id');

  if (!toAdd.length) throw ApiError.badRequest('Everyone is already in this chat', 'NO_NEW_MEMBERS');

  toAdd.forEach((u) => {
    const prior = conv.participants.find((p) => String(p.user._id || p.user) === String(u._id));
    if (prior) {
      prior.leftAt = null; // rejoining
      prior.joinedAt = new Date();
    } else {
      conv.participants.push({ user: u._id, role: 'member', addedBy: req.user._id });
    }
  });
  conv.syncMemberIds();
  await conv.save();

  await postSystemMessage(conv, 'members.added', req.user._id, toAdd.map((u) => u._id));

  const populated = await Conversation.findById(conv._id)
    .populate('participants.user', POPULATE_USER)
    .populate('lastMessage');

  const io = getIO();
  toAdd.forEach((u) =>
    io?.to('user:' + u._id).emit('conversation:new', { conversation: serialize(populated, u._id) })
  );

  res.json({ success: true, conversation: serialize(populated, req.user._id, req.user) });
});

export const removeMember = asyncHandler(async (req, res) => {
  const conv = await loadConversation(req.params.id, req.user._id);
  if (!conv.isAdmin(req.user._id)) throw ApiError.forbidden('Only admins can remove members', 'NOT_ADMIN');

  const target = conv.participantOf(req.params.userId);
  if (!target) throw ApiError.notFound('That person is not in this chat', 'NO_MEMBER');
  if (target.role === 'owner') throw ApiError.forbidden('The owner cannot be removed', 'IS_OWNER');

  target.leftAt = new Date();
  conv.syncMemberIds();
  await conv.save();

  await postSystemMessage(conv, 'member.removed', req.user._id, [req.params.userId]);

  getIO()?.to('user:' + req.params.userId).emit('conversation:removed', {
    conversationId: String(conv._id),
  });

  res.json({ success: true, message: 'Member removed' });
});

/* ────────────────────────────── moderation ────────────────────────────── */

/**
 * Removing someone and barring them. A plain kick is undone by the invite link
 * they still have in their scrollback, so "remove" on its own is not a
 * moderation tool — this is the one that holds.
 */
export const banMember = asyncHandler(async (req, res) => {
  const conv = await loadConversation(req.params.id, req.user._id, { populate: false });
  if (conv.type === 'direct') throw ApiError.badRequest('Block the person instead', 'DIRECT');
  if (!conv.isAdmin(req.user._id)) throw ApiError.forbidden('Only admins can do that', 'NOT_ADMIN');

  const targetId = req.params.userId;
  if (!mongoose.isValidObjectId(targetId)) throw ApiError.badRequest('Bad user id', 'BAD_ID');
  if (String(targetId) === String(req.user._id)) {
    throw ApiError.badRequest('You cannot ban yourself', 'SELF');
  }

  const target = conv.participantOf(targetId);
  // An owner outranks an admin; without this, one admin could remove the person
  // who made the group.
  if (target && (target.role === 'owner' || (target.role === 'admin' && !isOwner(conv, req.user._id)))) {
    throw ApiError.forbidden('You cannot ban another admin', 'OUTRANKED');
  }

  if (conv.isBanned(targetId)) throw ApiError.conflict('Already banned', 'ALREADY_BANNED');

  conv.bans.push({
    user: targetId,
    by: req.user._id,
    reason: (req.body.reason || '').slice(0, 200) || null,
  });

  if (target && !target.leftAt) {
    target.leftAt = new Date();
    conv.syncMemberIds();
  }
  await conv.save();

  await postSystemMessage(conv, 'group.banned', req.user._id, [targetId]);

  getIO()?.to('conversation:' + conv._id).emit('conversation:banned', {
    conversationId: String(conv._id),
    userId: String(targetId),
    by: String(req.user._id),
  });
  // The person being removed is no longer in the room, so tell them directly.
  getIO()?.to('user:' + targetId).emit('conversation:removed', {
    conversationId: String(conv._id),
    reason: 'banned',
  });

  res.json({ success: true, bannedCount: conv.bans.length });
});

export const unbanMember = asyncHandler(async (req, res) => {
  const conv = await loadConversation(req.params.id, req.user._id, { populate: false });
  if (!conv.isAdmin(req.user._id)) throw ApiError.forbidden('Only admins can do that', 'NOT_ADMIN');

  const before = conv.bans.length;
  conv.bans = conv.bans.filter((b) => String(b.user._id || b.user) !== String(req.params.userId));
  if (conv.bans.length === before) throw ApiError.notFound('Not banned', 'NOT_BANNED');

  await conv.save();
  res.json({ success: true, bannedCount: conv.bans.length });
});

export const listBans = asyncHandler(async (req, res) => {
  const conv = await Conversation.findOne({ _id: req.params.id, memberIds: req.user._id })
    .populate('bans.user', 'name username avatar avatarColor')
    .populate('bans.by', 'name');
  if (!conv) throw ApiError.notFound('Conversation not found', 'NO_CONVERSATION');
  if (!conv.isAdmin(req.user._id)) throw ApiError.forbidden('Only admins can do that', 'NOT_ADMIN');

  res.json({
    success: true,
    bans: (conv.bans || []).map((b) => ({
      user: b.user,
      by: b.by,
      reason: b.reason,
      at: b.at,
    })),
  });
});

const isOwner = (conv, userId) => conv.participantOf(userId)?.role === 'owner';

export const leaveConversation = asyncHandler(async (req, res) => {
  const conv = await loadConversation(req.params.id, req.user._id);
  const me = conv.participantOf(req.user._id);
  if (!me) throw ApiError.badRequest('You are not in this chat', 'NOT_MEMBER');

  if (me.role === 'owner') {
    // Hand ownership to the longest-standing remaining member.
    const heir = conv.participants
      .filter((p) => !p.leftAt && String(p.user._id || p.user) !== String(req.user._id))
      .sort((a, b) => a.joinedAt - b.joinedAt)[0];
    if (heir) heir.role = 'owner';
  }

  me.leftAt = new Date();
  conv.syncMemberIds();
  await conv.save();

  await postSystemMessage(conv, 'member.left', req.user._id, [req.user._id]);

  res.json({ success: true, message: 'You left the chat' });
});

export const setRole = asyncHandler(async (req, res) => {
  const conv = await loadConversation(req.params.id, req.user._id);
  if (!conv.isAdmin(req.user._id)) throw ApiError.forbidden('Only admins can do that', 'NOT_ADMIN');

  const target = conv.participantOf(req.params.userId);
  if (!target) throw ApiError.notFound('That person is not in this chat', 'NO_MEMBER');
  if (target.role === 'owner') throw ApiError.forbidden('The owner role cannot change', 'IS_OWNER');

  const role = req.body.role === 'admin' ? 'admin' : 'member';
  target.role = role;
  await conv.save();

  await postSystemMessage(
    conv,
    role === 'admin' ? 'member.promoted' : 'member.demoted',
    req.user._id,
    [req.params.userId]
  );

  res.json({ success: true, role });
});

/** Per-viewer chat state: pin, mute, archive, draft, wallpaper. */
export const updateState = asyncHandler(async (req, res) => {
  const conv = await loadConversation(req.params.id, req.user._id, { populate: false });
  const me = conv.participantOf(req.user._id);
  if (!me) throw ApiError.notFound('Not a member', 'NOT_MEMBER');

  const { pinned, muted, mutedUntil, muteMode, archived, draft, wallpaper } = req.body;
  if (pinned !== undefined) me.pinned = !!pinned;
  if (muted !== undefined) {
    me.muted = !!muted;
    me.mutedUntil = muted && mutedUntil ? new Date(mutedUntil) : null;
  }
  if (muteMode !== undefined && ['all', 'mentions'].includes(muteMode)) {
    me.muteMode = muteMode;
  }
  if (archived !== undefined) me.archived = !!archived;
  if (draft !== undefined) me.draft = String(draft).slice(0, 5000);
  if (wallpaper !== undefined) me.wallpaper = wallpaper;

  await conv.save();

  getIO()?.to('user:' + req.user._id).emit('conversation:state', {
    conversationId: String(conv._id),
    state: {
      pinned: me.pinned,
      muted: me.muted,
      mutedUntil: me.mutedUntil,
      muteMode: me.muteMode,
      archived: me.archived,
      draft: me.draft,
      wallpaper: me.wallpaper,
    },
  });

  res.json({ success: true });
});

export const markRead = asyncHandler(async (req, res) => {
  const conv = await loadConversation(req.params.id, req.user._id, { populate: false });
  const me = conv.participantOf(req.user._id);
  if (!me) throw ApiError.notFound('Not a member', 'NOT_MEMBER');

  const now = new Date();
  me.unreadCount = 0;
  me.mentionCount = 0;
  me.lastReadAt = now;
  if (req.body.messageId && mongoose.isValidObjectId(req.body.messageId)) {
    me.lastReadMessage = req.body.messageId;
  }
  await conv.save();

  if (req.user.privacy.readReceipts) {
    const result = await Message.updateMany(
      {
        conversation: conv._id,
        sender: { $ne: req.user._id },
        'receipts.user': req.user._id,
        'receipts.readAt': null,
      },
      { $set: { 'receipts.$[slot].readAt': now } },
      { arrayFilters: [{ 'slot.user': req.user._id, 'slot.readAt': null }] }
    );

    if (result.modifiedCount) {
      getIO()?.to('conversation:' + conv._id).emit('message:read', {
        conversationId: String(conv._id),
        userId: String(req.user._id),
        readAt: now,
      });
    }
  }

  res.json({ success: true, readAt: now });
});

/** Clears history for this viewer only — everyone else keeps theirs. */
export const clearHistory = asyncHandler(async (req, res) => {
  const conv = await loadConversation(req.params.id, req.user._id, { populate: false });
  const me = conv.participantOf(req.user._id);
  me.clearedAt = new Date();
  me.unreadCount = 0;
  await conv.save();

  await Message.updateMany(
    { conversation: conv._id },
    { $addToSet: { deletedFor: req.user._id } }
  );

  res.json({ success: true, message: 'Chat cleared' });
});

export const deleteConversation = asyncHandler(async (req, res) => {
  const conv = await loadConversation(req.params.id, req.user._id, { populate: false });
  const me = conv.participantOf(req.user._id);

  me.clearedAt = new Date();
  me.leftAt = conv.type === 'direct' ? me.leftAt : new Date();
  me.archived = false;
  me.unreadCount = 0;
  conv.syncMemberIds();
  await conv.save();

  await Message.updateMany({ conversation: conv._id }, { $addToSet: { deletedFor: req.user._id } });

  res.json({ success: true, message: 'Chat deleted' });
});

/* ────────────────────────────── invites ────────────────────────────── */

export const getInvite = asyncHandler(async (req, res) => {
  const conv = await loadConversation(req.params.id, req.user._id, { populate: false });
  if (!conv.isAdmin(req.user._id)) throw ApiError.forbidden('Only admins can share invites', 'NOT_ADMIN');

  if (!conv.inviteCode || req.query.rotate === 'true') {
    conv.inviteCode = makeInviteCode();
    await conv.save();
  }

  res.json({ success: true, inviteCode: conv.inviteCode, enabled: conv.inviteEnabled });
});

export const joinByInvite = asyncHandler(async (req, res) => {
  const code = String(req.params.code || '').toUpperCase().trim();
  const conv = await Conversation.findOne({ inviteCode: code });

  if (!conv || !conv.inviteEnabled) throw ApiError.notFound('That invite is no longer valid', 'BAD_INVITE');

  // The whole point of a ban is that the link in their scrollback stops working.
  if (conv.isBanned(req.user._id)) {
    throw ApiError.forbidden('You cannot rejoin this chat', 'BANNED');
  }

  const existing = conv.participantOf(req.user._id);
  if (existing && !existing.leftAt) {
    const populated = await Conversation.findById(conv._id)
      .populate('participants.user', POPULATE_USER)
      .populate('lastMessage');
    return res.json({ success: true, conversation: serialize(populated, req.user._id, req.user), already: true });
  }

  if (existing) {
    existing.leftAt = null;
    existing.joinedAt = new Date();
  } else {
    conv.participants.push({ user: req.user._id, role: 'member' });
  }
  conv.syncMemberIds();
  await conv.save();

  await postSystemMessage(conv, 'member.joined', req.user._id, [req.user._id]);

  const populated = await Conversation.findById(conv._id)
    .populate('participants.user', POPULATE_USER)
    .populate('lastMessage');

  res.json({ success: true, conversation: serialize(populated, req.user._id, req.user) });
});

export { postSystemMessage, loadConversation };
