'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { feedback } from '@/lib/sound';

const PAD = 8;

/**
 * A menu anchored to the button that opened it, rather than a centred modal.
 * It measures itself after mount so it can flip up or left when it would run
 * off screen, and it closes on outside click, Escape, scroll or resize.
 */
export function Dropdown({ open, onClose, anchorRef, items = [], align = 'end', width = 232 }) {
  const menuRef = useRef(null);
  const [pos, setPos] = useState(null);

  useLayoutEffect(() => {
    if (!open || !anchorRef?.current) return;

    const a = anchorRef.current.getBoundingClientRect();
    const height = menuRef.current?.offsetHeight || items.length * 44 + 12;

    let left = align === 'end' ? a.right - width : a.left;
    left = Math.max(PAD, Math.min(left, window.innerWidth - width - PAD));

    const below = a.bottom + 6;
    const flip = below + height + PAD > window.innerHeight;
    const top = flip ? Math.max(PAD, a.top - height - 6) : below;

    setPos({ top, left, origin: flip ? 'bottom' : 'top' });
  }, [open, anchorRef, items.length, width, align]);

  useEffect(() => {
    if (!open) return undefined;

    const onKey = (e) => e.key === 'Escape' && onClose?.();
    const onAway = (e) => {
      if (menuRef.current?.contains(e.target)) return;
      if (anchorRef?.current?.contains(e.target)) return;
      onClose?.();
    };

    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onAway, true);
    window.addEventListener('resize', onClose);
    window.addEventListener('scroll', onClose, true);

    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onAway, true);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('scroll', onClose, true);
    };
  }, [open, onClose, anchorRef]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          ref={menuRef}
          role="menu"
          initial={{ opacity: 0, scale: 0.95, y: -4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.1 } }}
          transition={{ type: 'spring', damping: 26, stiffness: 460, mass: 0.5 }}
          style={{
            top: pos?.top ?? -9999,
            left: pos?.left ?? -9999,
            width,
            transformOrigin: (pos?.origin ?? 'top') + ' ' + (align === 'end' ? 'right' : 'left'),
            visibility: pos ? 'visible' : 'hidden',
          }}
          className="fixed z-[120] overflow-hidden rounded-xl bg-surface-raised py-1 shadow-pop"
        >
          {items.map((item, i) =>
            item.divider ? (
              <div key={'d' + i} className="my-1 h-px bg-line" />
            ) : (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                onClick={() => {
                  feedback('tap');
                  onClose?.();
                  item.onClick?.();
                }}
                className={cn(
                  'flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors',
                  'hover:bg-surface-2 active:bg-surface-3',
                  item.danger && 'text-danger'
                )}
              >
                {item.icon && (
                  <item.icon size={17} strokeWidth={1.9} className="shrink-0 opacity-70" />
                )}
                <span className="min-w-0 flex-1 truncate text-[14.5px]">{item.label}</span>
                {item.trailing}
              </button>
            )
          )}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
