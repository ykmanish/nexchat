'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Phone,
  PhoneOff,
  Mic,
  MicOff,
  Video,
  VideoOff,
  Volume2,
  Minimize2,
  Maximize2,
  MonitorUp,
  MoreHorizontal,
  UserPlus,
  Lock,
  SignalHigh,
  SignalMedium,
  SignalLow,
} from 'lucide-react';
import { useUI, toast } from '@/store/ui';
import { Avatar } from '@/components/ui/Avatar';
import { cn, duration } from '@/lib/utils';
import { emit } from '@/lib/socket';
import { sounds, feedback, haptics, canPlayNow } from '@/lib/sound';
import { CALL_STATUS_BAR, setStatusBarOverride } from '@/lib/theme';
import { startCall, hasTurn, CALL_STATES } from '@/lib/webrtc';

/**
 * The call screen.
 *
 * All the media logic lives in `lib/webrtc` — this is presentation and the
 * handful of decisions that belong to a UI. The one piece of plumbing that
 * stays here is deliberate: the remote stream is held in state and attached to
 * elements by an effect, because attaching it from the track event meant losing
 * it whenever the track arrived before React had painted anything.
 *
 * The remote audio has its own element and always exists. Previously the only
 * sink was the remote `<video>`, which is rendered for video calls — so an
 * audio call had nowhere to play sound and there was none. A separate `<audio>`
 * tag cannot be laid out away by accident.
 */
