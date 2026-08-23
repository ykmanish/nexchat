'use client';

import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

export function TypingBubble({ names = [], isGroup }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.95 }}
      transition={{ type: 'spring', damping: 26, stiffness: 400 }}
      className="mb-2 flex justify-start px-1"
    >
      <div className={cn('flex flex-col gap-1', isGroup && 'ml-9')}>
        {isGroup && names.length > 0 && (
          <span className="px-2 text-[11.5px] text-ink-faint">
            {names.length === 1 ? names[0] : names.length + ' people'}
          </span>
        )}
        <div className="bubble-in flex items-center gap-1 px-4 py-3 shadow-bubble">
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
