import { z } from 'zod';

const email = z.string().trim().toLowerCase().email('Enter a valid email address');
const password = z
  .string()
  .min(8, 'Use at least 8 characters')
  .max(128, 'That password is too long');
const code = z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code');
const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');

const deviceInfo = z
  .object({
    name: z.string().max(60).optional(),
    platform: z.string().max(24).optional(),
    formFactor: z.enum(['mobile', 'tablet', 'desktop']).optional(),
  })
  .optional();

const signedPreKey = z.object({
  keyId: z.number().int(),
  publicKey: z.string().min(20),
  signature: z.string().min(20),
});

const deviceKeys = z.object({
  deviceId: z.string().min(4).max(64).optional(),
  registrationId: z.number().int(),
  identityPublicKey: z.string().min(20),
  signingPublicKey: z.string().min(20),
  signedPreKey,
  oneTimePreKeys: z
    .array(z.object({ keyId: z.number().int(), publicKey: z.string().min(20) }))
    .max(200)
    .optional(),
});

const encryptedIdentity = z.object({
  ciphertext: z.string().min(20),
  iv: z.string().min(8),
  salt: z.string().min(8),
  iterations: z.number().int().min(50_000).max(1_000_000).optional(),
});

const accountKeys = z.object({
  identityPublicKey: z.string().min(20),
  signingPublicKey: z.string().min(20),
  encryptedIdentity,
});

/* ────────────────────────────── auth ────────────────────────────── */

export const registerSchema = z.object({
  email,
  name: z.string().trim().min(1, 'What should we call you?').max(60),
  password,
});

export const verifyEmailSchema = z.object({
  email,
  code,
  keys: z.object({ account: accountKeys, device: deviceKeys }),
  device: deviceInfo,
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Enter your password'),
  keys: z.object({ device: deviceKeys }).optional(),
  device: deviceInfo,
});

export const resendSchema = z.object({
  email,
  purpose: z.enum(['verify-email', 'login', 'reset-password']).optional(),
});

export const forgotSchema = z.object({ email });

export const resetSchema = z.object({
  email,
  code,
  password,
  encryptedIdentity: encryptedIdentity.optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: password,
  encryptedIdentity: encryptedIdentity.optional(),
});

/* ────────────────────────────── devices ────────────────────────────── */

export const initLinkSchema = z.object({
  ephemeralPublicKey: z.string().min(20),
  deviceKeys,
  device: deviceInfo,
});

export const linkCodeSchema = z.object({
  code: z.string().trim().length(8, 'Link codes are 8 characters'),
});

export const approveLinkSchema = z.object({
  code: z.string().trim().length(8),
  payload: z.object({
    ciphertext: z.string().min(20),
    iv: z.string().min(8),
    senderEphemeralKey: z.string().min(20),
  }),
});

export const claimLinkSchema = z.object({
  code: z.string().trim().length(8),
  claimToken: z.string().min(16),
});

/* ────────────────────────────── keys ────────────────────────────── */

export const preKeysSchema = z.object({
  signedPreKey: signedPreKey.optional(),
  oneTimePreKeys: z
    .array(z.object({ keyId: z.number().int(), publicKey: z.string().min(20) }))
    .max(200)
    .optional(),
});

export const rotateIdentitySchema = accountKeys;

/* ────────────────────────────── conversations ────────────────────────────── */

export const directSchema = z.object({ userId: objectId });

export const groupSchema = z.object({
  name: z.string().trim().min(1, 'Give the group a name').max(80),
  about: z.string().max(500).optional(),
  avatar: z.string().nullable().optional(),
  memberIds: z.array(objectId).max(512).optional(),
  parentCommunity: objectId.nullable().optional(),
});

export const communitySchema = z.object({
  name: z.string().trim().min(1, 'Give the community a name').max(80),
  about: z.string().max(500).optional(),
  avatar: z.string().nullable().optional(),
  memberIds: z.array(objectId).max(1024).optional(),
});

