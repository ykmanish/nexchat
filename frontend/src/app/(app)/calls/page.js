'use client';

import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Phone, Video, PhoneMissed, PhoneOutgoing, PhoneIncoming, Plus, Link2,
} from 'lucide-react';
import { useChat } from '@/store/chat';
import { useAuth } from '@/store/auth';
import { useUI } from '@/store/ui';
import { Avatar } from '@/components/ui/Avatar';
import { IconButton } from '@/components/ui/Button';
import { EmptyState } from '@/components/chat/EmptyState';
import { api } from '@/lib/api';
import { chatTime, duration, cn } from '@/lib/utils';
import { emitAsync } from '@/lib/socket';
import { feedback } from '@/lib/sound';

export default function CallsPage() {
  const conversations = useChat((s) => s.conversations);
  const user = useAuth((s) => s.user);
  const setCall = useUI((s) => s.setCall);
  const openSheet = useUI((s) => s.openSheet);

  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);

  // Call records live in the transcript, so we read them back out of it.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const lists = await Promise.all(
          conversations.slice(0, 40).map((c) =>
            api
              .get('/messages/conversation/' + c._id, { params: { limit: 60 } })
              .then(({ data }) =>
                data.messages
                  .filter((m) => m.type === 'call')
                  .map((m) => ({ ...m, conversation: c }))
              )
              .catch(() => [])
          )
        );
        if (cancelled) return;
        const flat = lists
          .flat()
          .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
          .slice(0, 80);
        setEntries(flat);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [conversations]);

  async function startCall(conversation, mode) {
    feedback('select');
    const res = await emitAsync('call:start', {
      conversationId: conversation._id,
      mode,
    }).catch(() => null);
    if (!res?.success) return;

    setCall({
      callId: res.callId,
      mode,
      direction: 'outgoing',
      status: 'ringing',
      conversationId: conversation._id,
      from: conversation.peer || { name: conversation.name, avatar: conversation.avatar },
      conversationName: conversation.name,
    });
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-app">
      <header className="safe-top shrink-0 px-5 pb-3 pt-4">
        <div className="flex items-center justify-between">
          <h1 className="font-display text-[27px] tracking-tight">Calls</h1>
          <div className="flex items-center gap-1">
          <IconButton
            icon={Link2}
            label="Call links"
            onClick={() => {
              feedback('open');
              openSheet('callLinks');
            }}
          />
          <IconButton
            icon={Plus}
            label="New call"
            variant="subtle"
            onClick={() => openSheet('newChat')}
          />
          </div>
        </div>
      </header>

      <div className="scroll-soft min-h-0 flex-1 overflow-y-auto px-3 pb-6">
        {loading ? (
          <div className="space-y-1 px-1 pt-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-3">
                <div className="skeleton h-11 w-11 rounded-full" />
                <div className="flex-1 space-y-2">
                  <div className="skeleton h-3 w-1/3 rounded-full" />
                  <div className="skeleton h-2.5 w-1/2 rounded-full" />
                </div>
              </div>
            ))}
          </div>
        ) : entries.length === 0 ? (
          <EmptyState variant="calls" />
        ) : (
          entries.map((entry) => {
            const isMine = String(entry.sender?._id || entry.sender) === String(user?._id);
            const missed = entry.call?.status === 'missed' || entry.call?.status === 'declined';
            const Icon = missed ? PhoneMissed : isMine ? PhoneOutgoing : PhoneIncoming;

            return (
              <motion.div
                key={entry._id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center gap-3.5 rounded-2xl px-3 py-2.5 transition-colors hover:bg-black/[.035] dark:hover:bg-white/[.05]"
              >
                <Avatar
                  src={entry.conversation.avatar}
                  name={entry.conversation.name}
                  color={entry.conversation.avatarColor}
                  size="md"
                />
                <div className="min-w-0 flex-1">
                  <p className={cn('truncate text-[15px] font-medium', missed && 'text-danger')}>
                    {entry.conversation.name}
                  </p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-[12.5px] text-ink-muted">
                    <Icon size={13} className={missed ? 'text-danger' : ''} />
                    {chatTime(entry.createdAt)}
                    {entry.call?.duration > 0 && ' · ' + duration(entry.call.duration)}
                  </p>
                </div>
                <IconButton
                  icon={entry.call?.mode === 'video' ? Video : Phone}
                  label="Call back"
                  size="sm"
                  onClick={() => startCall(entry.conversation, entry.call?.mode || 'audio')}
                  className="text-brand-strong"
                />
              </motion.div>
            );
          })
        )}
      </div>
    </div>
  );
}
