'use client';

import { useRef, useState } from 'react';
import { motion, useMotionValue, useTransform } from 'framer-motion';
import { Archive, AtSign, BellOff, Check, CheckCheck, Clock, FileText, Image as ImageIcon, Mic, Phone, Pin, Users, Video } from 'lucide-react';
import { Avatar } from '@/components/ui/Avatar';
import { useChat } from '@/store/chat';
import { useUI } from '@/store/ui';
import { cn, chatTime, truncate } from '@/lib/utils';
import { feedback } from '@/lib/sound';

const KIND_ICONS = {
  image: ImageIcon,
  video: Video,
  voice: Mic,
  audio: Mic,
  file: FileText,
  gif: ImageIcon,
  sticker: ImageIcon,
};

const LONG_PRESS_MS = 420;

/** Builds the one-line preview under a chat name. */
function usePreview(conversation, currentUserId) {
  const plain = useChat((s) => s.plain);
  const typing = useChat((s) => s.typing[conversation._id]);

  const typingNames = Object.values(typing || {});
  if (typingNames.length) {
    return {
      typing: true,
      text:
        conversation.type === 'direct'
          ? 'typing…'
          : typingNames[0] + (typingNames.length > 1 ? ' and others are typing…' : ' is typing…'),
    };
  }

  const last = conversation.lastMessage;
  if (!last) return { text: 'Tap to start chatting', muted: true };

  if (last.type === 'system') return { text: systemText(last), muted: true };
  if (last.type === 'call') {
    return { text: last.call?.mode === 'video' ? 'Video call' : 'Voice call', icon: Phone };
  }
  if (last.deletedForEveryone) {
    return { text: 'This message was deleted', muted: true, italic: true };
  }

  const payload = plain[last._id];
  const isMine = String(last.sender?._id || last.sender) === String(currentUserId);
  const senderName =
    conversation.type !== 'direct' && !isMine ? last.sender?.name?.split(' ')[0] : null;

  if (!payload) {
    return {
      text: 'Encrypted message',
      muted: true,
      prefix: senderName,
      isMine,
      status: isMine ? receiptStatus(last) : null,
    };
  }

  const attachment = payload.attachments?.[0];
  return {
    text: payload.text || (attachment ? attachmentLabel(attachment) : ''),
    icon: attachment ? KIND_ICONS[attachment.kind] : null,
    prefix: senderName,
    isMine,
    status: isMine ? receiptStatus(last) : null,
  };
}

function attachmentLabel(a) {
  const labels = {
    image: 'Photo',
    video: 'Video',
    voice: 'Voice message',
    audio: 'Audio',
    file: a.name || 'Document',
    gif: 'GIF',
    sticker: 'Sticker',
  };
  return labels[a.kind] || 'Attachment';
}

function systemText(message) {
  const actor = message.system?.actor?.name || 'Someone';
  const targets = (message.system?.targets || []).map((t) => t.name).join(', ');
  const map = {
    'group.created': actor + ' created this group',
    'community.created': actor + ' created this community',
    'group.renamed': actor + ' changed the name',
    'members.added': actor + ' added ' + targets,
    'member.removed': actor + ' removed ' + targets,
    'member.left': actor + ' left',
    'member.joined': actor + ' joined',
    'member.promoted': targets + ' is now an admin',
    'member.demoted': targets + ' is no longer an admin',
  };
  return map[message.system?.action] || 'Group updated';
}

function receiptStatus(message) {
  const receipts = message.receipts || [];
  if (!receipts.length) return 'sent';
  if (receipts.every((r) => r.readAt)) return 'read';
  if (receipts.some((r) => r.deliveredAt)) return 'delivered';
  return 'sent';
}

