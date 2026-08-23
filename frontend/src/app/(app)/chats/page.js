'use client';

import { motion } from 'framer-motion';
import { Lock } from 'lucide-react';
import { Logo } from '@/components/brand/Logo';

/** Only ever visible on desktop — mobile shows the list at this route. */
export default function ChatsIndexPage() {
  return (
    <div className="hidden h-full w-full flex-col items-center justify-center bg-app px-8 text-center lg:flex">
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.94 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="max-w-[380px]"
      >
        <Logo size={72} className="mx-auto mb-6 opacity-90" />
        <h2 className="font-display text-[24px] tracking-tight">Pick up a conversation</h2>
        <p className="mt-2.5 text-[14.5px] leading-relaxed text-ink-muted">
          Choose a chat from the list, or start a new one. Everything you send is
          encrypted before it leaves this device.
        </p>
        <div className="mt-6 inline-flex items-center gap-2 rounded-full bg-brand/[0.12] px-3.5 py-2 text-[12.5px] font-medium text-brand-strong">
          <Lock size={13} />
          End-to-end encrypted
        </div>
      </motion.div>
    </div>
  );
}
