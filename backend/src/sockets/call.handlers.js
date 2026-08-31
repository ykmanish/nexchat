import { Call, CallLink, Conversation, Message, User } from '../models/index.js';
import { presence } from '../services/presence.js';
import { shortId } from '../utils/ids.js';
import { logger } from '../utils/logger.js';

/** WebRTC signalling only — audio and video travel peer-to-peer and never
 *  touch this server. */
export function registerCallHandlers(io, socket) {
  const { userId, deviceId } = socket.data;

  socket.on('call:start', async ({ conversationId, mode = 'audio' }, ack) => {
    try {
      const conv = await Conversation.findOne({ _id: conversationId, memberIds: userId }).populate(
        'participants.user',
        'name avatar avatarColor'
      );
      if (!conv) return ack?.({ success: false, message: 'Conversation not found' });

      const caller = await User.findById(userId).select('name avatar avatarColor');

      const callees = conv.participants.filter(
        (p) => !p.leftAt && String(p.user._id) !== String(userId)
      );

      /**
       * Nobody there is not the same as nobody answering.
       *
       * A `call:incoming` addressed to a user with no connected socket goes into
       * a room with nothing in it. The caller used to watch "Ringing…" for the
       * full forty-five seconds and then be told the call was missed — for a
       * phone that was never going to ring, because it was not on. Refusing up
       * front is both truthful and instant, and it is what the phone network
       * does: an unreachable number gets told so, not put through to a tone.
       *
       * Only when *no* callee is reachable. A group call rings whoever is there.
       */
      const reachable = callees.filter((p) => presence.isOnline(p.user._id));

      if (!reachable.length) {
        const who =
          conv.type === 'direct'
            ? callees[0]?.user?.name || 'They'
            : 'Nobody in ' + (conv.name || 'this group');

        // Logged as missed all the same, so the attempt is in the call history.
        const missedId = 'call_' + shortId();
        await logCall(io, conv, userId, missedId, mode, 'missed', 0);

        return ack?.({
          success: false,
          code: 'UNREACHABLE',
          message: who + (conv.type === 'direct' ? ' is offline right now.' : ' is online.'),
        });
      }

      const callId = 'call_' + shortId();

      await Call.create({
        callId,
        conversation: conv._id,
        initiator: userId,
        mode,
        status: 'ringing',
        participants: [{ user: userId, deviceId, joinedAt: new Date() }],
      });

      reachable.forEach((p) =>
        io.to('user:' + p.user._id).emit('call:incoming', {
          callId,
          conversationId: String(conv._id),
          mode,
          from: {
            id: userId,
            name: caller.name,
            avatar: caller.avatar,
            avatarColor: caller.avatarColor,
          },
          isGroup: conv.type !== 'direct',
          conversationName: conv.name,
        })
      );

      // Auto-miss if nobody picks up within 45 seconds.
      setTimeout(async () => {
        const call = await Call.findOne({ callId });
        if (call && call.status === 'ringing') {
          call.status = 'missed';
          call.endedAt = new Date();
          await call.save();
          io.to('conversation:' + conv._id).emit('call:ended', { callId, reason: 'missed' });
          await logCall(io, conv, userId, callId, mode, 'missed', 0);
        }
      }, 45000).unref?.();

      ack?.({ success: true, callId });
    } catch (err) {
      logger.error('call:start — ' + err.message);
      ack?.({ success: false, message: err.message });
    }
  });

  socket.on('call:accept', async ({ callId }, ack) => {
    const call = await Call.findOne({ callId });
    if (!call || call.status === 'ended') return ack?.({ success: false, message: 'Call is over' });

    call.status = 'active';
    call.answeredAt = call.answeredAt || new Date();
    if (!call.participants.some((p) => String(p.user) === String(userId))) {
      call.participants.push({ user: userId, deviceId, joinedAt: new Date() });
    }
    await call.save();

    socket.join('call:' + callId);
    io.to('conversation:' + call.conversation).emit('call:accepted', { callId, userId });
    ack?.({ success: true, callId, mode: call.mode });
  });

  socket.on('call:decline', async ({ callId }) => {
    const call = await Call.findOne({ callId });
    if (!call) return;

    call.status = 'declined';
    call.endedAt = new Date();
    await call.save();

    io.to('user:' + call.initiator).emit('call:declined', { callId, userId });

    const conv = await Conversation.findById(call.conversation);
    await logCall(io, conv, call.initiator, callId, call.mode, 'declined', 0);
  });

  socket.on('call:join', ({ callId }) => {
    socket.join('call:' + callId);
    socket.to('call:' + callId).emit('call:peer-joined', { callId, userId, deviceId });
  });

  /* ── raw WebRTC plumbing: offer / answer / ICE ── */

  socket.on('call:offer', ({ callId, to, sdp }) => {
    io.to('user:' + to).emit('call:offer', { callId, from: userId, sdp });
  });

  socket.on('call:answer', ({ callId, to, sdp }) => {
    io.to('user:' + to).emit('call:answer', { callId, from: userId, sdp });
  });

  socket.on('call:ice', ({ callId, to, candidate }) => {
    io.to('user:' + to).emit('call:ice', { callId, from: userId, candidate });
  });

  socket.on('call:media-state', ({ callId, muted, videoOff }) => {
    socket.to('call:' + callId).emit('call:media-state', { callId, userId, muted, videoOff });
  });

  /* ── screen sharing ──
     The screen travels as an ordinary extra track over the existing peer
     connection, so nothing here touches media. What the peers cannot work out
     for themselves is *which* incoming track is a screen and who is sharing, and
     that is all this announces. Kept separate from media-state because the UI
     reacts to it completely differently — a shared screen takes over the
     layout, a muted mic does not. */
  socket.on('call:screen-share', ({ callId, on }) => {
    socket.to('call:' + callId).emit('call:screen-share', {
      callId,
      userId,
      deviceId,
      on: !!on,
    });
  });

  /* ── link calls ──
     A call reached by link has no conversation to derive its room from, so the
     room is the link's code. Joining the callId room as well means every piece
     of signalling below can address peers the same way whether they arrived
     through a chat or through a URL. */
  socket.on('call:link-join', async ({ code }, ack) => {
    try {
      const link = await CallLink.findOne({ code: String(code || '').toUpperCase() });
      if (!link || !link.isLive()) {
        return ack?.({ success: false, message: 'That link is no longer valid' });
      }

      // The REST join is what admits someone; this only attaches their socket.
      // Without that check a leaked code would be a listening post on the room.
      const call = link.callId ? await Call.findOne({ callId: link.callId }) : null;
      const admitted = call?.participants?.some(
        (p) => String(p.user) === String(userId) && !p.leftAt
      );
      if (!admitted) return ack?.({ success: false, message: 'Join the call first' });

      socket.join('call:' + link.code);
      socket.join('call:' + link.callId);
      socket.to('call:' + link.code).emit('call:peer-joined', {
        callId: link.callId,
        userId,
        deviceId,
      });

      ack?.({ success: true, callId: link.callId, mode: link.mode });
    } catch (err) {
      logger.error('call:link-join — ' + err.message);
      ack?.({ success: false, message: err.message });
    }
  });

  socket.on('call:link-leave', async ({ code }) => {
    const link = await CallLink.findOne({ code: String(code || '').toUpperCase() });
    if (!link) return;

    socket.leave('call:' + link.code);
    if (link.callId) socket.leave('call:' + link.callId);

    socket.to('call:' + link.code).emit('call:peer-left', {
      callId: link.callId,
      userId,
      deviceId,
    });

    // The last one out ends the call, so the next joiner starts a fresh one
    // instead of walking into an empty room.
    if (link.callId) {
      const call = await Call.findOne({ callId: link.callId });
      if (!call) return;

      const mine = call.participants.find(
        (p) => String(p.user) === String(userId) && p.deviceId === deviceId && !p.leftAt
      );
      if (mine) mine.leftAt = new Date();

      if (!call.participants.some((p) => !p.leftAt)) {
        call.status = 'ended';
        call.endedAt = new Date();
        call.duration = call.answeredAt
          ? Math.round((Date.now() - call.answeredAt.getTime()) / 1000)
          : 0;
      }
      await call.save();
    }
  });

  socket.on('call:end', async ({ callId }) => {
    const call = await Call.findOne({ callId });
    if (!call || call.status === 'ended') return;

    const duration = call.answeredAt ? Math.round((Date.now() - call.answeredAt.getTime()) / 1000) : 0;

    call.status = 'ended';
    call.endedAt = new Date();
    call.duration = duration;
    await call.save();

    // Addressed both ways on purpose: a call reached by link has no
    // conversation room, and one reached from a chat has peers who may not have
    // joined the call room yet.
    const ended = { callId, reason: 'hangup', duration };
    if (call.conversation) io.to('conversation:' + call.conversation).emit('call:ended', ended);
    io.to('call:' + callId).emit('call:ended', ended);

    socket.leave('call:' + callId);

    const conv = await Conversation.findById(call.conversation);
    await logCall(io, conv, call.initiator, callId, call.mode, duration > 0 ? 'ended' : 'missed', duration);
  });
}

