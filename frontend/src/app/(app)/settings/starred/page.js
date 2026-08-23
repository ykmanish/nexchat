'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { Star, StarOff } from 'lucide-react';
import { SettingsShell } from '@/components/layout/SettingsShell';
import { Avatar } from '@/components/ui/Avatar';
import { useChat } from '@/store/chat';
import { toast } from '@/store/ui';
import { api } from '@/lib/api';
import { chatTime, truncate } from '@/lib/utils';
import { feedback } from '@/lib/sound';

export default function StarredPage() {
  const router = useRouter();
  const decryptMany = useChat((s) => s.decryptMany);
  const plain = useChat((s) => s.plain);

  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    api
      .get('/messages/starred')
      .then(async ({ data }) => {
        if (cancelled) return;
        setMessages(data.messages);
        await decryptMany(data.messages);
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false));

    return () => {
      cancelled = true;
    };
  }, [decryptMany]);

  async function unstar(message) {
    feedback('tap');
    await api.post('/messages/' + message._id + '/star').catch(() => {});
    setMessages((list) => list.filter((m) => m._id !== message._id));
    toast.success('Removed from starred');
  }

  return (
    <SettingsShell title="Starred messages" subtitle={messages.length + ' saved'}>
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-3xl bg-surface p-4">
              <div className="skeleton mb-2 h-3 w-1/3 rounded-full" />
              <div className="skeleton h-3 w-3/4 rounded-full" />
            </div>
          ))}
        </div>
      ) : messages.length === 0 ? (
        <div className="py-20 text-center">
          <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-3xl bg-surface text-ink-faint shadow-card">
            <Star size={26} strokeWidth={1.8} />
          </div>
          <h3 className="text-[16px] font-semibold">Nothing starred yet</h3>
          <p className="mx-auto mt-1.5 max-w-[280px] text-[13.5px] leading-relaxed text-ink-muted">
            Long-press any message and choose Star to keep it here.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {messages.map((message) => (
            <motion.div
              key={message._id}
              layout
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-3xl bg-surface p-4 shadow-card"
            >
              <div className="mb-2 flex items-center gap-2.5">
                <Avatar
                  src={message.sender?.avatar}
                  name={message.sender?.name}
                  color={message.sender?.avatarColor}
                  size="xs"
                />
                <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">
                  {message.sender?.name}
                  {message.conversation?.name && (
                    <span className="font-normal text-ink-faint">
                      {' · ' + message.conversation.name}
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-[11.5px] text-ink-faint">
                  {chatTime(message.createdAt)}
                </span>
                <button
                  type="button"
                  onClick={() => unstar(message)}
                  className="shrink-0 rounded-full p-1 text-brand transition-colors hover:text-ink-faint"
                  aria-label="Unstar"
                >
                  <Star size={15} fill="currentColor" />
                </button>
              </div>

              <button
                type="button"
                onClick={() => {
                  const id = message.conversation?._id || message.conversation;
                  if (id) router.push('/chats/' + id);
                }}
                className="block w-full text-left text-[14.5px] leading-relaxed text-ink-soft"
              >
                {truncate(plain[message._id]?.text || 'Encrypted message', 220)}
              </button>
            </motion.div>
          ))}
        </div>
      )}
    </SettingsShell>
  );
}
