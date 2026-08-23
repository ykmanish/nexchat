'use client';

import { Suspense } from 'react';
import { useSelectedLayoutSegment } from 'next/navigation';
import { cn } from '@/lib/utils';
import { ChatListPane } from '@/components/chat/ChatListPane';

/**
 * Two panes on desktop, one at a time on mobile. The selected segment tells us
 * whether a thread is open, which is all the mobile layout needs to know.
 */
export default function ChatsLayout({ children }) {
  const segment = useSelectedLayoutSegment();
  const threadOpen = !!segment;

  return (
    <div className="flex h-full min-h-0 w-full overflow-hidden">
      <div
        className={cn(
          'relative min-h-0 w-full shrink-0 flex-col border-r border-line bg-surface',
          'lg:flex lg:w-[380px] xl:w-[420px]',
          threadOpen ? 'hidden lg:flex' : 'flex'
        )}
      >
        <Suspense fallback={<div className="flex-1 bg-surface" />}>
          <ChatListPane />
        </Suspense>
      </div>

      <div
        className={cn(
          'h-full min-h-0 min-w-0 flex-1 overflow-hidden',
          threadOpen ? 'flex' : 'hidden lg:flex'
        )}
      >
        {children}
      </div>
    </div>
  );
}
