import mongoose from 'mongoose';

/**
 * One person reporting another for fraud.
 *
 * A community signal is genuinely useful — the same scam number works on dozens
 * of people before anyone warns anyone — and it is also the most abusable thing
 * in this codebase. A brigade could bury someone under false reports, and a
 * reputation system that can be weaponised is worse than no reputation system.
 *
 * So the design is deliberately conservative:
 *
 *   - One report per reporter per subject, enforced by a unique index. Volume
 *     comes from distinct people, never from one person clicking repeatedly.
 *   - A reporter must have actually received a message from the subject. You
 *     cannot report a stranger you have never heard from, which removes the
 *     drive-by case entirely.
 *   - Reporters are never disclosed, to the subject or to anyone else.
 *   - Nothing is surfaced below a threshold, so one grudge shows nobody
 *     anything.
 *
 * What it deliberately does not do is act by itself. A report never blocks,
 * limits or bans the subject anywhere on the service. It warns the next person,
 * and a human decides what to do about it.
 */
const scamReportSchema = new mongoose.Schema(
  {
    reporter: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    reported: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    category: {
      type: String,
      enum: ['otp-request', 'fake-payment', 'impersonation', 'lottery', 'harassment', 'other'],
      default: 'other',
    },
    /** Optional, and never shown to the subject. */
    note: { type: String, default: null, maxlength: 300 },

    /** Kept so a review can distinguish a long history from a single message. */
    conversation: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', default: null },
  },
  { timestamps: true }
);

/* One per reporter per subject: the count has to mean "how many people", not
   "how many clicks". */
scamReportSchema.index({ reporter: 1, reported: 1 }, { unique: true });
scamReportSchema.index({ reported: 1, createdAt: -1 });

export const ScamReport = mongoose.model('ScamReport', scamReportSchema);
