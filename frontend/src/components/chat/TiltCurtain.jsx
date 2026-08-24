'use client';

import { useCallback, useEffect, useRef } from 'react';
import * as tilt from '@/lib/tiltreveal';
import { feedback } from '@/lib/sound';

/**
 * Drives the tilt-to-read blur. Renders nothing.
 *
 * Its output is a class on `<html>`, which the stylesheet turns into a blur over
 * everything marked `data-private`. That indirection is the point — the sensor
 * reports around sixty times a second, and pushing that through React to
 * re-render a screenful of message bubbles would be indefensible when a single
 * class mutation does the same job.
 *
 * The escape hatch is a tap on the blurred content itself rather than a visible
 * control. A phone in a car mount or propped against a monitor never reaches the
 * reading angle, so some way to clear the blur by hand is necessary — but a pill
 * floating permanently over the chat list is a banner announcing a private
 * setting, and it was in the way. Tapping what you cannot read is the obvious
 * thing to try anyway.
 *
 * The tap is swallowed rather than passed on, which is deliberate: opening a
 * chat you cannot read, or a message you cannot see, is not what the tap meant.
 */
export function TiltCurtain() {
  const peeking = useRef(false);
  const peekTimer = useRef(null);
  /* The sensor callback closes over its first render, so the current hidden
     state has to live somewhere it can read. */
  const hidden = useRef(false);

  const paint = useCallback((shouldHide) => {
    hidden.current = shouldHide;
    document.documentElement.classList.toggle('tilt-hidden', shouldHide);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let stopSensor = () => {};

    /** Holds the blur off for a few seconds, for a phone that cannot be tilted. */
    const peek = () => {
      feedback('tap');
      peeking.current = true;
      paint(false);

      clearTimeout(peekTimer.current);
      peekTimer.current = setTimeout(() => {
        peeking.current = false;
        // Back to whatever the phone is actually doing, and until the next
        // sample says otherwise the safe answer is hidden.
        paint(true);
      }, tilt.PEEK_MS);
    };

    /* Capture phase, so the tap is consumed before a chat row or a bubble can
       act on it. Scrolling is unaffected: a drag produces no click. */
    const onClickCapture = (event) => {
      if (!hidden.current || peeking.current) return;
      if (!event.target.closest?.('[data-private]')) return;

      event.preventDefault();
      event.stopPropagation();
      peek();
    };

    /**
     * Tears down and rebuilds from the current setting.
     *
     * Called again on every change, so switching the feature on, off, or to a
     * different sensitivity takes effect on the tap rather than at the next
     * reload — which is what made the toggle feel broken before.
     */
    const arm = (settings) => {
      stopSensor();
      clearTimeout(peekTimer.current);
      peeking.current = false;
      document.removeEventListener('click', onClickCapture, true);
      paint(false);

      if (!settings.enabled || !tilt.isSupported()) return;

      document.addEventListener('click', onClickCapture, true);
      stopSensor = tilt.watch(
        (readable) => paint(!readable && !peeking.current),
        { threshold: settings.threshold }
      );
    };

    const unsubscribe = tilt.config.subscribe((settings) => {
      if (!cancelled) arm(settings);
    });

    tilt.config.get().then((settings) => {
      if (!cancelled) arm(settings);
    });

    return () => {
      cancelled = true;
      unsubscribe();
      stopSensor();
      clearTimeout(peekTimer.current);
      document.removeEventListener('click', onClickCapture, true);
      // Leaving the class behind would blur the app permanently once the
      // setting is switched off.
      document.documentElement.classList.remove('tilt-hidden');
    };
  }, [paint]);

  return null;
}
