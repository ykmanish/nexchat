'use client';

import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { rememberScroll, recallScroll } from './scrollmemory';

/* Restoring after paint shows the top of the list for a frame, which is the
   flicker this exists to avoid — so layout effect on the client. */
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** How long to keep trying to restore while the pane fills out. */
const RESTORE_WINDOW_MS = 700;
const RESTORE_STEP_MS = 50;

/**
 * Binds a scroll container to a remembered position, so a tab you come back to
 * is where you left it.
 *
 * Two things here were learned the hard way.
 *
 * Recording does not use requestAnimationFrame. A rAF callback does not run
 * while its tab is in the background — which is precisely the moment a pane is
 * about to be navigated away from — so the last position was silently never
 * written and every return landed at the top. A timestamp throttle runs
 * whatever the tab is doing.
 *
 * Restoring is not a single assignment either. A pane mounts before its
 * content has height, and `scrollTop = 1200` against a container that is still
 * 900px tall clamps to zero and stays there. It retries for a few hundred
 * milliseconds and stops the moment the position sticks.
 */
export function usePaneScroll(key) {
  const ref = useRef(null);
  const lastWrite = useRef(0);
  /* The last position actually observed, kept out of the DOM on purpose — see
     the note on the cleanup below. */
  const latest = useRef(0);

  useIsomorphicLayoutEffect(() => {
    const node = ref.current;
    if (!node || !key) return undefined;

    const target = recallScroll(key);
    if (!target) return undefined;

    let timer = null;
    const started = Date.now();

    const attempt = () => {
      if (!ref.current) return;
      ref.current.scrollTop = target;

      // Landed, or the content is genuinely too short to hold the position.
      const stuck = Math.abs(ref.current.scrollTop - target) < 2;
      const maxed = ref.current.scrollHeight - ref.current.clientHeight <= target;
      if (stuck || maxed || Date.now() - started > RESTORE_WINDOW_MS) return;

      timer = setTimeout(attempt, RESTORE_STEP_MS);
    };

    attempt();
    return () => clearTimeout(timer);
  }, [key]);

  useEffect(() => {
    const node = ref.current;
    if (!node || !key) return undefined;

    const onScroll = () => {
      // Always current, whatever the throttle decides to do with it.
      latest.current = node.scrollTop;

      const now = Date.now();
      if (now - lastWrite.current < 100) return;
      lastWrite.current = now;
      rememberScroll(key, latest.current);
    };

    node.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      node.removeEventListener('scroll', onScroll);

      /* `latest.current`, not `node.scrollTop`. React unmounts the children
         before it runs this cleanup, so by now the pane has no content, its
         scroll height has collapsed and the browser has already clamped
         scrollTop to zero. Reading the DOM here does not save the position —
         it overwrites a good one with 0, which is exactly why every tab came
         back at the top even though the scroll handler had recorded it
         correctly a moment earlier. */
      if (latest.current > 0) rememberScroll(key, latest.current);
    };
  }, [key]);

  /** Jump to the top — what tapping the wordmark should do. */
  const scrollToTop = useCallback(
    (behavior = 'smooth') => {
      ref.current?.scrollTo({ top: 0, behavior });
      rememberScroll(key, 0);
    },
    [key]
  );

  return { ref, scrollToTop };
}
