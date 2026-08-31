'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, MessageCircle, Grid3x3, List, Loader2, Settings, UserX } from 'lucide-react';
import { useFeed, selectList, countLabel } from '@/store/feed';
import { useAuth } from '@/store/auth';
import { useChat } from '@/store/chat';
import { toast } from '@/store/ui';
import { Avatar } from '@/components/ui/Avatar';
import { Button, IconButton } from '@/components/ui/Button';
import { PostGrid } from '@/components/feed/PostGrid';
import { PostCard } from '@/components/feed/PostCard';
import { FollowButton } from '@/components/feed/FollowButton';
import { FollowersSheet } from '@/components/feed/FollowersSheet';
import { cn } from '@/lib/utils';

/**
 * Somebody's posts.
 *
 * Grid by default, list on request. The grid is how you take in a body of work
 * at a glance; the list is how you actually read it, and a profile that only
 * offers one of the two is missing half its job.
 */
export default function ProfilePage() {
  const { id } = useParams();
  const router = useRouter();

  const profile = useFeed((s) => s.profiles[id]);
  const posts = useFeed((s) => s.posts);
  const list = useFeed(selectList('profile:' + id));
  const loadProfile = useFeed((s) => s.loadProfile);

  const me = useAuth((s) => s.user);
  const createDirect = useChat((s) => s.createDirect);

  const [view, setView] = useState('grid');
  const [sheet, setSheet] = useState(null); // 'followers' | 'following'
  const [opening, setOpening] = useState(false);

  const sentinel = useRef(null);
  const scroller = useRef(null);
  const asked = useRef(null);

  useEffect(() => {
    if (!id || asked.current === id) return;
    asked.current = id;
    loadProfile(id, { refresh: true });
  }, [id, loadProfile]);

  const more = useCallback(() => {
    if (!list.loading && list.hasMore) loadProfile(id);
  }, [list.loading, list.hasMore, loadProfile, id]);

  useEffect(() => {
    const node = sentinel.current;
    if (!node) return undefined;
    const observer = new IntersectionObserver(
      (entries) => entries[0].isIntersecting && more(),
      { root: scroller.current, rootMargin: '700px 0px' }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [more]);

  const rows = list.ids.map((postId) => posts[postId]).filter(Boolean);
  const mine = profile?.isMe || String(id) === String(me?._id);

  async function message() {
    setOpening(true);
    try {
      const conversation = await createDirect(id);
      router.push('/chats/' + conversation._id);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setOpening(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-app">
      <header className="safe-top z-20 flex h-[54px] shrink-0 items-center gap-2 bg-header px-2">
        <IconButton icon={ArrowLeft} label="Back" variant="ghost" onClick={() => router.back()} />
        <h1 className="min-w-0 flex-1 truncate font-display text-[17px] tracking-tight">
          {profile?.username ? '@' + profile.username : profile?.name || 'Profile'}
        </h1>
        {mine && (
          <IconButton
            icon={Settings}
            label="Edit profile"
            variant="ghost"
            onClick={() => router.push('/settings/profile')}
          />
        )}
      </header>

      <div ref={scroller} className="scroll-soft min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[935px] pb-8">
          {!profile ? (
            <div className="grid place-items-center py-20 text-ink-faint">
              <Loader2 size={22} className="animate-spin" />
            </div>
          ) : (
            <>
              {/* ── identity ── */}
              <section className="px-5 pt-6 sm:px-8">
                <div className="flex items-center gap-5 sm:gap-10">
                  <Avatar
                    src={profile.avatar}
                    name={profile.name}
                    color={profile.avatarColor}
                    size="2xl"
                    online={profile.presence === 'online'}
                    className="shrink-0"
                  />

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <h2 className="truncate font-display text-[20px] tracking-tight sm:text-[23px]">
                        {profile.name}
                      </h2>
                      {!mine && (
                        <FollowButton
                          userId={profile._id}
                          isFollowing={profile.isFollowing}
                          size="sm"
                          showIcon
                        />
                      )}
                      {!mine && (
                        <Button
                          size="sm"
                          variant="secondary"
                          icon={MessageCircle}
                          loading={opening}
                          onClick={message}
                        >
                          Message
                        </Button>
                      )}
                      {mine && (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => router.push('/settings/profile')}
                        >
                          Edit profile
                        </Button>
                      )}
                    </div>

                    {/* Counts, tappable where tapping them means something. */}
                    <dl className="mt-3 flex gap-6 text-[13.5px]">
                      <Stat label="posts" value={profile.postCount} />
                      <Stat
                        label="followers"
                        value={profile.followerCount}
                        onClick={() => setSheet('followers')}
                      />
                      <Stat
                        label="following"
                        value={profile.followingCount}
                        onClick={() => setSheet('following')}
                      />
                    </dl>
                  </div>
                </div>

                {profile.about && (
                  <p className="selectable mt-4 max-w-[560px] whitespace-pre-wrap text-[14px] leading-relaxed text-ink-soft">
                    {profile.about}
                  </p>
                )}
              </section>

              {/* ── view switch ── */}
              <div className="mt-6 flex items-center justify-center gap-1 border-t border-line">
                {[
                  { key: 'grid', icon: Grid3x3, label: 'Grid' },
                  { key: 'list', icon: List, label: 'List' },
                ].map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => setView(option.key)}
                    aria-label={option.label}
                    className={cn(
                      '-mt-px flex items-center gap-2 border-t-2 px-6 py-3 text-[12px] font-semibold uppercase tracking-wide transition-colors',
                      view === option.key
                        ? 'border-ink text-ink'
                        : 'border-transparent text-ink-faint hover:text-ink-muted'
                    )}
                  >
                    <option.icon size={14} strokeWidth={2.2} />
                    <span className="hidden sm:inline">{option.label}</span>
                  </button>
                ))}
              </div>

              {/* ── the posts ── */}
              {list.loading && !rows.length ? (
                <div className="mt-1 grid grid-cols-3 gap-0.5 sm:gap-1">
                  {Array.from({ length: 9 }).map((_, i) => (
                    <div key={i} className="skeleton aspect-square sm:rounded-md" />
                  ))}
                </div>
              ) : rows.length ? (
                view === 'grid' ? (
                  <PostGrid posts={rows} className="mt-1" />
                ) : (
                  <div className="mx-auto mt-3 max-w-[600px] space-y-0 sm:space-y-3">
                    {rows.map((post) => (
                      <PostCard key={post._id} post={post} />
                    ))}
                  </div>
                )
              ) : (
                <div className="flex flex-col items-center px-8 py-16 text-center">
                  <div className="mb-4 grid h-16 w-16 place-items-center rounded-3xl border border-line bg-surface text-ink-faint">
                    <UserX size={26} strokeWidth={1.8} />
                  </div>
                  <h3 className="font-display text-[17px] tracking-tight">
                    {mine ? 'You have not posted yet' : 'No posts to show'}
                  </h3>
                  <p className="mt-1.5 max-w-[300px] text-[13.5px] leading-relaxed text-ink-muted">
                    {mine
                      ? 'Anything you post will appear here.'
                      : profile.isFollowing
                        ? 'They have not posted anything yet.'
                        : 'Some of their posts may only be visible to followers.'}
                  </p>
                </div>
              )}

              <div ref={sentinel} aria-hidden className="h-px" />
              {list.loading && rows.length > 0 && (
                <div className="grid place-items-center py-8 text-ink-faint">
                  <Loader2 size={22} className="animate-spin" />
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <FollowersSheet
        open={!!sheet}
        mode={sheet || 'followers'}
        userId={id}
        onClose={() => setSheet(null)}
      />
    </div>
  );
}

function Stat({ label, value, onClick }) {
  const content = (
    <>
      <dd className="font-semibold tabular-nums">{countLabel(value ?? 0) || 0}</dd>
      <dt className="text-ink-muted">{label}</dt>
    </>
  );

  if (!onClick) return <div className="flex items-baseline gap-1.5">{content}</div>;

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-baseline gap-1.5 transition-opacity hover:opacity-70"
    >
      {content}
    </button>
  );
}
