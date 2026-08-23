'use client';

import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { BarChart3, Check, Lock } from 'lucide-react';
import { useAuth } from '@/store/auth';
import { useChat } from '@/store/chat';
import { useUI, toast } from '@/store/ui';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { feedback } from '@/lib/sound';

/**
 * A poll bubble. The question and option labels come from the decrypted
 * payload; only the tallies come from the server, which counts votes by option
 * index and never learns what the options say.
 */
export function PollBubble({ message, payload, isMine }) {
  const user = useAuth((s) => s.user);
  const applyMessagePatch = useChat((s) => s.applyMessagePatch);
  const openSheet = useUI((s) => s.openSheet);

  const poll = message.poll || {};
  const votes = poll.votes || [];
  const options = payload?.poll?.options || [];
  const closed = poll.closed;

  const { counts, mine, total } = useMemo(() => {
    const c = new Array(options.length).fill(0);
    const m = new Set();
    votes.forEach((v) => {
      if (v.option >= 0 && v.option < c.length) c[v.option] += 1;
      if (String(v.user?._id || v.user) === String(user?._id)) m.add(v.option);
    });
    return { counts: c, mine: m, total: votes.length };
  }, [votes, options.length, user?._id]);

  const leading = Math.max(...counts, 0);

  async function vote(index) {
    if (closed) return;
    feedback('select');

    // Optimistic: the bars should move under the finger.
    const without = votes.filter((v) => {
      const isMineVote = String(v.user?._id || v.user) === String(user?._id);
      if (!isMineVote) return true;
      if (poll.multiple) return v.option !== index;
      return false;
    });
    const wasSet = mine.has(index);
    const next = wasSet ? without : [...without, { user: user._id, option: index }];

    applyMessagePatch(String(message.conversation), message._id, {
      poll: { ...poll, votes: next },
    });

    try {
      const { data } = await api.post('/messages/' + message._id + '/vote', { option: index });
      applyMessagePatch(String(message.conversation), message._id, { poll: data.poll });
    } catch (err) {
      applyMessagePatch(String(message.conversation), message._id, { poll });
      toast.error(err.message || 'Could not record your vote');
    }
  }

  return (
    <div className="min-w-[240px] max-w-[320px] px-1 py-0.5">
      <div className="mb-2 flex items-center gap-1.5 text-[11.5px] uppercase tracking-wide opacity-60">
        <BarChart3 size={12} />
        {poll.multiple ? 'Select one or more' : 'Select one'}
        {closed && (
          <>
            <span>·</span>
            <Lock size={10} />
            Closed
          </>
        )}
      </div>

      <p className="mb-2.5 text-[14.5px] font-medium leading-snug">
        {payload?.poll?.question || 'Poll'}
      </p>

      <div className="space-y-1.5">
        {options.map((option, i) => {
          const count = counts[i] || 0;
          const pct = total ? Math.round((count / total) * 100) : 0;
          const chosen = mine.has(i);

          return (
            <button
              key={i}
              type="button"
              onClick={() => vote(i)}
              disabled={closed}
              className={cn(
                'relative block w-full overflow-hidden rounded-lg px-2.5 py-2 text-left transition-colors',
                'bg-black/[.07] dark:bg-white/[.07]',
                !closed && 'hover:bg-black/[.11] dark:hover:bg-white/[.11]'
              )}
            >
              {/* result bar */}
              <motion.span
                initial={false}
                animate={{ width: pct + '%' }}
                transition={{ type: 'spring', damping: 26, stiffness: 220 }}
                className={cn(
                  'absolute inset-y-0 left-0 rounded-lg',
                  count === leading && count > 0
                    ? 'bg-brand/30'
                    : 'bg-black/[.07] dark:bg-white/[.08]'
                )}
              />

              <span className="relative flex items-center gap-2">
                <span
                  className={cn(
                    'grid h-[18px] w-[18px] shrink-0 place-items-center border-2 transition-colors',
                    poll.multiple ? 'rounded-[5px]' : 'rounded-full',
                    chosen ? 'border-brand bg-brand text-white' : 'border-current opacity-40'
                  )}
                >
                  {chosen && <Check size={11} strokeWidth={3.5} />}
                </span>

                <span className="min-w-0 flex-1 truncate text-[13.5px]">{option}</span>
                <span className="shrink-0 text-[12px] tabular-nums opacity-70">{count}</span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-2 flex items-center justify-between text-[11.5px] opacity-60">
        <button
          type="button"
          onClick={() => openSheet('pollVoters', { message, payload })}
          className="underline-offset-2 hover:underline"
          disabled={!total}
        >
          {total} {total === 1 ? 'vote' : 'votes'}
        </button>

        {isMine && !closed && total > 0 && (
          <button
            type="button"
            onClick={async () => {
              await api.post('/messages/' + message._id + '/close-poll').catch(() => {});
              applyMessagePatch(String(message.conversation), message._id, {
                poll: { ...poll, closed: true },
              });
            }}
            className="underline-offset-2 hover:underline"
          >
            Close poll
          </button>
        )}
      </div>
    </div>
  );
}
