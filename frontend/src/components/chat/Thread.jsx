'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowDown, Lock } from 'lucide-react';
import { useChat } from '@/store/chat';
import { useAuth } from '@/store/auth';
import { useUI } from '@/store/ui';
import { cn, groupByDay, withGrouping } from '@/lib/utils';
import { wallpaperClass } from '@/lib/theme';
import { emit } from '@/lib/socket';
import { ThreadHeader } from './ThreadHeader';
import { ThreadSearch } from './ThreadSearch';
import { Composer } from './Composer';
import { MessageBubble } from './MessageBubble';
import { ReplyPanel } from './ReplyPanel';
import { SystemMessage } from './SystemMessage';
import { TypingBubble } from './TypingBubble';
import { MessageActions } from './MessageActions';
import { SelectionBar } from './SelectionBar';
import { PinnedBar } from './PinnedBar';

export function Thread({ conversationId }) {
  const router = useRouter();

  const conversation = useChat((s) => s.conversations.find((c) => c._id === conversationId));
  const messages = useChat((s) => s.messages[conversationId]);
  const hasMore = useChat((s) => s.hasMore[conversationId]);
  const loading = useChat((s) => s.loadingMessages[conversationId]);
  const typing = useChat((s) => s.typing[conversationId]);
  const openConversation = useChat((s) => s.openConversation);
  const loadOlder = useChat((s) => s.loadOlder);
  const markRead = useChat((s) => s.markRead);

  const user = useAuth((s) => s.user);
  const selection = useUI((s) => s.selection);
  const repliesFor = useUI((s) => s.repliesFor);
  const openReplies = useUI((s) => s.openReplies);
  const closeReplies = useUI((s) => s.closeReplies);
  const searchOpen = useUI((s) => s.search.open);
  const closeSearch = useUI((s) => s.closeSearch);

  const scrollRef = useRef(null);
  const bottomRef = useRef(null);
  const restoreRef = useRef(null);
  const [atBottom, setAtBottom] = useState(true);
  /* The jump button used to sit at a fixed offset, which collided with the
     reply preview's close button the moment the composer grew. Measuring it
     keeps the button clear of a reply bar, staged attachments and a link
     preview alike. */
  const composerRef = useRef(null);
  const [composerH, setComposerH] = useState(72);
  const [newCount, setNewCount] = useState(0);

  const canvas = wallpaperClass(conversation?.wallpaper || user?.settings?.wallpaper || 'doodle');

  /* ── open / close ── */
  useEffect(() => {
    if (!conversationId) return undefined;
    openConversation(conversationId);
    return () => {
      emit('conversation:leave', conversationId);
      closeSearch();
    };
  }, [conversationId, openConversation, closeSearch]);

  /* ── stick to the bottom as messages arrive ── */
  const list = messages || [];
  const lastId = list.length ? list[list.length - 1]._id : null;

  useEffect(() => {
    if (!lastId) return;
    if (atBottom) {
      requestAnimationFrame(() =>
        bottomRef.current?.scrollIntoView({ behavior: list.length > 30 ? 'auto' : 'smooth' })
      );
      setNewCount(0);
      markRead(conversationId);
    } else {
      const last = list[list.length - 1];
      const isMine = String(last.sender?._id || last.sender) === String(user?._id);
      if (!isMine) setNewCount((n) => n + 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastId]);

  useEffect(() => {
    const el = composerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([entry]) => setComposerH(entry.contentRect.height));
    ro.observe(el);
    setComposerH(el.getBoundingClientRect().height);
    return () => ro.disconnect();
  }, []);

  /* ── keep the viewport steady when older pages load in ── */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || restoreRef.current == null) return;
    el.scrollTop = el.scrollHeight - restoreRef.current;
    restoreRef.current = null;
  }, [list.length]);

  const onScroll = useCallback(
    (e) => {
      const el = e.currentTarget;
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      const bottom = distanceFromBottom < 90;

      setAtBottom(bottom);
      if (bottom && newCount) {
        setNewCount(0);
        markRead(conversationId);
      }

      if (el.scrollTop < 220 && hasMore && !loading) {
        restoreRef.current = el.scrollHeight;
        loadOlder(conversationId);
      }
    },
    [hasMore, loading, loadOlder, conversationId, newCount, markRead]
  );

  const scrollToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    setNewCount(0);
  };

  const days = useMemo(() => groupByDay(withGrouping(list)), [list]);
  const typingNames = Object.values(typing || {});

  if (!conversation) {
    return (
      <div className={cn('chat-canvas flex h-full w-full flex-col', canvas)}>
        <div className="flex flex-1 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-line border-t-brand" />
        </div>
      </div>
    );
  }

  return (
    <div className={cn('chat-canvas relative flex h-full min-h-0 w-full flex-col overflow-hidden', canvas)}>
      <AnimatePresence mode="wait" initial={false}>
        {searchOpen ? (
          <ThreadSearch key="search" conversation={conversation} />
        ) : (
          <ThreadHeader
            key="header"
            conversation={conversation}
            onBack={() => router.push('/chats')}
          />
        )}
      </AnimatePresence>

      <PinnedBar conversation={conversation} />

      {/* ── message list ── */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="scroll-soft relative z-[1] min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain"
      >
        <div className="mx-auto flex min-h-full w-full max-w-[900px] flex-col justify-end pb-2 pt-3">
          {/* Encryption notice at the very top of a conversation. Green rather
              than the old amber: this is reassurance, not a warning, and amber
              reads as the latter. Both pairs come from the fixed `wa` scale so
              the contrast holds whatever the accent is set to — deep green on
              pale green in light, pale on deep in dark. */}
          {!hasMore && (
            <div className="mx-4 mb-4 mt-2 flex max-w-[430px] items-start gap-1.5 self-center rounded-lg bg-wa-100 px-3 py-2 sm:mx-auto dark:bg-wa-800/40">
              <Lock size={12} className="mt-[3px] shrink-0 text-wa-800 dark:text-wa-200" />
              <p className="text-[12.5px] leading-relaxed text-wa-800 dark:text-wa-100">
                Messages are end-to-end encrypted. No one outside this chat, not even Chax,
                can read them.
              </p>
            </div>
          )}

          {loading && hasMore && (
            <div className="flex justify-center py-3">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-line border-t-brand" />
            </div>
          )}

          {days.map((day) => (
            <div key={day.key}>
              <DayDivider label={day.label} />
              {day.messages.map((message) =>
                message.type === 'system' || message.type === 'call' ? (
                  <SystemMessage key={message._id} message={message} />
                ) : (
                  <MessageBubble
                    key={message._id || message.clientId}
                    message={message}
                    conversation={conversation}
                    currentUserId={user?._id}
                    selecting={selection.length > 0}
                    onOpenThread={openReplies}
                  />
                )
              )}
            </div>
          ))}

          <AnimatePresence>
            {typingNames.length > 0 && (
              <TypingBubble names={typingNames} isGroup={conversation.type !== 'direct'} />
            )}
          </AnimatePresence>

          <div ref={bottomRef} className="h-1" />
        </div>
      </div>

      {/* ── jump to latest ── */}
      <AnimatePresence>
        {!atBottom && (
          <motion.button
            type="button"
            initial={{ opacity: 0, scale: 0.7, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.7, y: 10 }}
            onClick={scrollToBottom}
            style={{ bottom: composerH + 14 }}
            className="absolute right-4 z-20 grid h-10 w-10 place-items-center rounded-full bg-surface text-ink-muted shadow-pop"
          >
            <ArrowDown size={19} strokeWidth={2.2} />
            {newCount > 0 && (
              <span className="absolute -top-1.5 grid h-[19px] min-w-[19px] place-items-center rounded-full bg-brand px-1.5 text-[10.5px] font-bold text-brand-ink">
                {newCount > 99 ? '99+' : newCount}
              </span>
            )}
          </motion.button>
        )}
      </AnimatePresence>

      <div ref={composerRef} className="shrink-0">
        {selection.length > 0 ? (
          <SelectionBar conversation={conversation} />
        ) : (
          <Composer conversation={conversation} onSent={scrollToBottom} />
        )}
      </div>

      <MessageActions conversation={conversation} />

      {/* Over the conversation rather than beside it: on a phone there is no
          "beside", and on desktop the drawer still wants the chat behind it. */}
      <AnimatePresence>
        {repliesFor && (
          <ReplyPanel
            key={repliesFor}
            conversationId={conversationId}
            rootId={repliesFor}
            onClose={closeReplies}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function DayDivider({ label }) {
  return (
    <div className="sticky top-1.5 z-10 my-2.5 flex justify-center">
      <span className="rounded-lg bg-surface px-3 py-1 text-[12px] font-medium uppercase tracking-wide text-ink-muted shadow-bubble">
        {label}
      </span>
    </div>
  );
}
