import mongoose from 'mongoose';
import { CallLink, Call, Conversation } from '../models/index.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { linkCode, shortId } from '../utils/ids.js';
import { getIO } from '../sockets/io.js';
import { env } from '../config/env.js';

/**
 * Call links.
 *
 * Ringing someone normally requires a shared conversation, which is the right
 * default and useless for the case this solves: handing a joinable address to
 * somebody you have no chat with. The link *is* the permission, so it is
 * revocable, expiring and capped, and the host can make people wait to be let
 * in. A code alone is not identity — everyone still has to be signed in to use
 * one, so a leaked link cannot be used anonymously.
 */

const DEFAULT_TTL_HOURS = 24;

const publicUrl = (code) => {
  const base = env.clientUrl.split(',')[0].trim().replace(/\/+$/, '');
  return base + '/call/' + code;
};

const serialize = (link, { host = null } = {}) => ({
  code: link.code,
  url: publicUrl(link.code),
  name: link.name,
  mode: link.mode,
  callId: link.callId,
  approvalRequired: link.approvalRequired,
  maxParticipants: link.maxParticipants,
  conversationId: link.conversation ? String(link.conversation) : null,
  expiresAt: link.expiresAt,
  revokedAt: link.revokedAt,
  live: link.isLive(),
  joinCount: link.joinCount,
  createdAt: link.createdAt,
  host: host || null,
});

/* ─────────────────────────────── creating ─────────────────────────────── */

export const createLink = asyncHandler(async (req, res) => {
  const {
    name = null,
    mode = 'video',
    conversationId = null,
    approvalRequired = false,
    maxParticipants = 16,
    expiresInHours = DEFAULT_TTL_HOURS,
  } = req.body;

  // A link anchored to a chat has to be one the creator is actually in,
  // otherwise it would be a way to inject a call into someone else's group.
  let conversation = null;
  if (conversationId) {
    if (!mongoose.isValidObjectId(conversationId)) {
      throw ApiError.badRequest('Bad conversation id', 'BAD_ID');
    }
    conversation = await Conversation.findOne({
      _id: conversationId,
      memberIds: req.user._id,
    }).select('_id');
    if (!conversation) throw ApiError.notFound('Conversation not found', 'NO_CONVERSATION');
  }

  const link = await CallLink.create({
    code: linkCode(),
    createdBy: req.user._id,
    conversation: conversation?._id || null,
    name: name ? String(name).trim().slice(0, 80) : null,
    mode: mode === 'audio' ? 'audio' : 'video',
    approvalRequired: !!approvalRequired,
    maxParticipants,
    expiresAt:
      expiresInHours === null
        ? null
        : new Date(Date.now() + Math.min(Math.max(expiresInHours, 1), 720) * 3600 * 1000),
  });

  res.status(201).json({
    success: true,
    link: serialize(link, { host: { _id: req.user._id, name: req.user.name } }),
  });
});

export const listLinks = asyncHandler(async (req, res) => {
  const links = await CallLink.find({ createdBy: req.user._id, revokedAt: null }).sort({
    createdAt: -1,
  });
  res.json({ success: true, links: links.map((l) => serialize(l)) });
});

export const revokeLink = asyncHandler(async (req, res) => {
  const link = await CallLink.findOne({ code: req.params.code, createdBy: req.user._id });
  if (!link) throw ApiError.notFound('Link not found', 'NO_LINK');

  link.revokedAt = new Date();
  await link.save();

  // Anyone sitting in the call room should be told the door has closed.
  getIO()?.to('call:' + link.code).emit('call:link-revoked', { code: link.code });

  res.json({ success: true });
});

/* ─────────────────────────────── joining ─────────────────────────────── */

/**
 * What is behind the code, before committing to joining it. Deliberately thin:
 * a link is guessable enough that this should not describe the host's contacts
 * or the chat it came from.
 */
export const inspectLink = asyncHandler(async (req, res) => {
  const link = await CallLink.findOne({ code: String(req.params.code || '').toUpperCase() })
    .populate('createdBy', 'name avatar avatarColor');
  if (!link) throw ApiError.notFound('That link is not valid', 'NO_LINK');

  if (!link.isLive()) {
    return res.json({
      success: true,
      link: { code: link.code, live: false, name: link.name, mode: link.mode },
      reason: link.revokedAt ? 'revoked' : 'expired',
    });
  }

  const participants = link.callId
    ? await Call.findOne({ callId: link.callId }).select('participants status')
    : null;
  const active = (participants?.participants || []).filter((p) => !p.leftAt).length;

  res.json({
    success: true,
    link: {
      code: link.code,
      live: true,
      name: link.name,
      mode: link.mode,
      approvalRequired: link.approvalRequired,
      maxParticipants: link.maxParticipants,
      activeCount: active,
      full: active >= link.maxParticipants,
      host: {
        name: link.createdBy?.name || 'Someone',
        avatar: link.createdBy?.avatar || null,
        avatarColor: link.createdBy?.avatarColor || '#21C063',
      },
    },
  });
});

