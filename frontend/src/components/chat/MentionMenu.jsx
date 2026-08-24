'use client';

import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { AtSign } from 'lucide-react';
import { Avatar } from '@/components/ui/Avatar';
import { cn } from '@/lib/utils';

/**
 * The @-mention picker, floated above the composer.
 *
 * Keyboard-first on purpose: the whole point of typing `@ann` is not having to
 * reach for the mouse, so arrows move, Enter or Tab confirms, and Escape gets
 * out. The composer owns the selection index — this only draws it and reports
 * clicks, which keeps the keyboard handling in one place next to the textarea
 * that actually receives the keystrokes.
 */
export function MentionMenu({ items, active, onPick, onHover }) {
  const listRef = useRef(null);

  // Keep the highlighted row in view when arrowing past the fold.
  useEffect(() => {
    const el = listRef.current?.children?.[active];
    el?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!items.length) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 6, scale: 0.98 }}
      transition={{ duration: 0.14 }}
      className="absolute bottom-full left-0 right-0 z-30 mb-2 overflow-hidden rounded-2xl border border-line bg-surface shadow-pop"
    >
      <div ref={listRef} className="scroll-soft max-h-[232px] overflow-y-auto py-1">
        {items.map((item, i) => (
          <button
            key={item.id + ':' + item.label}
            type="button"
            // Pointer down rather than click: the textarea must not lose focus
            // first, or the caret position we are about to write into is gone.
            onPointerDown={(e) => {
              e.preventDefault();
              onPick(item);
            }}
            onMouseEnter={() => onHover?.(i)}
            className={cn(
              'flex w-full items-center gap-3 px-3 py-2 text-left transition-colors',
              i === active ? 'bg-brand-tint' : 'hover:bg-surface-2'
            )}
          >
            {item.everyone ? (
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-tint text-brand-strong">
                <AtSign size={17} />
              </span>
            ) : (
              <Avatar
                src={item.avatar}
                name={item.name}
                color={item.avatarColor}
                size="sm"
              />
            )}

            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14.5px] font-medium">
                {item.everyone ? 'Everyone' : item.name}
              </span>
              <span className="block truncate text-[12.5px] text-ink-muted">
                {item.everyone ? 'Notify the whole group' : '@' + item.label}
              </span>
            </span>

            {item.role && item.role !== 'member' && (
              <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                {item.role}
              </span>
            )}
          </button>
        ))}
      </div>
    </motion.div>
  );
}
