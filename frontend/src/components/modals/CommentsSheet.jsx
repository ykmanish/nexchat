'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Heart, Send, Trash2, CornerDownRight, Loader2 } from 'lucide-react';
import { Sheet } from '@/components/ui/Sheet';
import { Avatar } from '@/components/ui/Avatar';
import { useAuth } from '@/store/auth';
import { useFeed, countLabel } from '@/store/feed';
import { toast } from '@/store/ui';
import { feedTime } from '@/lib/feedtext';
import { PostText } from '@/components/feed/PostText';
import { cn } from '@/lib/utils';
import { feedback } from '@/lib/sound';

/**
 * Comments on one post.
 *
 * A sheet rather than a route, because a comment is a thing you do *to* a post
 * you are already looking at — navigating away and back loses your place in the
 * feed, which is the whole reason both references use an overlay here too.
 *
 * Newest first, unlike a chat thread: on a busy post the comment worth reading
 * is the one that just arrived.
 */
export function CommentsSheet({ open, onClose, postId }) {
  const post = useFeed((s) => (postId ? s.posts[postId] : null));
  const thread = useFeed((s) => (postId ? s.comments[postId] : null));
  const loadComments = useFeed((s) => s.loadComments);
  const addComment = useFeed((s) => s.addComment);

  const [replyTo, setReplyTo] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (open && postId) {
      setReplyTo(null);
      loadComments(postId, { refresh: true });
    }
  }, [open, postId, loadComments]);

  const items = thread?.items || [];

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Comments"
      subtitle={
        post?.commentCount
          ? countLabel(post.commentCount) + (post.commentCount === 1 ? ' comment' : ' comments')
          : 'Be the first to say something'
      }
      size="lg"
      footer={
        <Composer
          postId={postId}
          replyTo={replyTo}
          onCancelReply={() => setReplyTo(null)}
          onSend={addComment}
          inputRef={inputRef}
        />
      }
    >
      <div className="px-2 pb-2">
        {thread?.loading && !items.length && (
          <div className="grid place-items-center py-12 text-ink-faint">
            <Loader2 size={22} className="animate-spin" />
          </div>
        )}

        {!thread?.loading && !items.length && (
          <div className="px-6 py-14 text-center">
            <p className="text-[15px] font-semibold">No comments yet</p>
            <p className="mt-1 text-[13px] text-ink-muted">
              Start the conversation — yours will be the first.
            </p>
          </div>
        )}

        <AnimatePresence initial={false}>
          {items.map((comment) => (
            <CommentRow
              key={comment._id}
              postId={postId}
              comment={comment}
              onReply={(target) => {
                setReplyTo(target);
                inputRef.current?.focus();
              }}
            />
          ))}
        </AnimatePresence>

        {thread?.hasMore && items.length > 0 && (
          <button
            type="button"
            onClick={() => loadComments(postId)}
            disabled={thread.loading}
            className="mx-auto my-3 block rounded-full px-4 py-2 text-[13px] font-medium text-brand-strong transition-colors hover:bg-brand-tint disabled:opacity-50"
          >
            {thread.loading ? 'Loading…' : 'Load earlier comments'}
          </button>
        )}
      </div>
    </Sheet>
  );
}

