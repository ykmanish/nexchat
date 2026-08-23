'use client';

import { forwardRef, useId, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Eye, EyeOff, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { feedback } from '@/lib/sound';

export const Input = forwardRef(function Input(
  {
    label,
    hint,
    error,
    icon: Icon,
    suffix,
    className,
    containerClassName,
    type = 'text',
    ...rest
  },
  ref
) {
  const id = useId();
  const [reveal, setReveal] = useState(false);
  const isPassword = type === 'password';
  const inputType = isPassword && reveal ? 'text' : type;

  return (
    <div className={cn('w-full', containerClassName)}>
      {label && (
        <label
          htmlFor={id}
          className="mb-1.5 block text-[13px] font-medium text-ink-muted"
        >
          {label}
        </label>
      )}

      <div
        className={cn(
          'group relative flex items-center gap-2.5 rounded-2xl px-4',
          'border bg-surface transition-all duration-200',
          error
            ? 'border-danger/60 focus-within:shadow-[0_0_0_3px_rgba(255,69,58,.16)]'
            : 'border-line focus-within:border-brand focus-within:shadow-[0_0_0_3px_var(--accent-tint)]'
        )}
      >
        {Icon && (
          <Icon
            size={18}
            strokeWidth={2}
            className="shrink-0 text-ink-faint transition-colors group-focus-within:text-brand"
          />
        )}

        <input
          ref={ref}
          id={id}
          type={inputType}
          className={cn(
            'h-[52px] min-w-0 flex-1 bg-transparent text-[15px] outline-none',
            'placeholder:text-ink-faint',
            className
          )}
          {...rest}
        />

        {isPassword && (
          <button
            type="button"
            tabIndex={-1}
            onClick={() => {
              feedback('tap');
              setReveal((v) => !v);
            }}
            className="shrink-0 rounded-full p-1.5 text-ink-faint transition-colors hover:text-ink"
            aria-label={reveal ? 'Hide password' : 'Show password'}
          >
            {reveal ? <EyeOff size={17} /> : <Eye size={17} />}
          </button>
        )}

        {suffix}
      </div>

      <AnimatePresence mode="wait">
        {(error || hint) && (
          <motion.p
            key={error || hint}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className={cn(
              'mt-1.5 px-1 text-[12.5px] leading-snug',
              error ? 'text-danger' : 'text-ink-faint'
            )}
          >
            {error || hint}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
});

export const Textarea = forwardRef(function Textarea(
  { label, error, hint, rows = 3, className, ...rest },
  ref
) {
  const id = useId();
  return (
    <div className="w-full">
      {label && (
        <label htmlFor={id} className="mb-1.5 block text-[13px] font-medium text-ink-muted">
          {label}
        </label>
      )}
      <textarea
        ref={ref}
        id={id}
        rows={rows}
        className={cn(
          'w-full resize-none rounded-2xl border bg-surface px-4 py-3.5 text-[15px] outline-none transition-all',
          'placeholder:text-ink-faint',
          error
            ? 'border-danger/60'
            : 'border-line focus:border-brand focus:shadow-[0_0_0_3px_var(--accent-tint)]',
          className
        )}
        {...rest}
      />
      {(error || hint) && (
        <p className={cn('mt-1.5 px-1 text-[12.5px]', error ? 'text-danger' : 'text-ink-faint')}>
          {error || hint}
        </p>
      )}
    </div>
  );
});

/** iOS toggle. */
export function Switch({ checked, onChange, disabled, label, sublabel }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => {
        feedback('select');
        onChange?.(!checked);
      }}
      className={cn('flex w-full items-center gap-4 text-left', disabled && 'opacity-50')}
    >
      {(label || sublabel) && (
        <span className="min-w-0 flex-1">
          {label && <span className="block text-[15px] font-medium">{label}</span>}
          {sublabel && (
            <span className="mt-0.5 block text-[13px] leading-snug text-ink-muted">
              {sublabel}
            </span>
          )}
        </span>
      )}
      <span
        className={cn(
          'relative inline-flex h-[31px] w-[51px] shrink-0 items-center rounded-full transition-colors duration-200',
          checked ? 'bg-brand' : 'bg-surface-3'
        )}
      >
        {/* Translating the knob is cheaper than a layout animation, so the
            switch tracks the tap instead of lagging a frame behind it. */}
        <motion.span
          animate={{ x: checked ? 22 : 2 }}
          transition={{ type: 'spring', stiffness: 900, damping: 42, mass: 0.4 }}
          className="absolute left-0 h-[27px] w-[27px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,.25)]"
        />
      </span>
    </button>
  );
}

/** Segmented control — Apple's pill selector. */
export function Segmented({ options = [], value, onChange, className }) {
  return (
    <div
      className={cn(
        'relative flex rounded-full bg-surface-3 p-1 dark:bg-surface-2',
        className
      )}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => {
              feedback('select');
              onChange?.(opt.value);
            }}
            className={cn(
              'relative flex-1 rounded-full px-4 py-2 text-[13.5px] font-semibold transition-colors duration-200',
              active ? 'text-ink' : 'text-ink-muted'
            )}
          >
            {active && (
              <motion.span
                layoutId={'seg-' + (className || 'default')}
                transition={{ type: 'spring', stiffness: 480, damping: 36 }}
                className="absolute inset-0 rounded-full bg-surface shadow-[0_1px_3px_rgba(0,0,0,.1)]"
              />
            )}
            <span className="relative z-10">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function RadioRow({ checked, onChange, label, sublabel }) {
  return (
    <button
      type="button"
      onClick={() => {
        feedback('select');
        onChange?.();
      }}
      className="flex w-full items-center gap-4 px-5 py-3.5 text-left transition-colors active:bg-black/[.04] dark:active:bg-white/[.06]"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[15px]">{label}</span>
        {sublabel && (
          <span className="mt-0.5 block text-[13px] text-ink-muted">{sublabel}</span>
        )}
      </span>
      <AnimatePresence>
        {checked && (
          <motion.span
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.5, opacity: 0 }}
            className="text-brand"
          >
            <Check size={20} strokeWidth={2.6} />
          </motion.span>
        )}
      </AnimatePresence>
    </button>
  );
}

/** The 6-box verification code entry. */
export function CodeInput({ value = '', onChange, length = 6, error, autoFocus = true, onComplete }) {
  const chars = value.padEnd(length).split('').slice(0, length);

  const handleChange = (raw) => {
    const digits = raw.replace(/\D/g, '').slice(0, length);
    onChange?.(digits);
    if (digits.length === length) onComplete?.(digits);
  };

  return (
    <div className="relative">
      <input
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        inputMode="numeric"
        autoComplete="one-time-code"
        autoFocus={autoFocus}
        maxLength={length}
        aria-label="Verification code"
        className="absolute inset-0 z-10 h-full w-full cursor-default opacity-0"
      />
      <div className="flex justify-center gap-2 sm:gap-2.5">
        {chars.map((char, i) => {
          const filled = char.trim() !== '';
          const isNext = i === value.length;
          return (
            <motion.div
              key={i}
              animate={filled ? { scale: [1, 1.06, 1] } : {}}
              transition={{ duration: 0.2 }}
              className={cn(
                'grid h-[58px] w-[46px] place-items-center rounded-2xl border-2 font-mono text-[24px] font-semibold transition-all duration-200 sm:w-[50px]',
                error
                  ? 'border-danger/60 bg-danger/5'
                  : filled
                    ? 'border-brand bg-brand/10'
                    : isNext
                      ? 'border-brand/60 bg-surface shadow-[0_0_0_3px_var(--accent-tint)]'
                      : 'border-line bg-surface'
              )}
            >
              {filled ? char : isNext ? <span className="h-6 w-[2px] animate-pulse bg-brand" /> : ''}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
