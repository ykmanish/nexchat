import { AppState } from 'react-native';
import { io } from 'socket.io-client';
import { API_ORIGIN } from './config';
import { tokens } from './api';
import { report, trace } from './report';

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
    // Native has no same-origin problem and no proxy in the way, so the
    // websocket is tried first and polling is kept only as a fallback for
    // networks that block upgrades.
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 600,
    reconnectionDelayMax: 6000,
    timeout: 12_000,
  });

  socket.on('connect', () => {
    trace('socket:connect', { id: socket.id, queued: pending.length });
    reportVisibility();
    while (pending.length) {
      const { event, payload, ack } = pending.shift();
      socket.emit(event, payload, ack);
    }
  });

  /* A socket that never connects is the difference between "sending is slow"
     and "sending silently falls back to REST forever", and neither said so. */
  socket.on('connect_error', (err) => report('socket:connect_error', err));
  socket.on('disconnect', (reason) => trace('socket:disconnect', { reason }));

  watchVisibility();
  return socket;
}

/**
 * Tells the server whether the app is actually on screen.
 *
 * The server uses this to decide whether to send a push, and holding a socket
 * is not the same as being looked at — Android keeps the connection alive for a
 * while after the app is backgrounded, which on the web client meant the
 * message went over the socket into a frozen tab and no notification was sent.
 *
 * Native makes this far more trustworthy than the web version it replaces:
 * AppState is a real lifecycle signal rather than the Page Visibility API's
 * approximation, so there is no equivalent of the desktop tab that is
 * technically "visible" behind another window, and no need for the focus/blur
 * and pagehide patches the browser needed.
 */
let visibilityWatched = false;

const isAttentive = () => AppState.currentState === 'active';

function reportVisibility() {
  if (!socket?.connected) return;
  socket.emit('app:visibility', isAttentive() ? 'visible' : 'hidden');
}

function watchVisibility() {
  if (visibilityWatched) return;
  visibilityWatched = true;

  AppState.addEventListener('change', (state) => {
    if (!socket?.connected) return;
    socket.emit('app:visibility', state === 'active' ? 'visible' : 'hidden');
  });
}

/** Connects without a session — used only by the QR device-link screen. */
export function connectLinkSocket(linkCode) {
  return io(API_ORIGIN, {
    auth: { linkCode },
    transports: ['websocket', 'polling'],
    reconnection: true,
  });
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
