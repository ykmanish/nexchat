import { Snapshot } from '../models/index.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';

/**
 * The device-sync locker. See models/Snapshot.js for why this exists at all.
 *
 * Every route here is scoped to req.user, and the payload is opaque, so there is
 * nothing to authorise beyond "is this your snapshot".
 */

const MAX_BYTES = 48 * 1024 * 1024;

export const putSnapshot = asyncHandler(async (req, res) => {
  const { ciphertext, iv, stats = {} } = req.body;

  const size = Buffer.byteLength(ciphertext, 'utf8');
  if (size > MAX_BYTES) {
    throw ApiError.badRequest(
      'That snapshot is larger than ' + MAX_BYTES / (1024 * 1024) + ' MB',
      'TOO_LARGE'
    );
  }

  /* $inc on version rather than reading-then-writing: two devices pushing at
     once would otherwise both compute the same next number, and a device that
     had already applied that version would skip a snapshot it has never seen. */
  const doc = await Snapshot.findOneAndUpdate(
    { user: req.user._id },
    {
      $set: {
        ciphertext,
        iv,
        size,
        stats: {
          messages: stats.messages || 0,
          conversations: stats.conversations || 0,
          sessions: stats.sessions || 0,
        },
        deviceId: req.deviceId || null,
        deviceName: req.device?.name || null,
      },
      $inc: { version: 1 },
      $setOnInsert: { user: req.user._id },
    },
    { new: true, upsert: true }
  );

  res.status(201).json({ success: true, snapshot: doc.info() });
});

export const getSnapshot = asyncHandler(async (req, res) => {
  const doc = await Snapshot.findOne({ user: req.user._id });
  if (!doc) throw ApiError.notFound('No snapshot stored', 'NO_SNAPSHOT');

  res.json({
    success: true,
    snapshot: {
      ...doc.info(),
      ciphertext: doc.ciphertext,
      iv: doc.iv,
      algorithm: doc.algorithm,
    },
  });
});

/** Metadata only — lets a device decide whether a download is worth it. */
export const getSnapshotInfo = asyncHandler(async (req, res) => {
  const doc = await Snapshot.findOne({ user: req.user._id }).select('-ciphertext');
  if (!doc) throw ApiError.notFound('No snapshot stored', 'NO_SNAPSHOT');
  res.json({ success: true, snapshot: doc.info() });
});

export const deleteSnapshot = asyncHandler(async (req, res) => {
  await Snapshot.deleteOne({ user: req.user._id });
  res.json({ success: true });
});
