'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ShieldAlert, ChevronDown } from 'lucide-react';
import { useChat } from '@/store/chat';
import { arm as armCaptureGuard, isCaptureKey, captureCaveat } from '@/lib/captureguard';
import { cn } from '@/lib/utils';

/**
 * What being in a secret chat actually does on this device.
 *
 * Two jobs. It arms the capture guard for the whole thread rather than for one
 * photo, so the conversation blanks the moment a capture is suspected. And it
 * tells the other side when that happens, which is the part the person on the
 * far end cares about — they cannot stop a screenshot, but they can know.
 *
 * Both halves are honest-participant features and the banner says so. A browser
 * cannot block a screen capture, and a phone pointed at the screen defeats
 * every messenger ever written. What this catches is the ordinary case, and
 * what it promises is a warning rather than a wall — and on a phone, where a
 * screenshot is invisible to the page entirely, the banner says so.
 */
export function SecretGuard({ conversation }) {
  const reportScreenshot = useChat((s) => s.reportScreenshot);
  const lastReport = useRef(0);

  const enabled = !!conversation?.secret?.enabled;
  const alerts = conversation?.secret?.screenshotAlerts !== false;
  const id = conversation?._id;

  // Blank the thread around anything that looks like a capture.
  useEffect(() => {
    if (!enabled) return undefined;
    return armCaptureGuard();
  }, [enabled]);

  /**
   * Report the signals that are worth reporting.
   *
   * Only the deliberate ones: a capture keystroke, and printing. Window blur is
   * what the *blanking* reacts to, because a false positive there costs a
   * flicker — but reporting it would tell somebody "they screenshotted this"
   * every time their friend alt-tabbed, which is worse than saying nothing.
   */
  useEffect(() => {
    if (!enabled || !alerts || !id) return undefined;

    const report = (kind) => {
      const now = Date.now();
      if (now - lastReport.current < 15_000) return;
      lastReport.current = now;
      reportScreenshot(id, kind);
    };

    const onKey = (e) => {
      if (isCaptureKey(e)) report('screenshot');
    };
    const onPrint = () => report('screenshot');

    window.addEventListener('keydown', onKey, true);
    window.addEventListener('beforeprint', onPrint);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('beforeprint', onPrint);
    };
  }, [enabled, alerts, id, reportScreenshot]);

  /**
   * Screen recording, as far as a browser can tell.
   *
   * There is no API that reports another application recording the screen, and
   * there is not going to be one — so this catches the single case the platform
   * does expose: a capture started from inside this page. `getDisplayMedia` is
   * patched to notice a share that includes this tab. It is a narrow win and it
   * is stated as one; nothing here claims to see OBS running behind the
   * browser.
   */
  useEffect(() => {
    if (!enabled || !alerts || !id) return undefined;
    const media = navigator.mediaDevices;
    if (!media?.getDisplayMedia) return undefined;

    const original = media.getDisplayMedia.bind(media);
    media.getDisplayMedia = async (...args) => {
      const stream = await original(...args);
      try {
        reportScreenshot(id, 'recording');
      } catch {
        /* never let the report break the capture the user asked for */
      }
      return stream;
    };

    return () => {
      media.getDisplayMedia = original;
    };
  }, [enabled, alerts, id, reportScreenshot]);

  return null;
}

/**
 * The banner at the top of a secret thread.
 *
 * One line by default, with the caveat behind a tap. The first version put the
 * whole explanation on screen permanently, which on a desktop was two lines and
 * on a phone was five — a quarter of the visible thread, every time, saying the
 * same thing it said yesterday. The summary is what you need at a glance; the
 * fine print is what you need once.
 */
export function SecretBanner({ conversation }) {
  const [open, setOpen] = useState(false);
  if (!conversation?.secret?.enabled) return null;

  const seconds = conversation.settings?.disappearingSeconds || 0;
  const summary = [
    seconds ? 'vanishes after ' + ttl(seconds) : null,
    conversation.secret.blockForwarding !== false ? 'no forwarding' : null,
    conversation.secret.hideNotifications !== false ? 'silent alerts' : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="shrink-0 border-b border-line bg-surface-2/90">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="mx-auto flex w-full max-w-[820px] items-center gap-2 px-4 py-2 text-left"
      >
        <ShieldAlert size={14} className="shrink-0 text-brand-strong" />
        <span className="min-w-0 flex-1 truncate text-[12px] leading-snug">
          <span className="font-semibold">Secret chat</span>
          {summary && <span className="text-ink-muted"> · {summary}</span>}
        </span>
        <ChevronDown
          size={14}
          className={cn(
            'shrink-0 text-ink-faint transition-transform duration-200',
            open && 'rotate-180'
          )}
        />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <p className="mx-auto max-w-[820px] px-4 pb-3 text-[11.5px] leading-relaxed text-ink-muted">
              {captureCaveat()}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ttl(seconds) {
  if (seconds < 3600) return Math.round(seconds / 60) + ' minutes';
  if (seconds < 86_400) {
    const h = Math.round(seconds / 3600);
    return h + (h === 1 ? ' hour' : ' hours');
  }
  const d = Math.round(seconds / 86_400);
  return d + (d === 1 ? ' day' : ' days');
}
