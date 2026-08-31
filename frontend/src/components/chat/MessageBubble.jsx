'use client';

import { useEffect, useRef, useState } from 'react';
import { motion, useMotionValue, useTransform } from 'framer-motion';
import {
  CornerUpLeft, Pencil, Star, Clock, AlertCircle, RotateCw, Forward, Check, MessagesSquare,
} from 'lucide-react';
import { useChat } from '@/store/chat';
import { useAuth } from '@/store/auth';
import { useUI, toast } from '@/store/ui';
import { cn, bubbleTime, isEmojiOnly, linkify, highlightParts, scrollToMessage } from '@/lib/utils';
import { feedback } from '@/lib/sound';
import { Avatar } from '@/components/ui/Avatar';
import { ReceiptTick } from './ChatRow';
import { Attachment } from './Attachment';
import { VoiceNote } from './VoiceNote';
import { ReactionPills } from './ReactionPills';
import { ViewOnceBubble } from './ViewOnceBubble';
import { CodeBlock } from './CodeBlock';
import { PollBubble } from './PollBubble';
import { LinkPreview } from './LinkPreview';
import { isInternalLink } from '@/lib/linkpreview';
import { parseMessageBody, splitInlineCode, firstUrl } from '@/lib/codeblocks';
import { seedPreview } from '@/lib/linkpreview';
import * as mentions from '@/lib/mentions';
import * as scamguard from '@/lib/scamguard';
import { ScamWarning } from './ScamWarning';

/* 380ms fired while a scroll or a tap was still plausibly in progress, so the
   menu kept appearing unintentionally. 550ms is roughly what the platform
   long-press gestures use and reads as deliberate. */
const LONG_PRESS_MS = 550;
const MOVE_TOLERANCE = 10;

