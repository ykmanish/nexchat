'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { ChevronDown, ShieldAlert, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import { feedback } from '@/lib/sound';

/**
 * The warning shown above a message the on-device guard flagged.
 *
 * Two decisions shape this. It always says *why* — a bare "suspicious message"
 * badge teaches nobody anything and is easy to dismiss, whereas "no bank ever
 * asks for an OTP" is a fact someone carries to the next attempt. And it never
 * hides the message. Covering the text would make the warning the thing to get
 * past, and people are very good at getting past things.
 *
 * The high and low tiers look meaningfully different because they mean
 * meaningfully different things: high is "this is a scam", low is "worth a second
 * look". Rendering them identically would flatten that into noise.
 */
export function ScamWarning({ assessment, className }) {
  const [open, setOpen] = useState(false);

  if (!assessment || assessment.level === 'none') return null;

  const high = assessment.level === 'high';
  const top = assessment.reasons[0];
  const rest = assessment.reasons.slice(1);

  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        'mb-1 overflow-hidden rounded-xl border text-left',
        high ? 'border-danger/40 bg-danger/10' : 'border-warn/40 bg-warn/10',
        className
      )}
    >
      <div className="flex items-start gap-2.5 px-3 py-2.5">
        {high ? (
          <ShieldAlert size={16} className="mt-0.5 shrink-0 text-danger" />
        ) : (
          <TriangleAlert size={16} className="mt-0.5 shrink-0 text-warn" />
        )}

        <div className="min-w-0 flex-1">
          <p
            className={cn(
              'text-[12.5px] font-semibold',
              high ? 'text-danger' : 'text-warn'
            )}
          >
            {high ? 'This looks like a scam' : 'Be careful with this one'}
          </p>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-muted">{top.detail}</p>

          {rest.length > 0 && (
            <button
              type="button"
              onClick={() => {
                feedback('tap');
                setOpen((v) => !v);
              }}
              className="mt-1 inline-flex items-center gap-1 text-[12px] font-medium text-ink-muted"
            >
              {open ? 'Fewer details' : rest.length + ' more sign' + (rest.length === 1 ? '' : 's')}
              <ChevronDown
                size={13}
                className={cn('transition-transform', open && 'rotate-180')}
              />
            </button>
          )}

          {open && (
            <motion.ul
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              className="mt-1.5 space-y-1"
            >
              {rest.map((r) => (
                <li key={r.code} className="text-[12px] leading-relaxed text-ink-muted">
                  · {r.detail}
                </li>
              ))}
            </motion.ul>
          )}

          {high && (
            <p className="mt-1.5 text-[11.5px] font-medium leading-relaxed text-ink">
              Do not share codes, do not pay, and do not install anything. Checked entirely on
              your device — nothing was sent anywhere.
            </p>
          )}
        </div>
      </div>
    </motion.div>
  );
}

/**
 * The banner for a conversation you have never replied in.
 *
 * Most fraud starts with a message from someone you do not know, so the useful
 * moment to say so is before the first reply — not after money has moved. Kept
 * calm on purpose: a stranger messaging you is usually just a stranger
 * messaging you, and a red alert on every new contact would be worthless.
 */
export function FirstContactBanner({ conversation, onBlock, onReport, reputation }) {
  if (conversation?.type !== 'direct') return null;
  if (!conversation.neverReplied || conversation.peerIsContact) return null;

  const flagged = reputation?.flagged;

  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        'mx-4 mb-3 mt-2 max-w-[430px] self-center rounded-xl border px-3.5 py-3',
        flagged ? 'border-danger/40 bg-danger/10' : 'border-line bg-surface'
      )}
    >
      <div className="flex items-start gap-2.5">
        {flagged ? (
          <ShieldAlert size={16} className="mt-0.5 shrink-0 text-danger" />
        ) : (
          <TriangleAlert size={16} className="mt-0.5 shrink-0 text-ink-faint" />
        )}
        <div className="min-w-0">
          <p className={cn('text-[13px] font-semibold', flagged && 'text-danger')}>
            {flagged
              ? 'Other people have reported this account'
              : 'First message from this person'}
          </p>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-muted">
            {flagged
              ? reputation.caveat
              : 'You have never replied here and they are not in your contacts. Most fraud starts this way — take care with codes, payments and links.'}
          </p>

          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={onBlock}
              className="rounded-full bg-surface-2 px-3 py-1.5 text-[12.5px] font-semibold"
            >
              Block
            </button>
            <button
              type="button"
              onClick={onReport}
              className="rounded-full px-3 py-1.5 text-[12.5px] font-semibold text-danger transition-colors hover:bg-danger/10"
            >
              Report as scam
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
