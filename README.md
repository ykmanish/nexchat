# NexChat

A real-time, end-to-end encrypted chat app. Mobile-first UI that expands into a
two-pane desktop layout, with QR device linking so a laptop can join an account
that lives on a phone.

```
nexchat/
├── backend/     Express + MongoDB + Socket.IO
└── frontend/    Next.js (App Router, JSX) + Tailwind
```

---

## Running it

You need **Node 18+** and a **MongoDB** — a local `mongod`, an Atlas cluster, or
the bundled in-memory server for a zero-setup try.

### 1. Backend

```bash
cd backend && npm install && cp .env.example .env
```

Then either point `MONGODB_URI` at a real database and run:

```bash
npm run dev
```

…or skip the database entirely (data is wiped on restart):

```bash
npm run dev:mem
```

The API comes up on <http://localhost:5000>.

**Email.** Leave `SMTP_HOST` blank and verification codes are printed to the
server console *and* delivered to a throwaway [Ethereal](https://ethereal.email)
inbox whose preview link is logged. Fill in the SMTP block for real mail.

### 2. Frontend

```bash
cd frontend && npm install && cp .env.example .env.local && npm run dev
```

Open <http://localhost:3000>.

> Web Crypto requires a secure context. `localhost` counts; to test on a phone
> over your LAN you need HTTPS (ngrok, Caddy, or `next dev --experimental-https`)
> and `NEXT_PUBLIC_API_URL` pointing at the same host.

### 3. Smoke test (optional)

`backend/scripts/smoke-test.mjs` replays the whole contract against a running
API using Node's WebCrypto — the same algorithms the browser uses. It signs two
people up, exchanges encrypted messages, builds a group and a community, links a
device by QR, and checks that outsiders are locked out.

It reads verification codes from the server's own output, so start the API with
its log tee'd to a file:

```bash
cd backend && npm run dev:mem > server.log 2>&1
```

then, in another terminal:

```bash
cd backend && npm run smoke server.log
```

### 4. Test suites

Neither of these needs a server or a database of its own — the API ones boot the
app in-process against the in-memory Mongo, and the web ones drive the modules
under test directly with synthetic input.

```bash
cd backend && npm test
```

Forensic export verification, contact reachability (that somebody who added you
is reachable from New chat), and push delivery (that a backgrounded device is
still pushed to).

```bash
cd frontend && npm test
```

The flip, tilt and shake gesture state machines against synthetic accelerometer
data, on-device scam detection, and the view-once capture guard.

---

## How the encryption works

Keys are generated in the browser. The server only ever stores **public keys and
ciphertext** — it has no way to read a message.

**Account identity.** On signup the browser mints an ECDH P-256 identity pair and
an ECDSA P-256 signing pair. The private halves are wrapped with a key derived
from the password (PBKDF2-SHA256, 250k iterations) and stored server-side as an
opaque blob. That blob is what lets a new browser recover the account with a
password — and why a forgotten password means unrecoverable history.

**Per-device keys.** Every sign-in mints a fresh device key set: an identity
pair, a signed prekey, and 60 one-time prekeys. Sessions are established with an
X3DH-style handshake (four Diffie-Hellmans mixed through HKDF), then each
direction runs its own hash-ratchet chain, so a message key recovered today
cannot open yesterday's traffic.

**Sending.** A message is encrypted **once** with a random content key (AES-GCM-256).
That content key is then sealed separately for each recipient, twice over:

| Slot | Sealed to | Why it exists |
|---|---|---|
| `account` | The recipient's account identity key | Any device they own — now or later — can read history |
| `<deviceId>` | A ratcheting session with that device | Forward secrecy on the fast path |

Decryption tries the device slot first and falls back to the account slot, so a
stale or missing session degrades into "still readable" instead of "lost".

**Attachments** are encrypted in the browser before upload; the server stores
opaque bytes. The file's key, name and MIME type travel *inside* the encrypted
message body, never in the upload metadata.

**Device linking.** The new screen generates an ephemeral key pair and shows it
in a QR code. The trusted phone scans it, both sides display the same safety
number, and on approval the phone seals the account identity to that ephemeral
key. The server relays a blob it cannot open.

### What the server *can* see

Being straight about the limits: message **content**, attachments and stories are
unreadable to the server. Metadata is not — it necessarily knows who is in which
conversation, timestamps, message sizes, and read receipts. **Emoji reactions and
group names are stored in plaintext**, a deliberate trade for reaction summaries
and searchable chat lists. System events ("Ada added Grace") are server-authored
and therefore also plaintext.

---

## What's in it

**Messaging** — 1:1, groups, communities (with an auto-created General room),
replies, edits (15-minute window), delete for me / everyone, reactions, forwarding,
starring, pinning, multi-select, disappearing messages, drafts that sync across
your devices.

**Media** — photos, video, documents, voice notes with a live waveform and 1×/1.5×/2×
playback, a swipe-to-dismiss lightbox.

**Realtime** — typing and recording indicators, presence, delivered/read receipts,
per-device fan-out, offline queue that flushes on reconnect, gap-filling sync.

**Notifications** — Web Push to every device that is not currently on screen.
A connected socket is *not* treated as proof the message was seen: a backgrounded
phone keeps its websocket while the browser freezes the tab, so clients report
their visibility and a hidden device gets a push like a disconnected one. Sent at
high urgency, because Web Push defaults to normal and both FCM and APNs batch
that. Optional "someone is typing" notices, off by default. A **Send a test**
button on the notifications screen exercises the whole chain — VAPID keys, push
service, subscription, service worker — rather than just proving the browser can
draw a notification.

**Contacts** — a contact is one-directional, so New chat also lists people who
added *you* and people you already share a chat with, each with a one-tap save.
A chat with someone unsaved carries a save-contact bar above the composer.

**Safety** — on-device scam detection, community scam reports, an emergency share
that sends your live location to chosen contacts as ordinary encrypted messages,
a shake gesture to raise it without looking at the screen (five-second countdown,
cancelled by any tap), flip-to-hide, tilt-to-read, and app lock.

**Calls** — 1:1 voice and video over WebRTC with in-app signalling; media is
peer-to-peer and never touches the server.

**Stories** — 24-hour encrypted updates with viewer lists and reactions.

**Accounts** — email signup with a 6-digit code, password reset that can re-wrap
your keys if you still remember the old password, linked-device management with
per-device revocation, privacy controls, blocking.

**Feel** — Apple-flavoured design (SF Pro on Apple hardware, Inter elsewhere),
spring physics on every transition, synthesised UI sounds via the Web Audio API
(no audio files to download), haptics, light/dark/auto, six wallpapers, adjustable
text size, and a reduce-motion switch.

---

## API sketch

| | |
|---|---|
| `POST /api/auth/register` · `verify-email` · `login` · `refresh` · `logout` | account lifecycle |
| `POST /api/auth/forgot-password` · `reset-password` · `change-password` | recovery |
| `GET /api/keys/:userId` · `GET /api/keys/roster` · `POST /api/keys/prekeys` | key distribution |
| `POST /api/devices/link/init` · `scan` · `approve` · `claim` | QR device linking |
| `GET/POST /api/conversations` (+ `/direct`, `/group`, `/community`) | chats |
| `GET/POST /api/messages` (+ reactions, star, pin, forward, receipts) | messaging |
| `POST /api/uploads/media` · `/voice` · `/story-media` | encrypted blobs |
| `GET/POST /api/stories` | 24-hour updates |

Socket.IO carries `message:send`, `message:delivered`, `message:read`,
`message:react`, `typing:*`, `presence:update`, `call:*`, and `sync:since`.

---

## Before deploying

- Replace both JWT secrets with real random values.
- **Set `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`.** Left blank, the server
  mints a pair at boot and notifications work — until the next restart, at which
  point every stored subscription is signed against a key the push service no
  longer accepts. Delivery stops, clients still believe they are subscribed, and
  nothing appears in any log. Generate a pair with
  `npx web-push generate-vapid-keys`; the notifications screen warns while the
  keys are temporary.
- Put uploads on object storage — the local `uploads/` directory does not survive
  a container restart and will not scale past one instance.
- Add a TURN server; STUN alone fails behind symmetric NAT.
- Socket.IO needs the Redis adapter to run more than one API instance.
- Serve over HTTPS. Web Crypto and camera access both require it.