export function MessageBubble({
  message,
  conversation,
  currentUserId,
  selecting,
  onOpenThread,
}) {
  const plain = useChat((s) => s.plain[message._id] || s.plain[message.clientId]);
  const retryMessage = useChat((s) => s.retryMessage);
  const openContextMenu = useUI((s) => s.openContextMenu);
  // Any link in the body gets a card. A preview the sender attached renders
  // straight from the encrypted payload; without one the card resolves it
  // here, which `fetchPreviews` lets the user switch off.
  const fetchPreviews = useAuth((s) => s.user?.privacy?.linkPreviews !== false);
  const setReplyTo = useUI((s) => s.setReplyTo);
  const toggleSelection = useUI((s) => s.toggleSelection);
  const selection = useUI((s) => s.selection);
  const search = useUI((s) => s.search);

  const activeHitId = search.open ? search.hits[search.index] : null;
  const query = search.open ? search.query.trim() : '';

  const isMine = String(message.sender?._id || message.sender) === String(currentUserId);
  const isGroup = conversation.type !== 'direct';
  const selected = selection.includes(message._id);

  const x = useMotionValue(0);
  const replyOpacity = useTransform(x, isMine ? [-64, -24, 0] : [0, 24, 64], isMine ? [1, 0.35, 0] : [0, 0.35, 1]);
  const replyScale = useTransform(x, isMine ? [-64, -24] : [24, 64], isMine ? [1, 0.7] : [0.7, 1]);

  const openThread = (id) => onOpenThread?.(id);

  const pressTimer = useRef(null);
  const pressOrigin = useRef({ x: 0, y: 0 });
  const openedRef = useRef(false);
  const movedRef = useRef(false);
  const [pressed, setPressed] = useState(false);

  const text = plain?.text || '';

  /* Only messages *received* are assessed. Warning someone about their own
     outgoing text would be nonsense, and the guard's whole framing is about
     what somebody else is trying to get you to do. Runs on the already-decrypted
     text, on this device, and nothing leaves it. */
  const scam =
    !isMine && text && conversation.type === 'direct'
      ? scamguard.assess(text, {
          firstContact: !!conversation.neverReplied,
          isContact: !!conversation.peerIsContact,
        })
      : null;

  const linkUrl = firstUrl(text);
  // A sender-attached preview also warms the shared cache, so the same
  // link in a later bubble renders instantly and never refetches.
  if (plain?.linkPreview) seedPreview(plain.linkPreview);
  const attachments = plain?.attachments || [];
  const bigEmoji = isEmojiOnly(text) && !attachments.length;
  const deleted = message.deletedForEveryone;
  const undecrypted = !plain && !deleted;
  const mediaOnly = attachments.length > 0 && !text;
  const viewOnce = !!message.viewOnce;

  const status = isMine ? receiptStatus(message) : null;

  /* ── long-press opens the action menu; a small drag cancels it ── */

  /* One open per gesture.
     A long press on Android also makes the browser fire `contextmenu`, at
     roughly 500ms — just before our own timer. Both paths called
     openContextMenu, so the menu opened twice a few tens of milliseconds
     apart, at slightly different coordinates, and visibly jumped as it
     re-placed itself. This latch lets whichever fires first win and ignores
     the other until the finger goes down again. */
  const openMenuOnce = (x, y) => {
    if (openedRef.current || selecting) return;
    openedRef.current = true;
    clearTimeout(pressTimer.current);
    pressTimer.current = null;
    feedback('select');
    openContextMenu({ message, isMine, x, y });
    setPressed(false);
  };

  const startPress = (e) => {
    if (selecting) return;
    const point = e.touches?.[0] || e;
    pressOrigin.current = { x: point.clientX, y: point.clientY };
    openedRef.current = false;
    movedRef.current = false;
    setPressed(true);

    pressTimer.current = setTimeout(
      () => openMenuOnce(point.clientX, point.clientY),
      LONG_PRESS_MS
    );
  };

  const movePress = (e) => {
    if (!pressTimer.current) return;
    const point = e.touches?.[0] || e;
    const dx = Math.abs(point.clientX - pressOrigin.current.x);
    const dy = Math.abs(point.clientY - pressOrigin.current.y);
    if (dx > MOVE_TOLERANCE || dy > MOVE_TOLERANCE) {
      movedRef.current = true;
      endPress();
    }
  };

  /* A cancelled pointer is not necessarily a cancelled press.
     Chrome fires `pointercancel` whenever it claims the gesture for itself,
     which includes the overscroll it starts when you hold a message at the very
     bottom of a list that cannot scroll any further. Treating that as a release
     is what made a long press down there do nothing but blip the bubble: the
     press animation ran and the menu never opened, while the same press higher
     up the list worked. A real scroll moves the finger, and `movePress` has
     already cancelled by then — so with no movement the timer is left to run
     and the press still counts. */
  const cancelPress = () => {
    if (movedRef.current) endPress();
    else setPressed(false);
  };

  const endPress = () => {
    clearTimeout(pressTimer.current);
    pressTimer.current = null;
    setPressed(false);
  };

  /* Now that `pointercancel` no longer cancels the press, this is what stops a
     pending timer from opening a menu for a message that has been deleted or
     scrolled out of the list mid-press — the pointercancel that firing used to
     depend on is exactly the one being ignored above. */
  useEffect(() => () => clearTimeout(pressTimer.current), []);

  return (
    <motion.div
      layout="position"
      id={'msg-' + message._id}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', damping: 30, stiffness: 460 }}
      className={cn(
        'group relative flex px-2 sm:px-4',
        isMine ? 'justify-end' : 'justify-start',
        message.lastOfGroup ? 'mb-2' : 'mb-[3px]',
        selected && 'bg-brand/10'
      )}
      onClick={() => selecting && toggleSelection(message._id)}
    >
      {selecting && (
        <span
          className={cn(
            'mr-2 mt-3 grid h-5 w-5 shrink-0 place-items-center self-start rounded-full border-2 transition-colors',
            selected ? 'border-brand bg-brand text-brand-ink' : 'border-line-strong'
          )}
        >
          {selected && <Check size={12} strokeWidth={3.5} />}
        </span>
      )}

      {/* avatar gutter keeps grouped messages aligned in group chats */}
      {!isMine && isGroup && (
        <div className="mr-1.5 w-7 shrink-0 self-end">
          {message.lastOfGroup && (
            <Avatar
              src={message.sender?.avatar}
              name={message.sender?.name}
              color={message.sender?.avatarColor}
              size="xs"
            />
          )}
        </div>
      )}

      <div className={cn('relative flex min-w-0 max-w-[80%] flex-col sm:max-w-[65%]', isMine && 'items-end')}>
        {/* swipe-to-reply affordance */}
        <motion.span
          style={{ opacity: replyOpacity, scale: replyScale }}
          className={cn(
            'pointer-events-none absolute top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full bg-surface-3 text-ink-muted',
            isMine ? '-right-9' : '-left-9'
          )}
        >
          <CornerUpLeft size={14} />
        </motion.span>

        <motion.div
          drag={selecting ? false : 'x'}
          dragConstraints={{ left: 0, right: 0 }}
          dragElastic={0.16}
          dragDirectionLock
          style={{ x }}
          onDragStart={endPress}
          onDragEnd={(_e, info) => {
            const far = isMine ? info.offset.x < -56 : info.offset.x > 56;
            if (far) {
              feedback('swipe');
              setReplyTo(message);
            }
          }}
          onPointerDown={startPress}
          onPointerMove={movePress}
          onPointerUp={endPress}
          onPointerCancel={cancelPress}
          // Leaving the element only aborts a press for a mouse. Under touch the
          // pointer is implicitly captured, so a `pointerleave` here means the
          // finger drifted over an edge, not that the press was abandoned.
          onPointerLeave={(e) => e.pointerType === 'mouse' && endPress()}
          onContextMenu={(e) => {
            // Suppress the native long-press menu and text selection that
            // would otherwise come with it.
            e.preventDefault();
            openMenuOnce(e.clientX, e.clientY);
          }}
          onDoubleClick={() => {
            if (!deleted) useChat.getState().toggleReaction(message, '❤️');
          }}
          animate={{ scale: pressed ? 0.98 : 1 }}
          transition={{ duration: 0.12 }}
          className={cn(
            'relative select-none',
            bigEmoji
              ? 'px-1 py-0.5'
              : cn(
                  'bubble',
                  isMine ? 'bubble-out' : 'bubble-in',
                  // Only the first bubble of a run gets the tail.
                  message.firstOfGroup && (isMine ? 'bubble-tail-out' : 'bubble-tail-in'),
                  mediaOnly && !viewOnce ? 'p-[3px]' : 'px-2 py-[6px]',
                  message.failed && 'opacity-60'
                )
          )}
        >
          {message.forwardedFrom && !deleted && (
            <div className="mb-0.5 flex items-center gap-1 px-1 text-[12px] italic opacity-55">
              <Forward size={11} />
              Forwarded
            </div>
          )}

          {message.replyTo && !deleted && <QuotedReply reply={message.replyTo} isMine={isMine} />}

          {/* sender name inside the bubble, WhatsApp-style */}
          {!isMine && isGroup && message.firstOfGroup && !deleted && (
            <span
              className="mb-0.5 block px-1 text-[13px] font-medium"
              style={{ color: message.sender?.avatarColor || 'var(--accent)' }}
            >
              {message.sender?.name}
            </span>
          )}

          {message.type === 'poll' && !deleted && (
            <PollBubble message={message} payload={plain} isMine={isMine} />
          )}

          {viewOnce && !deleted && <ViewOnceBubble message={message} isMine={isMine} />}

          {!viewOnce && attachments.length > 0 && (
            <div className={cn('space-y-[3px] overflow-hidden rounded-[6px]', text && 'mb-1')}>
              {attachments.map((a, i) =>
                a.kind === 'voice' ? (
                  <VoiceNote key={a.id || i} attachment={a} message={message} isMine={isMine} />
                ) : (
                  <Attachment
                    key={a.id || i}
                    attachment={a}
                    meta={message.attachments?.[i]}
                    isMine={isMine}
                    all={attachments}
                    index={i}
                  />
                )
              )}
            </div>
          )}

          {/* body — the trailing pad reserves room for the inline timestamp */}
          {deleted ? (
            <p className="flex items-center gap-1.5 px-1 text-[14.5px] italic opacity-60">
              <AlertCircle size={13} />
              This message was deleted
              {/* The timestamp is absolutely positioned, so every body has to
                  reserve room for it or the two overlap. */}
              <span className="w-[52px] shrink-0" aria-hidden />
            </p>
          ) : undecrypted ? (
            <p className="flex items-center gap-1.5 px-1 text-[14px] italic opacity-60">
              <Clock size={13} />
              Waiting for this message…
            </p>
          ) : text && message.type !== 'poll' ? (
            <div
              className={cn(
                'px-1',
                bigEmoji ? 'text-[42px] leading-[1.2]' : 'text-[14.6px] leading-[1.35]'
              )}
            >
              {linkUrl && !bigEmoji && !isInternalLink(linkUrl) && (
                <LinkPreview
                  url={linkUrl}
                  preview={plain?.linkPreview}
                  isMine={isMine}
                  enabled={fetchPreviews}
                />
              )}

              {scam && scam.level !== 'none' && <ScamWarning assessment={scam} />}

              {(() => {
                const parts = parseMessageBody(text);
                const lastText = parts.map((p) => p.type).lastIndexOf('text');

                return (
                  <>
                    {parts.map((part, pi) =>
                      part.type === 'code' ? (
                        <CodeBlock key={pi} code={part.value} language={part.language} />
                      ) : (
                        <p key={pi} className="whitespace-pre-wrap break-words">
                          {renderProse(
                            part.value,
                            query,
                            message._id === activeHitId,
                            { labels: plain?.mentionLabels, meId: currentUserId }
                          )}
                          {/* The spacer must live *inside* the final paragraph so
                              the timestamp tucks onto that line rather than
                              starting a new one. */}
                          {!bigEmoji && pi === lastText && (
                            <span className="inline-block w-[64px]" aria-hidden />
                          )}
                        </p>
                      )
                    )}

                    {/* A trailing code block is full width, so the timestamp
                        needs a row of its own beneath it. */}
                    {!bigEmoji && lastText !== parts.length - 1 && (
                      <span className="block h-[14px]" aria-hidden />
                    )}
                  </>
                );
              })()}
            </div>
          ) : null}

          {/* timestamp + ticks, floated bottom-right the way WhatsApp does */}
          <span
            className={cn(
              'flex items-center gap-1 text-[11px] leading-none',
              bigEmoji
                ? cn('mt-1', isMine ? 'justify-end' : 'justify-start')
                : mediaOnly && !viewOnce
                  ? 'absolute bottom-2 right-3 rounded-full bg-black/45 px-1.5 py-0.5 text-white'
                  : viewOnce
                    ? 'mt-0.5 justify-end pr-1'
                    : 'absolute bottom-[5px] right-2',
              (!mediaOnly || viewOnce) && !bigEmoji && (isMine ? 'text-[var(--bubble-out-meta)]' : 'text-[var(--bubble-in-meta)]')
            )}
          >
            {message.starred && <Star size={10} fill="currentColor" />}
            {message.editedAt && <Pencil size={9} />}
            <span className="tabular-nums">{bubbleTime(message.createdAt)}</span>
            {isMine &&
              (message.pending ? (
                <Clock size={12} className="animate-pulse" />
              ) : message.failed ? (
                <AlertCircle size={12} className="text-danger" />
              ) : (
                <ReceiptTick status={status} />
              ))}
          </span>
        </motion.div>

        <ReactionPills message={message} isMine={isMine} />

        <ThreadChip
          count={message.thread?.replyCount}
          lastReplyAt={message.thread?.lastReplyAt}
          onOpen={() => openThread(message._id)}
        />

        {message.failed && (
          <button
            type="button"
            onClick={() => retryMessage(String(message.conversation), message.clientId)}
            className="mt-1 inline-flex items-center gap-1 px-1 text-[11.5px] font-medium text-danger"
          >
            <RotateCw size={11} />
            Tap to retry
          </button>
        )}
      </div>
    </motion.div>
  );
}

