'use client';

import { useRouter } from 'next/navigation';
import { ArrowLeft, Bookmark } from 'lucide-react';
import { FeedList } from '@/components/feed/FeedList';
import { IconButton } from '@/components/ui/Button';

/** Everything you have bookmarked. Private — nobody is told you saved theirs. */
export default function SavedPage() {
  const router = useRouter();

  return (
    <div className="flex h-full min-h-0 flex-col bg-app">
      <header className="safe-top z-20 flex h-[54px] shrink-0 items-center gap-2 border-b border-line bg-header px-2">
        <IconButton icon={ArrowLeft} label="Back" variant="ghost" onClick={() => router.back()} />
        <h1 className="font-display text-[17px] tracking-tight">Saved</h1>
      </header>

      <div className="scroll-soft min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[600px] sm:p-4">
          <p className="px-4 pb-1 pt-3 text-[12.5px] text-ink-faint sm:px-0">
            Only you can see what you have saved.
          </p>

          <FeedList
            listKey="saved"
            className="space-y-0 sm:space-y-3"
            emptyState={
              <div className="flex flex-col items-center px-8 py-16 text-center">
                <div className="mb-4 grid h-16 w-16 place-items-center rounded-3xl border border-line bg-surface text-ink-faint">
                  <Bookmark size={26} strokeWidth={1.8} />
                </div>
                <h3 className="font-display text-[17px] tracking-tight">Nothing saved yet</h3>
                <p className="mt-1.5 max-w-[280px] text-[13.5px] leading-relaxed text-ink-muted">
                  Tap the bookmark on any post and it will be waiting here.
                </p>
              </div>
            }
          />
          <div className="h-6" />
        </div>
      </div>
    </div>
  );
}
