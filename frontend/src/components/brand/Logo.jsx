'use client';

import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

/**
 * The Chax mark, from `public/icon.png`.
 *
 * Served from the pre-scaled PNGs rather than the 2249px original — the mark
 * renders between 26px and 72px, so shipping the full-size file would cost
 * ~278KB for something drawn at a fraction of that.
 */
export function Logo({ size = 44, className, animated = false, rounded = true }) {
  const Wrapper = animated ? motion.div : 'div';
  const props = animated
    ? {
        initial: { scale: 0.82, opacity: 0 },
        animate: { scale: 1, opacity: 1 },
        transition: { type: 'spring', damping: 13, stiffness: 220 },
      }
    : {};

  // Pick the smallest asset that still covers a 2x display.
  const src = size <= 48 ? '/icon-96.png' : size <= 96 ? '/icon-192.png' : '/icon-512.png';

  return (
    <Wrapper
      {...props}
      className={cn('grid shrink-0 place-items-center', className)}
      style={{ width: size, height: size }}
    >
      <img
        src={src}
        alt="Chax"
        width={size}
        height={size}
        draggable={false}
        className={cn('h-full w-full select-none object-contain', rounded && 'rounded-full')}
      />
    </Wrapper>
  );
}

export function Wordmark({ className, size = 'md', showIcon = true }) {
  const s = {
    sm: { logo: 26, text: 'text-[17px]' },
    md: { logo: 32, text: 'text-[21px]' },
    lg: { logo: 46, text: 'text-[29px]' },
  }[size];

  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      {showIcon && <Logo size={s.logo} />}
      <span className={cn('font-display font-semibold tracking-tight', s.text)}>
        Nex<span className="text-brand-strong">Chat</span>
      </span>
    </div>
  );
}

/** The small "end-to-end encrypted" reassurance used throughout. */
export function EncryptedBadge({ className, label = 'End-to-end encrypted' }) {
  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full bg-brand-tint px-2.5 py-1',
        'text-[11px] font-medium text-brand-strong',
        className
      )}
    >
      <LockIcon size={11} />
      {label}
    </div>
  );
}

export function LockIcon({ size = 12, className }) {
  return (
    <svg
      width={size}
      height={size * 1.18}
      viewBox="0 0 11 13"
      fill="none"
      className={className}
      aria-hidden
    >
      <path
        d="M2.4 5.4V3.7a3.1 3.1 0 0 1 6.2 0v1.7"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <rect x="0.9" y="5.3" width="9.2" height="7" rx="2.2" fill="currentColor" />
    </svg>
  );
}
