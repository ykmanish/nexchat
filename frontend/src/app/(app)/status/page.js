'use client';

import { useEffect } from 'react';
import { motion } from 'framer-motion';
import { Plus, Eye } from 'lucide-react';
import { useChat } from '@/store/chat';
import { useAuth } from '@/store/auth';
import { useUI } from '@/store/ui';
import { Avatar } from '@/components/ui/Avatar';
import { IconButton } from '@/components/ui/Button';
import { EmptyState } from '@/components/chat/EmptyState';
import { chatTime, cn } from '@/lib/utils';
import { feedback } from '@/lib/sound';

export default function StatusPage() {
  const stories = useChat((s) => s.stories);
  const loadStories = useChat((s) => s.loadStories);
  const user = useAuth((s) => s.user);
  const openSheet = useUI((s) => s.openSheet);

  useEffect(() => {
    loadStories().catch(() => {});
  }, [loadStories]);

  const mine = stories.find((r) => r.isMine);
  const unseen = stories.filter((r) => !r.isMine && r.hasUnseen);
  const seen = stories.filter((r) => !r.isMine && !r.hasUnseen);

  return (
    <div className="flex h-full min-h-0 flex-col bg-app">
      <header className="safe-top shrink-0 px-5 pb-3 pt-4">
        <div className="flex items-center justify-between">
          <h1 className="font-display text-[27px] tracking-tight">Status</h1>
          <IconButton
            icon={Plus}
            label="Add status"
            variant="subtle"
            onClick={() => openSheet('newStory')}
          />
        </div>
        <p className="mt-1 text-[13px] text-ink-muted">
          Updates disappear after 24 hours.
        </p>
      </header>

      <div className="scroll-soft min-h-0 flex-1 overflow-y-auto px-3 pb-6">
        {/* my status */}
        <button
          type="button"
          onClick={() => {
            feedback('open');
            openSheet(mine ? 'storyViewer' : 'newStory', mine ? { ring: mine } : {});
          }}
          className="mb-2 flex w-full items-center gap-3.5 rounded-2xl px-3 py-3 text-left transition-colors hover:bg-black/[.035] dark:hover:bg-white/[.05]"
        >
          <span className="relative">
            {mine ? (
              <span className="block rounded-full bg-gradient-to-tr from-brand to-wa-200 p-[2.5px]">
                <span className="block rounded-full bg-app p-[2px]">
                  <Avatar src={user?.avatar} name={user?.name} color={user?.avatarColor} size="lg" />
                </span>
              </span>
            ) : (
              <Avatar src={user?.avatar} name={user?.name} color={user?.avatarColor} size="lg" />
            )}
            {!mine && (
              <span className="absolute -bottom-0.5 -right-0.5 grid h-[22px] w-[22px] place-items-center rounded-full bg-brand text-white ring-[3px] ring-app">
                <Plus size={13} strokeWidth={3} />
              </span>
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15.5px] font-semibold">My status</span>
            <span className="mt-0.5 block text-[13px] text-ink-muted">
              {mine
                ? mine.items.length + ' update' + (mine.items.length === 1 ? '' : 's') + ' · ' + chatTime(mine.latestAt)
                : 'Tap to add an update'}
            </span>
          </span>
          {mine && (
            <span className="flex items-center gap-1 text-[12.5px] text-ink-faint">
              <Eye size={14} />
              {mine.items.reduce((n, i) => n + (i.viewerCount || 0), 0)}
            </span>
          )}
        </button>

        {stories.length <= (mine ? 1 : 0) ? (
          <EmptyState variant="status" onAction={() => openSheet('newStory')} />
        ) : (
          <>
            {unseen.length > 0 && (
              <Section title="Recent updates">
                {unseen.map((ring) => (
                  <StatusRow key={ring.user._id} ring={ring} onOpen={() => openSheet('storyViewer', { ring })} />
                ))}
              </Section>
            )}
            {seen.length > 0 && (
              <Section title="Viewed">
                {seen.map((ring) => (
                  <StatusRow key={ring.user._id} ring={ring} onOpen={() => openSheet('storyViewer', { ring })} />
                ))}
              </Section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="mt-4">
      <h2 className="px-3 pb-1.5 text-[12px] font-semibold uppercase tracking-wide text-ink-faint">
        {title}
      </h2>
      {children}
    </div>
  );
}

function StatusRow({ ring, onOpen }) {
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.985 }}
      onClick={() => {
        feedback('open');
        onOpen();
      }}
      className="flex w-full items-center gap-3.5 rounded-2xl px-3 py-3 text-left transition-colors hover:bg-black/[.035] dark:hover:bg-white/[.05]"
    >
      <span
        className={cn(
          'block rounded-full p-[2.5px]',
          ring.hasUnseen
            ? 'bg-gradient-to-tr from-brand-strong via-brand to-wa-200'
            : 'bg-line-strong'
        )}
      >
        <span className="block rounded-full bg-app p-[2px]">
          <Avatar src={ring.user.avatar} name={ring.user.name} color={ring.user.avatarColor} size="lg" />
        </span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15.5px] font-medium">{ring.user.name}</span>
        <span className="mt-0.5 block text-[13px] text-ink-muted">
          {chatTime(ring.latestAt)}
          {ring.items.length > 1 && ' · ' + ring.items.length + ' updates'}
        </span>
      </span>
    </motion.button>
  );
}
