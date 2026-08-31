/**
 * Tests the status-bar colour against a minimal document.
 *
 * The strip the phone draws above the app — the notch bar, the URL bar — is
 * painted from a `<meta name="theme-color">` tag and nothing else. That makes it
 * the one piece of the UI with no CSS, no cascade and no owner, which is why it
 * went wrong: a full-screen dark call screen sat under a pale grey band because
 * the tag still held the app's light header colour.
 *
 * The fix routes both writers — the theme, and a call that wants the bar to
 * match it — through one module, so what is worth proving is the handover:
 *
 *   - A call's colour wins over the theme's while the call is up.
 *   - The bar goes back to the theme's colour when the call ends, and to the
 *     *current* theme even if the theme changed mid-call. A cached "restore
 *     this" value would put the bar back to a colour the app is no longer using.
 *   - A theme change during a call does not repaint the bar out from under the
 *     call screen.
 *   - The iOS style tag stays consistent with the colour. It is a separate tag
 *     with only two values, and a light `default` style over a near-black call
 *     screen is unreadable.
 *   - Every call state gets its own colour, and all of them are dark, because
 *     the call screen is dark in both themes.
 *
 * Run: node scripts/statusbar.test.mjs   (from frontend/)
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/* ── a document, in as few lines as the module actually needs ── */

const head = [];

const makeMeta = () => {
  const attrs = {};
  return {
    attrs,
    setAttribute: (k, v) => {
      attrs[k] = v;
    },
    getAttribute: (k) => attrs[k] ?? null,
  };
};

globalThis.document = {
  head: { appendChild: (el) => head.push(el) },
  createElement: () => makeMeta(),
  querySelector: (selector) => {
    const name = /meta\[name="([^"]+)"\]/.exec(selector)?.[1];
    return head.find((el) => el.attrs.name === name) || null;
  },
  documentElement: { style: { setProperty: () => {} } },
};

const source = fs.readFileSync(path.resolve('src/lib/theme.js'), 'utf8');
const shim = path.resolve('src/lib/.theme.undertest.mjs');
fs.writeFileSync(shim, source);
const theme = await import(pathToFileURL(shim).href);

/* What the phone is currently being told. */
const barColor = () => document.querySelector('meta[name="theme-color"]')?.getAttribute('content');
const barStyle = () =>
  document
    .querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')
    ?.getAttribute('content');

/* ── cases ── */

const results = [];
const check = (name, fn) => {
  try {
    fn();
    results.push(['PASS', name]);
  } catch (err) {
    results.push(['FAIL', name + ' — ' + err.message]);
  }
};
const assert = (cond, message) => {
  if (!cond) throw new Error(message);
};

check('the bar follows the theme when nothing is overriding it', () => {
  theme.setStatusBarOverride(null);

  theme.setStatusBarBase(false);
  assert(barColor() === theme.STATUS_BAR.light, 'light theme gave ' + barColor());
  assert(barStyle() === 'default', 'light theme gave the ' + barStyle() + ' iOS style');

  theme.setStatusBarBase(true);
  assert(barColor() === theme.STATUS_BAR.dark, 'dark theme gave ' + barColor());
  assert(barStyle() === 'black', 'dark theme gave the ' + barStyle() + ' iOS style');
});

check('only one tag of each kind is ever created', () => {
  theme.setStatusBarBase(true);
  theme.setStatusBarOverride(theme.CALL_STATUS_BAR.incoming);
  theme.setStatusBarOverride(null);
  theme.setStatusBarBase(false);

  const colors = head.filter((el) => el.attrs.name === 'theme-color');
  const styles = head.filter(
    (el) => el.attrs.name === 'apple-mobile-web-app-status-bar-style'
  );
  assert(colors.length === 1, colors.length + ' theme-color tags — the phone reads the first');
  assert(styles.length === 1, styles.length + ' iOS style tags');
});

check("a call's colour wins over the theme's", () => {
  theme.setStatusBarBase(false); // light app
  theme.setStatusBarOverride(theme.CALL_STATUS_BAR.incoming);

  assert(
    barColor() === theme.CALL_STATUS_BAR.incoming,
    'the call screen sat under ' + barColor()
  );
  // The call screen is dark whatever the app is, so the iOS style has to follow
  // the call and not the theme.
  assert(barStyle() === 'black', 'a dark call screen got the ' + barStyle() + ' iOS style');
});

check('a theme change during a call does not repaint the bar', () => {
  theme.setStatusBarBase(false);
  theme.setStatusBarOverride(theme.CALL_STATUS_BAR.connected);

  theme.setStatusBarBase(true); // the OS flipped to dark mid-call

  assert(
    barColor() === theme.CALL_STATUS_BAR.connected,
    'the theme repainted the bar over a live call: ' + barColor()
  );
});

check('ending the call gives the bar back to the current theme', () => {
  theme.setStatusBarBase(false); // light app
  theme.setStatusBarOverride(theme.CALL_STATUS_BAR.connected);
  theme.setStatusBarBase(true); // flipped to dark while the call was up
  theme.setStatusBarOverride(null); // hung up

  assert(
    barColor() === theme.STATUS_BAR.dark,
    'the bar came back as ' + barColor() + ' rather than the theme it is actually on'
  );
  assert(barStyle() === 'black', 'the iOS style came back as ' + barStyle());
});

check('every call state has its own colour, and every one of them is dark', () => {
  const states = Object.entries(theme.CALL_STATUS_BAR);
  assert(states.length >= 5, 'only ' + states.length + ' call states are coloured');

  const seen = new Set();
  states.forEach(([state, color]) => {
    assert(/^#[0-9a-f]{6}$/i.test(color), state + ' is not a six-digit hex colour: ' + color);
    assert(!seen.has(color), state + ' reuses the colour of another state');
    seen.add(color);

    /* Roughly relative luminance. The bound is 0.18 because of what these
       colours actually sit above: the call canvas is #0a0f0d at luma 0.02, but
       the brand bloom over it lifts the top of a ringing screen to somewhere
       near 0.28 — so a status bar anywhere in this range disappears into the
       screen, and one above it reads as a band. For scale, the app's own dark
       header is 0.07 and its light header is 0.97. */
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16) / 255);
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    assert(luma < 0.18, state + ' is too light (' + luma.toFixed(3) + ') for the call screen');
  });
});

check('the ringing states are the ones that stand out', () => {
  const luma = (color) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16) / 255);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };

  // An incoming call is the one that has to catch your eye from across a room.
  assert(
    luma(theme.CALL_STATUS_BAR.incoming) > luma(theme.CALL_STATUS_BAR.outgoing),
    'an incoming call is no brighter than one you placed yourself'
  );
});

/* ── report ── */

fs.unlinkSync(shim);

const failed = results.filter(([r]) => r === 'FAIL');
results.forEach(([r, name]) => console.log(r === 'PASS' ? '  ok  ' + name : '  FAIL  ' + name));
console.log(
  '\n' + (results.length - failed.length) + '/' + results.length + ' status-bar checks passed'
);
process.exit(failed.length ? 1 : 0);
