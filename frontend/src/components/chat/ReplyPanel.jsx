'use client';

import { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, MessagesSquare, X } from 'lucide-react';
import { useChat } from '@/store/chat';
import { useAuth } from '@/store/auth';
import { toast } from '@/store/ui';
import { cn } from '@/lib/utils';
import { feedback } from '@/lib/sound';
import { IconButton } from '@/components/ui/Button';
import { MessageBubble } from './MessageBubble';
import { Composer } from './Composer';

/**
 * One thread of replies, over the conversation.
 *
 * Replies are kept out of the timeline entirely — that separation is the whole
 * value of threads, and every previous half-measure (indenting them, or marking
 * them inline) ends up as clutter in the one place people scroll most. So this
 * is a real surface: a panel with the root pinned at the top, the replies under
 * it, and its own composer.
 *
 * A drawer on desktop, a full sheet on a phone. Same component either way —
 * splitting it would mean maintaining two copies of the send path.
 */
export function ReplyPanel({ conversationId, rootId, onClose }) {
  const conversation = useChat((s) => s.conversations.find((c) => c._id === conversationId));
  const thread = useChat((s) => s.threads[rootId]);
  const loading = useChat((s) => s.threadLoading[rootId]);
  const openThread = useChat((s) => s.openThread);
  const user = useAuth((s) => s.user);

  const scrollRef = useRef(null);
  const replyCount = thread?.replies?.length || 0;

  useEffect(() => {
    if (!rootId || thread) return;
    openThread(rootId).catch((err) => {
      toast.error(err.message || 'Could not open that thread');
      onClose?.();
    });
  }, [rootId, thread, openThread, onClose]);

  /* Threads are read bottom-up like any other conversation, so a new reply
     should land in view rather than below the fold. */
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [replyCount]);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!conversation) return null;

  return (
    <motion.aside
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', damping: 34, stiffness: 320 }}
      className={cn(
        'absolute inset-0 z-40 flex flex-col bg-app',
        // Beyond a phone it is a drawer against the right edge, so the
        // conversation it belongs to stays visible behind it.
        'sm:left-auto sm:w-[420px] sm:border-l sm:border-line sm:shadow-pop'
      )}
    >
      <header className="flex shrink-0 items-center gap-3 border-b border-line px-3 py-2.5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-tint text-brand-strong">
          <MessagesSquare size={17} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold">Replies</p>
          <p className="truncate text-[12.5px] text-ink-muted">
            {loading && !thread
              ? 'Loading…'
              : replyCount === 0
                ? 'No replies yet'
                : replyCount === 1
                  ? '1 reply'
                  : replyCount + ' replies'}
            {conversation.type !== 'direct' && ' · ' + conversation.name}
          </p>
        </div>
        <IconButton
          icon={X}
          label="Close replies"
          onClick={() => {
            feedback('close');
            onClose?.();
          }}
        />
      </header>

      <div ref={scrollRef} className="scroll-soft flex-1 overflow-y-auto px-2 py-3">
        {loading && !thread ? (
          <div className="grid h-full place-items-center">
            <Loader2 className="h-5 w-5 animate-spin text-ink-faint" />
          </div>
        ) : (
          <>
            {/* The root, then a rule: it is context, not the first reply. */}
            {thread?.root && (
              <>
                <MessageBubble
                  message={thread.root}
                  conversation={conversation}
                  currentUserId={user?._id}
                />
                <div className="my-3 flex items-center gap-3 px-3">
                  <span className="h-px flex-1 bg-line" />
                  <span className="text-[11.5px] font-semibold uppercase tracking-wide text-ink-faint">
                    {replyCount === 0 ? 'Reply below' : 'Replies'}
                  </span>
                  <span className="h-px flex-1 bg-line" />
                </div>
              </>
            )}

            <AnimatePresence initial={false}>
              {(thread?.replies || []).map((reply) => (
                <motion.div
                  key={reply._id || reply.clientId}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                >
                  <MessageBubble
                    message={reply}
                    conversation={conversation}
                    currentUserId={user?._id}
                  />
                </motion.div>
              ))}
            </AnimatePresence>

            {replyCount === 0 && !loading && (
              <p className="px-6 py-8 text-center text-[13.5px] leading-relaxed text-ink-muted">
                Replies here stay out of the main chat. Only people in the thread are
                notified.
              </p>
            )}
          </>
        )}
      </div>

      {/* The same composer as the conversation, pointed at this root. Mentions,
          attachments and voice notes all work unchanged as a result. */}
      <Composer
        conversation={conversation}
        threadRoot={rootId}
        placeholder="Reply in thread"
      />
    </motion.aside>
  );
}
