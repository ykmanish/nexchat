'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Info, ShieldAlert } from 'lucide-react';
import { Sheet } from '@/components/ui/Sheet';
import { Button } from '@/components/ui/Button';
import { Textarea, RadioRow } from '@/components/ui/Field';
import { toast } from '@/store/ui';
import { api } from '@/lib/api';
import { feedback } from '@/lib/sound';

/**
 * Reporting an account for fraud.
 *
 * Two things this screen has to be straight about, because a reporting flow that
 * overpromises is how people end up believing something was handled when it was
 * not:
 *
 *   - Reporting blocks them for you, immediately. That part is entirely under
 *     your control and takes effect at once.
 *   - It does not get them banned. Reports become a warning shown to the *next*
 *     person only once several unrelated people have reported the same account,
 *     and nothing here is verified by anyone.
 *
 * The categories exist because "why" is what makes the aggregate useful later —
 * three reports for the same reason is a much stronger signal than three reports
 * for three different ones.
 */
const CATEGORIES = [
  { value: 'otp-request', label: 'Asked for an OTP, PIN or password' },
  { value: 'fake-payment', label: 'Fake payment, refund or QR code' },
  { value: 'impersonation', label: 'Pretending to be a bank, company or someone I know' },
  { value: 'lottery', label: 'Prize, lottery or job offer' },
  { value: 'harassment', label: 'Harassment or abuse' },
  { value: 'other', label: 'Something else' },
];

export function ReportScamSheet({ open, onClose, conversation }) {
  const [category, setCategory] = useState('otp-request');
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);

  const peer = conversation?.peer;

  async function submit() {
    if (!peer?._id) return;
    setSending(true);
    try {
      const { data } = await api.post('/users/' + peer._id + '/report', {
        category,
        note: note.trim() || null,
      });
      feedback('success');
      toast.success(
        data.blocked ? 'Reported and blocked' : 'Reported'
      );
      onClose?.();
    } catch (err) {
      feedback('error');
      toast.error(err.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Report as scam"
      subtitle={peer?.name ? 'Reporting ' + peer.name : 'Report this account'}
      size="md"
    >
      <div className="px-5 pb-6">
        <div className="mb-5 flex items-start gap-3 rounded-xl bg-danger/10 px-4 py-3">
          <ShieldAlert size={17} className="mt-0.5 shrink-0 text-danger" />
          <p className="text-[12.5px] leading-relaxed text-ink-muted">
            This <strong className="text-ink">blocks them for you straight away</strong>. It
            does not ban them — reports only become a warning to other people once several
            unrelated users report the same account.
          </p>
        </div>

        <p className="mb-2 px-1 text-[12px] font-semibold uppercase tracking-wide text-ink-faint">
          What happened
        </p>

        <div className="mb-4 overflow-hidden rounded-xl bg-surface-2">
          {CATEGORIES.map((c, i) => (
            <div key={c.value}>
              {i > 0 && <div className="divider mx-4" />}
              <RadioRow
                label={c.label}
                checked={category === c.value}
                onChange={() => setCategory(c.value)}
              />
            </div>
          ))}
        </div>

        <Textarea
          label="Anything to add (optional)"
          placeholder="What they said or asked for"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={300}
          rows={3}
        />

        <div className="mt-3 flex items-start gap-2 px-1">
          <Info size={14} className="mt-0.5 shrink-0 text-ink-faint" />
          <p className="text-[12px] leading-relaxed text-ink-faint">
            Your name is never shown to them or to anyone else. Your messages are not sent
            with the report — only that you reported, and why.
          </p>
        </div>

        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-4">
          <Button size="block" variant="danger" loading={sending} onClick={submit}>
            Report and block
          </Button>
        </motion.div>
      </div>
    </Sheet>
  );
}
