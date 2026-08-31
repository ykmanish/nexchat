import { Server } from 'socket.io';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { verifyAccessToken } from '../services/token.js';
import { presence } from '../services/presence.js';
import { User, Device, Conversation } from '../models/index.js';
import { pushTyping } from '../services/push.js';
import { setIO } from './io.js';
import { registerMessageHandlers } from './message.handlers.js';
import { registerCallHandlers } from './call.handlers.js';

export function initSockets(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: env.clientUrl.split(',').map((s) => s.trim()),
      credentials: true,
    },
    maxHttpBufferSize: 12e6,
    /* How fast a vanished device stops counting as connected.
       The defaults let a dead socket linger for up to 45 seconds, and a
       lingering socket is a device presence still believes is watching the
       screen — so every message in that window skipped its push and the
       notification never came. Halving it roughly halves the worst case, and
       two small frames every ten seconds is a price worth paying for that. */
    pingTimeout: 10000,
    pingInterval: 10000,
    transports: ['websocket', 'polling'],
  });

  setIO(io);

  /* ─── handshake: everything past this point is an authenticated device ─── */
  io.use(async (socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        socket.handshake.headers?.authorization?.replace('Bearer ', '');

      // The device-linking screen connects before it has a session — it may
      // only join its own link room and receive nothing else.
      if (!token && socket.handshake.auth?.linkCode) {
        socket.data.linkOnly = true;
        socket.data.linkCode = String(socket.handshake.auth.linkCode).toUpperCase();
        return next();
      }

      if (!token) return next(new Error('UNAUTHENTICATED'));

      const decoded = verifyAccessToken(token);
      const [user, device] = await Promise.all([
        User.findById(decoded.sub).select('name avatar avatarColor privacy blocked contacts'),
        Device.findOne({ deviceId: decoded.did, revokedAt: null }).select('deviceId'),
      ]);

      if (!user) return next(new Error('UNAUTHENTICATED'));
      if (!device) return next(new Error('DEVICE_REVOKED'));

      socket.data.userId = String(user._id);
      socket.data.deviceId = decoded.did;
      socket.data.user = user;
      next();
    } catch (err) {
      next(new Error(err.name === 'TokenExpiredError' ? 'TOKEN_EXPIRED' : 'UNAUTHENTICATED'));
    }
  });

  io.on('connection', async (socket) => {
    /* ── link-only sockets: the QR screen waiting to be approved ── */
    if (socket.data.linkOnly) {
      socket.join('link:' + socket.data.linkCode);
      logger.socket('link session ' + socket.data.linkCode + ' waiting');
      socket.on('disconnect', () => socket.leave('link:' + socket.data.linkCode));
      return;
    }

    const { userId, deviceId } = socket.data;

    socket.join('user:' + userId);
    socket.join('device:' + deviceId);

    const conversations = await Conversation.find({ memberIds: userId }).select('_id').lean();
    conversations.forEach((c) => socket.join('conversation:' + c._id));

    const cameOnline = await presence.add(userId, deviceId, socket.id);
    // Connecting is something a page in the foreground does. Anything else
    // arrives as an explicit app:visibility.
    presence.setForeground(deviceId, true);
    logger.socket('connected ' + socket.data.user.name + ' (' + deviceId + ')');

    if (cameOnline) {
      conversations.forEach((c) =>
        socket.to('conversation:' + c._id).emit('presence:update', {
          userId,
          presence: 'online',
          lastSeen: new Date(),
        })
      );
    }

    socket.emit('ready', {
      userId,
      deviceId,
      conversations: conversations.map((c) => String(c._id)),
      onlineUsers: presence.onlineUserIds(),
      serverTime: new Date(),
    });

    /**
     * The client saying whether it is on screen.
     *
     * Everything about push delivery hangs off this. A connected socket used to
     * be taken as proof the message had been seen, but a backgrounded tab holds
     * its socket while the browser freezes its JavaScript — so the "delivered"
     * message was rendered by nobody and no push was sent. The client now
     * reports `visibilitychange`, and a hidden device is pushed to like a
     * disconnected one.
     *
     * A device that never sends this counts as foreground, so an older client
     * behaves exactly as it did before.
     */
    socket.on('app:visibility', (state) => {
      const visible = state === true || state === 'visible';
      presence.setForeground(deviceId, visible);
    });

    /* ── rooms ── */
    socket.on('conversation:join', (conversationId) => {
      if (conversationId) socket.join('conversation:' + conversationId);
    });

    socket.on('conversation:leave', (conversationId) => {
      if (conversationId) socket.leave('conversation:' + conversationId);
    });

    /* ── typing ── */
    socket.on('typing:start', async ({ conversationId }) => {
      if (!conversationId) return;
      if (socket.data.user.privacy?.typingIndicator === false) return;

      presence.setTyping(conversationId, userId, () => {
        io.to('conversation:' + conversationId).emit('typing:stop', { conversationId, userId });
      });

      socket.to('conversation:' + conversationId).emit('typing:start', {
        conversationId,
        userId,
        name: socket.data.user.name,
      });

      // Anyone without a live socket cannot see the indicator, so nudge them.
      Conversation.findOne({ _id: conversationId, memberIds: userId })
        .then((conv) => {
          if (!conv) return null;
          const others = conv.participants
            .filter((p) => !p.leftAt && String(p.user) !== String(userId))
            .map((p) => ({ userId: p.user }));
          return pushTyping({ conversation: conv, sender: socket.data.user, recipients: others });
        })
        .catch(() => {});
    });

    socket.on('typing:stop', ({ conversationId }) => {
      if (!conversationId) return;
      presence.clearTyping(conversationId, userId);
      socket.to('conversation:' + conversationId).emit('typing:stop', { conversationId, userId });
    });

    socket.on('recording:start', ({ conversationId }) => {
      if (!conversationId) return;
      socket.to('conversation:' + conversationId).emit('recording:start', {
        conversationId,
        userId,
        name: socket.data.user.name,
      });
    });

    socket.on('recording:stop', ({ conversationId }) => {
      if (!conversationId) return;
      socket.to('conversation:' + conversationId).emit('recording:stop', { conversationId, userId });
    });

    /* ── presence queries ── */
    socket.on('presence:check', (userIds, ack) => {
      const map = {};
      (userIds || []).forEach((id) => {
        map[id] = presence.isOnline(id);
      });
      ack?.(map);
    });

    registerMessageHandlers(io, socket);
    registerCallHandlers(io, socket);

    /* ── teardown ── */
    socket.on('disconnect', async (reason) => {
      const wentOffline = await presence.remove(userId, deviceId);
      logger.socket('disconnected ' + socket.data.user.name + ' (' + reason + ')');

      if (wentOffline) {
        const convs = await Conversation.find({ memberIds: userId }).select('_id').lean();
        convs.forEach((c) =>
          io.to('conversation:' + c._id).emit('presence:update', {
            userId,
            presence: 'offline',
            lastSeen: new Date(),
          })
        );
      }
    });
  });

  return io;
}
