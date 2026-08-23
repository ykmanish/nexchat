'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';
import { useUI } from '@/store/ui';
import { cn } from '@/lib/utils';

const ICONS = { success: CheckCircle2, error: AlertCircle, info: Info };
const TONES = {
  success: 'text-brand',
  error: 'text-danger',
  info: 'text-info',
};

/**
 * Toasts rise from the bottom on phones — where the thumb is and where they
 * cannot cover the header — and tuck into the bottom-right on desktop.
 */
export function ToastStack() {
  const toasts = useUI((s) => s.toasts);
  const dismiss = useUI((s) => s.dismissToast);

  return (
    <div
      className={cn(
        'pointer-events-none fixed z-[200] flex flex-col-reverse gap-2',
        'inset-x-0 bottom-0 items-center px-4 pb-[calc(5.5rem+var(--safe-bottom))]',
        'sm:inset-x-auto sm:bottom-6 sm:right-6 sm:items-end sm:px-0 sm:pb-0'
      )}
    >
      <AnimatePresence mode="popLayout">
        {toasts.map((t) => {
          const Icon = ICONS[t.type] || Info;
          return (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: 24, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.92, transition: { duration: 0.16 } }}
              transition={{ type: 'spring', damping: 24, stiffness: 420, mass: 0.7 }}
              drag="x"
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={0.5}
              onDragEnd={(_e, info) => Math.abs(info.offset.x) > 90 && dismiss(t.id)}
              className={cn(
                'pointer-events-auto flex w-full max-w-[420px] items-center gap-3 sm:w-auto sm:min-w-[280px]',
                'rounded-full bg-ink py-2.5 pl-3.5 pr-2 shadow-pop'
              )}
            >
              <Icon size={18} className={cn('shrink-0', TONES[t.type])} strokeWidth={2.2} />
              <p className="min-w-0 flex-1 text-[14px] leading-snug text-app">{t.message}</p>

              {t.action ? (
                <button
                  type="button"
                  onClick={() => {
                    t.action.onClick?.();
                    dismiss(t.id);
                  }}
                  className="shrink-0 rounded-full px-3 py-1 text-[13px] font-semibold text-brand transition-colors hover:bg-white/10"
                >
                  {t.action.label}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => dismiss(t.id)}
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-app/50 transition-colors hover:bg-white/10 hover:text-app"
                  aria-label="Dismiss"
                >
                  <X size={15} />
                </button>
              )}
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
