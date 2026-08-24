import { Backup } from '../models/index.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { logger } from '../utils/logger.js';

/**
 * Storage for one encrypted archive per account.
 *
 * Only one is kept, on purpose. A history of archives sounds generous and is
 * actually a liability: every old copy is another ciphertext sitting around
 * under a passphrase the user may since have changed, and none of them can be
 * verified or pruned by anyone but the owner. The client can always keep its own
 * exported files if it wants generations.
 *
 * Everything stored here is opaque. The server cannot tell an archive from
 * random bytes, cannot check the passphrase, and cannot say how many messages
 * are inside except by believing the counts the client reported — which is why
 * those counts are only ever shown as a description, never trusted for
 * anything.
 */

// Kept under the route's own JSON limit, so the refusal comes from here —
// with a message that says what to do — rather than from the body parser.
const MAX_BYTES = 48 * 1024 * 1024;

export const putBackup = asyncHandler(async (req, res) => {
  const {
    ciphertext,
    iv,
    salt,
    iterations = 310000,
    verifier = null,
    stats = {},
    deviceName = null,
    formatVersion = 1,
  } = req.body;

  // The JSON body limit would catch most of this first, but the ceiling that
  // matters is the one stated in terms of the archive itself.
  const size = Buffer.byteLength(ciphertext, 'utf8');
  if (size > MAX_BYTES) {
    throw ApiError.badRequest(
      'That archive is larger than ' + MAX_BYTES / (1024 * 1024) + ' MB',
      'TOO_LARGE'
    );
  }

  const doc = await Backup.findOneAndUpdate(
    { user: req.user._id },
    {
      user: req.user._id,
      formatVersion,
      ciphertext,
      iv,
      salt,
      iterations,
      verifier,
      size,
      stats: {
        messages: stats.messages || 0,
        conversations: stats.conversations || 0,
        sessions: stats.sessions || 0,
        media: stats.media || 0,
      },
      deviceId: req.deviceId || null,
      deviceName: deviceName || req.device?.name || null,
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  logger.info('Backup stored for ' + req.user.email + ' (' + Math.round(size / 1024) + ' KB)');

  res.status(201).json({ success: true, backup: doc.summary() });
});

/** Metadata only — enough for the settings screen to describe what is there. */
export const getBackupInfo = asyncHandler(async (req, res) => {
  const doc = await Backup.findOne({ user: req.user._id }).select('-ciphertext');
  res.json({ success: true, backup: doc ? doc.summary() : null });
});

/**
 * The archive itself, with the KDF parameters needed to open it. Those are in
 * the clear because restoring is impossible without them and they give away
 * nothing: they describe how the key was stretched, not what it was.
 */
export const getBackup = asyncHandler(async (req, res) => {
  const doc = await Backup.findOne({ user: req.user._id });
  if (!doc) throw ApiError.notFound('No backup stored', 'NO_BACKUP');

  res.json({
    success: true,
    backup: {
      ...doc.summary(),
      ciphertext: doc.ciphertext,
      iv: doc.iv,
      salt: doc.salt,
      iterations: doc.iterations,
      algorithm: doc.algorithm,
      verifier: doc.verifier,
    },
  });
});

export const deleteBackup = asyncHandler(async (req, res) => {
  const result = await Backup.deleteOne({ user: req.user._id });
  if (!result.deletedCount) throw ApiError.notFound('No backup stored', 'NO_BACKUP');
  res.json({ success: true });
});
