import { User } from '../models/User.js';

/** deviceId -> socketId, per user. Keeps presence accurate when a person is
 *  signed in on a phone and two browser tabs at once. */
const online = new Map(); // userId -> Map<deviceId, socketId>
const typing = new Map(); // conversationId -> Map<userId, timeoutHandle>

/**
 * Devices whose tab is hidden right now.
 *
 * Holding a socket is not the same as looking at the screen, and conflating the
 * two is why notifications did not arrive. A phone with the app in the
 * background keeps its websocket alive for as long as the OS allows, so the
 * server saw a connected device, decided the message had already been delivered
 * over the socket, and sent no push — while the browser had frozen the tab and
 * drawn nothing. The message was there the moment you opened the app, which is
 * exactly what "notifications are not coming" looks like from the outside.
 *
 * So the client says when it goes away, and a backgrounded device is pushed to
 * like any other. A device that never reports either way is treated as
 * foreground, which keeps older clients behaving as before.
 */
const backgrounded = new Set(); // deviceId

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
    backgrounded.delete(deviceId);
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

  setForeground(deviceId, isForeground) {
    if (isForeground) backgrounded.delete(String(deviceId));
    else backgrounded.add(String(deviceId));
  },

  isForeground: (deviceId) => !backgrounded.has(String(deviceId)),

  /** Connected devices that are actually on screen — the ones a push would
   *  duplicate. Everything else is a push target. */
  attentiveDevicesOf: (userId) =>
    [...(online.get(String(userId))?.keys() ?? [])].filter((d) => !backgrounded.has(d)),

  /** Whether this user has any device that would show the message right now. */
  hasAttentiveDevice: (userId) =>
    [...(online.get(String(userId))?.keys() ?? [])].some((d) => !backgrounded.has(d)),

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
    backgrounded.clear();
    await User.updateMany({ presence: 'online' }, { presence: 'offline' });
  },
};
