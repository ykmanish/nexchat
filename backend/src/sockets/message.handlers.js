import mongoose from 'mongoose';
import { Message, Conversation, User } from '../models/index.js';
import { createMessage, hydrate } from '../services/messaging.js';
import { logger } from '../utils/logger.js';

/** Socket is the fast path for sending — REST stays available as a fallback
 *  for clients that lost their websocket. Both funnel into createMessage. */
export function registerMessageHandlers(io, socket) {
  const { userId, deviceId } = socket.data;
  // arrayFilters are not cast by Mongoose, so compare against a real ObjectId.
  const uid = new mongoose.Types.ObjectId(userId);

  socket.on('message:send', async (payload, ack) => {
    try {
      const user = await User.findById(userId);
      const { message, duplicate } = await createMessage({
        user,
        deviceId,
        payload,
      });

      ack?.({
        success: true,
        duplicate,
        message: hydrate(message, userId),
        clientId: payload.clientId,
      });
    } catch (err) {
      logger.error('message:send — ' + err.message);
      ack?.({
        success: false,
        message: err.message,
        code: err.code || 'SEND_FAILED',
        clientId: payload?.clientId,
      });
    }
  });

  /** The recipient's device confirms it received the envelope. */
  socket.on('message:delivered', async ({ messageIds = [] }) => {
    if (!messageIds.length) return;
    const now = new Date();

    const result = await Message.updateMany(
      { _id: { $in: messageIds }, 'receipts.user': userId, 'receipts.deliveredAt': null },
      { $set: { 'receipts.$[slot].deliveredAt': now } },
      { arrayFilters: [{ 'slot.user': uid, 'slot.deliveredAt': null }] }
    ).catch(() => ({ modifiedCount: 0 }));

    if (!result.modifiedCount) return;

    const touched = await Message.find({ _id: { $in: messageIds } })
      .select('conversation sender')
      .lean();

    const bySender = new Map();
    touched.forEach((m) => {
      const key = String(m.sender);
      if (!bySender.has(key)) bySender.set(key, { conversationId: String(m.conversation), ids: [] });
      bySender.get(key).ids.push(String(m._id));
    });

    bySender.forEach((entry, senderId) => {
      io.to('user:' + senderId).emit('message:delivered', {
        conversationId: entry.conversationId,
        messageIds: entry.ids,
        userId,
        deliveredAt: now,
      });
    });
  });

  /** Opening a chat marks everything in it as read. */
  socket.on('message:read', async ({ conversationId, messageIds = [] }) => {
    if (!conversationId) return;

    const user = await User.findById(userId).select('privacy');
    if (!user?.privacy?.readReceipts) return;

    const now = new Date();
    const filter = {
      conversation: conversationId,
      sender: { $ne: userId },
      'receipts.user': userId,
      'receipts.readAt': null,
    };
    if (messageIds.length) filter._id = { $in: messageIds };

    const result = await Message.updateMany(
      filter,
      { $set: { 'receipts.$[slot].readAt': now, 'receipts.$[slot].deliveredAt': now } },
      { arrayFilters: [{ 'slot.user': uid }] }
    ).catch(() => ({ modifiedCount: 0 }));

    await Conversation.updateOne(
      { _id: conversationId, 'participants.user': userId },
      { $set: { 'participants.$.unreadCount': 0, 'participants.$.lastReadAt': now } }
    );

    if (result.modifiedCount) {
      socket.to('conversation:' + conversationId).emit('message:read', {
        conversationId,
        userId,
        messageIds,
        readAt: now,
      });
    }

    // Keep the badge in sync across this person's own devices.
    socket.to('user:' + userId).emit('conversation:read', { conversationId, readAt: now });
  });

  /** Voice notes report playback separately from read. */
  socket.on('message:played', async ({ messageId }) => {
    if (!messageId) return;
    const now = new Date();

    await Message.updateOne(
      { _id: messageId, 'receipts.user': userId },
      { $set: { 'receipts.$[slot].playedAt': now } },
      { arrayFilters: [{ 'slot.user': uid }] }
    ).catch(() => {});

    const msg = await Message.findById(messageId).select('sender conversation').lean();
    if (msg) {
      io.to('user:' + msg.sender).emit('message:played', {
        conversationId: String(msg.conversation),
        messageId,
        userId,
        playedAt: now,
      });
    }
  });

  /** Live reaction without a REST round-trip. */
  socket.on('message:react', async ({ messageId, emoji }, ack) => {
    try {
      const msg = await Message.findById(messageId);
      if (!msg) return ack?.({ success: false, message: 'Message not found' });

      const conv = await Conversation.findOne({ _id: msg.conversation, memberIds: userId });
      if (!conv) return ack?.({ success: false, message: 'Not allowed' });

      const mine = msg.reactions.find((r) => String(r.user) === String(userId));
      let action = 'added';

      if (mine && mine.emoji === emoji) {
        msg.reactions = msg.reactions.filter((r) => String(r.user) !== String(userId));
        action = 'removed';
      } else if (mine) {
        mine.emoji = emoji;
        mine.at = new Date();
        action = 'changed';
      } else {
        msg.reactions.push({ user: userId, emoji, at: new Date() });
      }
      await msg.save();

      const populated = await msg.populate('reactions.user', 'name avatar avatarColor');

      io.to('conversation:' + msg.conversation).emit('message:reaction', {
        conversationId: String(msg.conversation),
        messageId: String(msg._id),
        reactions: populated.reactions,
        action,
        by: userId,
        emoji,
      });

      ack?.({ success: true, action, reactions: populated.reactions });
    } catch (err) {
      ack?.({ success: false, message: err.message });
    }
  });

  /** Drafts follow you between phone and laptop. */
  socket.on('conversation:draft', async ({ conversationId, draft }) => {
    if (!conversationId) return;
    await Conversation.updateOne(
      { _id: conversationId, 'participants.user': userId },
      { $set: { 'participants.$.draft': String(draft || '').slice(0, 5000) } }
    ).catch(() => {});

    socket.to('user:' + userId).emit('conversation:draft', { conversationId, draft });
  });

  /** Lets a reconnecting client pull anything it missed while offline. */
  socket.on('sync:since', async ({ since }, ack) => {
    try {
      const cutoff = since ? new Date(since) : new Date(Date.now() - 60 * 60 * 1000);
      const convs = await Conversation.find({ memberIds: userId }).select('_id').lean();

      const messages = await Message.find({
        conversation: { $in: convs.map((c) => c._id) },
        createdAt: { $gt: cutoff },
        deletedFor: { $ne: userId },
      })
        .populate('sender', 'name username avatar avatarColor presence')
        .sort({ createdAt: 1 })
        .limit(500);

      ack?.({
        success: true,
        messages: messages.map((m) => hydrate(m, userId)),
        serverTime: new Date(),
      });
    } catch (err) {
      ack?.({ success: false, message: err.message });
    }
  });
}