/**
 * Claims a place in the call. The first person through starts it; everyone after
 * joins the one already running, which is why the callId lives on the link
 * rather than being minted per join.
 */
export const joinLink = asyncHandler(async (req, res) => {
  const link = await CallLink.findOne({ code: String(req.params.code || '').toUpperCase() });
  if (!link) throw ApiError.notFound('That link is not valid', 'NO_LINK');
  if (!link.isLive()) {
    throw ApiError.forbidden(
      link.revokedAt ? 'That link was turned off' : 'That link has expired',
      'LINK_DEAD'
    );
  }

  const isHost = String(link.createdBy) === String(req.user._id);
  let call = link.callId ? await Call.findOne({ callId: link.callId }) : null;

  // A call that has already ended leaves a stale id on the link; the next
  // person to arrive should start a fresh one rather than join a corpse.
  if (call && call.status === 'ended') call = null;

  if (!call) {
    call = await Call.create({
      callId: 'call_' + shortId(),
      conversation: link.conversation || null,
      initiator: link.createdBy,
      mode: link.mode,
      status: 'active',
      participants: [{ user: req.user._id, deviceId: req.deviceId, joinedAt: new Date() }],
      startedAt: new Date(),
      answeredAt: new Date(),
    });
    link.callId = call.callId;
  } else {
    const active = call.participants.filter((p) => !p.leftAt);
    if (active.length >= link.maxParticipants) {
      throw ApiError.forbidden('That call is full', 'CALL_FULL');
    }

    const mine = call.participants.find(
      (p) => String(p.user) === String(req.user._id) && p.deviceId === req.deviceId
    );
    if (mine) {
      mine.leftAt = null;
      mine.joinedAt = new Date();
    } else {
      call.participants.push({
        user: req.user._id,
        deviceId: req.deviceId,
        joinedAt: new Date(),
      });
    }
    await call.save();
  }

  link.joinCount += 1;
  link.lastJoinedAt = new Date();
  await link.save();

  // Guests wait in the lobby; the host is told someone is knocking. The room is
  // keyed by code so people with no shared conversation can still be signalled.
  const pending = link.approvalRequired && !isHost;

  const io = getIO();
  if (pending) {
    io?.to('user:' + link.createdBy).emit('call:knock', {
      code: link.code,
      callId: call.callId,
      from: {
        _id: req.user._id,
        name: req.user.name,
        avatar: req.user.avatar,
        avatarColor: req.user.avatarColor,
      },
    });
  } else {
    io?.to('call:' + link.code).emit('call:participant-joined', {
      code: link.code,
      callId: call.callId,
      user: {
        _id: req.user._id,
        name: req.user.name,
        avatar: req.user.avatar,
        avatarColor: req.user.avatarColor,
      },
      deviceId: req.deviceId,
    });
  }

  res.json({
    success: true,
    callId: call.callId,
    mode: link.mode,
    room: 'call:' + link.code,
    pending,
    isHost,
    conversationId: link.conversation ? String(link.conversation) : null,
    participants: call.participants
      .filter((p) => !p.leftAt)
      .map((p) => ({ user: String(p.user), deviceId: p.deviceId })),
  });
});

/** The host letting a waiting guest in, or turning them away. */
export const decideKnock = asyncHandler(async (req, res) => {
  const link = await CallLink.findOne({
    code: String(req.params.code || '').toUpperCase(),
    createdBy: req.user._id,
  });
  if (!link) throw ApiError.notFound('Link not found', 'NO_LINK');

  const { userId, allow } = req.body;
  if (!mongoose.isValidObjectId(userId)) throw ApiError.badRequest('Bad user id', 'BAD_ID');

  getIO()?.to('user:' + userId).emit('call:knock-answered', {
    code: link.code,
    callId: link.callId,
    allowed: !!allow,
  });

  if (!allow) {
    await Call.updateOne(
      { callId: link.callId, 'participants.user': userId },
      { $set: { 'participants.$[slot].leftAt': new Date() } },
      { arrayFilters: [{ 'slot.user': new mongoose.Types.ObjectId(userId), 'slot.leftAt': null }] }
    ).catch(() => {});
  }

  res.json({ success: true });
});
