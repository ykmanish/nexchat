'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Search, X, Loader2, Compass } from 'lucide-react';
import { useFeed, selectList } from '@/store/feed';
import { PostGrid } from '@/components/feed/PostGrid';
import { WhoToFollow, TrendingTags } from '@/components/feed/FeedPieces';
import { PeopleResults } from '@/components/feed/PeopleResults';
import { IconButton } from '@/components/ui/Button';
import { debounce } from '@/lib/utils';
import { cn } from '@/lib/utils';

/**
 * Explore.
 *
 * Search covers both halves of what people look for — accounts and posts — and
 * shows them in that order, because somebody typing a name is almost always
 * after the person rather than a post that mentions them.
 */
export default function ExplorePage() {
  const router = useRouter();
  const params = useSearchParams();
  const initial = params.get('q') || '';

  const list = useFeed(selectList('explore'));
  const posts = useFeed((s) => s.posts);
  const loadList = useFeed((s) => s.loadList);
  const loadSuggestions = useFeed((s) => s.loadSuggestions);
  const loadTrending = useFeed((s) => s.loadTrending);

  const [query, setQuery] = useState(initial);
  const [applied, setApplied] = useState(initial);
  const sentinel = useRef(null);
  const scroller = useRef(null);

  useEffect(() => {
    loadSuggestions();
    loadTrending();
  }, [loadSuggestions, loadTrending]);

  /* Debounced so a typed query is one request rather than one per keystroke. */
  const push = useRef(
    debounce((value) => setApplied(value.trim()), 320)
  ).current;

  useEffect(() => {
    push(query);
  }, [query, push]);

  useEffect(() => {
    loadList('explore', { refresh: true, params: applied ? { q: applied } : {} });
  }, [applied, loadList]);

  const more = useCallback(() => {
    if (!list.loading && list.hasMore) {
      loadList('explore', { params: applied ? { q: applied } : {} });
    }
  }, [list.loading, list.hasMore, loadList, applied]);

  useEffect(() => {
    const node = sentinel.current;
    if (!node) return undefined;
    const observer = new IntersectionObserver(
      (entries) => entries[0].isIntersecting && more(),
      { root: scroller.current, rootMargin: '800px 0px' }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [more]);

  const rows = list.ids.map((id) => posts[id]).filter(Boolean);
  const searching = applied.length >= 2;

  return (
    <div className="flex h-full min-h-0 flex-col bg-app">
      <header className="safe-top z-20 shrink-0 border-b border-line bg-header">
        <div className="mx-auto flex h-[54px] w-full max-w-[935px] items-center gap-2 px-2 sm:px-4">
          <IconButton
            icon={ArrowLeft}
            label="Back"
            variant="ghost"
            className="lg:hidden"
            onClick={() => router.back()}
          />

          <label className="flex h-10 min-w-0 flex-1 items-center gap-2.5 rounded-full bg-surface-2 px-4">
            <Search size={16} className="shrink-0 text-ink-faint" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search people, posts and #tags"
              className="min-w-0 flex-1 bg-transparent text-[14.5px] outline-none placeholder:text-ink-faint"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Clear search"
                className="shrink-0 text-ink-faint hover:text-ink"
              >
                <X size={15} />
              </button>
            )}
          </label>
        </div>
      </header>

      <div ref={scroller} className="scroll-soft min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[935px] px-0 pb-8 sm:px-4">
          {searching && <PeopleResults query={applied} />}

          {!searching && (
            <div className="space-y-3 px-4 py-4 sm:px-0 xl:hidden">
              <WhoToFollow variant="rail" limit={8} />
            </div>
          )}

          <div className="flex gap-7">
            <main className="min-w-0 flex-1">
              {searching && (
                <h2 className="px-4 pb-2 pt-3 text-[12px] font-semibold uppercase tracking-wide text-ink-faint sm:px-0">
                  Posts
                </h2>
              )}

              {list.loading && !rows.length ? (
                <div className="grid grid-cols-3 gap-0.5 sm:gap-1">
                  {Array.from({ length: 9 }).map((_, i) => (
                    <div key={i} className="skeleton aspect-square sm:rounded-md" />
                  ))}
                </div>
              ) : rows.length ? (
                <PostGrid posts={rows} className={cn(!searching && 'sm:mt-3')} />
              ) : (
                <div className="flex flex-col items-center px-8 py-16 text-center">
                  <div className="mb-4 grid h-16 w-16 place-items-center rounded-3xl border border-line bg-surface text-ink-faint">
                    <Compass size={26} strokeWidth={1.8} />
                  </div>
                  <h3 className="font-display text-[17px] tracking-tight">
                    {searching ? 'No posts found' : 'Nothing to explore yet'}
                  </h3>
                  <p className="mt-1.5 max-w-[280px] text-[13.5px] leading-relaxed text-ink-muted">
                    {searching
                      ? 'Try a different word, or search for a name instead.'
                      : 'Public posts from across Chax will show up here.'}
                  </p>
                </div>
              )}

              <div ref={sentinel} aria-hidden className="h-px" />
              {list.loading && rows.length > 0 && (
                <div className="grid place-items-center py-8 text-ink-faint">
                  <Loader2 size={22} className="animate-spin" />
                </div>
              )}
            </main>

            <aside className="hidden w-[280px] shrink-0 space-y-3 py-4 xl:block">
              <div className="sticky top-4 space-y-3">
                <WhoToFollow limit={6} />
                <TrendingTags />
              </div>
            </aside>
          </div>
        </div>
      </div>
    </div>
  );
}
