'use client';

import { motion } from 'framer-motion';
import { MessageSquarePlus, SearchX, Archive, Radio, PhoneOff } from 'lucide-react';
import { Button } from '@/components/ui/Button';

const VARIANTS = {
  chats: {
    icon: MessageSquarePlus,
    title: 'No chats yet',
    body: 'Start a conversation and it will show up here.',
    action: 'New chat',
  },
  search: {
    icon: SearchX,
    title: 'Nothing found',
    body: 'Try a different name or word.',
  },
  archive: {
    icon: Archive,
    title: 'Nothing archived',
    body: 'Swipe a chat left to tuck it away here.',
  },
  status: {
    icon: Radio,
    title: 'No updates',
    body: 'Stories from your contacts appear here for 24 hours.',
    action: 'Add a story',
  },
  calls: {
    icon: PhoneOff,
    title: 'No calls yet',
    body: 'Voice and video calls you make will be listed here.',
  },
};

export function EmptyState({ variant = 'chats', query, onAction }) {
  const config = VARIANTS[variant] || VARIANTS.chats;
  const Icon = config.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className="flex flex-col items-center justify-center px-8 py-20 text-center"
    >
      <div className="mb-4 grid h-16 w-16 place-items-center rounded-3xl bg-surface text-ink-faint shadow-[0_0_0_1px_var(--border)]">
        <Icon size={26} strokeWidth={1.8} />
      </div>
      <h3 className="text-[16px] font-semibold tracking-tight">{config.title}</h3>
      <p className="mt-1.5 max-w-[260px] text-[13.5px] leading-relaxed text-ink-muted">
        {query ? 'No results for “' + query + '”.' : config.body}
      </p>
      {config.action && onAction && !query && (
        <Button size="sm" className="mt-5" onClick={onAction}>
          {config.action}
        </Button>
      )}
    </motion.div>
  );
}
