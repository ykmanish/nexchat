'use client';

import { useCallback, useEffect, useRef } from 'react';
import { Loader2, RotateCw } from 'lucide-react';
import { useFeed, selectList } from '@/store/feed';
import { PostCard } from './PostCard';
import { FeedSkeleton, EndOfFeed } from './FeedPieces';

/**
 * A paginated list of posts, with infinite scroll.
 *
 * The sentinel is an IntersectionObserver rather than a scroll handler, and it
 * sits a screen-and-a-half below the last card. Waiting for the reader to hit
 * the actual bottom means they always see a spinner; loading early means they
 * usually do not.
 */
export function FeedList({
  listKey,
  emptyState = null,
  interleave = null,
  className,
  scrollRoot = null,
}) {
  const list = useFeed(selectList(listKey));
  const posts = useFeed((s) => s.posts);
  const loadList = useFeed((s) => s.loadList);

  const sentinel = useRef(null);
  const firstLoad = useRef(false);

  /* Whether this list already had rows when the pane mounted.
     Coming back to a tab should look like the tab reappearing, not like it
     being built again — replaying a fade-and-lift on forty cards is both
     visibly wrong and a real cost in frames at exactly the moment the browser
     is busiest. New arrivals still animate; a revisit does not. */
  const revisit = useRef(list.ids.length > 0);

  useEffect(() => {
    if (firstLoad.current) return;
    firstLoad.current = true;
    loadList(listKey, { refresh: true });
  }, [listKey, loadList]);

  const more = useCallback(() => {
    if (!list.loading && list.hasMore) loadList(listKey);
  }, [list.loading, list.hasMore, listKey, loadList]);

  useEffect(() => {
    const node = sentinel.current;
    if (!node) return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) more();
      },
      { root: scrollRoot?.current || null, rootMargin: '900px 0px' }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [more, scrollRoot]);

  const rows = list.ids.map((id) => posts[id]).filter(Boolean);
  const loadingFirstPage = list.loading && !rows.length;

  if (loadingFirstPage) return <FeedSkeleton />;

  if (!rows.length && !list.loading) {
    if (list.error) {
      return (
        <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
          <p className="text-[14.5px] text-ink-muted">{list.error}</p>
          <button
            type="button"
            onClick={() => loadList(listKey, { refresh: true })}
            className="flex items-center gap-2 rounded-full bg-surface-2 px-4 py-2 text-[13.5px] font-medium transition-colors hover:bg-surface-3"
          >
            <RotateCw size={14} />
            Try again
          </button>
        </div>
      );
    }
    return emptyState;
  }

  return (
    <div className={className}>
      {rows.map((post, i) => (
        <div key={post._id}>
          <PostCard post={post} priority={revisit.current || i < 2} />
          {/* Something other than posts, every so often — a suggestions rail
              sitting inside the scroll rather than pinned above it. */}
          {interleave?.(i)}
        </div>
      ))}

      <div ref={sentinel} aria-hidden className="h-px" />

      {list.loading && rows.length > 0 && (
        <div className="grid place-items-center py-8 text-ink-faint">
          <Loader2 size={22} className="animate-spin" />
        </div>
      )}

      {!list.hasMore && rows.length > 3 && <EndOfFeed />}
    </div>
  );
}
