'use client';

import { useCallback, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Heart, ChevronLeft, ChevronRight, Play, Volume2, VolumeX } from 'lucide-react';
import { mediaUrl } from '@/lib/api';
import { cn } from '@/lib/utils';

/* One frame for every post — 4:5, so a column of cards is a column rather than
   a jumble of different heights — with the picture fitted *inside* it whole.
   `contain`, not `cover`: cropping to fill guarantees a uniform grid but cuts
   the sides off anything that is not already 4:5, and a photo you have to open
   to see properly is not really in the feed. The letterbox is filled with the
   picture's own blurred edges, so a portrait shot still reads as one object
   rather than as an image marooned in a grey box. */
const FRAME_RATIO = 4 / 5;

/**
 * A post's photos or video.
 *
 * Three things here are load-bearing rather than decorative:
 *
 *   - The frame's aspect ratio is fixed before anything downloads, from the
 *     dimensions the server measured. Without it every image landing shoves
 *     the rest of the feed down, which is the single worst thing a feed does.
 *   - The blurred placeholder sits underneath, so the card is never an empty
 *     grey box.
 *   - The carousel is a native scroll-snap strip, not a transform carousel.
 *     It costs nothing, it flicks correctly on a touchpad and a phone, and it
 *     keeps working when JavaScript is busy.
 */
export function PostMedia({ media = [], onDoubleTapLike, onOpen, liked, className }) {
  const [index, setIndex] = useState(0);
  const [burst, setBurst] = useState(0);
  const stripRef = useRef(null);
  const lastTap = useRef(0);

  const many = media.length > 1;

  const scrollTo = useCallback((next) => {
    const strip = stripRef.current;
    if (!strip) return;
    const clamped = Math.max(0, Math.min(media.length - 1, next));
    strip.scrollTo({ left: clamped * strip.clientWidth, behavior: 'smooth' });
    setIndex(clamped);
  }, [media.length]);

  /* Which slide is showing is read off the scroll position rather than tracked
     in state as it moves — a scroll handler that re-renders on every frame is
     how a carousel starts dropping frames. */
  const onScroll = (e) => {
    const el = e.currentTarget;
    const next = Math.round(el.scrollLeft / el.clientWidth);
    if (next !== index) setIndex(next);
  };

  /**
   * Double-tap to like.
   *
   * Implemented by hand rather than with `onDoubleClick`, because on touch that
   * event does not fire reliably and, where it does, the browser has already
   * dispatched two clicks — so a double-tap on the picture also counted as two
   * taps on whatever was underneath it.
   */
  const onPointerUp = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    const now = Date.now();
    const isDouble = now - lastTap.current < 300;
    lastTap.current = isDouble ? 0 : now;

    if (isDouble) {
      e.preventDefault();
      setBurst((n) => n + 1);
      onDoubleTapLike?.();
      return;
    }

    // A single tap opens the viewer, but only after the double-tap window has
    // passed — otherwise the first of two taps opens it under the second.
    if (onOpen) {
      const tapped = now;
      setTimeout(() => {
        if (lastTap.current === tapped) onOpen(index);
      }, 300);
    }
  };

  if (!media.length) return null;

  return (
    <div
      className={cn('relative select-none overflow-hidden bg-black/[.04] dark:bg-white/[.04]', className)}
      style={{ aspectRatio: String(FRAME_RATIO) }}
    >
      <div
        ref={stripRef}
        onScroll={many ? onScroll : undefined}
        onPointerUp={onPointerUp}
        className={cn(
          'flex h-full w-full',
          /* Only a carousel is a scroller. A single photo in a scrollable
             container still rubber-bands under a finger on touch, so the
             picture slid about while you were trying to tap or scroll the
             feed past it. */
          many
            ? 'no-scrollbar snap-x snap-mandatory overflow-x-auto overscroll-x-contain'
            : 'overflow-hidden',
          onOpen && 'cursor-zoom-in'
        )}
      >
        {media.map((item, i) => (
          <Slide key={item.url + i} item={item} active={i === index} />
        ))}
      </div>

      {/* The heart that blooms on a double-tap. Keyed on a counter so a rapid
          second double-tap restarts it instead of being swallowed. */}
      <AnimatePresence>
        {burst > 0 && (
          <motion.div
            key={burst}
            initial={{ opacity: 0, scale: 0.4 }}
            animate={{ opacity: [0, 1, 1, 0], scale: [0.4, 1.15, 1, 1.4] }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.9, times: [0, 0.25, 0.6, 1], ease: 'easeOut' }}
            onAnimationComplete={() => setBurst(0)}
            className="pointer-events-none absolute inset-0 grid place-items-center"
          >
            <Heart
              size={92}
              className="text-white drop-shadow-[0_2px_18px_rgba(0,0,0,.45)]"
              fill="currentColor"
              strokeWidth={0}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {many && (
        <>
          <span className="pointer-events-none absolute right-3 top-3 rounded-full bg-black/55 px-2.5 py-1 text-[11.5px] font-semibold tabular-nums text-white backdrop-blur-sm">
            {index + 1}/{media.length}
          </span>

          {/* Arrows are desktop-only: on touch the strip is already swipeable
              and a tap target over the picture would fight the double-tap. */}
          {index > 0 && (
            <Arrow side="left" onClick={() => scrollTo(index - 1)} />
          )}
          {index < media.length - 1 && (
            <Arrow side="right" onClick={() => scrollTo(index + 1)} />
          )}

          <div className="pointer-events-none absolute bottom-3 left-0 right-0 flex justify-center gap-[5px]">
            {media.map((item, i) => (
              <span
                key={item.url + 'dot' + i}
                className={cn(
                  'h-[5px] rounded-full transition-all duration-300',
                  i === index ? 'w-[5px] bg-white' : 'w-[5px] bg-white/45'
                )}
              />
            ))}
          </div>
        </>
      )}

      {liked && (
        <span className="pointer-events-none absolute inset-0 ring-1 ring-inset ring-brand/20" />
      )}
    </div>
  );
}