/** Drops a call record into the transcript so it shows up in history. */
/**
 * Ends calls that are still ringing at somebody who has just gone offline.
 *
 * The other half of refusing a call to an unreachable phone. Presence can drop
 * *during* the ring — the phone loses signal, the tab is closed, the battery
 * goes — and the caller was then left listening to a ringback for a device that
 * had stopped existing, until the forty-five-second timeout finally admitted it.
 *
 * Only when nobody left is reachable. A group call carries on ringing at whoever
 * is still there.
 */
export async function endCallsRingingAt(io, userId) {
  const ringing = await Call.find({ status: 'ringing' })
    .populate({ path: 'conversation', select: 'participants type name seq lastMessage' })
    .catch(() => []);

  for (const call of ringing) {
    const conv = call.conversation;
    if (!conv) continue;

    const callees = (conv.participants || []).filter(
      (p) => !p.leftAt && String(p.user) !== String(call.initiator)
    );
    if (!callees.some((p) => String(p.user) === String(userId))) continue;
    if (callees.some((p) => presence.isOnline(p.user))) continue;

    call.status = 'missed';
    call.endedAt = new Date();
    await call.save().catch(() => {});

    io.to('conversation:' + conv._id).emit('call:ended', {
      callId: call.callId,
      reason: 'unreachable',
    });
  }
}

async function logCall(io, conv, initiatorId, callId, mode, status, duration) {
  if (!conv) return;

  conv.seq += 1;
  const msg = await Message.create({
    conversation: conv._id,
    sender: initiatorId,
    clientId: 'call_' + callId,
    seq: conv.seq,
    type: 'call',
    call: { callId, mode, status, duration },
  }).catch(() => null);

  if (!msg) return;

  conv.lastMessage = msg._id;
  conv.lastMessageAt = new Date();
  await conv.save();

  const populated = await msg.populate('sender', 'name avatar avatarColor');
  io.to('conversation:' + conv._id).emit('message:new', {
    conversationId: String(conv._id),
    message: populated.toJSON(),
  });
}
