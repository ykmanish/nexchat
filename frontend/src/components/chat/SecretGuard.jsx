'use client';

import { useEffect, useRef } from 'react';
import { ShieldAlert } from 'lucide-react';
import { useChat } from '@/store/chat';
import { arm as armCaptureGuard, isCaptureKey, CAPTURE_CAVEAT } from '@/lib/captureguard';

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
 * what it promises is a warning rather than a wall.
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

/** The banner at the top of a secret thread. Says what it is, and what it is not. */
export function SecretBanner({ conversation }) {
  if (!conversation?.secret?.enabled) return null;

  const seconds = conversation.settings?.disappearingSeconds || 0;

  return (
    <div className="shrink-0 border-b border-line bg-surface-2/90 px-4 py-2.5">
      <div className="mx-auto flex max-w-[820px] items-start gap-2.5">
        <ShieldAlert size={15} className="mt-0.5 shrink-0 text-brand-strong" />
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] font-semibold leading-snug">Secret chat</p>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-ink-muted">
            {[
              seconds ? 'Messages vanish after ' + ttl(seconds) : null,
              conversation.secret.blockForwarding !== false ? 'forwarding is off' : null,
              conversation.secret.hideNotifications !== false ? 'notifications say nothing' : null,
            ]
              .filter(Boolean)
              .join(' · ')}
            . {CAPTURE_CAVEAT}
          </p>
        </div>
      </div>
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
