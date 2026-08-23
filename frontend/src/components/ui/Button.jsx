'use client';

import { forwardRef } from 'react';
import { motion } from 'framer-motion';
import { Loader2, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { feedback } from '@/lib/sound';

const VARIANTS = {
  primary: 'bg-brand text-brand-ink hover:bg-brand-hover active:bg-brand-hover',
  secondary: 'bg-surface-2 text-ink border border-line hover:bg-surface-3',
  ghost: 'text-ink hover:bg-surface-2',
  subtle: 'bg-surface-3 text-ink hover:brightness-95 dark:hover:brightness-110',
  tinted: 'bg-brand-tint text-brand-strong hover:brightness-95',
  danger: 'bg-danger text-white hover:brightness-110',
  dangerGhost: 'text-danger hover:bg-danger/10',
  link: 'text-brand-strong hover:underline underline-offset-4',
};

const SIZES = {
  xs: 'h-8 px-3.5 text-[13px] rounded-full gap-1.5',
  sm: 'h-9 px-4 text-[14px] rounded-full gap-2',
  md: 'h-11 px-5 text-[15px] rounded-full gap-2',
  lg: 'h-[52px] px-7 text-[16px] rounded-full gap-2.5',
  block: 'h-[52px] w-full px-6 text-[16px] rounded-xl gap-2.5',
};

export const Button = forwardRef(function Button(
  {
    children,
    variant = 'primary',
    size = 'md',
    loading = false,
    disabled = false,
    icon: Icon,
    iconRight: IconRight,
    className,
    sound = 'tap',
    onClick,
    type = 'button',
    ...rest
  },
  ref
) {
  const isDisabled = disabled || loading;

  return (
    <motion.button
      ref={ref}
      type={type}
      disabled={isDisabled}
      whileTap={isDisabled ? undefined : { scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 520, damping: 30 }}
      onClick={(e) => {
        if (isDisabled) return;
        if (sound) feedback(sound);
        onClick?.(e);
      }}
      className={cn(
        'relative inline-flex select-none items-center justify-center font-medium',
        'transition-colors duration-150 focus-ring',
        'disabled:cursor-not-allowed disabled:opacity-45',
        VARIANTS[variant],
        SIZES[size],
        className
      )}
      {...rest}
    >
      {loading ? (
        <Loader2 className="h-[18px] w-[18px] animate-spin" />
      ) : (
        Icon && <Icon className="h-[18px] w-[18px]" strokeWidth={2} />
      )}
      {children && <span className="truncate">{children}</span>}
      {!loading && IconRight && <IconRight className="h-[18px] w-[18px]" strokeWidth={2} />}
    </motion.button>
  );
});

export const IconButton = forwardRef(function IconButton(
  {
    icon: Icon,
    label,
    size = 'md',
    variant = 'ghost',
    active = false,
    badge = null,
    className,
    sound = 'tap',
    onClick,
    ...rest
  },
  ref
) {
  const dims = { sm: 'h-8 w-8', md: 'h-10 w-10', lg: 'h-12 w-12', xl: 'h-14 w-14' }[size];
  const iconSize = { sm: 17, md: 20, lg: 22, xl: 26 }[size];

  return (
    <motion.button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      whileTap={{ scale: 0.9 }}
      transition={{ type: 'spring', stiffness: 520, damping: 28 }}
      onClick={(e) => {
        if (sound) feedback(sound);
        onClick?.(e);
      }}
      className={cn(
        'relative grid shrink-0 place-items-center rounded-full transition-colors duration-150 focus-ring',
        dims,
        active ? 'bg-brand-tint text-brand-strong' : VARIANTS[variant],
        className
      )}
      {...rest}
    >
      <Icon size={iconSize} strokeWidth={1.9} />
      {badge != null && badge > 0 && (
        <span className="absolute -right-0.5 -top-0.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-brand px-1 text-[10px] font-semibold text-brand-ink ring-2 ring-app">
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </motion.button>
  );
});

/** Full-width row used inside sheets and settings lists. */
export function ListButton({
  icon: Icon,
  iconClass,
  label,
  sublabel,
  right,
  danger = false,
  onClick,
  className,
  chevron = false,
}) {
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.99 }}
      onClick={(e) => {
        feedback('tap');
        onClick?.(e);
      }}
      className={cn(
        'flex w-full items-center gap-4 px-4 py-3 text-left transition-colors',
        'hover:bg-surface-2 active:bg-surface-3',
        className
      )}
    >
      {Icon && (
        <span
          className={cn(
            'grid h-10 w-10 shrink-0 place-items-center rounded-full',
            danger ? 'bg-danger/10 text-danger' : 'bg-surface-3 text-ink-soft',
            iconClass
          )}
        >
          <Icon size={19} strokeWidth={1.9} />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className={cn('block truncate text-[15px]', danger && 'text-danger')}>{label}</span>
        {sublabel && (
          <span className="mt-0.5 block truncate text-[13px] text-ink-muted">{sublabel}</span>
        )}
      </span>
      {right}
      {chevron && <ChevronRight size={18} className="shrink-0 text-ink-faint" />}
    </motion.button>
  );
}

/** The round floating action button — new chat, new status. */
export function Fab({ icon: Icon, label, onClick, className, size = 'md' }) {
  const dims = size === 'sm' ? 'h-11 w-11' : 'h-14 w-14';
  return (
    <motion.button
      type="button"
      aria-label={label}
      whileTap={{ scale: 0.9 }}
      whileHover={{ scale: 1.04 }}
      transition={{ type: 'spring', stiffness: 500, damping: 26 }}
      onClick={() => {
        feedback('open');
        onClick?.();
      }}
      className={cn(
        'grid place-items-center rounded-full bg-brand text-brand-ink shadow-card',
        'transition-colors hover:bg-brand-hover',
        dims,
        className
      )}
    >
      <Icon size={size === 'sm' ? 20 : 25} strokeWidth={2} />
    </motion.button>
  );
}
