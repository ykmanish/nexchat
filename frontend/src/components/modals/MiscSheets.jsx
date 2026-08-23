'use client';

import dynamic from 'next/dynamic';
import { useTheme } from 'next-themes';
import { useMemo, useState } from 'react';
import { CheckCheck, Check, Clock, Eye } from 'lucide-react';
import { Sheet } from '@/components/ui/Sheet';
import { Avatar } from '@/components/ui/Avatar';
import { useChat } from '@/store/chat';
import { useAuth } from '@/store/auth';
import { bubbleTime, truncate, cn } from '@/lib/utils';
import { format } from 'date-fns';

const EmojiPicker = dynamic(() => import('emoji-picker-react'), { ssr: false });

/** Full emoji palette for reactions. */
export function EmojiPickerSheet({ open, onClose, message }) {
  const toggleReaction = useChat((s) => s.toggleReaction);
  const { resolvedTheme } = useTheme();

  return (
    <Sheet open={open} onClose={onClose} title="React" size="md">
      <div className="pb-4">
        {open && (
          <EmojiPicker
            onEmojiClick={(e) => {
              toggleReaction(message, e.emoji);
              onClose();
            }}
            theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
            width="100%"
            height={400}
            searchPlaceHolder="Search emoji"
            previewConfig={{ showPreview: false }}
            lazyLoadEmojis
          />
        )}
      </div>
    </Sheet>
  );
}

/* ─────────────────────────── who reacted, and when ─────────────────────────── */

export function ReactionDetailsSheet({ open, onClose, message: initial }) {
  const [filter, setFilter] = useState('all');
  const user = useAuth((s) => s.user);
  const toggleReaction = useChat((s) => s.toggleReaction);

  // Read the live message so a reaction added while the sheet is open shows up.
  const live = useChat((s) => {
    const list = s.messages[String(initial?.conversation)] || [];
    return list.find((m) => m._id === initial?._id);
  });
  const message = live || initial;

  const reactions = message?.reactions || [];

  const tabs = useMemo(() => {
    const counts = reactions.reduce((acc, r) => {
      acc[r.emoji] = (acc[r.emoji] || 0) + 1;
      return acc;
    }, {});
    return [
      { key: 'all', label: 'All', count: reactions.length },
      ...Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .map(([emoji, count]) => ({ key: emoji, label: emoji, count })),
    ];
  }, [reactions]);

  const shown = filter === 'all' ? reactions : reactions.filter((r) => r.emoji === filter);

  if (!message) return null;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Reactions"
      subtitle={reactions.length + (reactions.length === 1 ? ' reaction' : ' reactions')}
      size="sm"
    >
      {/* emoji tabs */}
      <div className="no-scrollbar flex gap-2 overflow-x-auto border-b border-line px-5 pb-3">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setFilter(tab.key)}
            className={cn(
              'flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[13.5px] transition-colors',
              filter === tab.key
                ? 'bg-brand-tint font-medium text-brand-strong'
                : 'bg-surface-2 text-ink-muted hover:bg-surface-3'
            )}
          >
            <span>{tab.label}</span>
            <span className="tabular-nums opacity-70">{tab.count}</span>
          </button>
        ))}
      </div>

      <div className="pb-6">
        {shown.map((r, i) => {
          const isMe = String(r.user?._id || r.user) === String(user?._id);
          return (
            <div key={i} className="flex items-center gap-3 px-5 py-2.5">
              <Avatar
                src={r.user?.avatar}
                name={r.user?.name}
                color={r.user?.avatarColor}
                size="md"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px]">{isMe ? 'You' : r.user?.name || 'Someone'}</p>
                <p className="mt-0.5 text-[12.5px] text-ink-muted">
                  {r.at ? format(new Date(r.at), "d MMM 'at' HH:mm") : 'Reacted'}
                  {isMe && ' · tap to remove'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => isMe && toggleReaction(message, r.emoji)}
                disabled={!isMe}
                className={cn('text-[22px] leading-none', isMe && 'transition-transform active:scale-90')}
                aria-label={isMe ? 'Remove your reaction' : undefined}
              >
                {r.emoji}
              </button>
            </div>
          );
        })}

        {!shown.length && (
          <p className="px-5 py-10 text-center text-[13.5px] text-ink-muted">No reactions yet.</p>
        )}
      </div>
    </Sheet>
  );
}

/* ─────────────────────── sent / delivered / read times ─────────────────────── */

const stamp = (d) => (d ? format(new Date(d), "d MMM 'at' HH:mm") : null);

