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
    reportVisibility();
    while (pending.length) {
      const { event, payload, ack } = pending.shift();
      socket.emit(event, payload, ack);
    }
  });

  watchVisibility();
  return socket;
}

/**
 * Tells the server whether this tab is on screen.
 *
 * The server decides whether to send a push from this. Holding a socket is not
 * the same as being looked at: a phone with the app in the background keeps its
 * websocket for as long as the OS allows, so it counted as connected, the
 * message went over the socket into a frozen tab that drew nothing, and no
 * notification was sent. Saying "I am hidden" is what makes the push arrive.
 *
 * `pagehide` is included because iOS does not reliably fire `visibilitychange`
 * when an app is swiped away, and a device stuck in a phantom foreground state
 * is one that silently stops notifying.
 */
let visibilityWatched = false;

/**
 * Focus counts, not just visibility.
 *
 * A desktop tab that is open behind another window is `visible` as far as the
 * Page Visibility API is concerned, and treating that as "being read" is why a
 * message arriving while you were in another app produced nothing at all. If
 * the window does not have focus, nobody is reading it, and a notification is
 * exactly right.
 */
const isAttentive = () =>
  typeof document !== 'undefined' &&
  document.visibilityState === 'visible' &&
  (typeof document.hasFocus !== 'function' || document.hasFocus());

function reportVisibility() {
  if (typeof document === 'undefined' || !socket?.connected) return;
  socket.emit('app:visibility', isAttentive() ? 'visible' : 'hidden');
}

/**
 * Restates "I am on screen" on a timer.
 *
 * The server treats attentiveness as something that expires, because the
 * alternative is worse: a device that is force-quit, loses signal, or has its
 * tab frozen never gets to say it went away, so it counted as watching the
 * screen — and every message skipped its push — until the socket finally timed
 * out. A heartbeat turns "did it tell us it left" into "is it still telling us
 * it is here", which is the question that has an answer when a device
 * disappears without warning.
 *
 * Sent only while the page is genuinely being looked at, so a hidden tab stops
 * the beat by doing nothing rather than by having to report anything. Well
 * inside the server's window, so an ordinary late tick never demotes a device
 * somebody is reading.
 */
const ATTENTION_BEAT_MS = 20_000;
let beat = null;

function startAttentionBeat() {
  clearInterval(beat);
  beat = setInterval(() => {
    if (socket?.connected && isAttentive()) socket.emit('app:visibility', 'visible');
  }, ATTENTION_BEAT_MS);
}

function watchVisibility() {
  if (visibilityWatched || typeof document === 'undefined') return;
  visibilityWatched = true;

  document.addEventListener('visibilitychange', reportVisibility);
  window.addEventListener('pagehide', () => {
    if (socket?.connected) socket.emit('app:visibility', 'hidden');
  });
  window.addEventListener('focus', reportVisibility);
  window.addEventListener('blur', reportVisibility);

  startAttentionBeat();
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
  clearInterval(beat);
  beat = null;
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
