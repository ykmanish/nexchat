'use client';

import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { Sparkles, Hash, RefreshCw } from 'lucide-react';
import { Avatar } from '@/components/ui/Avatar';
import { useFeed, countLabel } from '@/store/feed';
import { FollowButton } from './FollowButton';

/** Placeholder cards, shaped like the real thing so nothing jumps on arrival. */
export function FeedSkeleton({ count = 3 }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="border-b border-line bg-surface sm:rounded-2xl sm:border"
        >
          <div className="flex items-center gap-3 px-4 py-3.5">
            <div className="skeleton h-10 w-10 rounded-full" />
            <div className="flex-1 space-y-2">
              <div className="skeleton h-3 w-32 rounded-full" />
              <div className="skeleton h-2.5 w-20 rounded-full" />
            </div>
          </div>
          <div className="skeleton aspect-[4/5] w-full" />
          <div className="space-y-2 px-4 py-4">
            <div className="skeleton h-3 w-24 rounded-full" />
            <div className="skeleton h-3 w-3/4 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Shown when a list has run out — quieter than an empty state, and final. */
export function EndOfFeed({ label = 'You are all caught up' }) {
  return (
    <div className="flex flex-col items-center gap-1 px-6 py-10 text-center">
      <div className="grid h-11 w-11 place-items-center rounded-full bg-brand-tint text-brand-strong">
        <Sparkles size={19} strokeWidth={1.9} />
      </div>
      <p className="mt-1 text-[14px] font-semibold">{label}</p>
      <p className="text-[12.5px] text-ink-muted">You have seen everything from the last while.</p>
    </div>
  );
}

/**
 * Who to follow.
 *
 * Every card carries the reason it is here — "You chat with them", "Followed
 * by people you follow". A suggestion with no reason attached is
 * indistinguishable from an advert, and nothing in this app should look like
 * one.
 */
export function WhoToFollow({ variant = 'card', limit = 5 }) {
  const router = useRouter();
  const suggestions = useFeed((s) => s.suggestions);
  const loadSuggestions = useFeed((s) => s.loadSuggestions);

  if (!suggestions.length) return null;
  const people = suggestions.slice(0, limit);

  if (variant === 'rail') {
    return (
      <div className="border-b border-line bg-surface py-4 sm:rounded-2xl sm:border">
        <div className="flex items-center justify-between px-4 pb-3">
          <h2 className="flex items-center gap-2 font-display text-[15px] tracking-tight">
            <Sparkles size={15} className="text-brand-strong" />
            Suggested for you
          </h2>
          <button
            type="button"
            onClick={() => loadSuggestions()}
            aria-label="Refresh suggestions"
            className="grid h-8 w-8 place-items-center rounded-full text-ink-faint transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <RefreshCw size={14} />
          </button>
        </div>

        <div className="no-scrollbar flex gap-3 overflow-x-auto px-4">
          {people.map((person) => (
            <div
              key={person._id}
              className="flex w-[152px] shrink-0 flex-col items-center gap-2 rounded-2xl border border-line p-4 text-center"
            >
              <button type="button" onClick={() => router.push('/u/' + person._id)}>
                <Avatar src={person.avatar} name={person.name} color={person.avatarColor} size="xl" />
              </button>
              <div className="w-full min-w-0">
                <p className="truncate text-[14px] font-semibold">{person.name}</p>
                <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-ink-faint">
                  {person.reason}
                </p>
              </div>
              <FollowButton userId={person._id} isFollowing={person.isFollowing} size="xs" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <section className="rounded-2xl border border-line bg-surface p-4">
      <h2 className="mb-3 flex items-center gap-2 font-display text-[15px] tracking-tight">
        <Sparkles size={15} className="text-brand-strong" />
        Suggested for you
      </h2>
      <ul className="space-y-1">
        {people.map((person) => (
          <li key={person._id} className="flex items-center gap-3 rounded-xl py-1.5">
            <button type="button" onClick={() => router.push('/u/' + person._id)}>
              <Avatar src={person.avatar} name={person.name} color={person.avatarColor} size="sm" />
            </button>
            <button
              type="button"
              onClick={() => router.push('/u/' + person._id)}
              className="min-w-0 flex-1 text-left"
            >
              <span className="block truncate text-[14px] font-semibold">{person.name}</span>
              <span className="block truncate text-[11.5px] text-ink-faint">{person.reason}</span>
            </button>
            <FollowButton userId={person._id} isFollowing={person.isFollowing} size="xs" />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Trending hashtags, for the desktop sidebar. */
export function TrendingTags() {
  const router = useRouter();
  const trending = useFeed((s) => s.trending);

  if (!trending.length) return null;

  return (
    <section className="rounded-2xl border border-line bg-surface p-4">
      <h2 className="mb-2 flex items-center gap-2 font-display text-[15px] tracking-tight">
        <Hash size={15} className="text-brand-strong" />
        Trending this week
      </h2>
      <ul>
        {trending.slice(0, 8).map((item) => (
          <li key={item.tag}>
            <button
              type="button"
              onClick={() => router.push('/explore?q=' + encodeURIComponent('#' + item.tag))}
              className="w-full rounded-xl px-2 py-2 text-left transition-colors hover:bg-surface-2"
            >
              <span className="block truncate text-[14px] font-medium">#{item.tag}</span>
              <span className="block text-[11.5px] text-ink-faint">
                {countLabel(item.posts)} {item.posts === 1 ? 'post' : 'posts'}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
