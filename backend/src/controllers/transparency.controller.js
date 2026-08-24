import {
  User,
  Device,
  Conversation,
  Message,
  Story,
  Call,
  Attestation,
  Backup,
  Snapshot,
  Passkey,
} from '../models/index.js';
import { asyncHandler } from '../utils/asyncHandler.js';

/**
 * What this server can see about one account, answered by the server itself.
 *
 * Every end-to-end encrypted messenger makes a claim of the form "we cannot read
 * your messages", and every user has to take it on faith. This does not ask for
 * faith: it enumerates, from the database, exactly what is legible here and what
 * is not — and for each legible item, why it has to be.
 *
 * Two rules kept this honest while writing it:
 *
 *   1. Nothing is omitted because it is embarrassing. The mention ids are the
 *      clearest example — they are cleartext, they reveal who was named in a
 *      group, and they are listed as such rather than quietly left out.
 *   2. The "cannot see" list is derived from where the decryption keys actually
 *      live, not from a promise. Each entry names the reason.
 *
 * Counts are computed live. That matters: a screenshot of a policy page ages, a
 * query does not.
 */

const oid = (id) => id;

export const whatWeKnow = asyncHandler(async (req, res) => {
  const userId = req.user._id;

  const [
    user,
    devices,
    conversations,
    messagesSent,
    mentionsOfMe,
    stories,
    callsInitiated,
    callsJoined,
    attestations,
    backup,
    snapshot,
    passkeys,
  ] = await Promise.all([
    User.findById(userId).lean(),
    Device.find({ user: userId }).select('deviceId name platform os browser formFactor lastActiveAt revokedAt createdAt ip pushSubscription linkedVia').lean(),
    Conversation.find({ memberIds: userId })
      .select('type name memberIds lastMessageAt seq createdAt settings participants')
      .lean(),
    Message.countDocuments({ sender: userId }),
    Message.countDocuments({ mentions: userId }),
    Story.countDocuments({ user: userId }),
    Call.countDocuments({ initiator: userId }),
    Call.countDocuments({ 'participants.user': userId }),
    Attestation.countDocuments({ user: userId }),
    Backup.findOne({ user: userId }).select('size stats updatedAt').lean(),
    Snapshot.findOne({ user: userId }).select('size stats version updatedAt').lean(),
    Passkey.countDocuments({ user: userId, revokedAt: null }),
  ]);

  const conversationIds = conversations.map((c) => c._id);

  /* Deliberately per-conversation rather than one total: the shape of who you
     talk to and how much is the metadata that matters, and rolling it into a
     single number would understate what is visible. */
  const perConversation = await Message.aggregate([
    { $match: { conversation: { $in: conversationIds } } },
    {
      $group: {
        _id: '$conversation',
        messages: { $sum: 1 },
        first: { $min: '$createdAt' },
        last: { $max: '$createdAt' },
        ciphertextBytes: { $sum: { $strLenBytes: { $ifNull: ['$body.ciphertext', ''] } } },
      },
    },
  ]);

  const byConversation = new Map(perConversation.map((r) => [String(r._id), r]));

  const byType = await Message.aggregate([
    { $match: { conversation: { $in: conversationIds } } },
    { $group: { _id: '$type', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);

  /* The counterparties. In a direct chat the server plainly knows who the other
     person is; in a group it knows the whole roster. */
  const counterparties = new Set();
  for (const c of conversations) {
    for (const m of c.memberIds || []) {
      if (String(m) !== String(userId)) counterparties.add(String(m));
    }
  }

  res.json({
    success: true,
    generatedAt: new Date().toISOString(),

    /* ── what is legible here ── */
    visible: {
      identity: {
        why: 'Needed to sign you in, route messages to you, and let people find you.',
        email: user.email,
        emailVerified: user.emailVerified,
        name: user.name,
        username: user.username || null,
        about: user.about || null,
        phone: user.phone || null,
        avatarStored: !!user.avatar,
        accountCreated: user.createdAt,
        lastLogin: user.lastLoginAt,
        presence: user.presence,
        lastSeen: user.lastSeen,
      },

      credentials: {
        why: 'Password and key material. Private halves are encrypted with keys derived on your device; the server holds only ciphertext and public keys.',
        passwordHash: 'stored (bcrypt, cost 12) — the password itself is never stored',
        identityPublicKey: user.identityPublicKey ? 'stored (public half only)' : 'none',
        encryptedIdentity: user.encryptedIdentity?.ciphertext
          ? 'stored as opaque ciphertext — unopenable without your password'
          : 'none',
        passkeys,
      },

      devices: {
        why: 'Each device needs its own keys so a message can be sealed to it, and so a lost device can be revoked.',
        count: devices.length,
        active: devices.filter((d) => !d.revokedAt).length,
        list: devices.map((d) => ({
          deviceId: d.deviceId,
          name: d.name,
          platform: d.platform,
          os: d.os,
          browser: d.browser,
          formFactor: d.formFactor,
          linkedVia: d.linkedVia,
          lastActiveAt: d.lastActiveAt,
          revokedAt: d.revokedAt,
          firstSeen: d.createdAt,
          lastKnownIp: d.ip || null,
          pushSubscribed: !!d.pushSubscription,
        })),
      },

      socialGraph: {
        why: 'Delivery requires knowing who is in a conversation. This is the metadata encryption does not hide.',
        conversations: conversations.length,
        distinctCounterparties: counterparties.size,
        contacts: (user.contacts || []).length,
        blocked: (user.blocked || []).length,
        perConversation: conversations.map((c) => {
          const stats = byConversation.get(String(c._id)) || {};
          return {
            type: c.type,
            // A group's name is chosen collectively and stored in the clear; a
            // direct chat has none.
            name: c.type === 'direct' ? null : c.name,
            members: (c.memberIds || []).length,
            messages: stats.messages || 0,
            firstMessage: stats.first || null,
            lastMessage: stats.last || null,
            ciphertextBytes: stats.ciphertextBytes || 0,
            disappearingSeconds: c.settings?.disappearingSeconds || 0,
          };
        }),
      },

      messages: {
        why: 'Timing, size and type are properties of the envelope, not the content. The server routes on them.',
        sentByYou: messagesSent,
        byType: Object.fromEntries(byType.map((t) => [t._id || 'unknown', t.count])),
        totalCiphertextBytes: perConversation.reduce((n, r) => n + (r.ciphertextBytes || 0), 0),
      },

      mentions: {
        why: 'This one is a genuine leak, and worth stating plainly. To ring the right phone when someone @-names you, the server has to know it was you — so mention user ids are stored in the clear. The name as written stays inside the encrypted body, but who was named does not.',
        timesYouWereMentioned: mentionsOfMe,
      },

      drafts: {
        why: 'Unsent drafts sync between your own devices so you can start a message on one and finish it on another. They are stored as plain text — unlike every message you actually send. This is an inconsistency in the current design, not a deliberate trade-off, and it means an unsent draft is more exposed than a sent message.',
        conversationsWithADraft: conversations.filter(
          (c) => (c.participants || []).some(
            (p) => String(p.user) === String(userId) && p.draft
          )
        ).length,
        totalDraftCharacters: conversations.reduce((n, c) => {
          const mine = (c.participants || []).find((p) => String(p.user) === String(userId));
          return n + (mine?.draft?.length || 0);
        }, 0),
      },

      activity: {
        why: 'Counts and durations only.',
        storiesPosted: stories,
        callsStarted: callsInitiated,
        callsJoined: callsJoined,
      },

      storedBlobs: {
        why: 'Opaque by construction — the server has no key for any of these and cannot tell them from random bytes.',
        encryptedBackup: backup
          ? { sizeBytes: backup.size, claimedContents: backup.stats, updatedAt: backup.updatedAt }
          : null,
        deviceSyncSnapshot: snapshot
          ? {
              sizeBytes: snapshot.size,
              claimedContents: snapshot.stats,
              version: snapshot.version,
              updatedAt: snapshot.updatedAt,
            }
          : null,
        forensicAttestations: attestations,
      },
    },

    /* ── what is not, and why ── */
    invisible: [
      {
        item: 'Message text',
        reason:
          'Encrypted with AES-GCM under a random content key, sealed separately to each of your devices. The server stores the ciphertext and none of the keys.',
      },
      {
        item: 'Attachment contents',
        reason: 'Encrypted on your device before upload. The server stores opaque bytes at a URL.',
      },
      {
        item: 'Poll questions and options',
        reason:
          'Only the option count and vote indices are stored. The server tallies votes without knowing what is being voted on.',
      },
      {
        item: 'Story and status content',
        reason: 'Encrypted per viewer, exactly like a message.',
      },
      {
        item: 'Call audio and video',
        reason:
          'WebRTC peer-to-peer. The server relays only the signalling needed to establish the connection.',
      },
      {
        item: 'Your app lock PIN, fingerprint and app-lock passkeys',
        reason:
          'Device-side only. Never transmitted; the server has no field for them and no way to check one.',
      },
      {
        item: 'Backup and device-sync contents',
        reason:
          'Sealed under a passphrase you chose, or a key derived from your account identity. Neither is ever sent here.',
      },
      {
        item: 'Forensic export contents',
        reason:
          'Only the Merkle root is submitted for a timestamp. A root is a hash of a hash tree and cannot be inverted.',
      },
      {
        item: 'Which message you read, and when, if receipts are off',
        reason: 'Read receipts are a setting; with them off no readAt is recorded.',
      },
    ],
  });
});
