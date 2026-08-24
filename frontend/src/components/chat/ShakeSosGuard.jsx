'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Siren, X } from 'lucide-react';
import * as shake from '@/lib/shakegesture';
import * as sos from '@/lib/sos';
import { useUI, toast } from '@/store/ui';
import { feedback } from '@/lib/sound';

/**
 * Shake to raise the emergency share.
 *
 * The gesture never sends anything by itself. It opens this countdown, and any
 * tap anywhere cancels it — which is the only defensible way to hang a
 * broadcast off a motion sensor. A shake is a broad signal and it will fire by
 * accident; the question is only whether the accident costs you five seconds or
 * sends your location to five people. An emergency feature that cries wolf gets
 * switched off, and a switched-off safety feature protects nobody.
 *
 * Five seconds is the number because it has to survive being wrong in both
 * directions: long enough to notice and stop, short enough that somebody who
 * shook the phone on purpose is not standing there waiting.
 *
 * The countdown is loud on purpose — full screen, red, a number you can read at
 * arm's length — for the case where the phone is in a pocket and the only signal
 * you get is the vibration. It also states what is about to happen, because a
 * countdown that does not say what it is counting down to is just alarming.
 */
export function ShakeSosGuard({ armed }) {
  const openSheet = useUI((s) => s.openSheet);

  const [countdown, setCountdown] = useState(null); // ms remaining, or null
  const deadline = useRef(0);
  const firing = useRef(false);

  const cancel = useCallback((reason = 'cancelled') => {
    deadline.current = 0;
    setCountdown(null);
    if (reason === 'cancelled') {
      feedback('close');
      toast.info('Emergency alert cancelled');
    }
  }, []);

  /* ── the sensor ── */
  useEffect(() => {
    if (!armed) return undefined;

    let cancelled = false;
    let stop = () => {};

    const arm = (settings) => {
      stop();
      if (!settings.enabled || !shake.isSupported()) return;

      stop = shake.watch(
        () => {
          // Already counting down, or already sharing. Either way, nothing to do.
          if (deadline.current || sos.active()) return;

          // The phone may be in a pocket, so the first confirmation has to be
          // one you can feel rather than see.
          feedback('error');
          deadline.current = Date.now() + shake.COUNTDOWN_MS;
          setCountdown(shake.COUNTDOWN_MS);
        },
        { sensitivity: settings.sensitivity }
      );
    };

    const unsubscribe = shake.config.subscribe((settings) => {
      if (!cancelled) arm(settings);
    });

    shake.config.get().then((settings) => {
      if (!cancelled) arm(settings);
    });

    return () => {
      cancelled = true;
      unsubscribe();
      stop();
    };
  }, [armed]);

  /* ── the countdown, and what happens at zero ── */
  useEffect(() => {
    if (countdown === null) return undefined;

    const tick = setInterval(async () => {
      const left = deadline.current - Date.now();

      if (left > 0) {
        setCountdown(left);
        return;
      }

      // Zero. Send it, once.
      clearInterval(tick);
      if (firing.current) return;
      firing.current = true;
      deadline.current = 0;
      setCountdown(null);

      try {
        await sos.start({});
        feedback('error');
        toast.error('Emergency share started — your location is going out', {
          duration: 8000,
        });
        // The sheet is where it is stopped, and where the updates are visible.
        openSheet('sos');
      } catch (err) {
        /* No contacts chosen yet is the likely reason, and it has to be said
           out loud — silently doing nothing after a countdown would be the
           worst possible outcome of a safety feature. */
        toast.error(err.message || 'Could not start the emergency share');
        openSheet('sos');
      } finally {
        firing.current = false;
      }
    }, 100);

    return () => clearInterval(tick);
  }, [countdown, openSheet]);

  /* Any key, any tap. Under stress, everything should be the cancel button. */
  useEffect(() => {
    if (countdown === null) return undefined;
    const onKey = () => cancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [countdown, cancel]);

  if (typeof document === 'undefined') return null;

  const seconds = countdown === null ? 0 : Math.max(1, Math.ceil(countdown / 1000));

  return createPortal(
    <AnimatePresence>
      {countdown !== null && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.14 }}
          onClick={() => cancel()}
          role="alertdialog"
          aria-live="assertive"
          className="fixed inset-0 z-[200] flex flex-col items-center justify-center bg-danger/95 px-8 text-center text-white"
        >
          <motion.div
            initial={{ scale: 0.9 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', damping: 22, stiffness: 320 }}
            className="flex flex-col items-center"
          >
            <span className="grid h-16 w-16 place-items-center rounded-full bg-white/15">
              <Siren size={30} />
            </span>

            <p className="mt-5 font-display text-[22px] tracking-tight">
              Sending your emergency alert
            </p>
            <p className="mt-1.5 max-w-[300px] text-[14px] leading-relaxed text-white/85">
              Your location goes to your emergency contacts in
            </p>

            <motion.span
              key={seconds}
              initial={{ scale: 1.35, opacity: 0.4 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
              className="my-3 font-display text-[76px] leading-none tabular-nums"
            >
              {seconds}
            </motion.span>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                cancel();
              }}
              className="mt-2 flex items-center gap-2 rounded-full bg-white px-7 py-3.5 text-[16px] font-semibold text-danger"
            >
              <X size={18} strokeWidth={2.6} />
              Cancel
            </button>

            <p className="mt-4 text-[12.5px] text-white/70">
              Tap anywhere to cancel
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
