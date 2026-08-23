'use client';

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Play, Pause } from 'lucide-react';
import { useDecryptedMedia } from './Attachment';
import { cn, duration } from '@/lib/utils';
import { feedback } from '@/lib/sound';
import { emit } from '@/lib/socket';

const SPEEDS = [1, 1.5, 2];

/** Waveform player. Bars fill as playback moves and are scrubbable. */
export function VoiceNote({ attachment, message, isMine }) {
  const { url, state } = useDecryptedMedia(attachment);
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [speedIndex, setSpeedIndex] = useState(0);
  const reported = useRef(false);

  const bars = attachment.waveform?.length
    ? attachment.waveform
    : Array.from({ length: 34 }, (_, i) => 0.25 + Math.abs(Math.sin(i * 1.7)) * 0.6);

  const total = attachment.duration || 0;
  const elapsed = total * progress;

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return undefined;

    const onTime = () => setProgress(audio.duration ? audio.currentTime / audio.duration : 0);
    const onEnd = () => {
      setPlaying(false);
      setProgress(0);
    };

    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('ended', onEnd);
    return () => {
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('ended', onEnd);
    };
  }, [url]);

  function toggle(e) {
    e.stopPropagation();
    const audio = audioRef.current;
    if (!audio) return;

    feedback('tap');
    if (playing) {
      audio.pause();
      setPlaying(false);
    } else {
      audio.playbackRate = SPEEDS[speedIndex];
      audio.play();
      setPlaying(true);
      if (!reported.current && !isMine) {
        reported.current = true;
        emit('message:played', { messageId: message._id });
      }
    }
  }

  function scrub(e) {
    e.stopPropagation();
    const audio = audioRef.current;
    if (!audio?.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    audio.currentTime = ratio * audio.duration;
    setProgress(ratio);
  }

  function cycleSpeed(e) {
    e.stopPropagation();
    const next = (speedIndex + 1) % SPEEDS.length;
    setSpeedIndex(next);
    if (audioRef.current) audioRef.current.playbackRate = SPEEDS[next];
    feedback('tap');
  }

  return (
    <div className="flex min-w-[218px] items-center gap-2.5 py-0.5">
      {url && <audio ref={audioRef} src={url} preload="metadata" />}

      <motion.button
        type="button"
        whileTap={{ scale: 0.9 }}
        onClick={toggle}
        disabled={state !== 'ready'}
        className={cn(
          'grid h-9 w-9 shrink-0 place-items-center rounded-full transition-colors',
          isMine ? 'bg-black/15 text-white' : 'bg-brand text-brand-ink',
          state !== 'ready' && 'opacity-50'
        )}
        aria-label={playing ? 'Pause' : 'Play'}
      >
        {state === 'loading' ? (
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
        ) : playing ? (
          <Pause size={15} fill="currentColor" />
        ) : (
          <Play size={15} fill="currentColor" className="ml-0.5" />
        )}
      </motion.button>

      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={scrub}
          className="flex h-7 w-full items-center gap-[2px]"
          aria-label="Seek"
        >
          {bars.map((v, i) => {
            const filled = i / bars.length <= progress;
            return (
              <span
                key={i}
                className={cn(
                  'flex-1 rounded-full transition-colors duration-100',
                  filled
                    ? isMine
                      ? 'bg-ink/80'
                      : 'bg-brand-strong'
                    : isMine
                      ? 'bg-ink/25'
                      : 'bg-ink-faint/35'
                )}
                style={{ height: Math.max(3, v * 26) + 'px' }}
              />
            );
          })}
        </button>

        <div className="mt-0.5 flex items-center gap-2">
          <span
            className={cn(
              'font-mono text-[10.5px] tabular-nums',
              isMine ? 'text-white/60' : 'text-ink-faint'
            )}
          >
            {duration(playing || progress > 0 ? elapsed : total)}
          </span>

          {playing && (
            <button
              type="button"
              onClick={cycleSpeed}
              className={cn(
                'rounded-full px-1.5 py-px text-[10px] font-bold',
                isMine ? 'bg-black/15 text-white' : 'bg-black/[.07] dark:bg-white/[.1]'
              )}
            >
              {SPEEDS[speedIndex]}×
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
