'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/store/auth';
import { useUI } from '@/store/ui';
import { cn } from '@/lib/utils';
import { feedback } from '@/lib/sound';

/**
 * Reaction chips, tucked onto the bottom edge of the bubble the way WhatsApp
 * does. Tapping one opens the list of who reacted and when — toggling your own
 * reaction happens from the context menu, so a tap never removes by accident.
 */
export function ReactionPills({ message, isMine }) {
  const user = useAuth((s) => s.user);
  const openSheet = useUI((s) => s.openSheet);

  const reactions = message.reactions || [];
  if (!reactions.length) return null;

  const grouped = reactions.reduce((acc, r) => {
    const key = r.emoji;
    if (!acc[key]) acc[key] = { emoji: key, count: 0, mine: false };
    acc[key].count += 1;
    if (String(r.user?._id || r.user) === String(user?._id)) acc[key].mine = true;
    return acc;
  }, {});

  const pills = Object.values(grouped).sort((a, b) => b.count - a.count);
  const total = reactions.length;

  return (
    <div
      className={cn(
        // Pulled up so the chips sit on the bubble's edge rather than floating
        // under it, and given a lane of their own so nothing overlaps.
        'relative z-[1] -mt-2 mb-0.5 flex flex-wrap items-center gap-1 px-1',
        isMine ? 'justify-end pr-1.5' : 'justify-start pl-1.5'
      )}
    >
      <AnimatePresence initial={false}>
        {pills.map((pill) => (
          <motion.button
            key={pill.emoji}
            type="button"
            layout
            initial={{ scale: 0.3, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.3, opacity: 0 }}
            transition={{ type: 'spring', damping: 17, stiffness: 480 }}
            whileTap={{ scale: 0.9 }}
            onClick={(e) => {
              e.stopPropagation();
              feedback('tap');
              openSheet('reactionDetails', { message });
            }}
            aria-label={
              pill.count + ' reacted with ' + pill.emoji + '. See who.'
            }
            className={cn(
              'flex items-center gap-1 rounded-full py-[2px] pl-1.5 pr-2 shadow-bubble transition-colors',
              // Chips sit on top of a bubble, so they need their own solid
              // ground rather than the translucent brand tint. No outline —
              // the shadow is what lifts them off the bubble, and your own
              // reaction reads from a lighter fill rather than a ring.
              pill.mine
                ? 'bg-surface-3 dark:bg-surface-3'
                : 'bg-surface hover:bg-surface-2 dark:bg-surface-2 dark:hover:bg-surface-3'
            )}
          >
            <span className="text-[13px] leading-none">{pill.emoji}</span>
            {total > 1 && (
              <span className="text-[11px] font-medium leading-none tabular-nums text-ink-soft">
                {pill.count}
              </span>
            )}
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  );
}
