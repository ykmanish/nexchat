import mongoose from 'mongoose';
import { ScamReport, User, Conversation, Message } from '../models/index.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { logger } from '../utils/logger.js';

/**
 * Community scam reporting.
 *
 * See models/ScamReport.js for why this is as cautious as it is. The short
 * version: a reputation signal one determined person can manufacture is a
 * harassment tool, so reporting requires having actually been messaged, the
 * count is of distinct people, and nothing shows until several unrelated people
 * agree.
 */

/** Below this, a warning would say more about one grudge than about the subject. */
const SURFACE_THRESHOLD = 3;

export const reportUser = asyncHandler(async (req, res) => {
  const { category = 'other', note = null } = req.body;
  const reported = req.params.id;

  if (!mongoose.isValidObjectId(reported)) throw ApiError.badRequest('Bad user id', 'BAD_ID');
  if (String(reported) === String(req.user._id)) {
    throw ApiError.badRequest('You cannot report yourself', 'SELF');
  }

  const subject = await User.findById(reported).select('_id');
  if (!subject) throw ApiError.notFound('No such person', 'NO_USER');

  /* You must have heard from them. Without this, the endpoint is a way to
     accumulate reports against anyone whose id you can guess. */
  const shared = await Conversation.findOne({
    type: 'direct',
    memberIds: { $all: [req.user._id, subject._id], $size: 2 },
  }).select('_id');

  const heardFrom = shared
    ? await Message.exists({ conversation: shared._id, sender: subject._id })
    : null;

  if (!heardFrom) {
    throw ApiError.forbidden(
      'You can only report someone who has messaged you',
      'NO_CONTACT_HISTORY'
    );
  }

  try {
    await ScamReport.create({
      reporter: req.user._id,
      reported: subject._id,
      category,
      note: note ? String(note).slice(0, 300) : null,
      conversation: shared?._id || null,
    });
  } catch (err) {
    // Already reported by this person. Idempotent rather than an error.
    if (err.code !== 11000) throw err;
  }

  /* Blocking is the reporter's own protection and takes effect at once; the
     community signal is separate and slower. Conflating them would mean filing
     a report you could not act on until strangers agreed with you. */
  await User.updateOne({ _id: req.user._id }, { $addToSet: { blocked: subject._id } });

  const reporters = await ScamReport.countDocuments({ reported: subject._id });
  logger.warn('Scam report filed against ' + subject._id + ' (' + reporters + ' total)');

  res.status(201).json({ success: true, blocked: true, reportsFiled: reporters });
});

/**
 * What the community thinks of someone, if anything.
 *
 * Returns a bare flag below the threshold and never the reporters. Exposing the
 * count at one or two reports would let anyone measure the effect of their own
 * report, which is the first step to gaming it.
 */
export const reputation = asyncHandler(async (req, res) => {
  const reported = req.params.id;
  if (!mongoose.isValidObjectId(reported)) throw ApiError.badRequest('Bad user id', 'BAD_ID');

  const reports = await ScamReport.find({ reported }).select('category').lean();
  const count = reports.length;

  if (count < SURFACE_THRESHOLD) {
    return res.json({ success: true, flagged: false });
  }

  const byCategory = {};
  for (const r of reports) byCategory[r.category] = (byCategory[r.category] || 0) + 1;
  const top = Object.entries(byCategory).sort((a, b) => b[1] - a[1])[0];

  res.json({
    success: true,
    flagged: true,
    reporters: count,
    topCategory: top ? top[0] : 'other',
    // Stated so a community flag is never read as a verdict.
    caveat:
      'Reported by ' +
      count +
      ' people who received messages from this account. Reports are unverified.',
  });
});

/** What this account has reported, so a mistaken report can be withdrawn. */
export const myReports = asyncHandler(async (req, res) => {
  const reports = await ScamReport.find({ reporter: req.user._id })
    .populate('reported', 'name username avatar avatarColor')
    .sort({ createdAt: -1 })
    .limit(100);

  res.json({
    success: true,
    reports: reports.map((r) => ({
      id: String(r._id),
      user: r.reported,
      category: r.category,
      at: r.createdAt,
    })),
  });
});

export const withdrawReport = asyncHandler(async (req, res) => {
  const result = await ScamReport.deleteOne({ reporter: req.user._id, reported: req.params.id });
  if (!result.deletedCount) throw ApiError.notFound('No report to withdraw', 'NO_REPORT');
  res.json({ success: true });
});
