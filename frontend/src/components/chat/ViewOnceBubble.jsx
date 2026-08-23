'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { EyeOff, Loader2, Image as ImageIcon, Video } from 'lucide-react';
import { useChat } from '@/store/chat';
import { useUI, toast } from '@/store/ui';
import { useAuth } from '@/store/auth';
import { api } from '@/lib/api';
import { decryptFile } from '@/lib/e2ee';
import { cn } from '@/lib/utils';
import { feedback } from '@/lib/sound';

/**
 * View-once media. The thumbnail is never rendered — opening it fetches the
 * envelope one final time, after which the server destroys the ciphertext and
 * keys, so nobody (sender included) can reopen it.
 */
export function ViewOnceBubble({ message, isMine }) {
  const user = useAuth((s) => s.user);
  const openLightbox = useUI((s) => s.openLightbox);
  const applyMessagePatch = useChat((s) => s.applyMessagePatch);

  const [opening, setOpening] = useState(false);

  const burned = message.viewOnceOpened;
  const iSaw = (message.viewedBy || []).some(
    (v) => String(v.user?._id || v.user) === String(user?._id)
  );
  const spent = burned || iSaw;

  const kind = message.attachments?.[0]?.kind === 'video' ? 'video' : 'photo';
  const Icon = kind === 'video' ? Video : ImageIcon;

  async function open() {
    if (isMine || spent || opening) return;

    setOpening(true);
    feedback('open');

    try {
      const { data } = await api.post('/messages/' + message._id + '/view-once');

      // Decrypt from the copy we were just handed, not from the store.
      const { decryptEnvelope } = await import('@/lib/e2ee');
      const payload = await decryptEnvelope(data.message);
      const attachment = payload?.attachments?.[0];
      if (!attachment) throw new Error('Could not open that media');

      const blob = await decryptFile({
        url: attachment.url,
        key: attachment.key,
        iv: attachment.iv,
        mime: attachment.mime,
      });

      openLightbox(
        [
          {
            ...attachment,
            previewUrl: URL.createObjectURL(blob),
            viewOnce: true,
          },
        ],
        0
      );

      applyMessagePatch(String(message.conversation), message._id, {
        viewedBy: [...(message.viewedBy || []), { user: user._id, at: new Date().toISOString() }],
        viewOnceOpened: data.burned,
      });
    } catch (err) {
      toast.error(err.message || 'That media is no longer available');
      applyMessagePatch(String(message.conversation), message._id, { viewOnceOpened: true });
    } finally {
      setOpening(false);
    }
  }

  return (
    <motion.button
      type="button"
      whileTap={spent || isMine ? undefined : { scale: 0.97 }}
      onClick={open}
      disabled={isMine || spent}
      className={cn(
        'flex w-full min-w-[190px] items-center gap-3 rounded-lg px-2 py-2 text-left',
        spent || isMine ? 'cursor-default opacity-70' : 'hover:bg-black/[.06] dark:hover:bg-white/[.07]'
      )}
    >
      <span
        className={cn(
          'grid h-10 w-10 shrink-0 place-items-center rounded-full border',
          spent ? 'border-current opacity-60' : 'border-current'
        )}
      >
        {opening ? (
          <Loader2 size={17} className="animate-spin" />
        ) : spent ? (
          <EyeOff size={17} />
        ) : (
          <Icon size={17} />
        )}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block text-[14.5px] font-medium leading-tight">
          {spent ? 'Opened' : kind === 'video' ? 'Video' : 'Photo'}
        </span>
        <span className="mt-0.5 block text-[12px] italic opacity-65">
          {isMine
            ? spent
              ? 'They opened it'
              : 'View once · sent'
            : spent
              ? 'No longer available'
              : 'Tap to view once'}
        </span>
      </span>
    </motion.button>
  );
}
