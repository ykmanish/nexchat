'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { IconButton } from './Button';

const SPRING = { type: 'spring', damping: 34, stiffness: 380, mass: 0.8 };

/**
 * Keeps a sheet mounted for exactly as long as it takes to animate away.
 *
 * This replaces AnimatePresence, which could not be trusted to do it here.
 * AnimatePresence removes a child only once everything animating inside it has
 * reported completion, and the panel below is draggable — a draggable element
 * does not reliably hand that callback back. The result was a closed sheet that
 * slid off screen and then stayed in the DOM indefinitely, its full-screen
 * backdrop still lying over the app at zero opacity and swallowing every click
 * behind it. Closing any sheet left the page dead until a reload, in a
 * production build as much as in development.
 *
 * Removal is now a timer this file owns, and `interactive` is the belt to that
 * braces: a sheet on its way out stops taking pointer events on the frame it
 * starts closing, so even if the unmount were somehow missed the worst case is
 * an invisible, inert element rather than a dead page.
 */
const FADE_MS = 200;

function useSheetPresence(open) {
  const [mounted, setMounted] = useState(open);

  useEffect(() => {
    if (open) {
      setMounted(true);
      return undefined;
    }
    /* A timer rather than framer's own completion callback. The callback is
       exactly the thing that proved unreliable here, and "how long the fade
       lasts" is a number this file already owns — so the unmount is arithmetic
       instead of a promise somebody else has to keep. */
    const timer = setTimeout(() => setMounted(false), FADE_MS + 60);
    return () => clearTimeout(timer);
  }, [open]);

  return { mounted: mounted || open, interactive: open };
}

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
  const { mounted, interactive } = useSheetPresence(open);
  useLockedBody(open, onClose, dismissible);

  if (typeof document === 'undefined' || !mounted) return null;

  const widths = {
    sm: 'sm:max-w-sm',
    md: 'sm:max-w-md',
    lg: 'sm:max-w-lg',
    xl: 'sm:max-w-2xl',
  }[size];

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: interactive ? 1 : 0 }}
      transition={{ duration: FADE_MS / 1000 }}
      className={cn(
        'fixed inset-0 z-[100] flex items-end justify-center sm:items-center',
        !interactive && 'pointer-events-none'
      )}
    >
      <div onClick={() => dismissible && onClose?.()} className="absolute inset-0 bg-black/55" />

      <motion.div
        role={interactive ? 'dialog' : undefined}
        aria-modal={interactive ? 'true' : undefined}
        aria-hidden={interactive ? undefined : 'true'}
        initial={{ y: '100%' }}
        animate={{ y: interactive ? 0 : '100%' }}
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
    </motion.div>,
    document.body
  );
}

/** iOS-style action list — the "New chat / New contact / New community" menu. */
export function ActionSheet({ open, onClose, title, actions = [], cancelLabel = 'Cancel' }) {
  /* Same presence handling as Sheet, and for the same reason — a menu that
     stays mounted after it closes leaves an invisible sheet of glass over the
     app. This one bit hardest on the post menu: choosing Delete closed the
     menu, and the confirmation that opened behind the stranded overlay could
     not be reached. */
  const { mounted, interactive } = useSheetPresence(open);
  useLockedBody(open, onClose);

  if (typeof document === 'undefined' || !mounted) return null;

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: interactive ? 1 : 0 }}
      transition={{ duration: FADE_MS / 1000 }}
      className={cn(
        'fixed inset-0 z-[100] flex items-end justify-center p-3 sm:items-center',
        !interactive && 'pointer-events-none'
      )}
    >
      <div onClick={onClose} className="absolute inset-0 bg-black/55" />

      <motion.div
        initial={{ y: 32, scale: 0.98 }}
        animate={{ y: interactive ? 0 : 32, scale: interactive ? 1 : 0.98 }}
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
    </motion.div>,
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
  const { mounted, interactive } = useSheetPresence(open);
  useLockedBody(open, onClose);

  if (typeof document === 'undefined' || !mounted) return null;

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: interactive ? 1 : 0 }}
      transition={{ duration: FADE_MS / 1000 }}
      className={cn(
        'fixed inset-0 z-[110] grid place-items-center p-6',
        !interactive && 'pointer-events-none'
      )}
    >
      <div onClick={onClose} className="absolute inset-0 bg-black/55" />
      <motion.div
        initial={{ scale: 0.94, y: 8 }}
        animate={{ scale: interactive ? 1 : 0.96, y: interactive ? 0 : 8 }}
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
    </motion.div>,
    document.body
  );
}
