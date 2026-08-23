'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Image as ImageIcon, Type, X, Eye, Send, ChevronLeft, ChevronRight } from 'lucide-react';
import { Sheet } from '@/components/ui/Sheet';
import { Button, IconButton } from '@/components/ui/Button';
import { Avatar } from '@/components/ui/Avatar';
import { useChat } from '@/store/chat';
import { useAuth } from '@/store/auth';
import { toast } from '@/store/ui';
import { api } from '@/lib/api';
import * as e2ee from '@/lib/e2ee';
import { useDecryptedMedia } from '@/components/chat/Attachment';
import { cn, chatTime } from '@/lib/utils';
import { feedback } from '@/lib/sound';

const BACKGROUNDS = [
  'linear-gradient(140deg,#21C063,#FF9F0A)',
  'linear-gradient(140deg,#7986CB,#4FC3F7)',
  'linear-gradient(140deg,#F06292,#BA68C8)',
  'linear-gradient(140deg,#4DB6AC,#81C784)',
  'linear-gradient(140deg,#262622,#57574F)',
];

/* ────────────────────────── posting a story ────────────────────────── */

export function NewStorySheet({ open, onClose }) {
  const loadStories = useChat((s) => s.loadStories);
  const conversations = useChat((s) => s.conversations);

  const [mode, setMode] = useState('text');
  const [text, setText] = useState('');
  const [background, setBackground] = useState(BACKGROUNDS[0]);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [posting, setPosting] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    if (open) {
      setText('');
      setFile(null);
      setPreview(null);
      setMode('text');
    }
  }, [open]);

  async function post() {
    if (mode === 'text' && !text.trim()) return;
    if (mode === 'image' && !file) return;

    setPosting(true);
    try {
      // Everyone in your chats is a potential viewer, so fan the key out to them.
      const recipients = [];
      const seen = new Set();
      conversations.forEach((c) =>
        (c.participants || []).forEach((p) => {
          const id = String(p.user?._id || p.user);
          if (seen.has(id) || !p.user?.identityPublicKey) return;
          seen.add(id);
          recipients.push({ userId: id, identityPublicKey: p.user.identityPublicKey });
        })
      );

      let media;
      const payload = { text: text.trim() };

      if (file) {
        const encrypted = await e2ee.encryptFile(file);
        const form = new FormData();
        form.append('files', encrypted.blob, 'story.bin');
        const { data } = await api.post('/uploads/story-media', form, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        media = { url: data.files[0].url, size: file.size };
        payload.media = { key: encrypted.key, iv: encrypted.iv, mime: file.type };
      }

      const { body, keys } = await e2ee.encryptEnvelope({ payload, recipients });

      await api.post('/stories', {
        kind: file ? 'image' : 'text',
        body,
        keys,
        media,
        background: file ? null : background,
        audience: 'contacts',
      });

      feedback('success');
      toast.success('Story posted — it disappears in 24 hours');
      loadStories().catch(() => {});
      onClose();
    } catch (err) {
      toast.error(err.message || 'Could not post that story');
    } finally {
      setPosting(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Add to your story"
      subtitle="Visible to your contacts for 24 hours."
      size="md"
      footer={
        <Button
          size="block"
          icon={Send}
          loading={posting}
          onClick={post}
          disabled={mode === 'text' ? !text.trim() : !file}
        >
          Share story
        </Button>
      }
    >
      <div className="space-y-4 px-5 pb-4">
        <div className="flex gap-2">
          {[
            { key: 'text', label: 'Text', icon: Type },
            { key: 'image', label: 'Photo', icon: ImageIcon },
          ].map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => {
                feedback('select');
                setMode(option.key);
                if (option.key === 'image') fileRef.current?.click();
              }}
              className={cn(
                'flex flex-1 items-center justify-center gap-2 rounded-2xl border px-4 py-2.5 text-[14px] font-medium transition-colors',
                mode === option.key
                  ? 'border-brand bg-brand/[0.12]'
                  : 'border-line text-ink-muted'
              )}
            >
              <option.icon size={16} />
              {option.label}
            </button>
          ))}
        </div>

        <div
          className="relative grid aspect-[9/14] max-h-[380px] w-full place-items-center overflow-hidden rounded-3xl p-6"
          style={{ background: preview ? '#000' : background }}
        >
          {preview ? (
            <img src={preview} alt="Story preview" className="h-full w-full object-contain" />
          ) : (
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Type something…"
              maxLength={280}
              className="w-full resize-none bg-transparent text-center font-display text-[22px] font-semibold leading-snug text-white outline-none placeholder:text-white/50"
              rows={5}
            />
          )}
        </div>

        {!preview && (
          <div className="flex justify-center gap-2.5">
            {BACKGROUNDS.map((bg) => (
              <button
                key={bg}
                type="button"
                onClick={() => {
                  feedback('tap');
                  setBackground(bg);
                }}
                style={{ background: bg }}
                className={cn(
                  'h-8 w-8 rounded-full transition-transform',
                  background === bg
                    ? 'scale-110 ring-2 ring-brand ring-offset-2 ring-offset-surface'
                    : 'hover:scale-105'
                )}
                aria-label="Background"
              />
            ))}
          </div>
        )}

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const selected = e.target.files?.[0];
            if (!selected) return;
            setFile(selected);
            setPreview(URL.createObjectURL(selected));
            setMode('image');
          }}
        />
      </div>
    </Sheet>
  );
}

