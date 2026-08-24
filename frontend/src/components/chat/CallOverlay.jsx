'use client';

import { useEffect, useRef, useState } from 'react';
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
  ScreenShare,
  ScreenShareOff,
  MonitorUp,
} from 'lucide-react';
import { useUI, toast } from '@/store/ui';
import { Avatar } from '@/components/ui/Avatar';
import { cn, duration } from '@/lib/utils';
import { emit, getSocket } from '@/lib/socket';
import { sounds, feedback } from '@/lib/sound';

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

/**
 * WebRTC call UI. Media is peer-to-peer — the server only relays the offer,
 * answer and ICE candidates.
 */
export function CallOverlay() {
  const call = useUI((s) => s.call);
  const setCall = useUI((s) => s.setCall);
  const endCall = useUI((s) => s.endCall);

  const [muted, setMuted] = useState(false);
  const [videoOff, setVideoOff] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [peerSharing, setPeerSharing] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [minimized, setMinimized] = useState(false);

  const localVideo = useRef(null);
  const remoteVideo = useRef(null);
  const pc = useRef(null);
  const localStream = useRef(null);
  /* The camera track is set aside while a screen is being shared, so stopping
     the share can put the original back rather than renegotiating from nothing. */
  const cameraTrack = useRef(null);
  const screenStream = useRef(null);
  const videoSender = useRef(null);
  const stopRinging = useRef(null);
  const timer = useRef(null);

  const isVideo = call?.mode === 'video';
  const active = call?.status === 'active';

  /* ── ringtone ── */
  useEffect(() => {
    if (!call) return undefined;
    if (call.status === 'ringing') {
      stopRinging.current = call.direction === 'incoming' ? sounds.ring() : sounds.dial();
    }
    return () => {
      stopRinging.current?.();
      stopRinging.current = null;
    };
  }, [call?.status, call?.direction, call]);

  /* ── duration ── */
  useEffect(() => {
    if (!active) return undefined;
    timer.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer.current);
  }, [active]);

  /* ── peer connection ── */
  useEffect(() => {
    if (!call || !active) return undefined;

    let cancelled = false;

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: isVideo ? { facingMode: 'user' } : false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        localStream.current = stream;
        if (localVideo.current) localVideo.current.srcObject = stream;

        const connection = new RTCPeerConnection({ iceServers: ICE_SERVERS });
        pc.current = connection;

        stream.getTracks().forEach((track) => {
          const sender = connection.addTrack(track, stream);
          // Kept so a screen share can replace what this sender is carrying;
          // replaceTrack needs no new offer, which is why sharing is instant.
          if (track.kind === 'video') videoSender.current = sender;
        });

        connection.ontrack = (e) => {
          if (remoteVideo.current) remoteVideo.current.srcObject = e.streams[0];
        };

        connection.onicecandidate = (e) => {
          if (e.candidate) {
            emit('call:ice', {
              callId: call.callId,
              to: call.from?.id || call.peerId,
              candidate: e.candidate,
            });
          }
        };

        const socket = getSocket();

        socket?.on('call:offer', async ({ sdp, from }) => {
          await connection.setRemoteDescription(new RTCSessionDescription(sdp));
          const answer = await connection.createAnswer();
          await connection.setLocalDescription(answer);
          emit('call:answer', { callId: call.callId, to: from, sdp: answer });
        });

        socket?.on('call:answer', async ({ sdp }) => {
          if (connection.signalingState !== 'stable') {
            await connection.setRemoteDescription(new RTCSessionDescription(sdp));
          }
        });

        socket?.on('call:ice', async ({ candidate }) => {
          try {
            await connection.addIceCandidate(new RTCIceCandidate(candidate));
          } catch {
            /* candidates can arrive before the description; safe to drop */
          }
        });

        /* Which incoming track is a screen is not something the peer can work
           out for itself, so the other side says so. Kept separate from
           media-state: a shared screen changes the layout, a muted mic does not. */
        socket?.on('call:screen-share', ({ on }) => setPeerSharing(!!on));

        // The caller drives the handshake.
        if (call.direction === 'outgoing') {
          const offer = await connection.createOffer();
          await connection.setLocalDescription(offer);
          emit('call:offer', {
            callId: call.callId,
            to: call.from?.id || call.peerId,
            sdp: offer,
          });
        }

        emit('call:join', { callId: call.callId });
      } catch {
        toast.error('Could not access your microphone or camera');
        hangUp();
      }
    })();

    return () => {
      cancelled = true;
      const socket = getSocket();
      socket?.off('call:offer');
      socket?.off('call:answer');
      socket?.off('call:ice');
      pc.current?.close();
      pc.current = null;
      localStream.current?.getTracks().forEach((t) => t.stop());
      localStream.current = null;
      screenStream.current?.getTracks().forEach((t) => t.stop());
      screenStream.current = null;
      cameraTrack.current = null;
      videoSender.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, call?.callId]);

  function hangUp() {
    if (call) emit('call:end', { callId: call.callId });
    sounds.hangup();
    localStream.current?.getTracks().forEach((t) => t.stop());
    pc.current?.close();
    setSeconds(0);
    endCall();
  }

  function accept() {
    feedback('select');
    stopRinging.current?.();
    emit('call:accept', { callId: call.callId });
    setCall({ ...call, status: 'active' });
  }

  function decline() {
    feedback('close');
    emit('call:decline', { callId: call.callId });
    endCall();
  }

  function toggleMute() {
    const next = !muted;
    setMuted(next);
    localStream.current?.getAudioTracks().forEach((t) => {
      t.enabled = !next;
    });
    emit('call:media-state', { callId: call.callId, muted: next, videoOff });
    feedback('tap');
  }

  const canShare = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia;

  /**
   * Screen sharing.
   *
   * The screen goes out as an ordinary video track on the connection that is
   * already up: replaceTrack swaps what the existing sender carries, so there is
   * no second offer, no glare, and no visible pause. An audio-only call has no
   * video sender to swap, so one is added — and that case *does* need a fresh
   * offer, which is the only reason the two paths differ.
   */
  async function toggleShare() {
    if (!canShare) return toast.error('This browser cannot share a screen');

    if (sharing) return stopSharing();

    let stream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 15 },
        // Tab audio where the browser offers it; the user can decline in the
        // picker and the share still works.
        audio: false,
      });
    } catch {
      // The picker being dismissed is not an error worth reporting.
      return;
    }

    screenStream.current = stream;
    const track = stream.getVideoTracks()[0];

    // The browser's own "Stop sharing" bar is outside our UI, so the track
    // ending is the only signal that it was used.
    track.onended = () => stopSharing();

    try {
      if (videoSender.current) {
        cameraTrack.current = videoSender.current.track;
        await videoSender.current.replaceTrack(track);
      } else {
        videoSender.current = pc.current?.addTrack(track, stream);
        await renegotiate();
      }
    } catch (err) {
      stream.getTracks().forEach((t) => t.stop());
      screenStream.current = null;
      return toast.error(err.message || 'Could not start sharing');
    }

    if (localVideo.current) localVideo.current.srcObject = stream;
    setSharing(true);
    emit('call:screen-share', { callId: call.callId, on: true });
    feedback('select');
  }

  async function stopSharing() {
    screenStream.current?.getTracks().forEach((t) => t.stop());
    screenStream.current = null;

    // Put the camera back if there was one. On an audio call there was not, and
    // the sender is left carrying nothing, which the peer renders as no video.
    try {
      await videoSender.current?.replaceTrack(cameraTrack.current || null);
    } catch {
      /* the connection may already be closing */
    }
    cameraTrack.current = null;

    if (localVideo.current) localVideo.current.srcObject = localStream.current;
    setSharing(false);
    emit('call:screen-share', { callId: call.callId, on: false });
    feedback('tap');
  }

  /** Only needed when a track is added rather than swapped. */
  async function renegotiate() {
    const connection = pc.current;
    if (!connection) return;
    const offer = await connection.createOffer();
    await connection.setLocalDescription(offer);
    emit('call:offer', {
      callId: call.callId,
      to: call.from?.id || call.peerId,
      sdp: offer,
    });
  }

  function toggleVideo() {
    const next = !videoOff;
    setVideoOff(next);
    localStream.current?.getVideoTracks().forEach((t) => {
      t.enabled = !next;
    });
    emit('call:media-state', { callId: call.callId, muted, videoOff: next });
    feedback('tap');
  }

  if (typeof document === 'undefined') return null;

  const peer = call?.from || {};
  const title = call?.isGroup ? call.conversationName : peer.name;

  return createPortal(
    <AnimatePresence>
      {call && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className={cn(
            'fixed z-[160]',
            minimized ? 'bottom-24 right-4 lg:bottom-6' : 'inset-0 grid place-items-center p-4'
          )}
        >
          {/* Scrim only while the card is up — a minimised call must not
              block the app behind it. */}
          {!minimized && <div className="absolute inset-0 bg-black/55" />}

          <motion.div
            initial={{ opacity: 0, scale: 0.94, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ type: 'spring', damping: 28, stiffness: 340 }}
            className={cn(
              'relative overflow-hidden bg-[#0f1513] text-white shadow-pop',
              minimized
                ? 'h-[160px] w-[112px] rounded-2xl'
                : isVideo && active
                  ? 'aspect-[3/4] w-full max-w-[420px] rounded-3xl sm:aspect-video sm:max-w-[760px]'
                  : 'w-full max-w-[350px] rounded-3xl'
            )}
          >
          {/* video layer */}
          {isVideo && active && (
            <>
              <video
                ref={remoteVideo}
                autoPlay
                playsInline
                className={cn(
                  'absolute inset-0 h-full w-full bg-ink',
                  // A face can be cropped to fill; a shared screen cannot —
                  // the edges are where the toolbars and the text live.
                  peerSharing ? 'object-contain' : 'object-cover'
                )}
              />

              {peerSharing && !minimized && (
                <div className="absolute left-1/2 top-3 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-black/60 px-3 py-1.5 text-[12.5px] font-medium text-white backdrop-blur">
                  <MonitorUp size={14} />
                  {(call?.from?.name || 'They').split(' ')[0]} is sharing their screen
                </div>
              )}
              <video
                ref={localVideo}
                autoPlay
                playsInline
                muted
                className={cn(
                  'absolute rounded-xl border border-white/15 object-cover shadow-lg',
                  minimized ? 'inset-0 h-full w-full' : 'right-3 top-3 h-28 w-20 sm:h-36 sm:w-24'
                )}
              />
            </>
          )}

          {minimized ? (
            <button
              type="button"
              onClick={() => setMinimized(false)}
              className="absolute inset-0 grid place-items-center bg-black/30 text-[11px] font-medium"
            >
              {!isVideo && <Avatar src={peer.avatar} name={peer.name} size="md" />}
              <span className="absolute bottom-1.5 font-mono tabular-nums">
                {duration(seconds)}
              </span>
            </button>
          ) : (
            <div className="relative flex flex-col items-center gap-6 px-6 py-7">
              {/* top */}
              <div className="flex w-full items-center justify-between">
                <button
                  type="button"
                  onClick={() => setMinimized(true)}
                  className="grid h-9 w-9 place-items-center rounded-full bg-white/12 transition-colors hover:bg-white/20"
                  aria-label="Minimise"
                >
                  <Minimize2 size={18} />
                </button>
                <div className="text-center">
                  <p className="text-[13px] text-white/60">
                    {call.status === 'ringing'
                      ? call.direction === 'incoming'
                        ? 'Incoming ' + (isVideo ? 'video' : 'voice') + ' call'
                        : 'Calling…'
                      : 'Connected'}
                  </p>
                </div>
                <div className="w-10" />
              </div>

              {/* middle */}
              {(!isVideo || !active) && (
                <div className="flex flex-col items-center">
                  <div className="relative">
                    {call.status === 'ringing' && (
                      <>
                        <span className="absolute inset-0 animate-pulse-ring rounded-full bg-brand/30" />
                        <span
                          className="absolute inset-0 animate-pulse-ring rounded-full bg-brand/20"
                          style={{ animationDelay: '0.5s' }}
                        />
                      </>
                    )}
                    <Avatar
                      src={peer.avatar}
                      name={title}
                      color={peer.avatarColor}
                      size="2xl"
                      className="relative"
                    />
                  </div>
                  <h2 className="mt-5 font-display text-[22px] tracking-tight">{title}</h2>
                  <p className="mt-1 font-mono text-[14px] tabular-nums text-white/60">
                    {active ? duration(seconds) : isVideo ? 'Video call' : 'Voice call'}
                  </p>
                </div>
              )}

              {/* controls */}
              <div className="w-full">
                {call.status === 'ringing' && call.direction === 'incoming' ? (
                  <div className="flex items-center justify-center gap-12">
                    <CallButton icon={PhoneOff} tone="red" label="Decline" onClick={decline} />
                    <CallButton icon={Phone} tone="green" label="Accept" onClick={accept} pulse />
                  </div>
                ) : (
                  <div className="flex items-center justify-center gap-4">
                    <CallButton
                      icon={muted ? MicOff : Mic}
                      tone={muted ? 'active' : 'glass'}
                      label={muted ? 'Unmute' : 'Mute'}
                      onClick={toggleMute}
                      size="sm"
                    />
                    {isVideo && (
                      <CallButton
                        icon={videoOff ? VideoOff : Video}
                        tone={videoOff ? 'active' : 'glass'}
                        label="Camera"
                        onClick={toggleVideo}
                        size="sm"
                      />
                    )}
                    {canShare && (
                      <CallButton
                        icon={sharing ? ScreenShareOff : ScreenShare}
                        tone={sharing ? 'active' : 'glass'}
                        label={sharing ? 'Stop sharing' : 'Share screen'}
                        onClick={toggleShare}
                        size="sm"
                      />
                    )}
                    <CallButton icon={PhoneOff} tone="red" label="End call" onClick={hangUp} />
                    <CallButton icon={Volume2} tone="glass" label="Speaker" size="sm" onClick={() => feedback('tap')} />
                  </div>
                )}
              </div>
            </div>
          )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}

function CallButton({ icon: Icon, tone, label, onClick, size = 'md', pulse = false }) {
  const tones = {
    red: 'bg-danger text-white',
    green: 'bg-wa-500 text-white',
    glass: 'bg-white/14 text-white',
    active: 'bg-white text-ink',
  };
  const dims = size === 'sm' ? 'h-[52px] w-[52px]' : 'h-[64px] w-[64px]';

  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.88 }}
      onClick={onClick}
      aria-label={label}
      className={cn(
        'relative grid place-items-center rounded-full transition-colors',
        dims,
        tones[tone]
      )}
    >
      {pulse && <span className="absolute inset-0 animate-pulse-ring rounded-full bg-wa-500/50" />}
      <Icon size={size === 'sm' ? 21 : 26} strokeWidth={2} className="relative" />
    </motion.button>
  );
}
