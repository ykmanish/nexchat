'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useFeed, countLabel } from '@/store/feed';
import { useUI } from '@/store/ui';
import { PostCard } from '@/components/feed/PostCard';
import { FeedSkeleton } from '@/components/feed/FeedPieces';
import { IconButton } from '@/components/ui/Button';
import { feedTimeLong } from '@/lib/feedtext';

/**
 * One post, by permalink.
 *
 * This is where a shared link lands, so it has to stand on its own: the full
 * card, the exact time rather than "4h", and the comments open rather than
 * behind a tap. Everything else about the card is the same component the feed
 * uses — a detail view that drifts from the list view is how the two stop
 * agreeing about what a post looks like.
 */
export default function PostPage() {
  const { id } = useParams();
  const router = useRouter();

  const post = useFeed((s) => s.posts[id]);
  const loadPost = useFeed((s) => s.loadPost);
  const loadComments = useFeed((s) => s.loadComments);
  const openSheet = useUI((s) => s.openSheet);

  const [error, setError] = useState(null);
  const asked = useRef(false);

  useEffect(() => {
    if (!id || asked.current) return;
    asked.current = true;

    loadPost(id).catch((err) => setError(err.message));
    loadComments(id, { refresh: true });
  }, [id, loadPost, loadComments]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-app">
      <header className="safe-top z-20 flex h-[54px] shrink-0 items-center gap-2 bg-header px-2">
        <IconButton icon={ArrowLeft} label="Back" variant="ghost" onClick={() => router.back()} />
        <h1 className="font-display text-[17px] tracking-tight">Post</h1>
      </header>

      <div className="scroll-soft min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[600px] sm:p-4">
          {error && (
            <div className="px-6 py-16 text-center">
              <h2 className="font-display text-[17px]">This post is not available</h2>
              <p className="mt-1.5 text-[13.5px] text-ink-muted">
                It may have been deleted, or you may not have permission to see it.
              </p>
              <button
                type="button"
                onClick={() => router.push('/feed')}
                className="mt-5 rounded-full bg-surface-2 px-5 py-2.5 text-[14px] font-medium transition-colors hover:bg-surface-3"
              >
                Back to the feed
              </button>
            </div>
          )}

          {!post && !error && <FeedSkeleton count={1} />}

          {post && (
            <>
              <PostCard post={post} priority />

              <div className="border-b border-line bg-surface px-4 py-3 text-[12.5px] text-ink-faint sm:mt-3 sm:rounded-2xl sm:border">
                {feedTimeLong(post.createdAt)}
                {post.shareCount > 0 && ' · ' + countLabel(post.shareCount) + ' shares'}
                {post.editedAt && ' · edited'}
              </div>

              {!post.commentsDisabled && (
                <button
                  type="button"
                  onClick={() => openSheet('comments', { postId: post._id })}
                  className="mt-3 w-full rounded-2xl border border-line bg-surface px-4 py-3.5 text-left text-[14.5px] font-medium text-brand-strong transition-colors hover:bg-surface-2"
                >
                  {post.commentCount
                    ? 'Open ' + countLabel(post.commentCount) + (post.commentCount === 1 ? ' comment' : ' comments')
                    : 'Add the first comment'}
                </button>
              )}

              <InlineComments postId={post._id} />
              <div className="h-8" />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** A read-only preview of the thread, so the page is not empty under the card. */
function InlineComments({ postId }) {
  const thread = useFeed((s) => s.comments[postId]);
  const openSheet = useUI((s) => s.openSheet);

  if (thread?.loading && !thread?.items?.length) {
    return (
      <div className="grid place-items-center py-10 text-ink-faint">
        <Loader2 size={20} className="animate-spin" />
      </div>
    );
  }

  const items = (thread?.items || []).slice(0, 4);
  if (!items.length) return null;

  return (
    <ul className="mt-3 space-y-2">
      {items.map((comment) => (
        <li key={comment._id}>
          <button
            type="button"
            onClick={() => openSheet('comments', { postId })}
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
  );
}
