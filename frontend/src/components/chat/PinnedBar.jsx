'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Pin, X } from 'lucide-react';
import { useChat } from '@/store/chat';
import { truncate, scrollToMessage, cn } from '@/lib/utils';
import { feedback } from '@/lib/sound';
import { toast } from '@/store/ui';
import { api } from '@/lib/api';

/* A selector must return a stable reference — building `[]` inside one makes
   useSyncExternalStore re-render forever. */
const EMPTY = [];

/** Slim strip under the header showing the currently pinned message. */
export function PinnedBar({ conversation }) {
  const messages = useChat((s) => s.messages[conversation._id]) || EMPTY;
  const plain = useChat((s) => s.plain);
  const [dismissed, setDismissed] = useState(false);
  const [index, setIndex] = useState(0);

  const pinned = messages.filter((m) => m.pinned);

  // Newest first, matching the order the strip counts them in.
  const ordered = [...pinned].reverse();
  const active = ordered[Math.min(index, ordered.length - 1)];

  // Unpinning the one on screen must not leave the index dangling past the end.
  useEffect(() => {
    if (index >= ordered.length && ordered.length) setIndex(0);
  }, [index, ordered.length]);

  // A newly pinned message becomes the one the strip is showing.
  useEffect(() => {
    setDismissed(false);
    setIndex(0);
  }, [ordered.length]);

  if (!ordered.length || dismissed || !active) return null;

  const text = plain[active._id]?.text || 'Pinned message';

  /* Tapping jumps to the pin on screen. With several pinned, each tap then
     advances to the next one — the same cycling WhatsApp does, so every pin
     stays reachable from a strip that only has room for one. */
  const jump = () => {
    feedback('tap');
    const found = scrollToMessage(active._id);
    if (!found) {
      toast.info('That message is further up — scroll to load it.');
      return;
    }
    if (ordered.length > 1) setIndex((i) => (i + 1) % ordered.length);
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ height: 0, opacity: 0 }}
        animate={{ height: 'auto', opacity: 1 }}
        exit={{ height: 0, opacity: 0 }}
        className="relative z-20 shrink-0 overflow-hidden border-b border-line bg-surface"
      >
        <div className="flex items-stretch">
          <button
            type="button"
            onClick={jump}
            className="flex min-w-0 flex-1 items-center gap-2.5 px-4 py-2 text-left transition-colors hover:bg-surface-2 active:bg-surface-3"
            aria-label={'Go to pinned message' + (ordered.length > 1 ? ', ' + ordered.length + ' pinned' : '')}
          >
            {/* With several pins, a ladder of ticks shows which one is up —
                the same affordance WhatsApp uses. */}
            {ordered.length > 1 ? (
              <span className="flex shrink-0 flex-col gap-[2px] py-0.5" aria-hidden>
                {ordered.slice(0, 5).map((p, i) => (
                  <span
                    key={p._id}
                    className={cn(
                      'h-[5px] w-[3px] rounded-full transition-colors',
                      i === index ? 'bg-brand-strong' : 'bg-line'
                    )}
                  />
                ))}
              </span>
            ) : (
              <Pin size={14} className="shrink-0 text-brand-strong" />
            )}

            <span className="min-w-0 flex-1">
              <span className="block text-[11px] font-semibold uppercase tracking-wide text-brand-strong">
                Pinned{' '}
                {ordered.length > 1 ? index + 1 + '/' + ordered.length : ''}
              </span>
              <span className="block truncate text-[13px] text-ink-muted">
                {truncate(text, 70)}
              </span>
            </span>
          </button>

          <button
            type="button"
            onClick={async () => {
              feedback('tap');
              await api.post('/messages/' + active._id + '/pin').catch(() => {});
              // Only the last one collapses the strip; otherwise show the next.
              if (ordered.length <= 1) setDismissed(true);
              else setIndex(0);
            }}
            className="shrink-0 self-center rounded-full p-1.5 text-ink-faint transition-colors hover:bg-surface-2 hover:text-ink"
            aria-label="Unpin"
          >
            <X size={15} />
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
