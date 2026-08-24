'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Check, Forward, Search, ShieldAlert } from 'lucide-react';
import { Sheet } from '@/components/ui/Sheet';
import { Input } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { Avatar } from '@/components/ui/Avatar';
import { useChat } from '@/store/chat';
import * as scamguard from '@/lib/scamguard';
import { toast } from '@/store/ui';
import { cn, truncate } from '@/lib/utils';
import { feedback } from '@/lib/sound';

export function ForwardSheet({ open, onClose, messages = [] }) {
  const conversations = useChat((s) => s.conversations);
  const forwardTo = useChat((s) => s.forwardTo);
  const plain = useChat((s) => s.plain);

  const [selected, setSelected] = useState([]);
  const [query, setQuery] = useState('');
  const [sending, setSending] = useState(false);

  /* The risk on a forward runs the opposite way to the risk on receipt.
     "Your OTP is 428193" is perfectly normal to *have*; passing it on to
     whoever asked for it is how the money leaves. So this warning belongs at
     the moment of sending, not on the message itself. */
  const secrets = messages
    .map((m) => scamguard.carriesSecret(plain[m._id]?.text || ''))
    .filter(Boolean);

  useEffect(() => {
    if (open) {
      setSelected([]);
      setQuery('');
    }
  }, [open]);

  const filtered = conversations.filter((c) =>
    c.name?.toLowerCase().includes(query.trim().toLowerCase())
  );

  function toggle(id) {
    feedback('select');
    setSelected((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));
  }

  async function send() {
    if (!selected.length) return;
    setSending(true);

    try {
      for (const message of messages) {
        await forwardTo(message, selected);
      }
      feedback('success');
      toast.success(
        'Forwarded to ' + selected.length + (selected.length === 1 ? ' chat' : ' chats')
      );
      onClose();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSending(false);
    }
  }

  const preview = messages.length === 1 ? plain[messages[0]?._id]?.text : null;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Forward to"
      subtitle={
        messages.length === 1
          ? preview
            ? truncate(preview, 54)
            : '1 message'
          : messages.length + ' messages'
      }
      size="md"
      footer={
        <Button
          size="block"
          icon={Forward}
          loading={sending}
          disabled={!selected.length}
          onClick={send}
        >
      {secrets.length > 0 && (
        <div className="mx-5 mb-3 flex items-start gap-2.5 rounded-xl border border-danger/40 bg-danger/10 px-3.5 py-3">
          <ShieldAlert size={16} className="mt-0.5 shrink-0 text-danger" />
          <div className="min-w-0">
            <p className="text-[12.5px] font-semibold text-danger">
              {secrets.length === 1
                ? 'This message contains a one-time code'
                : secrets.length + ' of these contain a one-time code'}
            </p>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-muted">
              {secrets[0].reason} Nobody legitimate — no bank, no company, no support desk —
              will ever ask you to pass one on.
            </p>
            <p className="mt-1 font-mono text-[12px] text-ink-faint">
              found: {secrets.map((s) => s.masked).join(', ')}
            </p>
          </div>
        </div>
      )}
          {selected.length ? 'Send to ' + selected.length : 'Select a chat'}
        </Button>
      }
    >
      <div className="px-5 pb-2">
        <Input
          icon={Search}
          placeholder="Search chats"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
      </div>

      <div className="pb-2">
        {filtered.map((conversation) => {
          const active = selected.includes(conversation._id);
          return (
            <motion.button
              key={conversation._id}
              type="button"
              whileTap={{ scale: 0.985 }}
              onClick={() => toggle(conversation._id)}
              className="flex w-full items-center gap-3 px-5 py-2.5 text-left transition-colors hover:bg-black/[.035] dark:hover:bg-white/[.05]"
            >
              <Avatar
                src={conversation.avatar}
                name={conversation.name}
                color={conversation.avatarColor}
                size="md"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-medium">{conversation.name}</p>
                <p className="truncate text-[12.5px] text-ink-muted">
                  {conversation.type === 'direct'
                    ? conversation.peer?.about || 'Available'
                    : conversation.memberCount + ' members'}
                </p>
              </div>
              <span
                className={cn(
                  'grid h-6 w-6 place-items-center rounded-full border-2 transition-colors',
                  active
                    ? 'border-brand bg-brand text-brand-ink'
                    : 'border-line-strong'
                )}
              >
                {active && <Check size={14} strokeWidth={3} />}
              </span>
            </motion.button>
          );
        })}

        {filtered.length === 0 && (
          <p className="px-5 py-10 text-center text-[13.5px] text-ink-muted">
            No chats match that search.
          </p>
        )}
      </div>
    </Sheet>
  );
}