/** Links, inline code, mentions and search hits, in that order of precedence. */
function renderProse(value, query, isActiveHit, mention = {}) {
  return splitInlineCode(value).map((chunk, ci) => {
    if (chunk.code) return <CodeBlock key={ci} code={chunk.value} inline />;

    return linkify(chunk.value).map((part, li) =>
      part.type === 'link' ? (
        <a
          key={ci + '-' + li}
          href={part.href}
          target="_blank"
          rel="noopener noreferrer nofollow"
          onClick={(e) => e.stopPropagation()}
          className="underline decoration-current/40 underline-offset-2 hover:decoration-current"
        >
          {part.value}
        </a>
      ) : query ? (
        highlightParts(part.value, query).map((hit, hi) =>
          hit.match ? (
            <mark key={ci + '-' + li + '-' + hi} className={cn('hit', isActiveHit && 'hit-active')}>
              {hit.value}
            </mark>
          ) : (
            <span key={ci + '-' + li + '-' + hi}>{hit.value}</span>
          )
        )
      ) : (
        <MentionText key={ci + '-' + li} value={part.value} {...mention} />
      )
    );
  });
}

/**
 * Highlights @-names inside a plain run of text.
 *
 * The one naming *you* is emphasised harder than the others — in a busy group
 * that difference is the only thing that makes scrolling back useful. Driven by
 * the labels stored in the payload rather than a live roster, so an old message
 * still reads correctly after someone renames themselves.
 */
