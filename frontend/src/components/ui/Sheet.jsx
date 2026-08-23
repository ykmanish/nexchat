'use client';

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { IconButton } from './Button';

const SPRING = { type: 'spring', damping: 34, stiffness: 380, mass: 0.8 };

function useLockedBody(open, onClose, dismissible = true) {
  useEffect(() => {
    if (!open) return undefined;

    const onKey = (e) => {
      if (e.key === 'Escape' && dismissible) onClose?.();
    };
    document.addEventListener('keydown', onKey);

    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose, dismissible]);
}

/**
 * Bottom sheet on phones, centred dialog on wide screens — one component, so
 * behaviour never drifts between layouts. Drag down to dismiss on touch.
 */
export function Sheet({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  size = 'md',
  dismissible = true,
  showHandle = true,
  className,
}) {
  useLockedBody(open, onClose, dismissible);

  if (typeof document === 'undefined') return null;

  const widths = {
    sm: 'sm:max-w-sm',
    md: 'sm:max-w-md',
    lg: 'sm:max-w-lg',
    xl: 'sm:max-w-2xl',
  }[size];

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => dismissible && onClose?.()}
            className="absolute inset-0 bg-black/55"
          />

          <motion.div
            role="dialog"
            aria-modal="true"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={SPRING}
            drag={dismissible ? 'y' : false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.45 }}
            onDragEnd={(_e, info) => {
              if (info.offset.y > 110 || info.velocity.y > 640) onClose?.();
            }}
            className={cn(
              'relative flex max-h-[92dvh] w-full flex-col overflow-hidden bg-surface-raised',
              'rounded-t-[20px] shadow-sheet',
              'sm:mx-4 sm:max-h-[86dvh] sm:rounded-[16px] sm:shadow-pop',
              widths,
              className
            )}
          >
            {showHandle && (
              <div className="flex shrink-0 cursor-grab justify-center pt-2.5 active:cursor-grabbing sm:hidden">
                <div className="h-1 w-9 rounded-full bg-line-strong" />
              </div>
            )}

            {(title || dismissible) && (
              <header className="flex shrink-0 items-start gap-3 px-5 pb-3 pt-4">
                <div className="min-w-0 flex-1">
                  {title && (
                    <h2 className="truncate font-display text-[19px] tracking-tight">{title}</h2>
                  )}
                  {subtitle && (
                    <p className="mt-0.5 text-[13px] leading-snug text-ink-muted">{subtitle}</p>
                  )}
                </div>
                {dismissible && (
                  <IconButton
                    icon={X}
                    label="Close"
                    size="sm"
                    variant="subtle"
                    onClick={onClose}
                    className="-mr-1 -mt-0.5"
                  />
                )}
              </header>
            )}

            <div className="scroll-soft min-h-0 flex-1 overflow-y-auto overscroll-contain">
              {children}
            </div>

            {footer && (
              <div className="safe-bottom shrink-0 border-t border-line px-5 py-4">{footer}</div>
            )}
            {!footer && <div className="safe-bottom shrink-0" />}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}

/** iOS-style action list — the "New chat / New contact / New community" menu. */
export function ActionSheet({ open, onClose, title, actions = [], cancelLabel = 'Cancel' }) {
  useLockedBody(open, onClose);
  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[100] flex items-end justify-center p-3 sm:items-center">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/55"
          />

          <motion.div
            initial={{ y: 32, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 32, opacity: 0, scale: 0.98 }}
            transition={SPRING}
            className="relative w-full max-w-[440px] space-y-2"
          >
            <div className="overflow-hidden rounded-2xl bg-surface-raised shadow-pop">
              {title && (
                <div className="border-b border-line px-5 py-3 text-center text-[13px] text-ink-muted">
                  {title}
                </div>
              )}
              {actions.map((action, i) => (
                <motion.button
                  key={action.label}
                  type="button"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.03 + i * 0.03 }}
                  onClick={() => {
                    onClose?.();
                    action.onClick?.();
                  }}
                  className={cn(
                    'flex w-full items-center gap-4 px-5 py-3.5 text-left transition-colors',
                    'hover:bg-surface-2 active:bg-surface-3',
                    i > 0 && 'border-t border-line',
                    action.danger && 'text-danger'
                  )}
                >
                  {action.icon && (
                    <span
                      className={cn(
                        'grid h-10 w-10 shrink-0 place-items-center rounded-full',
                        action.danger ? 'bg-danger/10 text-danger' : 'bg-brand-tint text-brand-strong'
                      )}
                    >
                      <action.icon size={19} strokeWidth={1.9} />
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15.5px] leading-tight">{action.label}</span>
                    {action.sublabel && (
                      <span className="mt-0.5 block text-[13px] leading-snug text-ink-muted">
                        {action.sublabel}
                      </span>
                    )}
                  </span>
                </motion.button>
              ))}
            </div>

            <button
              type="button"
              onClick={onClose}
              className="w-full rounded-2xl bg-surface-raised py-3.5 text-[16px] font-medium shadow-pop transition-colors hover:bg-surface-2"
            >
              {cancelLabel}
            </button>
            <div className="safe-bottom" />
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}

/** Two-button confirm. */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  loading = false,
}) {
  return (
    <ChoiceDialog
      open={open}
      onClose={onClose}
      title={title}
      message={message}
      cancelLabel={cancelLabel}
      loading={loading}
      choices={[{ label: confirmLabel, danger, onClick: onConfirm }]}
    />
  );
}

/**
 * Stacked-choice dialog. Used where an action has more than one meaning —
 * "delete for me" versus "delete for everyone" being the obvious case.
 */
export function ChoiceDialog({
  open,
  onClose,
  title,
  message,
  choices = [],
  cancelLabel = 'Cancel',
  loading = false,
}) {
  useLockedBody(open, onClose);
  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[110] grid place-items-center p-6">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/55"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.94, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ type: 'spring', damping: 26, stiffness: 400 }}
            className="relative w-full max-w-[340px] overflow-hidden rounded-2xl bg-surface-raised shadow-pop"
          >
            <div className="px-6 pb-4 pt-6">
              <h3 className="font-display text-[18px] tracking-tight">{title}</h3>
              {message && (
                <p className="mt-2 text-[14px] leading-relaxed text-ink-muted">{message}</p>
              )}
            </div>

            {/* Choices stack vertically so each label has room to be explicit. */}
            <div className="flex flex-col px-3 pb-3">
              {choices.map((choice) => (
                <button
                  key={choice.label}
                  type="button"
                  disabled={loading}
                  onClick={choice.onClick}
                  className={cn(
                    'rounded-xl px-4 py-3 text-left text-[15px] font-medium transition-colors',
                    'hover:bg-surface-2 active:bg-surface-3 disabled:opacity-50',
                    choice.danger ? 'text-danger' : 'text-brand-strong'
                  )}
                >
                  {choice.label}
                  {choice.sublabel && (
                    <span className="mt-0.5 block text-[12.5px] font-normal text-ink-faint">
                      {choice.sublabel}
                    </span>
                  )}
                </button>
              ))}
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl px-4 py-3 text-left text-[15px] font-medium text-ink-muted transition-colors hover:bg-surface-2"
              >
                {cancelLabel}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}
