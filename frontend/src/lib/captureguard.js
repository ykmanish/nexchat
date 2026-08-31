'use client';

/**
 * Blanks view-once media around anything that looks like a screen capture.
 *
 * What this is, exactly — because the difference matters and overstating it
 * would be worse than not shipping it. **The web has no API to block a
 * screenshot.** Android and iOS both let a native app set a secure-window flag;
 * a page in a browser cannot, and no amount of JavaScript changes that. Anyone
 * determined to keep a copy of a view-once photo can point a second phone at the
 * screen, and that is true of every messenger ever written.
 *
 * What is actually available is the set of side effects a capture produces, and
 * those are worth catching because they cover the ordinary cases:
 *
 *   - **The window loses focus.** Android's screenshot chrome, the iOS app
 *     switcher, Windows' Snipping Tool overlay and macOS's capture cursor all
 *     take focus or hide the page for a moment. Blanking the instant focus goes
 *     is the single most effective rule here, and it is why the guard hides on
 *     `blur` and not only on `visibilitychange`.
 *   - **A capture key.** PrintScreen, Win+Shift+S, and Cmd+Shift+3/4/5 are all
 *     observable, and on desktop the keypress arrives before the pixels are
 *     read. The clipboard is overwritten too, since Windows' PrintScreen copies
 *     the screen into it.
 *   - **Printing.** `@media print` and the `beforeprint` event, because
 *     "print to PDF" is a screenshot with extra steps.
 *   - **The page being hidden at all.** Any tab switch, any minimise.
 *
 * Everything reveals again on focus, so the honest cost of a false positive is
 * a flicker rather than a lost photo.
 *
 * Two things it deliberately does *not* do. It does not try to detect screen
 * recording — there is no signal for it, and a guard that claims to catch
 * something it cannot is worse than an absent one. And it does not lie in the
 * UI: the copy next to it says a screenshot cannot be fully blocked in a
 * browser, because somebody relying on this deserves to know what it is worth.
 */

/** Set on <html> while a capture is suspected. The stylesheet does the rest. */
const CLASS = 'capture-shield';

/** How long the blank holds after a capture key, so the shot lands on black. */
const KEY_HOLD_MS = 2200;

/** Held after focus returns, because Android draws its screenshot toast late. */
const RETURN_HOLD_MS = 320;

let depth = 0;
let holdTimer = null;
let listeners = null;

const paint = (on) => {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle(CLASS, on);
};

/** True while at least one view-once surface is open. */
export const guarding = () => depth > 0;

function hide({ holdMs = 0 } = {}) {
  paint(true);
  clearTimeout(holdTimer);
  if (holdMs > 0) {
    holdTimer = setTimeout(() => {
      // Only reveal if the window is genuinely back in front of the user.
      if (isAttentive()) paint(false);
    }, holdMs);
  }
}

function reveal({ delayMs = 0 } = {}) {
  clearTimeout(holdTimer);
  holdTimer = setTimeout(() => {
    if (isAttentive()) paint(false);
  }, delayMs);
}

const isAttentive = () =>
  typeof document !== 'undefined' &&
  document.visibilityState === 'visible' &&
  (typeof document.hasFocus !== 'function' || document.hasFocus());

/**
 * Whether this keystroke is a screen-capture shortcut.
 *
 * Exported so the tests can assert the matcher without synthesising a whole
 * browser. `PrintScreen` arrives as `key: 'PrintScreen'` in Chromium on Windows
 * and as an empty key with `code: 'PrintScreen'` in some builds, so both are
 * checked.
 */
export function isCaptureKey(event) {
  if (!event) return false;

  const key = event.key || '';
  const code = event.code || '';

  if (key === 'PrintScreen' || code === 'PrintScreen') return true;

  // Windows / Linux: Win+Shift+S opens the snip overlay.
  if (event.shiftKey && event.metaKey && (key === 'S' || key === 's')) return true;

  // macOS: Cmd+Shift+3 (screen), 4 (region), 5 (recording panel).
  if (event.metaKey && event.shiftKey && ['3', '4', '5', '6'].includes(key)) return true;

  return false;
}

/** Best-effort: Windows' PrintScreen puts the screen on the clipboard. */
async function poisonClipboard() {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText('');
    }
  } catch {
    /* clipboard access is gated behind focus and permission — never critical */
  }
}