export function MessageInfoSheet({ open, onClose, message, conversation }) {
  const plain = useChat((s) => s.plain);
  if (!message) return null;

  const isDirect = conversation?.type === 'direct';
  const receipts = message.receipts || [];

  const members = (conversation?.participants || []).filter(
    (p) => !p.leftAt && String(p.user._id || p.user) !== String(message.sender?._id || message.sender)
  );

  const byUser = new Map(receipts.map((r) => [String(r.user), r]));

  /* A 1:1 chat has exactly one recipient, so show plain rows rather than a list. */
  const single = isDirect ? receipts[0] : null;

  const groups = [
    {
      key: 'read',
      label: 'Read by',
      icon: CheckCheck,
      tone: 'text-tick',
      people: members.filter((p) => byUser.get(String(p.user._id || p.user))?.readAt),
      at: (r) => r.readAt,
    },
    {
      key: 'delivered',
      label: 'Delivered to',
      icon: CheckCheck,
      tone: 'text-ink-muted',
      people: members.filter((p) => {
        const r = byUser.get(String(p.user._id || p.user));
        return r?.deliveredAt && !r.readAt;
      }),
      at: (r) => r.deliveredAt,
    },
    {
      key: 'pending',
      label: 'Sent to',
      icon: Check,
      tone: 'text-ink-faint',
      people: members.filter((p) => {
        const r = byUser.get(String(p.user._id || p.user));
        return !r?.deliveredAt;
      }),
      at: () => null,
    },
  ].filter((g) => g.people.length);

  return (
    <Sheet open={open} onClose={onClose} title="Message info" size="md">
      {/* the message itself, for context */}
      <div className="px-5 pb-4">
        <div className="ml-auto max-w-[85%] rounded-lg bg-[var(--bubble-out)] px-3 py-2 text-[var(--bubble-out-ink)] shadow-bubble">
          <p className="text-[14.5px] leading-snug">
            {message.deletedForEveryone
              ? 'This message was deleted'
              : truncate(plain[message._id]?.text || 'Attachment', 180)}
          </p>
          <p className="mt-1 text-right text-[11px] text-[var(--bubble-out-meta)]">
            {bubbleTime(message.createdAt)}
          </p>
        </div>
      </div>

      {isDirect ? (
        <div className="mx-4 mb-6 overflow-hidden rounded-xl bg-surface-2">
          <InfoRow
            icon={CheckCheck}
            tone="text-tick"
            label="Read"
            value={stamp(single?.readAt) || 'Not yet'}
          />
          <div className="divider mx-4" />
          <InfoRow
            icon={CheckCheck}
            tone="text-ink-muted"
            label="Delivered"
            value={stamp(single?.deliveredAt) || 'Not yet'}
          />
          <div className="divider mx-4" />
          <InfoRow
            icon={Check}
            tone="text-ink-faint"
            label="Sent"
            value={stamp(message.createdAt)}
          />
          {single?.playedAt && (
            <>
              <div className="divider mx-4" />
              <InfoRow
                icon={Eye}
                tone="text-brand-strong"
                label="Played"
                value={stamp(single.playedAt)}
              />
            </>
          )}
        </div>
      ) : (
        <div className="pb-6">
          {groups.map((group) => (
            <div key={group.key}>
              <div className="flex items-center gap-2 px-5 pb-1 pt-4">
                <group.icon size={15} className={group.tone} strokeWidth={2.2} />
                <h3 className="text-[12px] font-semibold uppercase tracking-wide text-ink-faint">
                  {group.label} · {group.people.length}
                </h3>
              </div>
              {group.people.map((p) => {
                const r = byUser.get(String(p.user._id || p.user));
                return (
                  <div key={p.user._id} className="flex items-center gap-3 px-5 py-2">
                    <Avatar
                      src={p.user.avatar}
                      name={p.user.name}
                      color={p.user.avatarColor}
                      size="sm"
                    />
                    <span className="min-w-0 flex-1 truncate text-[14.5px]">{p.user.name}</span>
                    <span className="shrink-0 text-[12px] tabular-nums text-ink-faint">
                      {r && group.at(r) ? bubbleTime(group.at(r)) : '—'}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}

          <div className="mx-4 mt-4 rounded-xl bg-surface-2 px-4 py-3">
            <p className="text-[12.5px] text-ink-muted">
              Sent {stamp(message.createdAt)}
            </p>
          </div>

          {!groups.length && (
            <p className="px-5 py-8 text-center text-[13.5px] text-ink-muted">
              No delivery information yet.
            </p>
          )}
        </div>
      )}
    </Sheet>
  );
}

function InfoRow({ icon: Icon, tone, label, value }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <Icon size={18} className={cn('shrink-0', tone)} strokeWidth={2.2} />
      <span className="flex-1 text-[15px]">{label}</span>
      <span className="text-[13px] tabular-nums text-ink-muted">{value}</span>
    </div>
  );
}
