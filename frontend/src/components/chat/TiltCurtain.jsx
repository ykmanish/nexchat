'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Eye, MoveUp } from 'lucide-react';
import * as tilt from '@/lib/tiltreveal';
import { feedback } from '@/lib/sound';

/**
 * Drives the tilt-to-read blur.
 *
 * Renders almost nothing: its real output is a class on `<html>`, which the
 * stylesheet turns into a blur over everything marked `data-private`. That
 * indirection is the point — the sensor reports around sixty times a second, and
 * pushing that through React to re-render a screenful of message bubbles would
 * be indefensible when a single class mutation does the same job.
 *
 * The visible part is the escape hatch. A phone in a car mount or propped on a
 * desk never reaches the reading angle, so without a way to peek the feature
 * would simply look broken. A real button rather than a hidden tap target, so
 * scrolling a blurred list still works normally.
 */
export function TiltCurtain() {
  const [enabled, setEnabled] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [peeking, setPeeking] = useState(false);
  const peekTimer = useRef(null);

  /* Kept in a ref as well as state: the sensor callback closes over its first
     render, so it needs somewhere current to read from. */
  const peekingRef = useRef(false);

  const paint = useCallback((shouldHide) => {
    const root = document.documentElement;
    root.classList.toggle('tilt-hidden', shouldHide);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let stop = () => {};

    (async () => {
      const settings = await tilt.config.get();
      if (cancelled || !settings.enabled || !tilt.isSupported()) return;

      setEnabled(true);
      stop = tilt.watch(
        (readable) => {
          const shouldHide = !readable && !peekingRef.current;
          setHidden(shouldHide);
          paint(shouldHide);
        },
        { threshold: settings.threshold }
      );
    })();

    return () => {
      cancelled = true;
      stop();
      clearTimeout(peekTimer.current);
      // Leaving the class behind would blur the app permanently after the
      // setting is switched off.
      document.documentElement.classList.remove('tilt-hidden');
    };
  }, [paint]);

  /** Holds the blur off for a few seconds, for a phone that cannot be tilted. */
  function peek() {
    feedback('tap');
    peekingRef.current = true;
    setPeeking(true);
    setHidden(false);
    paint(false);

    clearTimeout(peekTimer.current);
    peekTimer.current = setTimeout(() => {
      peekingRef.current = false;
      setPeeking(false);
      // Back to whatever the phone is actually doing. The next sample decides,
      // and until one arrives the safe answer is hidden.
      setHidden(true);
      paint(true);
    }, tilt.PEEK_MS);
  }

  if (!enabled) return null;

  return (
    <AnimatePresence>
      {hidden && !peeking && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ duration: 0.18 }}
          className="pointer-events-none fixed inset-x-0 bottom-[86px] z-30 flex justify-center px-4 sm:bottom-24"
        >
          <button
            type="button"
            onClick={peek}
            className="pointer-events-auto inline-flex items-center gap-2 rounded-full bg-ink/85 px-3.5 py-2 text-[12.5px] font-medium text-app shadow-pop backdrop-blur-sm"
          >
            <MoveUp size={14} />
            Tilt to read
            <span className="mx-0.5 h-3 w-px bg-current opacity-30" />
            <Eye size={14} />
            Peek
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