function MentionText({ value, labels, meId }) {
  if (!labels?.length && !/@(everyone|all)\b/i.test(value)) return <span>{value}</span>;

  const parts = mentions.segments(value, labels || [], { meId });

  return (
    <>
      {parts.map((part, i) =>
        part.type === 'mention' ? (
          <span
            key={i}
            className={cn(
              'rounded px-[3px] font-semibold',
              part.isMe || part.everyone
                ? 'bg-brand/25 text-brand-strong'
                : 'text-brand-strong'
            )}
          >
            {part.value}
          </span>
        ) : (
          <span key={i}>{part.value}</span>
        )
      )}
    </>
  );
}

/**
 * "3 replies" under a message that started a thread.
 *
 * Only ever rendered on a root, because replies do not appear in the timeline
 * at all — this chip is the only door into the panel from here.
 */
export function ThreadChip({ count, lastReplyAt, onOpen }) {
  if (!count) return null;

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        feedback('open');
        onOpen?.();
      }}
      className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-brand-tint px-2.5 py-1 text-[12px] font-semibold text-brand-strong transition-colors hover:brightness-95"
    >
      <MessagesSquare size={13} />
      {count === 1 ? '1 reply' : count + ' replies'}
      {lastReplyAt && (
        <span className="font-normal opacity-70">· {bubbleTime(lastReplyAt)}</span>
      )}
    </button>
  );
}