function Arrow({ side, onClick }) {
  const Icon = side === 'left' ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      aria-label={side === 'left' ? 'Previous photo' : 'Next photo'}
      className={cn(
        'absolute top-1/2 hidden h-8 w-8 -translate-y-1/2 place-items-center rounded-full',
        'bg-black/40 text-white backdrop-blur-sm transition hover:bg-black/60 md:grid',
        side === 'left' ? 'left-2.5' : 'right-2.5'
      )}
    >
      <Icon size={18} strokeWidth={2.4} />
    </button>
  );
}

/** One slide. Images fade in over their own blur; video gets real controls. */
function Slide({ item, active }) {
  const [loaded, setLoaded] = useState(false);

  return (
    <div className="relative h-full w-full shrink-0 snap-center snap-always overflow-hidden">
      {/* Stays put once the picture has loaded — it is what fills the space a
          contained image leaves at the edges. */}
      {item.placeholder && (
        <img
          src={item.placeholder}
          alt=""
          aria-hidden
          className="absolute inset-0 h-full w-full scale-110 object-cover blur-2xl saturate-150"
        />
      )}

      {item.kind === 'video' ? (
        <VideoSlide item={item} active={active} onReady={() => setLoaded(true)} />
      ) : (
        <img
          src={mediaUrl(item.url)}
          alt={item.alt || ''}
          draggable={false}
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(true)}
          className={cn(
            'relative h-full w-full object-contain transition-opacity duration-300',
            loaded ? 'opacity-100' : 'opacity-0'
          )}
        />
      )}
    </div>
  );
}

/**
 * Video in a feed.
 *
 * Muted by default and never autoplaying with sound, which is the only
 * behaviour browsers will allow anyway — an unmuted autoplay is refused and
 * the element silently stays on frame one. Playing is a deliberate tap, and
 * scrolling a playing video off screen pauses it so a feed does not turn into
 * six soundtracks at once.
 */
function VideoSlide({ item, active, onReady }) {
  const ref = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);

  const toggle = (e) => {
    e.stopPropagation();
    const video = ref.current;
    if (!video) return;
    if (video.paused) {
      video.play().then(() => setPlaying(true)).catch(() => {});
    } else {
      video.pause();
      setPlaying(false);
    }
  };

  return (
    <>
      <video
        ref={ref}
        src={mediaUrl(item.url)}
        muted={muted}
        loop
        playsInline
        preload="metadata"
        onLoadedData={onReady}
        onPause={() => setPlaying(false)}
        onPlay={() => setPlaying(true)}
        className="relative h-full w-full object-contain"
      />

      {!playing && (
        <span className="pointer-events-none absolute inset-0 grid place-items-center">
          <span className="grid h-14 w-14 place-items-center rounded-full bg-black/45 text-white backdrop-blur-sm">
            <Play size={24} fill="currentColor" strokeWidth={0} className="ml-0.5" />
          </span>
        </span>
      )}

      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? 'Pause video' : 'Play video'}
        className="absolute inset-0"
      />

      {active && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            const video = ref.current;
            setMuted((m) => {
              if (video) video.muted = !m;
              return !m;
            });
          }}
          aria-label={muted ? 'Unmute' : 'Mute'}
          className="absolute bottom-3 right-3 grid h-8 w-8 place-items-center rounded-full bg-black/50 text-white backdrop-blur-sm transition hover:bg-black/70"
        >
          {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
        </button>
      )}
    </>
  );
}
