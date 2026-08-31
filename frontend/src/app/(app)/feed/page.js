'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Compass, Bookmark, Plus, PenSquare, Sparkles } from 'lucide-react';
import { useFeed } from '@/store/feed';
import { usePaneScroll } from '@/lib/usePaneScroll';
import { useUI } from '@/store/ui';
import { useChat } from '@/store/chat';
import { StoryRail } from '@/components/chat/StoryRail';
import { FeedList } from '@/components/feed/FeedList';
import { WhoToFollow, TrendingTags } from '@/components/feed/FeedPieces';
import { Logo } from '@/components/brand/Logo';
import { IconButton } from '@/components/ui/Button';

/**
 * The home feed — and the first thing anybody sees when they open Chax.
 *
 * Three columns at xl, two at lg, one below that. The centre column is capped
 * at 600px whatever the screen does: a feed card that stretches to a 27-inch
 * monitor is unreadable, and every reference gets this right by refusing to.
 *
 * The page owns its own scroll container rather than letting the document
 * scroll, because the app shell locks the viewport so only one pane moves.
 */
export default function FeedPage() {
  const router = useRouter();
  const openSheet = useUI((s) => s.openSheet);

  const discover = useFeed((s) => s.discover);
  const loadSuggestions = useFeed((s) => s.loadSuggestions);
  const loadTrending = useFeed((s) => s.loadTrending);
  const loadStories = useChat((s) => s.loadStories);

  const { ref: scroller, scrollToTop } = usePaneScroll('feed');

  useEffect(() => {
    loadSuggestions();
    loadTrending();
    loadStories().catch(() => {});
  }, [loadSuggestions, loadTrending, loadStories]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-app">
      {/* ── header ── */}
      {/* No bottom border, and the same token the status bar is painted
          from — so on a phone the system strip and the app header read as
          one panel instead of two tones with a line between them. */}
      <header className="safe-top z-20 shrink-0 bg-header">
        <div className="mx-auto flex h-[54px] w-full max-w-[600px] items-center gap-2 px-4 xl:max-w-[952px]">
          <button
            type="button"
            onClick={() => scrollToTop()}
            className="flex items-center gap-2.5"
          >
            <Logo size={26} />
            <span className="font-display text-[20px] tracking-tight">Chax</span>
          </button>

          <div className="flex-1" />

          {/* Composing is the primary action, so it lives in the header at
              every width. On a phone it is the only way in — the "share
              something" row costs a whole card's height for a control that
              says nothing, and a thumb reaches the header as easily as the
              row it replaces. */}
          <IconButton
            icon={Plus}
            label="New post"
            variant="tinted"
            onClick={() => openSheet('newPost')}
          />
          <IconButton
            icon={Compass}
            label="Explore"
            variant="ghost"
            onClick={() => router.push('/explore')}
          />
          <IconButton
            icon={Bookmark}
            label="Saved"
            variant="ghost"
            onClick={() => router.push('/feed/saved')}
          />
        </div>
      </header>

      {/* ── body ── */}
      <div ref={scroller} className="scroll-soft scroll-layer min-h-0 flex-1 overflow-y-auto">
        {/* One centring, not two. The old version centred a 1100px block and
            then centred the 600px column again inside whatever was left over
            after the sidebar, which pushed the feed off to one side and left
            an odd gap on the other. The track is now exactly as wide as what
            is in it — 600 alone, or 600 + gap + 300 once the sidebar appears —
            so the whole thing sits square in the window at every width. */}
        <div className="mx-auto flex w-full max-w-[600px] gap-7 px-0 sm:px-4 xl:max-w-[952px]">
          <main className="w-full min-w-0 max-w-[600px] py-0 sm:py-4">
            <div className="border-b border-line bg-surface pt-2 sm:mb-3 sm:rounded-2xl sm:border">
              <StoryRail />
            </div>

            {discover && (
              <div className="mb-3 flex items-start gap-3 border-b border-line bg-brand-tint px-4 py-3 sm:rounded-2xl sm:border-0">
                <Sparkles size={17} className="mt-0.5 shrink-0 text-brand-strong" />
                <p className="text-[13px] leading-relaxed text-ink-soft">
                  <span className="font-semibold">You are not following anyone yet.</span> These are
                  recent public posts — follow a few people and this becomes your feed.
                </p>
              </div>
            )}

            <FeedList
              listKey="home"
              className="space-y-0 sm:space-y-3"
              scrollRoot={scroller}
              emptyState={<EmptyFeed onCompose={() => openSheet('newPost')} />}
              /* One suggestions rail, after the third post — far enough in to
                 be a break rather than an interruption. */
              interleave={(i) =>
                i === 2 ? (
                  <div className="my-0 sm:my-3">
                    <WhoToFollow variant="rail" />
                  </div>
                ) : null
              }
            />

            <div className="h-6" />
          </main>

          {/* ── sidebar, widest screens only ── */}
          <aside className="hidden w-[324px] shrink-0 space-y-3 py-4 xl:block">
            <div className="sticky top-4 space-y-3">
              <WhoToFollow />
              <TrendingTags />
              <p className="px-2 text-[11.5px] leading-relaxed text-ink-faint">
                Posts are public to the audience you choose. Your chats and calls stay end-to-end
                encrypted — the feed is the one part of Chax that is not.
              </p>
            </div>
          </aside>
        </div>
      </div>

    </div>
  );
}

function EmptyFeed({ onCompose }) {
  return (
    <div className="flex flex-col items-center px-8 py-16 text-center">
      <div className="mb-4 grid h-16 w-16 place-items-center rounded-3xl border border-line bg-surface text-ink-faint">
        <PenSquare size={26} strokeWidth={1.8} />
      </div>
      <h3 className="font-display text-[17px] tracking-tight">Nothing here yet</h3>
      <p className="mt-1.5 max-w-[280px] text-[13.5px] leading-relaxed text-ink-muted">
        Follow a few people, or post something of your own and start the thing off.
      </p>
      <button
        type="button"
        onClick={onCompose}
        className="mt-5 rounded-full bg-brand px-5 py-2.5 text-[14px] font-medium text-brand-ink transition-colors hover:bg-brand-hover"
      >
        Write your first post
      </button>
    </div>
  );
}
