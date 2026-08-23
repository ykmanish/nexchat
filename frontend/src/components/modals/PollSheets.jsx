'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, X, BarChart3 } from 'lucide-react';
import { Sheet } from '@/components/ui/Sheet';
import { Button } from '@/components/ui/Button';
import { Input, Switch } from '@/components/ui/Field';
import { Avatar } from '@/components/ui/Avatar';
import { useChat } from '@/store/chat';
import { toast } from '@/store/ui';
import { feedback } from '@/lib/sound';

const MAX_OPTIONS = 12;

/** Compose a poll. The question and options are encrypted like any message. */
export function NewPollSheet({ open, onClose, conversation }) {
  const sendMessage = useChat((s) => s.sendMessage);

  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [multiple, setMultiple] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (open) {
      setQuestion('');
      setOptions(['', '']);
      setMultiple(false);
    }
  }, [open]);

  const filled = options.map((o) => o.trim()).filter(Boolean);
  const canSend = question.trim().length > 0 && filled.length >= 2;

  function setOption(i, value) {
    setOptions((list) => list.map((o, idx) => (idx === i ? value : o)));
  }

  async function create() {
    if (!canSend) return;
    setSending(true);

    try {
      await sendMessage({
        conversationId: conversation._id,
        type: 'poll',
        text: question.trim(),
        meta: { poll: { question: question.trim(), options: filled } },
        poll: { optionCount: filled.length, multiple },
      });
      feedback('success');
      onClose();
    } catch (err) {
      toast.error(err.message || 'Could not create that poll');
    } finally {
      setSending(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="New poll"
      subtitle="Everyone in this chat can vote."
      size="md"
      footer={
        <Button size="block" icon={BarChart3} loading={sending} disabled={!canSend} onClick={create}>
          Send poll
        </Button>
      }
    >
      <div className="space-y-4 px-5 pb-4">
        <Input
          label="Question"
          placeholder="What should we do?"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          maxLength={200}
          autoFocus
        />

        <div>
          <p className="mb-1.5 text-[13px] font-medium text-ink-muted">Options</p>
          <div className="space-y-2">
            <AnimatePresence initial={false}>
              {options.map((option, i) => (
                <motion.div
                  key={i}
                  layout
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, height: 0 }}
                  className="flex items-center gap-2"
                >
                  <Input
                    containerClassName="flex-1"
                    placeholder={'Option ' + (i + 1)}
                    value={option}
                    onChange={(e) => setOption(i, e.target.value)}
                    maxLength={100}
                  />
                  {options.length > 2 && (
                    <button
                      type="button"
                      onClick={() => {
                        feedback('tap');
                        setOptions((list) => list.filter((_, idx) => idx !== i));
                      }}
                      className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-ink-faint transition-colors hover:bg-surface-2 hover:text-danger"
                      aria-label={'Remove option ' + (i + 1)}
                    >
                      <X size={17} />
                    </button>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
          </div>

          {options.length < MAX_OPTIONS && (
            <button
              type="button"
              onClick={() => {
                feedback('tap');
                setOptions((list) => [...list, '']);
              }}
              className="mt-2 inline-flex items-center gap-1.5 text-[13.5px] font-medium text-brand-strong"
            >
              <Plus size={15} />
              Add option
            </button>
          )}
        </div>

        <div className="rounded-xl bg-surface-2 px-4 py-3">
          <Switch
            label="Allow multiple answers"
            sublabel="People can pick more than one option"
            checked={multiple}
            onChange={setMultiple}
          />
        </div>
      </div>
    </Sheet>
  );
}

/** Who voted for what. */
export function PollVotersSheet({ open, onClose, message, payload }) {
  const poll = message?.poll || {};
  const options = payload?.poll?.options || [];
  const votes = poll.votes || [];

  if (!message) return null;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Poll results"
      subtitle={payload?.poll?.question}
      size="md"
    >
      <div className="pb-6">
        {options.map((option, i) => {
          const voters = votes.filter((v) => v.option === i);
          return (
            <div key={i}>
              <div className="flex items-baseline justify-between px-5 pb-1 pt-4">
                <h3 className="text-[13.5px] font-medium">{option}</h3>
                <span className="text-[12px] tabular-nums text-ink-faint">
                  {voters.length} {voters.length === 1 ? 'vote' : 'votes'}
                </span>
              </div>

              {voters.length === 0 ? (
                <p className="px-5 py-1.5 text-[13px] text-ink-faint">No votes yet</p>
              ) : (
                voters.map((v, k) => (
                  <div key={k} className="flex items-center gap-3 px-5 py-2">
                    <Avatar
                      src={v.user?.avatar}
                      name={v.user?.name}
                      color={v.user?.avatarColor}
                      size="sm"
                    />
                    <span className="min-w-0 flex-1 truncate text-[14.5px]">
                      {v.user?.name || 'Someone'}
                    </span>
                  </div>
                ))
              )}
            </div>
          );
        })}
      </div>
    </Sheet>
  );
}