/* ────────────────────────── viewing a story ────────────────────────── */

export function StoryViewerSheet({ open, onClose, ring }) {
  const [index, setIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [paused, setPaused] = useState(false);
  const user = useAuth((s) => s.user);

  const items = ring?.items || [];
  const current = items[index];

  useEffect(() => {
    if (open) {
      setIndex(0);
      setProgress(0);
    }
  }, [open, ring]);

  useEffect(() => {
    if (!open || !current || paused) return undefined;

    setProgress(0);
    const duration = 5000;
    const started = Date.now();

    const timer = setInterval(() => {
      const elapsed = Date.now() - started;
      const ratio = Math.min(1, elapsed / duration);
      setProgress(ratio);

      if (ratio >= 1) {
        clearInterval(timer);
        if (index < items.length - 1) setIndex((i) => i + 1);
        else onClose();
      }
    }, 50);

    api.post('/stories/' + current._id + '/view').catch(() => {});

    return () => clearInterval(timer);
  }, [open, index, current, paused, items.length, onClose]);

  if (typeof document === 'undefined' || !ring) return null;

  return createPortal(
    <AnimatePresence>
      {open && current && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[170] flex flex-col bg-black"
        >
          {/* progress bars */}
          <div className="safe-top flex gap-1 px-3 pt-3">
            {items.map((_, i) => (
              <div key={i} className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/25">
                <div
                  className="h-full rounded-full bg-white transition-[width] duration-100"
                  style={{ width: i < index ? '100%' : i === index ? progress * 100 + '%' : '0%' }}
                />
              </div>
            ))}
          </div>

          <header className="flex items-center gap-3 px-4 py-3">
            <Avatar
              src={ring.user.avatar}
              name={ring.user.name}
              color={ring.user.avatarColor}
              size="sm"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14.5px] font-semibold text-white">{ring.user.name}</p>
              <p className="text-[11.5px] text-white/60">{chatTime(current.createdAt)}</p>
            </div>
            <IconButton icon={X} label="Close" onClick={onClose} className="text-white hover:bg-white/10" />
          </header>

          <StoryBody
            story={current}
            onPause={setPaused}
            onPrev={() => setIndex((i) => Math.max(0, i - 1))}
            onNext={() => (index < items.length - 1 ? setIndex((i) => i + 1) : onClose())}
          />

          {ring.isMine && (
            <div className="safe-bottom flex items-center justify-center gap-2 py-4 text-white/70">
              <Eye size={16} />
              <span className="text-[13px]">
                {current.viewerCount || 0} {current.viewerCount === 1 ? 'view' : 'views'}
              </span>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}

function StoryBody({ story, onPause, onPrev, onNext }) {
  const [payload, setPayload] = useState(null);

  useEffect(() => {
    let cancelled = false;
    e2ee
      .decryptEnvelope({ ...story, sender: story.user })
      .then((p) => !cancelled && setPayload(p))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [story]);

  const mediaAttachment = story.media?.url && payload?.media
    ? { url: story.media.url, key: payload.media.key, iv: payload.media.iv, mime: payload.media.mime }
    : null;

  return (
    <div
      className="relative flex min-h-0 flex-1 items-center justify-center px-8 text-center"
      style={{ background: story.background || undefined }}
      onPointerDown={() => onPause(true)}
      onPointerUp={() => onPause(false)}
      onPointerLeave={() => onPause(false)}
    >
      <button
        type="button"
        onClick={onPrev}
        className="absolute inset-y-0 left-0 w-1/3"
        aria-label="Previous"
      />
      <button
        type="button"
        onClick={onNext}
        className="absolute inset-y-0 right-0 w-1/3"
        aria-label="Next"
      />

      {mediaAttachment ? (
        <StoryImage attachment={mediaAttachment} />
      ) : (
        <p className="pointer-events-none max-w-[520px] font-display text-[26px] font-semibold leading-snug text-white sm:text-[32px]">
          {payload?.text || '…'}
        </p>
      )}
    </div>
  );
}

function StoryImage({ attachment }) {
  const { url, state } = useDecryptedMedia(attachment);
  if (state !== 'ready' || !url) {
    return <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-white/25 border-t-white" />;
  }
  return <img src={url} alt="Story" className="max-h-full max-w-full object-contain" />;
}