export function CallOverlay() {
  const call = useUI((s) => s.call);
  const setCall = useUI((s) => s.setCall);
  const endCall = useUI((s) => s.endCall);

  const [muted, setMuted] = useState(false);
  const [videoOff, setVideoOff] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [peerSharing, setPeerSharing] = useState(false);
  const [peerMuted, setPeerMuted] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [minimized, setMinimized] = useState(false);
  const [connection, setConnection] = useState(CALL_STATES.connecting);
  const [remoteStream, setRemoteStream] = useState(null);
  const [quality, setQuality] = useState(null);
  const [showMore, setShowMore] = useState(false);

  const localVideo = useRef(null);
  const remoteVideo = useRef(null);
  const remoteAudio = useRef(null);
  const engine = useRef(null);
  const cameraTrack = useRef(null);
  const screenStream = useRef(null);
  const stopRinging = useRef(null);

  const isVideo = call?.mode === 'video';
  /* `callStatus`, not `status`: further down, `status` is already the line of
     text rendered under the peer's name. Two different meanings of the same
     word in one component, so the one that arrived second takes the longer
     name rather than shadowing the other. */
  const callStatus = call?.status;
  const direction = call?.direction;
  const active = callStatus === 'active';
  const peerName = call?.from?.name || call?.peer?.name || 'Unknown';
  const peerId = call?.from?.id || call?.peerId;

  /* ── ringtone ──
     Incoming gets the ringtone and the vibration; outgoing gets the ringback.
     Both stop the instant the status leaves 'ringing', which is the same effect
     cleanup for answered, declined, missed and hung up alike.

     `call` itself is deliberately *not* a dependency. It is a fresh object out
     of the store on every `setCall`, so depending on it tore the ringtone down
     and started it again on any unrelated update — restarting the cadence from
     its first burst each time, which is heard as a stutter. Only the two fields
     that decide what should be ringing belong here. */
  useEffect(() => {
    if (callStatus !== 'ringing') return undefined;

    stopRinging.current = direction === 'incoming' ? sounds.ring() : sounds.dial();

    return () => {
      stopRinging.current?.();
      stopRinging.current = null;
    };
  }, [callStatus, direction]);

  /* The fallback for a call arriving at a page nobody has touched.
     Audio cannot start without a gesture, so on a cold tab the ringtone is
     queued rather than playing (see `whenAudible` in lib/sound) — and a queued
     ringtone alerts nobody. A notification can make noise where the page
     cannot, so it stands in: the system rings, and tapping through both focuses
     the call and unlocks audio, at which point the ringtone takes over. */
  useEffect(() => {
    if (callStatus !== 'ringing' || direction !== 'incoming') return undefined;
    if (canPlayNow()) return undefined;

    let notification = null;
    let cancelled = false;

    (async () => {
      try {
        if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;

        const options = {
          body: isVideo ? 'Incoming video call' : 'Incoming call',
          icon: '/icon-192.png',
          badge: '/icon-96.png',
          tag: 'call-' + call.callId,
          renotify: true,
          // A call is the one alert that must not disappear on its own.
          requireInteraction: true,
          vibrate: [500, 240, 500, 240, 500],
          data: { callId: call.callId },
        };

        const registration =
          'serviceWorker' in navigator
            ? await navigator.serviceWorker.getRegistration('/sw.js')
            : null;

        if (cancelled) return;

        if (registration) {
          await registration.showNotification(peerName, options);
          notification = registration;
        } else {
          notification = new Notification(peerName, options);
          notification.onclick = () => {
            window.focus();
            notification.close();
          };
        }
      } catch {
        /* The ring is the alert; this was only the backstop. */
      }
    })();

    return () => {
      cancelled = true;
      // Whichever path raised it, take it down the moment the call stops
      // ringing — a call notification outliving its call is worse than none.
      // Duck-typed rather than `instanceof ServiceWorkerRegistration`: that
      // global does not exist on a browser without service workers, so the
      // check would throw in the very cleanup meant to cope with one.
      if (typeof notification?.getNotifications === 'function') {
        notification
          .getNotifications({ tag: 'call-' + call.callId })
          .then((list) => list.forEach((n) => n.close()))
          .catch(() => {});
      } else {
        notification?.close?.();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callStatus, direction, call?.callId]);

  /* ── the head panel ──
     The phone paints the strip above the call screen from the theme-color tag,
     and a call that does not set it leaves the app's header colour banded
     across the top of a full-screen dark call. Handing lib/theme the colour for
     the current call state makes the two continuous, and the override is
     dropped on unmount so the bar goes back to the theme's own colour. */
  useEffect(() => {
    if (!call) return undefined;
    setStatusBarOverride(callTint(call, connection));
    return () => setStatusBarOverride(null);
  }, [call, connection]);

  /* ── duration ── */
  useEffect(() => {
    if (connection !== CALL_STATES.connected) return undefined;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [connection]);

  const hangUp = useCallback(() => {
    if (call) emit('call:end', { callId: call.callId });
    sounds.hangup();
    engine.current?.close();
    engine.current = null;
    setSeconds(0);
    setRemoteStream(null);
    endCall();
  }, [call, endCall]);

  /* ── the call itself ── */
  useEffect(() => {
    if (!call || !active) return undefined;

    const handle = startCall({
      callId: call.callId,
      peerId,
      isVideo,
      isCaller: call.direction === 'outgoing',
      onRemoteStream: setRemoteStream,
      onState: setConnection,
      onPeerMedia: ({ muted: m }) => {
        if (m !== undefined) setPeerMuted(!!m);
      },
      onPeerSharing: setPeerSharing,
    });
    engine.current = handle;

    handle.ready.catch(() => {
      toast.error('Could not access your microphone or camera');
      hangUp();
    });

    return () => {
      handle.close();
      if (engine.current === handle) engine.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, call?.callId]);

  /* Attach the local preview once both the stream and the element exist. */
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    engine.current?.ready
      .then((stream) => {
        if (!cancelled && stream && localVideo.current) {
          localVideo.current.srcObject = stream;
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [active, minimized, isVideo]);

  /**
   * Attach the remote stream to both sinks.
   *
   * Re-run on `minimized` and `isVideo` too, because those remount the video
   * element — and an element that mounts after the stream arrived would
   * otherwise stay blank for the rest of the call.
   *
   * The video element is muted and the audio element is not. One stream, one
   * place the sound comes from: attaching audio to both would play it twice.
   */
  useEffect(() => {
    if (!remoteStream) return;
    if (remoteAudio.current && remoteAudio.current.srcObject !== remoteStream) {
      remoteAudio.current.srcObject = remoteStream;
      // Autoplay is allowed here: a call is about as clear a user gesture as
      // it gets, but a rejected play() must not be silent.
      remoteAudio.current.play?.().catch(() => {});
    }
    if (remoteVideo.current && remoteVideo.current.srcObject !== remoteStream) {
      remoteVideo.current.srcObject = remoteStream;
      remoteVideo.current.play?.().catch(() => {});
    }
  }, [remoteStream, minimized, isVideo, peerSharing]);

  /* ── quality pip ── */
  useEffect(() => {
    if (connection !== CALL_STATES.connected) return undefined;
    const t = setInterval(async () => {
      setQuality(await engine.current?.quality());
    }, 3000);
    return () => clearInterval(t);
  }, [connection]);

  /**
   * Answer.
   *
   * The ringtone is stopped here rather than left to the effect cleanup: the
   * status change that triggers that cleanup is a render away, and half a
   * second of ringing after you have already answered is the loudest possible
   * way to feel unresponsive.
   *
   * `connected` is the sound and `callAccepted` the buzz — the one moment in a
   * call you should be able to feel through a pocket without looking, since it
   * is when you can start talking.
   */
  function accept() {
    stopRinging.current?.();
    stopRinging.current = null;
    sounds.connected();
    haptics.callAccepted();
    emit('call:accept', { callId: call.callId });
    setCall({ ...call, status: 'active' });
  }

  /** Refuse. The falling tone and its matching buzz, on both ends — the caller
   *  gets the same pair when `call:declined` reaches them. */
  function decline() {
    stopRinging.current?.();
    stopRinging.current = null;
    sounds.declined();
    haptics.callDeclined();
    emit('call:decline', { callId: call.callId });
    endCall();
  }

  function toggleMute() {
    const next = !muted;
    setMuted(engine.current?.setMuted(next) ?? next);
    feedback('tap');
  }

  function toggleCamera() {
    const next = !videoOff;
    setVideoOff(engine.current?.setCameraOff(next) ?? next);
    feedback('tap');
  }

  const canShare =
    typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia;

  /**
   * Screen sharing.
   *
   * The screen replaces whatever the existing video sender is carrying, so
   * there is no second offer and no visible pause. An audio call has no video
   * sender, so one is added — and the engine's renegotiation handles that case.
   */
  async function toggleShare() {
    if (!engine.current) return;

    if (sharing) {
      screenStream.current?.getTracks().forEach((t) => t.stop());
      screenStream.current = null;
      await engine.current.setVideoTrack(cameraTrack.current || null);
      setSharing(false);
      emit('call:screen-share', { callId: call.callId, on: false });
      if (localVideo.current) {
        localVideo.current.srcObject = engine.current.localStream();
      }
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 15 },
        audio: false,
      });
      screenStream.current = stream;
      const track = stream.getVideoTracks()[0];

      // Keep the camera track so stopping the share can put it back.
      cameraTrack.current =
        engine.current.videoSender()?.track || cameraTrack.current || null;

      await engine.current.setVideoTrack(track);
      setSharing(true);
      emit('call:screen-share', { callId: call.callId, on: true });

      // The browser's own "stop sharing" bar has to end it too.
      track.onended = () => toggleShare();

      if (localVideo.current) localVideo.current.srcObject = stream;
    } catch {
      /* The picker was dismissed. Nothing to report. */
    }
  }

  if (typeof document === 'undefined' || !call) return null;

  const ringing = call.status === 'ringing';
  const incoming = ringing && call.direction === 'incoming';
  const showRemoteVideo = isVideo && !!remoteStream && connection !== CALL_STATES.connecting;

  /* What the line under the name says. It is the one place the call reports
     itself, so it says the true thing rather than always "encrypted". */
  const status = incoming
    ? isVideo ? 'Incoming video call' : 'Incoming call'
    : ringing
      ? 'Ringing…'
      : connection === CALL_STATES.connecting
        ? 'Connecting…'
        : connection === CALL_STATES.reconnecting
          ? 'Reconnecting…'
          : connection === CALL_STATES.failed
            ? 'Could not connect'
            : duration(seconds);

  return createPortal(
    <AnimatePresence>
      <motion.div
        key="call"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
        className={cn(
          'fixed z-[160] flex flex-col overflow-hidden',
          minimized
            ? 'bottom-4 right-4 h-[188px] w-[136px] rounded-2xl shadow-pop'
            : 'inset-0'
        )}
      >
        {/* ── canvas ──
            The doodle wall from the chat, dimmed right down. A call screen
            that is flat black belongs to a different app; this one is
            recognisably the same place the conversation was. */}
        <div className="absolute inset-0 bg-[#0a0f0d]">
          <div className="chat-canvas wp-doodle absolute inset-0 opacity-[0.38]" />
          {/* A slow brand-tinted bloom, so the screen is not inert while it
              rings. Composited only — opacity and transform. */}
          {!minimized && (
            <motion.div
              aria-hidden
              initial={{ opacity: 0.1, scale: 0.9 }}
              animate={
                // An incoming call breathes faster and brighter than one that
                // is already up: while it is ringing, the screen is trying to
                // get your attention, and afterwards it should get out of the
                // way. Still opacity and transform only.
                incoming
                  ? { opacity: [0.24, 0.5, 0.24], scale: [0.92, 1.1, 0.92] }
                  : { opacity: [0.16, 0.34, 0.16], scale: [0.9, 1.06, 0.9] }
              }
              transition={{
                duration: incoming ? 2 : 7,
                repeat: Infinity,
                ease: 'easeInOut',
              }}
              className={cn(
                'absolute left-1/2 top-[38%] h-[460px] w-[460px] -translate-x-1/2 -translate-y-1/2 rounded-full blur-[100px]',
                // The same state colour the status bar is painted with, so the
                // screen and the strip above it are one surface.
                BLOOM[callState(call, connection)]
              )}
            />
          )}
        </div>

        {/* Remote audio. Always mounted, never laid out — the sound must not
            depend on which visual branch happens to be rendered. */}
        <audio ref={remoteAudio} autoPlay playsInline className="hidden" />

        {showRemoteVideo && (
          <video
            ref={remoteVideo}
            autoPlay
            playsInline
            muted
            className={cn(
              'absolute inset-0 h-full w-full',
              // A face can be cropped to fill; a shared screen cannot — the
              // edges are where the toolbars and the text live.
              peerSharing ? 'object-contain' : 'object-cover'
            )}
          />
        )}

        {minimized ? (
          <button
            type="button"
            onClick={() => setMinimized(false)}
            className="relative flex h-full w-full flex-col items-center justify-center gap-2 text-white"
          >
            {!showRemoteVideo && (
              <Avatar src={call.from?.avatar} name={peerName} size="md" />
            )}
            <span className="relative z-[1] rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-medium tabular-nums backdrop-blur">
              {status}
            </span>
            <Maximize2 size={14} className="relative z-[1] opacity-70" />
          </button>
        ) : (
          <>
            {/* ── top bar ── */}
            <header className="safe-top relative z-[2] flex items-start justify-between px-5 pt-4">
              <RoundButton
                icon={Minimize2}
                label="Minimise"
                onClick={() => setMinimized(true)}
              />

              <div className="min-w-0 flex-1 px-3 text-center">
                <h2 className="truncate font-display text-[22px] leading-tight tracking-tight text-white">
                  {peerName}
                </h2>
                <p className="mt-1 flex items-center justify-center gap-1.5 text-[13px] text-white/60">
                  {connection === CALL_STATES.connected ? (
                    <>
                      <Lock size={11} />
                      <span className="tabular-nums">{status}</span>
                      <QualityPip quality={quality} />
                    </>
                  ) : (
                    <span>{status}</span>
                  )}
                </p>
              </div>

              <RoundButton icon={UserPlus} label="Add someone" onClick={() => toast.info('Group calls are coming')} />
            </header>

            {/* ── the person ── */}
            <div className="relative z-[1] flex min-h-0 flex-1 flex-col items-center justify-center px-8">
              {!showRemoteVideo && (
                <PeerAvatar
                  call={call}
                  name={peerName}
                  ringing={ringing || connection !== CALL_STATES.connected}
                  muted={peerMuted}
                />
              )}

              {peerSharing && (
                <div className="mt-5 flex items-center gap-1.5 rounded-full bg-black/55 px-3 py-1.5 text-[12.5px] font-medium text-white backdrop-blur">
                  <MonitorUp size={14} />
                  {peerName.split(' ')[0]} is sharing their screen
                </div>
              )}

              {connection === CALL_STATES.failed && (
                <p className="mt-5 max-w-[300px] text-center text-[12.5px] leading-relaxed text-white/55">
                  The two devices could not find a route to each other.
                  {!hasTurn() && ' This server has no relay configured, which is the usual cause on mobile data.'}
                </p>
              )}
            </div>

            {/* ── local preview ── */}
            {isVideo && active && !videoOff && (
              <motion.video
                ref={localVideo}
                autoPlay
                playsInline
                muted
                initial={{ opacity: 0, scale: 0.9, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ type: 'spring', stiffness: 320, damping: 28 }}
                className="absolute right-4 top-24 z-[3] h-36 w-24 rounded-2xl border border-white/15 object-cover shadow-lg sm:h-44 sm:w-32"
              />
            )}

            {/* ── controls ──
                The reference's two rows of round buttons with labels beneath,
                which is the shape that works: a bare icon grid makes you learn
                what each one is, and on a call is the worst moment to be
                guessing. Ours sits on the app's raised surface with the brand
                lime as the active state rather than white. */}
            <motion.div
              initial={{ y: 40, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 260, damping: 26, delay: 0.06 }}
              className="safe-bottom relative z-[2] px-4 pb-4"
            >
              <div className="mx-auto w-full max-w-[420px] rounded-[28px] border border-white/10 bg-white/[0.06] p-5 backdrop-blur-xl">
                {incoming ? (
                  <div className="flex items-center justify-around">
                    <ControlButton
                      icon={PhoneOff}
                      label="Decline"
                      tone="danger"
                      onClick={decline}
                    />
                    <ControlButton
                      icon={isVideo ? Video : Phone}
                      label="Accept"
                      tone="accept"
                      pulse
                      onClick={accept}
                    />
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-3 gap-2">
                      <ControlButton
                        icon={Volume2}
                        label="Speaker"
                        tone="idle"
                        onClick={() => toast.info('Output switching is up to your device')}
                      />
                      <ControlButton
                        icon={videoOff || !isVideo ? VideoOff : Video}
                        label="Video"
                        tone={isVideo && !videoOff ? 'on' : 'idle'}
                        disabled={!isVideo}
                        onClick={toggleCamera}
                      />
                      <ControlButton
                        icon={muted ? MicOff : Mic}
                        label={muted ? 'Unmute' : 'Mute'}
                        tone={muted ? 'on' : 'idle'}
                        onClick={toggleMute}
                      />
                    </div>

                    <div className="mt-3 grid grid-cols-3 gap-2">
                      <ControlButton
                        icon={MoreHorizontal}
                        label="More"
                        tone={showMore ? 'on' : 'idle'}
                        onClick={() => setShowMore((v) => !v)}
                      />
                      <ControlButton
                        icon={MonitorUp}
                        label="Share"
                        tone={sharing ? 'on' : 'idle'}
                        disabled={!canShare}
                        onClick={toggleShare}
                      />
                      <ControlButton icon={PhoneOff} label="End" tone="danger" onClick={hangUp} />
                    </div>

                    <AnimatePresence initial={false}>
                      {showMore && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.18 }}
                          className="overflow-hidden"
                        >
                          <p className="pt-4 text-center text-[11.5px] leading-relaxed text-white/45">
                            {connection === CALL_STATES.connected && quality?.rtt != null
                              ? 'Round trip ' + quality.rtt + 'ms' +
                                (quality.loss != null
                                  ? ' · ' + Math.round(quality.loss * 100) + '% packet loss'
                                  : '')
                              : 'Media is peer-to-peer and end-to-end encrypted. The server only passes the handshake along.'}
                          </p>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </>
                )}
              </div>
            </motion.div>
          </>
        )}
      </motion.div>
    </AnimatePresence>,
    document.body
  );
}

/* ─────────────────────────── the call's colour ───────────────────────────
 *
 * One function decides what state a call is in, and both the screen's bloom and
 * the phone's status bar are coloured from it. That is the whole point of
 * routing them through the same place: the strip the phone draws above the call
 * has to be the same colour the call is, and two independent opinions about
 * "what colour is a ringing call" drift apart the first time either changes.
 */
function callState(call, connection) {
  if (!call) return 'outgoing';
  if (call.status === 'ringing') {
    return call.direction === 'incoming' ? 'incoming' : 'outgoing';
  }
  if (connection === CALL_STATES.failed) return 'failed';
  if (connection === CALL_STATES.reconnecting) return 'reconnecting';
  if (connection === CALL_STATES.connected) return 'connected';
  return 'outgoing';
}

/** The colour for the head panel, in the state the call is currently in. */
const callTint = (call, connection) => CALL_STATUS_BAR[callState(call, connection)];

/** The on-screen bloom for each of those states. */
const BLOOM = {
  incoming: 'bg-brand/55',
  outgoing: 'bg-brand/40',
  connected: 'bg-brand/40',
  reconnecting: 'bg-warn/45',
  failed: 'bg-danger/40',
};

/* ────────────────────────────── pieces ────────────────────────────── */

/**
 * The avatar, with rings while the call is not yet up.
 *
 * The rings are the whole reason a ringing screen does not feel dead. Two of
 * them, offset, on a long slow cycle — scale and opacity only, so it costs the
 * compositor and nothing else.
 */
function PeerAvatar({ call, name, ringing, muted }) {
  return (
    <div className="relative grid place-items-center">
      {ringing && (
        <>
          <motion.span
            aria-hidden
            initial={{ scale: 1, opacity: 0.45 }}
            animate={{ scale: 1.7, opacity: 0 }}
            transition={{ duration: 2.4, repeat: Infinity, ease: 'easeOut' }}
            className="absolute h-[176px] w-[176px] rounded-full border-2 border-brand/70"
          />
          <motion.span
            aria-hidden
            initial={{ scale: 1, opacity: 0.35 }}
            animate={{ scale: 1.7, opacity: 0 }}
            transition={{ duration: 2.4, repeat: Infinity, ease: 'easeOut', delay: 1.2 }}
            className="absolute h-[176px] w-[176px] rounded-full border-2 border-brand/50"
          />
        </>
      )}

      <motion.div
        initial={{ scale: 0.86, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 240, damping: 22 }}
        className="relative rounded-full p-[3px] ring-1 ring-white/10"
      >
        <Avatar
          src={call.from?.avatar}
          name={name}
          color={call.from?.avatarColor}
          size="3xl"
          className="shadow-2xl"
        />

        {muted && (
          <span className="absolute -bottom-1 -right-1 grid h-9 w-9 place-items-center rounded-full bg-[#0a0f0d] ring-2 ring-white/10">
            <MicOff size={16} className="text-white/70" />
          </span>
        )}
      </motion.div>
    </div>
  );
}

/** Round-trip time as three bars, because a number means nothing mid-call. */
function QualityPip({ quality }) {
  if (!quality || quality.rtt == null) return null;

  const { rtt } = quality;
  const Icon = rtt < 120 ? SignalHigh : rtt < 300 ? SignalMedium : SignalLow;
  const tone = rtt < 120 ? 'text-brand' : rtt < 300 ? 'text-warn' : 'text-danger';

  return <Icon size={13} className={cn('shrink-0', tone)} title={rtt + 'ms round trip'} />;
}

/** The small glass buttons in the top corners. */
function RoundButton({ icon: Icon, label, onClick }) {
  return (
    <motion.button
      type="button"
      aria-label={label}
      title={label}
      whileTap={{ scale: 0.88 }}
      transition={{ type: 'spring', stiffness: 500, damping: 26 }}
      onClick={() => {
        feedback('tap');
        onClick?.();
      }}
      className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-white/10 bg-white/10 text-white backdrop-blur-md transition-colors hover:bg-white/20"
    >
      <Icon size={19} strokeWidth={2} />
    </motion.button>
  );
}

/* Tones rather than colours at the call site, so "what an active control looks
   like" is decided once. `on` is the brand lime with dark ink on it — the same
   pairing the rest of the app uses for an active state. */
const TONES = {
  idle: 'bg-white/10 text-white hover:bg-white/[0.18] border-white/10',
  on: 'bg-brand text-brand-ink hover:bg-brand-hover border-transparent',
  danger: 'bg-danger text-white hover:brightness-110 border-transparent',
  accept: 'bg-brand text-brand-ink hover:bg-brand-hover border-transparent',
};

/** One labelled control. The label is why you do not have to guess mid-call. */
function ControlButton({ icon: Icon, label, tone = 'idle', onClick, disabled, pulse }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <motion.button
        type="button"
        aria-label={label}
        disabled={disabled}
        whileTap={disabled ? undefined : { scale: 0.9 }}
        animate={pulse ? { scale: [1, 1.06, 1] } : { scale: 1 }}
        transition={
          pulse
            ? { duration: 1.6, repeat: Infinity, ease: 'easeInOut' }
            : { type: 'spring', stiffness: 480, damping: 24 }
        }
        onClick={() => {
          if (disabled) return;
          feedback('tap');
          onClick?.();
        }}
        className={cn(
          'grid h-[62px] w-[62px] place-items-center rounded-full border transition-colors duration-200',
          TONES[tone],
          disabled && 'cursor-not-allowed opacity-35'
        )}
      >
        <Icon size={24} strokeWidth={2} />
      </motion.button>
      <span className="text-[12px] font-medium text-white/70">{label}</span>
    </div>
  );
}
