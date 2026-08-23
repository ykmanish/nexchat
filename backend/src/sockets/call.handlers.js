import { Call, Conversation, Message, User } from '../models/index.js';
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

      const callId = 'call_' + shortId();
      const caller = await User.findById(userId).select('name avatar avatarColor');

      await Call.create({
        callId,
        conversation: conv._id,
        initiator: userId,
        mode,
        status: 'ringing',
        participants: [{ user: userId, deviceId, joinedAt: new Date() }],
      });

      const callees = conv.participants.filter(
        (p) => !p.leftAt && String(p.user._id) !== String(userId)
      );

      callees.forEach((p) =>
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

  socket.on('call:end', async ({ callId }) => {
    const call = await Call.findOne({ callId });
    if (!call || call.status === 'ended') return;

    const duration = call.answeredAt ? Math.round((Date.now() - call.answeredAt.getTime()) / 1000) : 0;

    call.status = 'ended';
    call.endedAt = new Date();
    call.duration = duration;
    await call.save();

    io.to('conversation:' + call.conversation).emit('call:ended', {
      callId,
      reason: 'hangup',
      duration,
    });

    socket.leave('call:' + callId);

    const conv = await Conversation.findById(call.conversation);
    await logCall(io, conv, call.initiator, callId, call.mode, duration > 0 ? 'ended' : 'missed', duration);
  });
}

/** Drops a call record into the transcript so it shows up in history. */
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