/**
 * Arms the guard. Returns a release function.
 *
 * Reference-counted, because two view-once surfaces can overlap — the bubble's
 * lightbox opening over a thread that is already guarded — and the first one to
 * close must not disarm the second.
 */
export function arm() {
  depth += 1;

  if (depth === 1 && typeof window !== 'undefined') {
    const onBlur = () => hide();
    const onFocus = () => reveal({ delayMs: RETURN_HOLD_MS });
    const onVisibility = () => {
      if (document.visibilityState === 'visible') reveal({ delayMs: RETURN_HOLD_MS });
      else hide();
    };
    const onKeyDown = (event) => {
      if (!isCaptureKey(event)) return;
      hide({ holdMs: KEY_HOLD_MS });
      poisonClipboard();
    };
    // Some platforms only report the capture key on release.
    const onKeyUp = onKeyDown;
    const onBeforePrint = () => hide({ holdMs: KEY_HOLD_MS });
    const onAfterPrint = () => reveal({ delayMs: RETURN_HOLD_MS });
    // A long-press "copy image" or drag-to-desktop is the same problem.
    const swallow = (event) => {
      event.preventDefault();
      return false;
    };

    listeners = { onBlur, onFocus, onVisibility, onKeyDown, onKeyUp, onBeforePrint, onAfterPrint, swallow };

    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    window.addEventListener('pagehide', onBlur);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('beforeprint', onBeforePrint);
    window.addEventListener('afterprint', onAfterPrint);
    document.addEventListener('contextmenu', swallow);
    document.addEventListener('dragstart', swallow);

    // Armed while already in the background — start hidden, not exposed.
    if (!isAttentive()) paint(true);
  }

  return function release() {
    depth = Math.max(0, depth - 1);
    if (depth > 0 || !listeners || typeof window === 'undefined') return;

    const l = listeners;
    listeners = null;
    clearTimeout(holdTimer);

    window.removeEventListener('blur', l.onBlur);
    window.removeEventListener('focus', l.onFocus);
    window.removeEventListener('pagehide', l.onBlur);
    document.removeEventListener('visibilitychange', l.onVisibility);
    window.removeEventListener('keydown', l.onKeyDown, true);
    window.removeEventListener('keyup', l.onKeyUp, true);
    window.removeEventListener('beforeprint', l.onBeforePrint);
    window.removeEventListener('afterprint', l.onAfterPrint);
    document.removeEventListener('contextmenu', l.swallow);
    document.removeEventListener('dragstart', l.swallow);

    // Leaving the class behind would black out the whole app.
    paint(false);
  };
}

/**
 * Whether this device can be caught taking a screenshot at all.
 *
 * On a desktop it can: the OS capture UI steals focus, and PrintScreen,
 * Win+Shift+S and Cmd+Shift+3/4/5 all arrive as keystrokes before the pixels
 * are read. On a phone none of that happens — a screenshot does not blur the
 * page, does not hide it, and there is no key to press. There is no web API
 * for it either, on Android or iOS.
 *
 * This exists so the copy can stop claiming otherwise. Telling somebody the
 * screen goes black when they take a screenshot, on a device where it plainly
 * does not, is worse than telling them nothing.
 */
export function canDetectCapture() {
  if (typeof window === 'undefined') return false;
  // A real keyboard and a fine pointer — that is what "desktop" means here.
  return window.matchMedia?.('(pointer: fine)').matches ?? false;
}

/** What the UI is allowed to claim, in one place so it cannot drift. */
export const CAPTURE_CAVEAT =
  'The screen goes black if this device tries to take a screenshot, but a browser cannot block one outright — and nothing stops a photo of the screen.';

/** The same honesty, for a phone, where the screenshot itself is invisible to us. */
export const CAPTURE_CAVEAT_TOUCH =
  'A phone can screenshot this without the browser ever knowing. The chat hides itself when you switch apps, and the other person is told when a capture is detected — but treat anything here as copyable.';

/** Whichever of the two is true on this device. */
export const captureCaveat = () =>
  canDetectCapture() ? CAPTURE_CAVEAT : CAPTURE_CAVEAT_TOUCH;
