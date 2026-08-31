/**
 * Error reporting that survives a release build.
 *
 * Every failure in this app used to end at `toast.error(err.message)`, which
 * tells the person something went wrong and tells whoever has to fix it
 * nothing at all — no context, no stack, nothing in `adb logcat`. That is how
 * "sending doesn't work" stayed a mystery through three builds.
 *
 * `console.error` is not stripped from release bundles: it reaches logcat under
 * the ReactNativeJS tag, so a plugged-in phone gives up the real cause. The
 * `where` label is the important half — the message alone rarely says which of
 * four network calls produced it.
 */
export function report(where, error, extra) {
  const detail = {
    where,
    message: error?.message || String(error),
    status: error?.status,
    code: error?.code,
    ...(extra || {}),
  };

  try {
    console.error('[chax] ' + where + ' — ' + JSON.stringify(detail));
    // The stack is separate because JSON.stringify drops it, and a minified
    // stack is still enough to tell two call sites apart.
    if (error?.stack) console.error('[chax] stack: ' + String(error.stack).slice(0, 900));
  } catch {
    /* reporting must never be the thing that throws */
  }

  return error;
}

/** Breadcrumb for the paths that are working, so a silence is meaningful. */
export function trace(where, detail) {
  try {
    console.log('[chax] ' + where + (detail ? ' ' + JSON.stringify(detail) : ''));
  } catch {
    /* ignore */
  }
}
