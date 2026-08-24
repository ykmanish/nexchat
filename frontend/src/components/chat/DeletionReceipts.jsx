'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { CircleCheck, CircleDashed, Loader2, ShieldCheck, Trash2 } from 'lucide-react';
import * as receipts from '@/lib/receipts';
import { chatTime } from '@/lib/utils';

/**
 * Who has actually deleted a message, under signature.
 *
 * "Delete for everyone" normally ends with a tombstone and nothing behind it. The
 * point of showing this is that a deletion confirmed by two of four devices is a
 * genuinely different fact from one confirmed by all four, and the version that
 * only listed confirmations would imply a completeness it had not established —
 * so the devices that have *not* confirmed are shown just as prominently.
 *
 * The scope note at the bottom is not boilerplate. A receipt says one device's
 * stored copy is gone; it cannot speak for a screenshot or an export somebody
 * already took, and a panel that let people believe otherwise would be worse
 * than no panel.
 */
export function DeletionReceipts({ messageId }) {
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    receipts
      .statusFor(messageId)
      .then((data) => !cancelled && setState(data))
      .catch((err) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [messageId]);

  if (error) {
    return (
      <p className="px-5 py-3 text-[12.5px] text-ink-faint">Could not load receipts — {error}</p>
    );
  }

  if (!state) {
    return (
      <div className="grid place-items-center py-5">
        <Loader2 className="h-4 w-4 animate-spin text-ink-faint" />
      </div>
    );
  }

  if (!state.deletedForEveryone) return null;

  const confirmed = state.receipts.length;
  const pending = state.outstanding.length;

  return (
    <div className="px-5 pb-4">
      <p className="mb-2 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide text-ink-faint">
        <Trash2 size={13} />
        Deletion confirmed by
      </p>

      <div className="mb-3 flex items-baseline gap-2">
        <span className="text-[20px] font-semibold tabular-nums">{confirmed}</span>
        <span className="text-[13px] text-ink-muted">
          of {confirmed + pending} device{confirmed + pending === 1 ? '' : 's'}
        </span>
      </div>

      <div className="space-y-1.5">
        {state.receipts.map((r) => (
          <motion.div
            key={r.deviceId}
            initial={{ opacity: 0, x: -4 }}
            animate={{ opacity: 1, x: 0 }}
            className="flex items-center gap-2.5 rounded-lg bg-surface-2 px-3 py-2"
          >
            <CircleCheck size={15} className="shrink-0 text-brand-strong" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] font-medium">
                {r.by?.name || 'A device'}
              </span>
              <span className="block truncate font-mono text-[11px] text-ink-faint">
                {r.deviceId} · {chatTime(r.deletedAt)}
              </span>
            </span>
            {/* Signed, so this is the device's own assertion rather than the
                server's word for it. */}
            <ShieldCheck size={13} className="shrink-0 text-ink-faint" title="Signed by the device" />
          </motion.div>
        ))}

        {state.outstanding.map((d) => (
          <div
            key={d.deviceId}
            className="flex items-center gap-2.5 rounded-lg px-3 py-2 opacity-60"
          >
            <CircleDashed size={15} className="shrink-0 text-ink-faint" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px]">{d.name || 'A device'}</span>
              <span className="block truncate font-mono text-[11px] text-ink-faint">
                {d.deviceId} · not confirmed
              </span>
            </span>
          </div>
        ))}
      </div>

      <p className="mt-3 text-[11.5px] leading-relaxed text-ink-faint">
        Each confirmation is signed by that device and checked against the key already
        registered for it, so it cannot be faked by us or denied by them. It attests that
        the device&apos;s stored copy is gone — not that no screenshot or earlier export
        exists elsewhere.
      </p>
    </div>
  );
}
