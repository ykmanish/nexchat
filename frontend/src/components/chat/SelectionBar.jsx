'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { X, Forward, Trash2, Star, Copy } from 'lucide-react';
import { useUI, toast } from '@/store/ui';
import { useChat } from '@/store/chat';
import { api } from '@/lib/api';
import { feedback } from '@/lib/sound';
import { IconButton } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Sheet';

/* A selector must return a stable reference — building `[]` inside one makes
   useSyncExternalStore re-render forever. */
const EMPTY = [];


/** Replaces the composer while messages are multi-selected. */
export function SelectionBar({ conversation }) {
  const selection = useUI((s) => s.selection);
  const clearSelection = useUI((s) => s.clearSelection);
  const setForwarding = useUI((s) => s.setForwarding);
  const messages = useChat((s) => s.messages[conversation._id]) || EMPTY;
  const plain = useChat((s) => s.plain);

  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  const selected = messages.filter((m) => selection.includes(m._id));

  async function copyAll() {
    const text = selected
      .map((m) => (plain[m._id]?.text ? m.sender?.name + ': ' + plain[m._id].text : null))
      .filter(Boolean)
      .join('\n');
    await navigator.clipboard.writeText(text);
    toast.success(selected.length + ' message(s) copied');
    clearSelection();
  }

  return (
    <>
      <motion.div
        initial={{ y: 60, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 60, opacity: 0 }}
        transition={{ type: 'spring', damping: 30, stiffness: 350 }}
        className="safe-bottom relative z-20 shrink-0 border-t border-line glass"
      >
        <div className="flex items-center gap-2 px-3 py-3">
          <IconButton icon={X} label="Cancel" onClick={clearSelection} />
          <span className="flex-1 text-[14.5px] font-semibold">{selection.length} selected</span>
          <IconButton icon={Copy} label="Copy" onClick={copyAll} />
          <IconButton
            icon={Star}
            label="Star"
            onClick={async () => {
              await Promise.all(
                selected.map((m) => api.post('/messages/' + m._id + '/star').catch(() => {}))
              );
              toast.success('Starred');
              clearSelection();
            }}
          />
          <IconButton
            icon={Forward}
            label="Forward"
            onClick={() => {
              setForwarding(selected);
              clearSelection();
            }}
          />
          <IconButton
            icon={Trash2}
            label="Delete"
            variant="dangerGhost"
            onClick={() => setConfirm(true)}
          />
        </div>
      </motion.div>

      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title={'Delete ' + selection.length + ' message(s)?'}
        message="They will be removed from your device."
        confirmLabel="Delete"
        danger
        loading={busy}
        onConfirm={async () => {
          setBusy(true);
          try {
            await api.post('/messages/delete-many', { messageIds: selection, scope: 'me' });
            useChat.setState((s) => ({
              messages: {
                ...s.messages,
                [conversation._id]: (s.messages[conversation._id] || []).filter(
                  (m) => !selection.includes(m._id)
                ),
              },
            }));
            feedback('success');
            clearSelection();
          } catch (err) {
            toast.error(err.message);
          } finally {
            setBusy(false);
            setConfirm(false);
          }
        }}
      />
    </>
  );
}