function CommentRow({ postId, comment, onReply, nested = false }) {
  const router = useRouter();
  const toggleCommentLike = useFeed((s) => s.toggleCommentLike);
  const deleteComment = useFeed((s) => s.deleteComment);
  const loadReplies = useFeed((s) => s.loadReplies);

  const hidden = comment.replyCount - (comment.replies?.length || 0);

  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0 }}
      className={cn('list-row', nested && 'pl-9')}
    >
      <div className="group flex gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-surface-2">
        <button
          type="button"
          onClick={() => comment.author && router.push('/u/' + comment.author._id)}
          className="shrink-0 pt-0.5"
        >
          <Avatar
            src={comment.author?.avatar}
            name={comment.author?.name}
            color={comment.author?.avatarColor}
            size={nested ? 'xs' : 'sm'}
          />
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5">
            <button
              type="button"
              onClick={() => comment.author && router.push('/u/' + comment.author._id)}
              className="truncate text-[13.5px] font-semibold hover:underline"
            >
              {comment.author?.name}
            </button>
            <span className="shrink-0 text-[12px] text-ink-faint">
              {feedTime(comment.createdAt)}
            </span>
          </div>

          {comment.deleted ? (
            <p className="mt-0.5 text-[13.5px] italic text-ink-faint">This comment was deleted.</p>
          ) : (
            <PostText text={comment.text} clamp={200} className="mt-0.5 text-[14px]" />
          )}

          <div className="mt-1 flex items-center gap-4">
            {!comment.deleted && (
              <button
                type="button"
                onClick={() => onReply({ id: comment._id, name: comment.author?.name })}
                className="text-[12.5px] font-medium text-ink-faint transition-colors hover:text-ink-muted"
              >
                Reply
              </button>
            )}

            {comment.likeCount > 0 && (
              <span className="text-[12.5px] text-ink-faint">
                {countLabel(comment.likeCount)} {comment.likeCount === 1 ? 'like' : 'likes'}
              </span>
            )}

            {comment.isMine && (
              <button
                type="button"
                onClick={async () => {
                  try {
                    await deleteComment(postId, comment._id);
                    feedback('close');
                  } catch (err) {
                    toast.error(err.message);
                  }
                }}
                aria-label="Delete comment"
                className="text-ink-faint opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
              >
                <Trash2 size={13.5} />
              </button>
            )}
          </div>
        </div>

        {!comment.deleted && (
          <motion.button
            type="button"
            whileTap={{ scale: 0.82 }}
            onClick={() => toggleCommentLike(postId, comment._id)}
            aria-label={comment.liked ? 'Unlike comment' : 'Like comment'}
            className={cn(
              'mt-1 h-6 shrink-0 self-start transition-colors',
              comment.liked ? 'text-danger' : 'text-ink-faint hover:text-ink-muted'
            )}
          >
            <Heart size={14.5} fill={comment.liked ? 'currentColor' : 'none'} strokeWidth={2} />
          </motion.button>
        )}
      </div>

      {(comment.replies || []).map((reply) => (
        <CommentRow key={reply._id} postId={postId} comment={reply} onReply={onReply} nested />
      ))}

      {hidden > 0 && (
        <button
          type="button"
          onClick={() => loadReplies(postId, comment._id)}
          className="ml-12 flex items-center gap-1.5 py-1.5 text-[12.5px] font-medium text-ink-faint transition-colors hover:text-ink-muted"
        >
          <CornerDownRight size={13} />
          View {hidden} more {hidden === 1 ? 'reply' : 'replies'}
        </button>
      )}
    </motion.div>
  );
}

function Composer({ postId, replyTo, onCancelReply, onSend, inputRef }) {
  const user = useAuth((s) => s.user);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  async function send() {
    const body = text.trim();
    if (!body || sending) return;

    setSending(true);
    try {
      await onSend(postId, body, { parent: replyTo?.id || null });
      setText('');
      onCancelReply?.();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-2">
      {replyTo && (
        <div className="flex items-center justify-between rounded-lg bg-surface-2 px-3 py-1.5">
          <span className="truncate text-[12.5px] text-ink-muted">
            Replying to <span className="font-medium text-ink">{replyTo.name}</span>
          </span>
          <button
            type="button"
            onClick={onCancelReply}
            className="ml-2 shrink-0 text-[12.5px] font-medium text-brand-strong"
          >
            Cancel
          </button>
        </div>
      )}

      <div className="flex items-end gap-2.5">
        <Avatar src={user?.avatar} name={user?.name} color={user?.avatarColor} size="xs" />

        <textarea
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            /* Enter sends, Shift+Enter breaks the line — the same bargain the
               chat composer makes, so the muscle memory carries over. */
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          rows={1}
          maxLength={1000}
          placeholder={replyTo ? 'Write a reply…' : 'Add a comment…'}
          className="selectable max-h-24 min-h-[38px] flex-1 resize-none rounded-2xl bg-surface-2 px-3.5 py-2.5 text-[14.5px] outline-none placeholder:text-ink-faint focus:ring-2 focus:ring-brand-tint"
        />

        <motion.button
          type="button"
          whileTap={{ scale: 0.9 }}
          onClick={send}
          disabled={!text.trim() || sending}
          aria-label="Send comment"
          className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-full bg-brand text-brand-ink transition-opacity disabled:opacity-35"
        >
          {sending ? (
            <Loader2 size={17} className="animate-spin" />
          ) : (
            <Send size={16} strokeWidth={2.1} />
          )}
        </motion.button>
      </div>
    </div>
  );
}
