import { User } from '../models/User.js';

/** deviceId -> socketId, per user. Keeps presence accurate when a person is
 *  signed in on a phone and two browser tabs at once. */
const online = new Map(); // userId -> Map<deviceId, socketId>
const typing = new Map(); // conversationId -> Map<userId, timeoutHandle>

export const presence = {
  async add(userId, deviceId, socketId) {
    const key = String(userId);
    const wasOffline = !online.has(key) || online.get(key).size === 0;
    if (!online.has(key)) online.set(key, new Map());
    online.get(key).set(deviceId, socketId);
    if (wasOffline) {
      await User.findByIdAndUpdate(key, { presence: 'online', lastSeen: new Date() });
    }
    return wasOffline;
  },

  async remove(userId, deviceId) {
    const key = String(userId);
    const devices = online.get(key);
    if (!devices) return false;
    devices.delete(deviceId);
    if (devices.size === 0) {
      online.delete(key);
      await User.findByIdAndUpdate(key, { presence: 'offline', lastSeen: new Date() });
      return true; // went fully offline
    }
    return false;
  },

  isOnline: (userId) => (online.get(String(userId))?.size ?? 0) > 0,
  devicesOf: (userId) => [...(online.get(String(userId))?.keys() ?? [])],
  socketsOf: (userId) => [...(online.get(String(userId))?.values() ?? [])],
  onlineUserIds: () => [...online.keys()],

  setTyping(conversationId, userId, onExpire) {
    const cid = String(conversationId);
    if (!typing.has(cid)) typing.set(cid, new Map());
    const room = typing.get(cid);
    clearTimeout(room.get(String(userId)));
    room.set(
      String(userId),
      setTimeout(() => {
        room.delete(String(userId));
        onExpire?.();
      }, 6000)
    );
  },

  clearTyping(conversationId, userId) {
    const room = typing.get(String(conversationId));
    if (!room) return;
    clearTimeout(room.get(String(userId)));
    room.delete(String(userId));
  },

  typingIn: (conversationId) => [...(typing.get(String(conversationId))?.keys() ?? [])],

  async resetAll() {
    online.clear();
    await User.updateMany({ presence: 'online' }, { presence: 'offline' });
  },
};
