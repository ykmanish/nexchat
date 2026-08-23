'use client';

import { motion } from 'framer-motion';
import { Plus } from 'lucide-react';
import { useChat } from '@/store/chat';
import { useAuth } from '@/store/auth';
import { useUI } from '@/store/ui';
import { Avatar } from '@/components/ui/Avatar';
import { cn } from '@/lib/utils';
import { feedback } from '@/lib/sound';

/** The horizontal "Add story · Terry · Craig · …" strip from the design. */
export function StoryRail() {
  const stories = useChat((s) => s.stories);
  const user = useAuth((s) => s.user);
  const openSheet = useUI((s) => s.openSheet);

  const mine = stories.find((r) => r.isMine);
  const others = stories.filter((r) => !r.isMine);

  return (
    <div className="no-scrollbar shrink-0 overflow-x-auto px-4 pb-3 pt-1">
      <div className="flex gap-4">
        {/* Add story */}
        <motion.button
          type="button"
          whileTap={{ scale: 0.92 }}
          onClick={() => {
            feedback('open');
            openSheet('newStory');
          }}
          className="flex w-[58px] shrink-0 flex-col items-center gap-1.5"
        >
          <span className="relative">
            {mine ? (
              <span className="block rounded-full bg-gradient-to-tr from-brand to-wa-200 p-[2px]">
                <span className="block rounded-full bg-surface-2 p-[2px]">
                  <Avatar src={user?.avatar} name={user?.name} color={user?.avatarColor} size="lg" />
                </span>
              </span>
            ) : (
              <span className="grid h-14 w-14 place-items-center rounded-full border-[1.5px] border-dashed border-line-strong bg-surface text-ink-muted">
                <Plus size={22} strokeWidth={2} />
              </span>
            )}
            {mine && (
              <span className="absolute -bottom-0.5 -right-0.5 grid h-[19px] w-[19px] place-items-center rounded-full bg-brand text-brand-ink ring-2 ring-surface-2">
                <Plus size={12} strokeWidth={3} />
              </span>
            )}
          </span>
          <span className="w-full truncate text-center text-[11px] font-medium text-ink-muted">
            Add story
          </span>
        </motion.button>

        {others.map((ring) => (
          <motion.button
            key={ring.user._id}
            type="button"
            whileTap={{ scale: 0.92 }}
            onClick={() => {
              feedback('open');
              openSheet('storyViewer', { ring });
            }}
            className="flex w-[58px] shrink-0 flex-col items-center gap-1.5"
          >
            <span
              className={cn(
                'block rounded-full p-[2px]',
                ring.hasUnseen
                  ? 'bg-gradient-to-tr from-brand-strong via-brand to-wa-200'
                  : 'bg-line-strong'
              )}
            >
              <span className="block rounded-full bg-surface-2 p-[2px]">
                <Avatar
                  src={ring.user.avatar}
                  name={ring.user.name}
                  color={ring.user.avatarColor}
                  size="lg"
                />
              </span>
            </span>
            <span className="w-full truncate text-center text-[11px] font-medium">
              {ring.user.name.split(' ')[0]}
            </span>
          </motion.button>
        ))}
      </div>
    </div>
  );
}