export const updateConversationSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  about: z.string().max(500).optional(),
  avatar: z.string().nullable().optional(),
  settings: z
    .object({
      whoCanSend: z.enum(['everyone', 'admins']).optional(),
      whoCanEditInfo: z.enum(['everyone', 'admins']).optional(),
      whoCanAddMembers: z.enum(['everyone', 'admins']).optional(),
      disappearingSeconds: z.number().int().min(0).max(7_776_000).optional(),
      approvalRequired: z.boolean().optional(),
      slowModeSeconds: z.number().int().min(0).max(21_600).optional(),
    })
    .optional(),
});

export const stateSchema = z.object({
  pinned: z.boolean().optional(),
  muted: z.boolean().optional(),
  mutedUntil: z.string().datetime().nullable().optional(),
  muteMode: z.enum(['all', 'mentions']).optional(),
  archived: z.boolean().optional(),
  draft: z.string().max(5000).optional(),
  wallpaper: z.string().nullable().optional(),
});

export const banSchema = z.object({
  reason: z.string().max(200).optional(),
});

/* ────────────────────────────── messages ────────────────────────────── */

const keySlot = z.object({
  user: objectId,
  deviceId: z.string().min(1),
  ciphertext: z.string().min(1),
  iv: z.string().min(1),
  ephemeralPublicKey: z.string().nullable().optional(),
  preKeyId: z.number().int().nullable().optional(),
  signedPreKeyId: z.number().int().nullable().optional(),
  counter: z.number().int().optional(),
  sessionId: z.string().nullable().optional(),
});

const attachment = z.object({
  id: z.string(),
  kind: z.enum(['image', 'video', 'audio', 'voice', 'file', 'sticker', 'gif']),
  url: z.string(),
  size: z.number().optional(),
  width: z.number().nullable().optional(),
  height: z.number().nullable().optional(),
  duration: z.number().nullable().optional(),
  thumbnail: z.string().nullable().optional(),
  waveform: z.array(z.number()).optional(),
});

export const sendMessageSchema = z.object({
  conversationId: objectId,
  clientId: z.string().min(6).max(64),
  type: z
    .enum(['text', 'image', 'video', 'audio', 'voice', 'file', 'sticker', 'gif', 'location', 'contact', 'poll'])
    .optional(),
  body: z.object({
    ciphertext: z.string().min(1),
    iv: z.string().min(1),
    algorithm: z.string().optional(),
  }),
  keys: z.array(keySlot).max(2000),
  attachments: z.array(attachment).max(10).optional(),
  replyTo: objectId.nullable().optional(),
  forwardedFrom: objectId.nullable().optional(),
  forwardScore: z.number().int().min(0).max(99).optional(),
  expiresIn: z.number().int().min(0).max(7_776_000).nullable().optional(),
  viewOnce: z.boolean().optional(),
  poll: z
    .object({
      optionCount: z.number().int().min(2).max(12),
      multiple: z.boolean().optional(),
    })
    .optional(),
  /** Hangs this message under another as a thread reply. */
  threadRoot: objectId.nullable().optional(),
  /** Ids only — the @-names themselves are inside the encrypted body. */
  mentions: z.array(objectId).max(128).optional(),
  mentionsEveryone: z.boolean().optional(),
});

export const voteSchema = z.object({
  option: z.number().int().min(0).max(11),
});

export const editMessageSchema = z.object({
  body: z.object({ ciphertext: z.string().min(1), iv: z.string().min(1) }),
  keys: z.array(keySlot).max(2000),
});

export const reactionSchema = z.object({
  emoji: z.string().min(1).max(16),
});

export const forwardSchema = z.object({
  items: z
    .array(
      z.object({
        conversationId: objectId,
        clientId: z.string().min(6).max(64),
        type: z.string().optional(),
        body: z.object({ ciphertext: z.string(), iv: z.string() }),
        keys: z.array(keySlot).max(2000),
        attachments: z.array(attachment).max(10).optional(),
        forwardedFrom: objectId.nullable().optional(),
        forwardScore: z.number().int().optional(),
      })
    )
    .min(1)
    .max(60),
});

export const receiptSchema = z.object({
  messageIds: z.array(objectId).max(300),
});

export const deleteManySchema = z.object({
  messageIds: z.array(objectId).min(1).max(200),
  scope: z.enum(['me', 'everyone']).optional(),
});

/* ────────────────────────────── users ────────────────────────────── */

