'use client';

import { io } from 'socket.io-client';
import { API_ORIGIN, tokens } from './api';

let socket = null;
const pending = [];

export function getSocket() {
  return socket;
}

export function connectSocket(accessToken) {
  const token = accessToken || tokens.access;
  if (!token) return null;

  if (socket?.connected && socket.auth?.token === token) return socket;
  if (socket) socket.disconnect();

  socket = io(API_ORIGIN, {
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 600,
    reconnectionDelayMax: 6000,
    timeout: 12_000,
  });

  // Anything queued while offline goes out the moment we reconnect.
  socket.on('connect', () => {
    while (pending.length) {
      const { event, payload, ack } = pending.shift();
      socket.emit(event, payload, ack);
    }
  });

  return socket;
}

/** Connects without a session — used only by the QR device-link screen. */
export function connectLinkSocket(linkCode) {
  const linkSocket = io(API_ORIGIN, {
    auth: { linkCode },
    transports: ['websocket', 'polling'],
    reconnection: true,
  });
  return linkSocket;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
  pending.length = 0;
}

/** Emit that survives a dropped connection by queueing until reconnect. */
export function emit(event, payload, ack) {
  if (socket?.connected) {
    socket.emit(event, payload, ack);
    return true;
  }
  pending.push({ event, payload, ack });
  return false;
}

/** Promise-shaped emit for handlers that acknowledge. */
export function emitAsync(event, payload, timeoutMs = 12_000) {
  return new Promise((resolve, reject) => {
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('The server did not respond in time'));
    }, timeoutMs);

    const done = (res) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(res);
    };

    if (socket?.connected) socket.emit(event, payload, done);
    else pending.push({ event, payload, ack: done });
  });
}

/** Subscribe helper that returns its own unsubscribe. */
export function on(event, handler) {
  socket?.on(event, handler);
  return () => socket?.off(event, handler);
}
