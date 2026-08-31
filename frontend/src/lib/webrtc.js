'use client';

import { api } from './api';
import { emit, getSocket } from './socket';

/**
 * The media half of a call.
 *
 * Pulled out of the overlay because the bugs were all in the *ordering*, and
 * ordering is impossible to see when it is tangled up with rendering. Each of
 * these was silent — the call simply did not work, and nothing said why:
 *
 *   - Signalling listeners were attached *after* `await getUserMedia`. That
 *     await includes the permission prompt, so anything from a second to
 *     forever. An offer arriving in that window hit no listener and was gone,
 *     and the call never connected. Listeners are now registered before any
 *     await, and offers that arrive before the connection exists are held.
 *
 *   - ICE candidates that arrived before the remote description were caught and
 *     dropped with a shrug. On a fast local network that is harmless; across
 *     the internet the useful candidates are exactly the early ones. They are
 *     queued and applied once there is something to apply them to.
 *
 *   - The remote stream was assigned straight onto a DOM ref from the track
 *     event. If React had not painted that element yet the ref was null and the
 *     stream was thrown away for the rest of the call. It is handed to the
 *     caller as data now, and the component attaches it when it is ready.
 *
 *   - Nothing watched the connection state, so a failed ICE negotiation looked
 *     exactly like a call that was still connecting, forever.
 */

/**
 * A TURN server is not optional in practice.
 *
 * STUN only tells a peer its own public address; it cannot get packets through
 * a symmetric NAT, which is what most mobile carriers use. Without a relay a
 * meaningful share of calls between two phones on mobile data simply never
 * connect — and they fail by hanging in "connecting", which is exactly what
 * "calls don't work" looks like. The public STUN servers below are enough for
 * two devices on the same wifi and not much else.
 */
const STUN = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

/* Cached because the credential is valid for hours, not for one call, and
   because the answer is needed at the exact moment nobody wants to wait for a
   round-trip. Refetched once it is inside its last few minutes. */
let cached = null;
let inflight = null;
const EARLY_MS = 5 * 60_000;

const fresh = () =>
  cached && Date.now() < cached.until - EARLY_MS ? cached : null;

/**
 * Asks the server for a relay and a credential to use it with.
 *
 * The credential is minted per request and expires, so it lives here rather
 * than in the bundle. `NEXT_PUBLIC_TURN_*` is still honoured for a relay whose
 * credentials are genuinely static — a hosted plan on a free tier, say — but
 * anything in those variables is readable by anyone who loads the page, so the
 * server route is the one to prefer.
 */