function QuotedReply({ reply, isMine }) {
  const plain = useChat((s) => s.plain[reply._id]);
  const text = plain?.text || (reply.deletedForEveryone ? 'Deleted message' : 'Message');
  const accent = reply.sender?.avatarColor || 'var(--accent)';

  /** Tapping a quote jumps to the message it quotes. */
  const jump = (e) => {
    e.stopPropagation();
    feedback('tap');
    if (!scrollToMessage(reply._id)) {
      toast.info('That message is further back — scroll up to load it.');
    }
  };

  return (
    <button
      type="button"
      onClick={jump}
      className="mb-1 flex w-full gap-2 overflow-hidden rounded-[5px] bg-black/[.06] text-left transition-colors hover:bg-black/[.1] dark:bg-white/[.07] dark:hover:bg-white/[.12]"
      style={{ borderLeft: '3px solid ' + accent }}
    >
      <span className="min-w-0 py-1 pl-2 pr-2.5">
        <span className="block truncate text-[12.5px] font-medium" style={{ color: accent }}>
          {reply.sender?.name || 'Unknown'}
        </span>
        <span className="block truncate text-[12.5px] opacity-60">{text}</span>
      </span>
    </button>
  );
}

function receiptStatus(message) {
  const receipts = message.receipts || [];
  if (message.pending) return 'sending';
  if (!receipts.length) return 'sent';
  if (receipts.every((r) => r.readAt)) return 'read';
  if (receipts.some((r) => r.deliveredAt)) return 'delivered';
  return 'sent';
}
