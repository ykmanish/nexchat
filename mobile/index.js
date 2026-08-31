/**
 * The real entry point.
 *
 * `expo-router/entry` was the entry before this, and the polyfills were
 * imported at the top of `app/_layout.js` — which is too late. @noble captures
 * its crypto reference the moment it is first imported:
 *
 *     exports.crypto = 'crypto' in globalThis ? globalThis.crypto : undefined;
 *
 * Router entry pulls in the whole route graph, and any route reaching the store
 * (`app/index.js` → `store/auth` → `e2ee` → `crypto` → @noble) can be evaluated
 * before the layout module runs. @noble then holds `undefined` for the rest of
 * the process, and the failure only surfaces later, at the first key
 * generation, as "crypto.getRandomValues must be defined" on the sign-up
 * screen.
 *
 * Installing the polyfills in their own module, imported before the router,
 * makes the ordering a property of the bundle rather than a race.
 */
import './src/lib/polyfills';
import './src/lib/typography';
import 'expo-router/entry';