export async function iceServers() {
  const hit = fresh();
  if (hit) return hit.servers;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const { data } = await api.get('/calls/ice');
      const servers = data?.iceServers?.length ? data.iceServers : STUN;
      cached = {
        servers,
        relay: !!data?.relay,
        until: Date.now() + (data?.expiresIn || 3600) * 1000,
      };
      return servers;
    } catch {
      /* A relay we cannot ask about is not a reason to abandon the call — most
         calls do not need one. Fall back to whatever is in the bundle, then to
         plain STUN, and let the connection state report the truth. */
      const envUrl = process.env.NEXT_PUBLIC_TURN_URL;
      const servers = [...STUN];
      if (envUrl) {
        servers.push({
          urls: envUrl.split(',').map((u) => u.trim()).filter(Boolean),
          username: process.env.NEXT_PUBLIC_TURN_USERNAME || undefined,
          credential: process.env.NEXT_PUBLIC_TURN_CREDENTIAL || undefined,
        });
      }
      cached = { servers, relay: !!envUrl, until: Date.now() + 60_000 };
      return servers;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

/**
 * Whether a relay is available, so the failure screen can name the reason.
 *
 * Answers from the last fetch rather than asking, because it is read while
 * rendering. Before the first call it assumes a relay exists — claiming one is
 * missing on no evidence would be worse than saying nothing.
 */
export const hasTurn = () => (cached ? cached.relay : true);

export const CALL_STATES = {
  connecting: 'connecting',
  connected: 'connected',
  reconnecting: 'reconnecting',
  failed: 'failed',
  closed: 'closed',
};

/**
 * Starts a call and returns the handles the UI needs.
 *
 * `onRemoteStream` and `onState` are how everything reaches React. Nothing in
 * here touches the DOM — that was the source of the dropped-stream bug.
 */
export function startCall({
  callId,
  peerId,
  isVideo,
  isCaller,
  onRemoteStream,
  onState,
  onPeerMedia,
  onPeerSharing,
}) {
  const socket = getSocket();
  let pc = null;
  let localStream = null;
  let videoSender = null;
  let closed = false;

  /* Anything that arrives before the connection is ready waits here rather
     than being dropped. This is the whole fix for a call that never connects
     because the offer beat the microphone prompt. */
  const pendingOffers = [];
  const pendingCandidates = [];
  const pendingAnswers = [];

  const state = (s) => !closed && onState?.(s);

  /* ── signalling, registered before anything can await ── */

  const onOffer = async ({ sdp, from }) => {
    if (!pc) return pendingOffers.push({ sdp, from });
    await applyOffer(sdp, from);
  };

  const onAnswer = async ({ sdp }) => {
    if (!pc) return pendingAnswers.push({ sdp });
    await applyAnswer(sdp);
  };

  const onIce = async ({ candidate }) => {
    if (!candidate) return;
    if (!pc || !pc.remoteDescription) return pendingCandidates.push(candidate);
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch {
      /* A candidate for a description that has since been replaced. Harmless. */
    }
  };

  const onMediaState = (payload) => onPeerMedia?.(payload);
  const onSharing = ({ on }) => onPeerSharing?.(!!on);

  socket?.on('call:offer', onOffer);
  socket?.on('call:answer', onAnswer);
  socket?.on('call:ice', onIce);
  socket?.on('call:media-state', onMediaState);
  socket?.on('call:screen-share', onSharing);

  /* ── description handling ── */

  async function drainCandidates() {
    while (pendingCandidates.length) {
      const candidate = pendingCandidates.shift();
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch {
        /* as above */
      }
    }
  }

  async function applyOffer(sdp, from) {
    /* Rollback rather than refusing.
       Both sides can offer at once — a screen share starting exactly as the
       other person's renegotiation lands. The polite peer (the callee) gives
       way instead of both sides deadlocking in have-local-offer. */
    const collision = pc.signalingState !== 'stable';
    if (collision) {
      if (isCaller) return; // impolite: ignore and let ours stand
      await Promise.all([
        pc.setLocalDescription({ type: 'rollback' }).catch(() => {}),
        pc.setRemoteDescription(new RTCSessionDescription(sdp)),
      ]);
    } else {
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    }

    await drainCandidates();
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    emit('call:answer', { callId, to: from || peerId, sdp: answer });
  }

  async function applyAnswer(sdp) {
    if (pc.signalingState === 'stable') return;
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    await drainCandidates();
  }

  /* ── bring up the media and the connection ── */

  const ready = (async () => {
    state(CALL_STATES.connecting);

    /* Started, not awaited: it overlaps the microphone prompt, which is the
       slowest thing here by a wide margin, so asking for a relay costs nothing
       in call setup time. */
    const ice = iceServers();

    localStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: isVideo ? { facingMode: 'user', width: { ideal: 1280 } } : false,
    });

    if (closed) {
      localStream.getTracks().forEach((t) => t.stop());
      return null;
    }

    pc = new RTCPeerConnection({
      iceServers: await ice,
      /* A few candidates are gathered before the first one is reported, which
         shortens the handshake noticeably on a good network. */
      iceCandidatePoolSize: 4,
    });

    localStream.getTracks().forEach((track) => {
      const sender = pc.addTrack(track, localStream);
      if (track.kind === 'video') videoSender = sender;
    });

    /* The remote stream goes out as data. The old code assigned it straight to
       a DOM ref, which was null whenever the track beat React to the paint —
       and the stream was then lost for the rest of the call. */
    pc.ontrack = (e) => {
      const stream = e.streams[0];
      if (stream) onRemoteStream?.(stream);
    };

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        emit('call:ice', { callId, to: peerId, candidate: e.candidate });
      }
    };

    /**
     * Something to watch, so a dead call stops looking like a slow one.
     *
     * `disconnected` is often temporary — a wifi-to-cellular handover recovers
     * on its own within a few seconds — so it reports as reconnecting rather
     * than failed. `failed` means ICE has given up, and the one thing worth
     * trying is a restart, which re-gathers candidates and can pick up a relay
     * that was not reachable a moment ago.
     */
    pc.onconnectionstatechange = () => {
      if (closed || !pc) return;
      switch (pc.connectionState) {
        case 'connected':
          state(CALL_STATES.connected);
          break;
        case 'disconnected':
          state(CALL_STATES.reconnecting);
          break;
        case 'failed':
          state(CALL_STATES.failed);
          restartIce();
          break;
        case 'closed':
          state(CALL_STATES.closed);
          break;
        default:
          break;
      }
    };

    /* Renegotiation, for anything that changes the tracks after the fact —
       a screen share on an audio call being the real case. */
    pc.onnegotiationneeded = async () => {
      if (closed || !pc || pc.signalingState !== 'stable') return;
      try {
        const offer = await pc.createOffer();
        if (pc.signalingState !== 'stable') return;
        await pc.setLocalDescription(offer);
        emit('call:offer', { callId, to: peerId, sdp: offer });
      } catch {
        /* A failed renegotiation leaves the existing call up, which is right. */
      }
    };

    // Anything that arrived while the microphone prompt was open.
    while (pendingOffers.length) {
      const { sdp, from } = pendingOffers.shift();
      await applyOffer(sdp, from);
    }
    while (pendingAnswers.length) {
      await applyAnswer(pendingAnswers.shift().sdp);
    }
    await drainCandidates();

    // The caller drives the first handshake; the callee answers the offer.
    if (isCaller && pc.signalingState === 'stable') {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      emit('call:offer', { callId, to: peerId, sdp: offer });
    }

    emit('call:join', { callId });
    return localStream;
  })();

  async function restartIce() {
    if (closed || !pc || !isCaller) return;
    try {
      const offer = await pc.createOffer({ iceRestart: true });
      await pc.setLocalDescription(offer);
      emit('call:offer', { callId, to: peerId, sdp: offer });
      state(CALL_STATES.reconnecting);
    } catch {
      /* Nothing more to try from here. */
    }
  }

  /* ── what the UI can do to a live call ── */

  return {
    ready,

    localStream: () => localStream,

    /** Returns the new muted state. */
    setMuted(muted) {
      localStream?.getAudioTracks().forEach((t) => {
        t.enabled = !muted;
      });
      emit('call:media-state', { callId, muted, videoOff: undefined });
      return muted;
    },

    setCameraOff(off) {
      localStream?.getVideoTracks().forEach((t) => {
        t.enabled = !off;
      });
      emit('call:media-state', { callId, muted: undefined, videoOff: off });
      return off;
    },

    /**
     * Swaps what the existing video sender carries.
     *
     * `replaceTrack` needs no new offer, which is why a screen share on a video
     * call is instant. An audio call has no video sender, so one is added — and
     * that path does need a renegotiation, which `onnegotiationneeded` handles.
     */
    async setVideoTrack(track) {
      if (!pc) return;
      if (videoSender) {
        await videoSender.replaceTrack(track);
      } else if (track) {
        videoSender = pc.addTrack(track, localStream || new MediaStream([track]));
      }
    },

    videoSender: () => videoSender,

    /** Round-trip time and packet loss, for the quality pip. */
    async quality() {
      if (!pc) return null;
      try {
        const stats = await pc.getStats();
        let rtt = null;
        let loss = null;
        stats.forEach((r) => {
          if (r.type === 'candidate-pair' && r.state === 'succeeded' && r.currentRoundTripTime != null) {
            rtt = Math.round(r.currentRoundTripTime * 1000);
          }
          if (r.type === 'inbound-rtp' && r.kind === 'audio' && r.packetsReceived) {
            loss = r.packetsLost / (r.packetsLost + r.packetsReceived);
          }
        });
        return { rtt, loss };
      } catch {
        return null;
      }
    },

    close() {
      closed = true;
      socket?.off('call:offer', onOffer);
      socket?.off('call:answer', onAnswer);
      socket?.off('call:ice', onIce);
      socket?.off('call:media-state', onMediaState);
      socket?.off('call:screen-share', onSharing);

      try {
        pc?.getSenders().forEach((s) => s.track?.stop());
      } catch {
        /* already torn down */
      }
      pc?.close();
      pc = null;
      localStream?.getTracks().forEach((t) => t.stop());
      localStream = null;
      videoSender = null;
    },
  };
}
