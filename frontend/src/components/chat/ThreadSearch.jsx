'use client';

import { useEffect, useMemo, useRef } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, ChevronUp, ChevronDown, X } from 'lucide-react';
import { useUI } from '@/store/ui';
import { useChat } from '@/store/chat';
import { scrollToMessage } from '@/lib/utils';
import { feedback } from '@/lib/sound';

const EMPTY = [];

/**
 * Replaces the thread header while searching. Matches are highlighted in the
 * bubbles themselves and stepped through with the chevrons, so the results
 * stay in context instead of hiding behind a modal.
 */
export function ThreadSearch({ conversation }) {
  const search = useUI((s) => s.search);
  const setQuery = useUI((s) => s.setSearchQuery);
  const setHits = useUI((s) => s.setSearchHits);
  const step = useUI((s) => s.stepSearch);
  const close = useUI((s) => s.closeSearch);

  const messages = useChat((s) => s.messages[conversation._id]) || EMPTY;
  const plain = useChat((s) => s.plain);
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  /* Every message whose decrypted text contains the query, oldest first. */
  const hits = useMemo(() => {
    const q = search.query.trim().toLowerCase();
    if (q.length < 1) return [];
    return messages
      .filter((m) => !m.deletedForEveryone && plain[m._id]?.text?.toLowerCase().includes(q))
      .map((m) => m._id);
  }, [search.query, messages, plain]);

  useEffect(() => {
    setHits(hits);
  }, [hits, setHits]);

  /* Keep the current hit centred as you step through. */
  useEffect(() => {
    const id = hits[search.index];
    if (id) scrollToMessage(id, { flash: false });
  }, [hits, search.index]);

  const total = hits.length;
  const position = total ? search.index + 1 : 0;

  return (
    <motion.header
      initial={{ y: -18, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: -18, opacity: 0 }}
      transition={{ type: 'spring', damping: 28, stiffness: 420 }}
      className="safe-top relative z-30 shrink-0 border-b border-line bg-[var(--header)]"
    >
      <div className="flex h-14 items-center gap-1.5 px-1.5 sm:px-3">
        <button
          type="button"
          onClick={() => {
            feedback('close');
            close();
          }}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-ink-muted transition-colors hover:bg-surface-3"
          aria-label="Close search"
        >
          <ArrowLeft size={20} />
        </button>

        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-full bg-surface px-4 shadow-bubble">
          <input
            ref={inputRef}
            value={search.query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                step(e.shiftKey ? -1 : 1);
              }
              if (e.key === 'Escape') close();
            }}
            placeholder={'Search in ' + (conversation.name || 'this chat')}
            className="h-10 min-w-0 flex-1 bg-transparent text-[14.5px] outline-none placeholder:text-ink-faint"
          />
          {search.query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="shrink-0 text-ink-faint transition-colors hover:text-ink"
              aria-label="Clear"
            >
              <X size={16} />
            </button>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          <span className="w-[52px] text-center text-[12.5px] tabular-nums text-ink-muted">
            {search.query.trim() ? position + '/' + total : ''}
          </span>
          <button
            type="button"
            disabled={!total}
            onClick={() => step(-1)}
            className="grid h-9 w-9 place-items-center rounded-full text-ink-muted transition-colors hover:bg-surface-3 disabled:opacity-35"
            aria-label="Previous match"
          >
            <ChevronUp size={18} />
          </button>
          <button
            type="button"
            disabled={!total}
            onClick={() => step(1)}
            className="grid h-9 w-9 place-items-center rounded-full text-ink-muted transition-colors hover:bg-surface-3 disabled:opacity-35"
            aria-label="Next match"
          >
            <ChevronDown size={18} />
          </button>
        </div>
      </div>

      {search.query.trim() && total === 0 && (
        <p className="px-5 pb-2 text-[12.5px] text-ink-muted">
          No matches. Only messages this device has decrypted are searchable.
        </p>
      )}
    </motion.header>
  );
}