export const profileSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  about: z.string().max(160).optional(),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, 'Usernames need at least 3 characters')
    .max(24)
    .regex(/^[a-z0-9_.]+$/, 'Letters, numbers, dots and underscores only')
    .optional(),
  avatarColor: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
});

export const contactSchema = z
  .object({
    email: email.optional(),
    username: z.string().trim().toLowerCase().optional(),
    userId: objectId.optional(),
  })
  .refine((v) => v.email || v.username || v.userId, {
    message: 'Enter an email, username, or pick someone',
  });

/* ────────────────────────────── stories ────────────────────────────── */

export const storySchema = z.object({
  kind: z.enum(['image', 'video', 'text']).optional(),
  body: z.object({ ciphertext: z.string(), iv: z.string() }).optional(),
  keys: z.array(keySlot.partial({ deviceId: true }).extend({ deviceId: z.string() })).max(2000).optional(),
  media: z
    .object({
      url: z.string(),
      thumbnail: z.string().nullable().optional(),
      width: z.number().nullable().optional(),
      height: z.number().nullable().optional(),
      duration: z.number().nullable().optional(),
      size: z.number().optional(),
    })
    .optional(),
  background: z.string().nullable().optional(),
  audience: z.enum(['contacts', 'selected', 'except']).optional(),
  audienceList: z.array(objectId).max(1024).optional(),
});

export { objectId };

/* ──────────────────────────── call links ──────────────────────────── */

export const callLinkSchema = z.object({
  name: z.string().trim().max(80).nullable().optional(),
  mode: z.enum(['audio', 'video']).optional(),
  conversationId: objectId.nullable().optional(),
  approvalRequired: z.boolean().optional(),
  maxParticipants: z.number().int().min(2).max(64).optional(),
  expiresInHours: z.number().int().min(1).max(720).nullable().optional(),
});

/* ───────────────────────────── passkeys ───────────────────────────── */

/** The credential JSON is passed straight to the verifier, which is far
 *  stricter about its shape than a schema here could be — so this only checks
 *  that the envelope is present and sane. */
export const passkeyVerifySchema = z.object({
  credential: z.object({
    id: z.string().min(1).max(1024),
    rawId: z.string().min(1).max(1024).optional(),
    type: z.string().optional(),
    response: z.record(z.any()),
    clientExtensionResults: z.record(z.any()).optional(),
    authenticatorAttachment: z.string().nullable().optional(),
  }),
  name: z.string().trim().max(60).optional(),
  /** Identity key sealed under the authenticator's PRF output, when available. */
  identityWrapper: z
    .object({
      ciphertext: z.string().min(1).max(20000),
      iv: z.string().min(1).max(256),
      salt: z.string().min(1).max(256),
    })
    .nullable()
    .optional(),
  keys: z.any().optional(),
  device: z.any().optional(),
});

/* ────────────────────────────── backups ────────────────────────────── */

export const backupSchema = z.object({
  formatVersion: z.number().int().min(1).max(9).optional(),
  ciphertext: z.string().min(1),
  iv: z.string().min(1).max(256),
  salt: z.string().min(1).max(256),
  iterations: z.number().int().min(100_000).max(2_000_000).optional(),
  verifier: z.string().max(512).nullable().optional(),
  stats: z
    .object({
      messages: z.number().int().min(0).optional(),
      conversations: z.number().int().min(0).optional(),
      sessions: z.number().int().min(0).optional(),
      media: z.number().int().min(0).optional(),
    })
    .optional(),
  deviceName: z.string().max(80).nullable().optional(),
});

/* ──────────────────────────── device sync ──────────────────────────── */

export const snapshotSchema = z.object({
  ciphertext: z.string().min(1),
  iv: z.string().min(1).max(256),
  stats: z
    .object({
      messages: z.number().int().min(0).optional(),
      conversations: z.number().int().min(0).optional(),
      sessions: z.number().int().min(0).optional(),
    })
    .optional(),
});

/* ─────────────────────────── forensic exports ─────────────────────────── */

export const attestSchema = z.object({
  exportId: z.string().min(8).max(64),
  merkleRoot: z.string().min(16).max(128),
  recordCount: z.number().int().min(0).max(1_000_000).optional(),
});
