# Chax for Android

The native client. React Native (Expo SDK 54, RN 0.81), talking to the same
API as the web app at **https://chax.nexarrow.eu** — no backend fork, no second
source of truth.

```
nexchat/
├── backend/     Express + MongoDB + Socket.IO   ← unchanged, plus FCM
├── frontend/    Next.js                          ← untouched
└── mobile/      React Native                     ← this
```

---

## The part that matters most

The two clients share an account. The password-wrapped identity blob, the prekey
bundles and every message key slot are minted by whichever client you last
signed in from, so the native crypto has to be **byte-identical** to the
browser's — not merely equivalent. React Native has no Web Crypto, so
`src/lib/crypto.js` re-implements it on [@noble](https://paulmillr.com/noble/):

| Web Crypto | here |
|---|---|
| `ECDH P-256` `deriveBits(256)` | `p256.getSharedSecret(…).slice(1)` |
| `ECDSA P-256 / SHA-256` | `p256.sign(sha256(m))`, compact r‖s |
| `HKDF-SHA256` | `@noble/hashes/hkdf` |
| `AES-GCM-256` | `@noble/ciphers` `gcm` |
| `PBKDF2-SHA256` 250k | `@noble/hashes/pbkdf2` |
| `exportKey('pkcs8')` | DER encoder in `crypto.js` |

Two test suites hold that line, and both run in plain Node with no device:

```bash
npm test
```

- **`crypto-parity.test.mjs`** loads the *actual* `frontend/src/lib/crypto.js`
  onto Node's WebCrypto and checks 59 properties against the native port —
  including that a browser-minted PKCS#8 private key re-encodes to the same
  bytes, that both sides derive the same X3DH root, and that message keys match
  at ratchet counters 0, 1, 5 and 40.
- **`envelope.test.mjs`** goes a level up: a message composed the way the web
  client composes one, opened the way the native client opens one — through the
  device slot and the account slot, in both directions, out of order, and on a
  device that did not exist when the message was sent.

If you change anything under `src/lib/crypto.js`, run these before you ship. A
mismatch does not throw; it just means history stops opening.

---

## Running it

```bash
npm install
npm run android          # dev build on a connected device
```

Point it somewhere else with `CHAX_API_URL`:

```bash
CHAX_API_URL=http://192.168.1.20:5000 npm run android
```

---

## Building the APK

The toolchain: **JDK 17**, Android **SDK platform 36**, build-tools **36.0.0**.

```bash
npm run prebuild
cd android && ./gradlew assembleRelease
```

The APK lands at `android/app/build/outputs/apk/release/app-release.apk`.

**Signing.** `plugins/withReleaseSigning.js` wires `credentials/signing.json`
into the generated Gradle config. That directory is gitignored and is not
recoverable — back it up. An APK signed with a different key cannot upgrade an
installed one in place, so everyone would have to uninstall first.

If `credentials/` is missing the build still succeeds, signed with the debug
key. Fine for trying it; not fine for anything you distribute.

---

## Notifications

This is the feature the app was built around, so it is worth being precise about
how it works.

### Two transports

**FCM is primary.** The server sends a **data-only** message — no `notification`
block. That is deliberate: a message carrying `notification` is drawn by Android
itself, and the app never gets to fill in the text or attach the reply action.
Data-only wakes the background task in `src/lib/notifications.js` instead.

**The socket is the fallback.** While the process is alive, `realtime.js` already
has the decrypted message, so it raises the notification locally — and can show
the actual text, which the FCM path cannot. Both funnel through `present()` with
one collapse id per conversation, so a message never produces two notifications.

Without `google-services.json` the app builds and runs; it just falls back to the
socket, and the settings screen says so rather than claiming push is on.

### Replying from the shade

The `reply` action is registered with `opensAppToForeground: false`, which is
what makes it a *direct* reply rather than a shortcut into the app: Android keeps
the shade open and hands the typed text to a background JS context.

That context has no UI and, on a cold start, no store — so
`sendReplyFromNotification` does its own minimal boot: hydrate tokens from the
keystore, load keys from the vault, fetch the conversation for its participant
list, encrypt, POST. REST rather than the socket, because the websocket is
usually down in the background and waiting on a handshake risks the process being
stopped mid-flight.

**The reply is written to a durable outbox before the network is touched.**
Android can stop a background context at any moment, and a one-word answer that
was typed but never sent is worse than one that arrives late. `flushOutbox()`
runs on every app start and finishes anything left over.

### Setting up FCM

1. Create a Firebase project and add an Android app with package
   **`eu.nexarrow.chax`**.
2. Download `google-services.json` into `mobile/`, then `npm run prebuild`.
3. In the same project, Service accounts → generate a private key. Put that JSON
   on the server and point the API at it:

   ```
   FCM_SERVICE_ACCOUNT=/etc/chax/firebase-service-account.json
   ```

   (or `FCM_SERVICE_ACCOUNT_JSON=` with the JSON inline).

4. Restart the API. It logs `FCM ready (project …)`, and
   `GET /api/devices/vapid-public-key` starts reporting `fcm: true`.

### While you are in there

Set `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` on the server if they are still
blank. With no keys the server mints a pair at boot, so every stored web
subscription silently stops delivering after each restart — the settings screen
warns about this in both clients.

---

## Why the tabs feel the way they do

Three settings, all fighting a default:

- `lazy: false` — every tab renders at startup, so the first switch is not also
  the first mount. The splash screen hides the cost.
- `detachInactiveScreens={false}` — inactive tabs stay in the native view
  hierarchy, which is what preserves scroll position. A detached screen comes
  back at the top, and that is the clearest tell that an app is not native.
- `freezeOnBlur: true` plus `enableFreeze(true)` — those mounted screens stop
  re-rendering while off screen, so keeping them costs CPU only when something
  changes.

Switching tabs is then a native view swap rather than a React remount.

---

## What is here, and what is not

Ported and working:

- Sign up, email verification, sign in, and unlock-on-this-device
- Chat list with archive, search, unread badges, pinning, mute state
- Threads: history, day separators, grouped bubbles, delivery and read ticks,
  reply quotes, reactions, attachment rendering (images, video, documents)
- Sending text, with optimistic bubbles and retry on failure
- Realtime: typing and recording indicators, presence, receipts, edits,
  deletions, offline queue that flushes on reconnect
- New chat, including people who added *you* and people you have chatted with
- Notifications: FCM, socket fallback, direct reply, mark-as-read, test send
- Stories and call history, read-only
- Settings: notifications, typing notices, haptics, sign out

Not ported yet — the web client still does all of it:

- **Sending attachments.** The picker opens; the encrypt-and-upload path is not
  wired to it. Receiving and decrypting attachments does work.
- **Calls.** History lists; WebRTC signalling is not implemented.
- **Message actions** beyond what the store exposes — no long-press menu yet for
  edit, delete, forward, star, pin, or the reaction picker.
- **Group and community creation**, member management, polls.
- **Stories**: viewing and posting.
- **Safety features**: on-device scam detection, emergency share, the shake,
  flip and tilt gestures, app lock.
- **Account extras**: password reset, QR device linking, passkeys, encrypted
  backups, the transparency and forensic-export screens.
- **Appearance**: bubble colours, wallpapers, font scaling.

The store layer in `src/store/chat.js` is a near-literal port of the web one, so
most of the second list is UI work against methods that already exist and are
already wired to the API.
