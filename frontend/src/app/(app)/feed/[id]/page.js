'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Loader2, Lock } from 'lucide-react';
import { useFeed, countLabel } from '@/store/feed';
import { useAuth } from '@/store/auth';
import { useUI } from '@/store/ui';
import { PostCard } from '@/components/feed/PostCard';
import { FeedSkeleton } from '@/components/feed/FeedPieces';
import { Logo } from '@/components/brand/Logo';
import { Button, IconButton } from '@/components/ui/Button';
import { feedTimeLong } from '@/lib/feedtext';

/**
 * One post, by permalink.
 *
 * This is where a shared link lands, and it has to work for whoever opens it —
 * including somebody with no account, who is the most likely person to be
 * following a link from outside. A public post renders in full for them; the
 * controls are what ask for an account, at the moment they reach for one,
 * rather than a wall in front of the thing they were sent.
 */
export default function PostPage() {
  const { id } = useParams();
  const router = useRouter();

  const status = useAuth((s) => s.status);
  const guest = status === 'guest';

  const post = useFeed((s) => s.posts[id]);
  const loadSharedPost = useFeed((s) => s.loadSharedPost);
  const loadComments = useFeed((s) => s.loadComments);
  const openSheet = useUI((s) => s.openSheet);

  const [error, setError] = useState(null);
  const asked = useRef(null);

  useEffect(() => {
    if (!id || status === 'loading' || asked.current === id + status) return;
    asked.current = id + status;

    loadSharedPost(id).catch((err) => setError(err.message));
    if (!guest) loadComments(id, { refresh: true });
  }, [id, status, guest, loadSharedPost, loadComments]);

  const signIn = () => router.push('/welcome?next=' + encodeURIComponent('/feed/' + id));

  return (
    <div className="flex h-full min-h-0 flex-col bg-app">
      <header className="safe-top z-20 flex h-[54px] shrink-0 items-center gap-2 bg-header px-2">
        {guest ? (
          <button
            type="button"
            onClick={() => router.push('/welcome')}
            className="flex items-center gap-2.5 px-2"
          >
            <Logo size={26} />
            <span className="font-display text-[19px] tracking-tight">Chax</span>
          </button>
        ) : (
          <>
            <IconButton icon={ArrowLeft} label="Back" variant="ghost" onClick={() => router.back()} />
            <h1 className="font-display text-[17px] tracking-tight">Post</h1>
          </>
        )}

        <div className="flex-1" />

        {guest && (
          <Button size="sm" onClick={signIn} className="mr-1">
            Sign in
          </Button>
        )}
      </header>

      <div className="scroll-soft min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[600px] sm:p-4">
          {error && (
            <div className="px-6 py-16 text-center">
              <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl border border-line bg-surface text-ink-faint">
                <Lock size={22} strokeWidth={1.8} />
              </div>
              <h2 className="font-display text-[17px]">This post is not available</h2>
              <p className="mx-auto mt-1.5 max-w-[300px] text-[13.5px] leading-relaxed text-ink-muted">
                It may have been deleted, or the person who posted it limited who can see it.
              </p>
              <Button size="sm" className="mt-5" onClick={() => router.push(guest ? '/welcome' : '/feed')}>
                {guest ? 'Go to Chax' : 'Back to the feed'}
              </Button>
            </div>
          )}

          {!post && !error && <FeedSkeleton count={1} />}

          {post && (
            <>
              <PostCard
                post={post}
                priority
                readOnly={guest}
                onRequireAuth={signIn}
              />

              <div className="border-b border-line bg-surface px-4 py-3 text-[12.5px] text-ink-faint sm:mt-3 sm:rounded-2xl sm:border">
                {feedTimeLong(post.createdAt)}
                {post.shareCount > 0 && ' · ' + countLabel(post.shareCount) + ' shares'}
                {post.editedAt && ' · edited'}
              </div>

              {guest ? <JoinPrompt onSignIn={signIn} /> : <SignedInTail post={post} openSheet={openSheet} />}
              <div className="h-8" />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * The way in, for somebody reading a shared post without an account.
 *
 * Stated as what they get rather than as what they are missing, and it says
 * what Chax is — most people arriving here have never heard of it, and a bare
 * "sign in to continue" tells them nothing about what they would be signing
 * in to.
 */
function JoinPrompt({ onSignIn }) {
  return (
    <div className="mt-3 rounded-2xl border border-line bg-surface p-6 text-center">
      <Logo size={34} className="mx-auto" />
      <h2 className="mt-3 font-display text-[18px] tracking-tight">Join the conversation</h2>
      <p className="mx-auto mt-1.5 max-w-[320px] text-[13.5px] leading-relaxed text-ink-muted">
        Reply, follow and post on Chax — a messenger where your chats and calls stay end-to-end
        encrypted.
      </p>

      <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
        <Button onClick={onSignIn}>Create an account</Button>
        <Button variant="secondary" onClick={onSignIn}>
          Sign in
        </Button>
      </div>
    </div>
  );
}

/** The comment tail, for a reader who actually has an account. */
function SignedInTail({ post, openSheet }) {
  const thread = useFeed((s) => s.comments[post._id]);

  return (
    <>
      {!post.commentsDisabled && (
        <button
          type="button"
          onClick={() => openSheet('comments', { postId: post._id })}
          className="mt-3 w-full rounded-2xl border border-line bg-surface px-4 py-3.5 text-left text-[14.5px] font-medium text-brand-strong transition-colors hover:bg-surface-2"
        >
          {post.commentCount
            ? 'Open ' +
              countLabel(post.commentCount) +
              (post.commentCount === 1 ? ' comment' : ' comments')
            : 'Add the first comment'}
        </button>
      )}

      {thread?.loading && !thread?.items?.length && (
        <div className="grid place-items-center py-10 text-ink-faint">
          <Loader2 size={20} className="animate-spin" />
        </div>
      )}

      <ul className="mt-3 space-y-2">
        {(thread?.items || []).slice(0, 4).map((comment) => (
          <li key={comment._id}>
            <button
              type="button"
              onClick={() => openSheet('comments', { postId: post._id })}
              className="w-full rounded-2xl border border-line bg-surface px-4 py-3 text-left transition-colors hover:bg-surface-2"
            >
              <span className="text-[14px] font-semibold">{comment.author?.name}</span>
              <span className="ml-2 text-[14px] text-ink-soft">
                {comment.deleted ? 'This comment was deleted.' : comment.text}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
