'use client';

import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { Logo } from '@/components/brand/Logo';

export function TypingBubble({ names = [], isGroup, assistant = false }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.95 }}
      transition={{ type: 'spring', damping: 26, stiffness: 400 }}
      className="mb-2 flex justify-start px-1"
    >
      <div className={cn('flex flex-col gap-1', isGroup && !assistant && 'ml-9')}>
        {!assistant && isGroup && names.length > 0 && (
          <span className="px-2 text-[11.5px] text-ink-faint">
            {names.length === 1 ? names[0] : names.length + ' people'}
          </span>
        )}
        <div
          className={cn(
            'bubble-in flex items-center gap-2 px-3.5 py-2.5 shadow-bubble',
            assistant && 'rounded-[22px]'
          )}
        >
          {assistant && <Logo size={24} />}
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="h-[7px] w-[7px] rounded-full bg-ink-faint"
              style={{
                animation: 'typing-dot 1.2s infinite',
                animationDelay: i * 0.16 + 's',
              }}
            />
          ))}
        </div>
      </div>
    </motion.div>
  );
}