export function ChatRow({ conversation, active, currentUserId, onOpen, showDivider = true }) {
  const preview = usePreview(conversation, currentUserId);
  const presence = useChat((s) => s.presence);
  const setConversationState = useChat((s) => s.setConversationState);
  const openSheet = useUI((s) => s.openSheet);

  const [swiping, setSwiping] = useState(false);
  const pressTimer = useRef(null);

  const x = useMotionValue(0);
  const archiveOpacity = useTransform(x, [-96, -40, 0], [1, 0.4, 0]);
  const pinOpacity = useTransform(x, [0, 40, 96], [0, 0.4, 1]);

  const online =
    conversation.type === 'direct' &&
    conversation.peer &&
    (presence[conversation.peer._id] ?? conversation.peer.presence === 'online');

  const unread = conversation.unreadCount || 0;
  const mentions = conversation.mentionCount || 0;

  const openMenu = (clientX, clientY) => {
    feedback('select');
    openSheet('chatOptions', { conversation });
  };

  return (
    <div className="relative overflow-hidden">
      {/* swipe affordances sitting behind the row */}
      <div className="absolute inset-0 flex items-center justify-between bg-surface-2 px-7">
        <motion.span style={{ opacity: pinOpacity }} className="text-brand-strong">
          <Pin size={20} />
        </motion.span>
        <motion.span style={{ opacity: archiveOpacity }} className="text-info">
          <Archive size={20} />
        </motion.span>
      </div>

      <motion.div
        layout
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0, height: 0 }}
        transition={{ type: 'spring', damping: 32, stiffness: 420 }}
        drag="x"
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.2}
        dragDirectionLock
        style={{ x }}
        onDragStart={() => {
          setSwiping(true);
          clearTimeout(pressTimer.current);
        }}
        onDragEnd={(_e, info) => {
          setSwiping(false);
          if (info.offset.x < -84) {
            feedback('swipe');
            setConversationState(conversation._id, { archived: !conversation.archived });
          } else if (info.offset.x > 84) {
            feedback('swipe');
            setConversationState(conversation._id, { pinned: !conversation.pinned });
          }
        }}
        onPointerDown={(e) => {
          const point = e.touches?.[0] || e;
          pressTimer.current = setTimeout(() => openMenu(point.clientX, point.clientY), LONG_PRESS_MS);
        }}
        onPointerUp={() => clearTimeout(pressTimer.current)}
        onPointerLeave={() => clearTimeout(pressTimer.current)}
        onClick={() => !swiping && onOpen()}
        onContextMenu={(e) => {
          e.preventDefault();
          openMenu(e.clientX, e.clientY);
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && onOpen()}
        className={cn(
          'relative flex cursor-pointer items-center gap-3 px-3 py-2 text-left transition-colors sm:px-4',
          active ? 'bg-surface-3' : 'bg-surface hover:bg-surface-2 active:bg-surface-3'
        )}
      >
        <div className="relative shrink-0">
          <Avatar
            src={conversation.avatar}
            name={conversation.name}
            color={conversation.avatarColor}
            size="lg"
            online={online}
          />
          {conversation.type === 'community' && (
            <span className="absolute -bottom-0.5 -right-0.5 grid h-[18px] w-[18px] place-items-center rounded-full bg-brand text-brand-ink ring-2 ring-surface">
              <Users size={10} strokeWidth={3} />
            </span>
          )}
        </div>

        <div className={cn('min-w-0 flex-1 py-1.5', showDivider && 'border-b border-line')}>
          <div className="flex items-baseline gap-2">
            <span
              className={cn(
                'min-w-0 flex-1 truncate text-[16px] leading-snug',
                unread > 0 ? 'font-semibold' : 'font-normal'
              )}
            >
              {conversation.name}
            </span>
            <span
              className={cn(
                'shrink-0 text-[12px] tabular-nums',
                unread > 0 ? 'font-medium text-brand-strong' : 'text-ink-faint'
              )}
            >
              {chatTime(conversation.lastMessageAt)}
            </span>
          </div>

          <div className="mt-0.5 flex items-center gap-1">
            {preview.isMine && preview.status && !preview.typing && (
              <ReceiptTick status={preview.status} className="shrink-0" />
            )}
            {preview.icon && !preview.typing && (
              <preview.icon size={14} className="shrink-0 text-ink-faint" />
            )}

            <span
              className={cn(
                'min-w-0 flex-1 truncate text-[14px] leading-snug',
                preview.typing ? 'text-brand-strong' : 'text-ink-muted',
                preview.italic && 'italic'
              )}
            >
              {preview.prefix && !preview.typing && (
                <span className="text-ink-faint">{preview.prefix}: </span>
              )}
              {truncate(preview.text, 44)}
            </span>

            <div className="flex shrink-0 items-center gap-1.5 pl-1">
              {conversation.settings?.disappearingSeconds > 0 && (
                <Clock size={13} className="text-ink-faint" />
              )}
              {conversation.muted && <BellOff size={14} className="text-ink-faint" />}
              {conversation.pinned && <Pin size={14} className="text-ink-faint" />}
              {/* Shown even when the chat is muted and the unread pill has gone
                  grey: being named is the one thing a mute is not meant to
                  hide, so it keeps full colour. */}
              {mentions > 0 && (
                <motion.span
                  initial={{ scale: 0.6, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  aria-label={mentions === 1 ? 'You were mentioned' : mentions + ' mentions'}
                  className="grid h-[20px] min-w-[20px] place-items-center rounded-full bg-brand px-1 text-[12px] font-bold text-brand-ink"
                >
                  <AtSign size={12} strokeWidth={3} />
                </motion.span>
              )}

              {unread > 0 && (
                <motion.span
                  initial={{ scale: 0.6, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className={cn(
                    'grid h-[20px] min-w-[20px] place-items-center rounded-full px-1.5 text-[11px] font-semibold',
                    conversation.muted && !mentions
                      ? 'bg-ink-faint text-white'
                      : 'bg-brand text-brand-ink'
                  )}
                >
                  {unread > 99 ? '99+' : unread}
                </motion.span>
              )}
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

export function ReceiptTick({ status, className }) {
  if (status === 'read') {
    return <CheckCheck size={15} className={cn('shrink-0 text-tick', className)} strokeWidth={2.2} />;
  }
  if (status === 'delivered') {
    return <CheckCheck size={15} className={cn('shrink-0 opacity-55', className)} strokeWidth={2.2} />;
  }
  if (status === 'sending') {
    return <Clock size={13} className={cn('shrink-0 opacity-55', className)} />;
  }
  return <Check size={15} className={cn('shrink-0 opacity-55', className)} strokeWidth={2.2} />;
}

export function ChatRowSkeleton() {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="skeleton h-[52px] w-[52px] rounded-full" />
      <div className="flex-1 space-y-2.5">
        <div className="skeleton h-3.5 w-1/3 rounded-full" />
        <div className="skeleton h-3 w-2/3 rounded-full" />
      </div>
    </div>
  );
}
