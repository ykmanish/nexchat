'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus,
  Smile,
  Mic,
  SendHorizontal,
  X,
  Image as ImageIcon,
  FileText,
  Camera,
  Trash2,
  CornerUpLeft,
  Pencil,
  Eye,
  EyeOff,
} from 'lucide-react';
import { useTheme } from 'next-themes';
import { useChat } from '@/store/chat';
import { useAuth } from '@/store/auth';
import { useUI, toast } from '@/store/ui';
import { cn, duration, formatBytes, throttle, debounce } from '@/lib/utils';
import { firstUrl } from '@/lib/codeblocks';
import { cachedPreview, hostOf, resolvePreview as resolveShared } from '@/lib/linkpreview';
import { feedback, sounds } from '@/lib/sound';
import { emit } from '@/lib/socket';
import { api } from '@/lib/api';
import * as e2ee from '@/lib/e2ee';
import { IconButton } from '@/components/ui/Button';
import { ActionSheet } from '@/components/ui/Sheet';
import { FileBadge } from '@/components/ui/FileIcon';

const EmojiPicker = dynamic(() => import('emoji-picker-react'), { ssr: false });

const MAX_ATTACHMENTS = 10;

export function Composer({ conversation, onSent }) {
  const sendMessage = useChat((s) => s.sendMessage);
  const editMessage = useChat((s) => s.editMessage);
  const plain = useChat((s) => s.plain);
  const user = useAuth((s) => s.user);
  const { resolvedTheme } = useTheme();

  const replyTo = useUI((s) => s.replyTo);
  const editing = useUI((s) => s.editing);
  const clearComposerState = useUI((s) => s.clearComposerState);

  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [showEmoji, setShowEmoji] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [viewOnce, setViewOnce] = useState(false);
  const [preview, setPreview] = useState(null);
  const previewFor = useRef(null);

  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const imageInputRef = useRef(null);
  const cameraInputRef = useRef(null);

  const recorder = useRecorder(conversation._id);

  const enterToSend = user?.settings?.enterToSend !== false;
  const canSend = (text.trim().length > 0 || attachments.length > 0) && !sending && !uploading;

  // The toggle is only meaningful for a single photo or video.
  const viewOnceEligible =
    attachments.length === 1 && ['image', 'video'].includes(attachments[0].kind);

  /* ── editing pre-fills the box ── */
  useEffect(() => {
    if (editing) {
      setText(plain[editing._id]?.text || '');
      textareaRef.current?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  useEffect(() => {
    if (replyTo) textareaRef.current?.focus();
  }, [replyTo]);

  /* ── autosize ── */
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 132) + 'px';
  }, [text]);

  /* ── typing indicator ── */
  const pingTyping = useRef(
    throttle(() => emit('typing:start', { conversationId: conversation._id }), 2500)
  ).current;

  const stopTyping = useCallback(() => {
    emit('typing:stop', { conversationId: conversation._id });
  }, [conversation._id]);

  useEffect(() => () => stopTyping(), [stopTyping]);

  /* ── link preview ──
     Resolved here, on the sender's device, and sent inside the encrypted
     payload — the recipient never fetches anything to render the card. */
  const resolvePreview = useRef(
    debounce(async (url) => {
      if (previewFor.current === url) return;
      previewFor.current = url;

      const found = await resolveShared(url);
      // Ignore a stale response if the text moved on while we waited.
      if (previewFor.current === url) setPreview(found);
    }, 350)
  ).current;

  useEffect(() => {
    const url = firstUrl(text);
    if (!url) {
      previewFor.current = null;
      setPreview(null);
      return;
    }
    if (preview?.url === url) return;

    // Already resolved once this session — show it without a round-trip.
    const known = cachedPreview(url);
    if (known) {
      previewFor.current = url;
      setPreview(known);
      return;
    }
    resolvePreview(url);
  }, [text, preview?.url, resolvePreview]);

  /* ── attachments ── */
  async function addFiles(fileList, kind = 'file') {
    const files = Array.from(fileList || []).slice(0, MAX_ATTACHMENTS - attachments.length);
    if (!files.length) return;

    setUploading(true);
    try {
      for (const file of files) {
        const detected =
          kind !== 'file'
            ? kind
            : file.type.startsWith('image/')
              ? 'image'
              : file.type.startsWith('video/')
                ? 'video'
                : file.type.startsWith('audio/')
                  ? 'audio'
                  : 'file';

        const encrypted = await e2ee.encryptFile(file);
        const form = new FormData();
        form.append('files', encrypted.blob, 'blob.bin');

        const { data } = await api.post('/uploads/media', form, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });

        const uploaded = data.files[0];
        const dims = detected === 'image' ? await imageDimensions(file) : {};

        setAttachments((list) => [
          ...list,
          {
            id: uploaded.id,
            url: uploaded.url,
            kind: detected,
            size: file.size,
            key: encrypted.key,
            iv: encrypted.iv,
            name: file.name,
            mime: file.type,
            previewUrl: detected === 'image' ? URL.createObjectURL(file) : null,
            ...dims,
          },
        ]);
      }
      feedback('tap');
    } catch (err) {
      toast.error(err.message || 'Could not attach that file');
    } finally {
      setUploading(false);
    }
  }

  function removeAttachment(id) {
    feedback('tap');
    setAttachments((list) => list.filter((a) => a.id !== id));
  }

  /* ── send ── */
  async function send() {
    if (!canSend) return;

    const body = text.trim();
    const files = attachments;

    const once = viewOnce && viewOnceEligible;

    /* Only attach the card if its URL actually survived into the sent text.
       Falling back to the shared cache matters: paste-and-send beats the
       debounced fetch nearly every time, and by the time the user sends a
       second message the same link is usually already resolved. If neither
       has it, the message goes without one and the recipient's bubble
       resolves it — the card is never what holds up a send. */
    const sentUrl = firstUrl(body);
    const linkPreview =
      (preview && sentUrl === preview.url ? preview : null) ||
      (sentUrl ? cachedPreview(sentUrl) || null : null);

    setText('');
    setAttachments([]);
    setViewOnce(false);
    setPreview(null);
    previewFor.current = null;
    setShowEmoji(false);
    stopTyping();

    if (editing) {
      const target = editing;
      clearComposerState();
      try {
        await editMessage(target, body);
        feedback('tap');
      } catch (err) {
        toast.error(err.message);
      }
      return;
    }

    const reply = replyTo;
    clearComposerState();
    setSending(true);

    try {
      await sendMessage({
        conversationId: conversation._id,
        text: once ? '' : body,
        attachments: files,
        replyTo: reply?._id || null,
        type: files.length === 1 ? files[0].kind : 'text',
        viewOnce: once,
        meta: linkPreview ? { linkPreview } : {},
      });
      onSent?.();
    } catch (err) {
      toast.error(err.message || 'Message not sent');
    } finally {
      setSending(false);
    }
  }

  /* ── voice note ── */
  async function sendVoiceNote() {
    const result = await recorder.stop();
    if (!result) return;

    setUploading(true);
    try {
      const file = new File([result.blob], 'voice.webm', { type: result.blob.type });
      const encrypted = await e2ee.encryptFile(file);

      const form = new FormData();
      form.append('files', encrypted.blob, 'voice.bin');
      const { data } = await api.post('/uploads/voice', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      await sendMessage({
        conversationId: conversation._id,
        text: '',
        type: 'voice',
        attachments: [
          {
            id: data.files[0].id,
            url: data.files[0].url,
            kind: 'voice',
            size: file.size,
            duration: result.duration,
            waveform: result.waveform,
            key: encrypted.key,
            iv: encrypted.iv,
            name: 'Voice message',
            mime: file.type,
          },
        ],
      });
      onSent?.();
    } catch (err) {
      toast.error(err.message || 'Could not send that voice note');
    } finally {
      setUploading(false);
    }
  }

  const readOnly =
    conversation.settings?.whoCanSend === 'admins' && !conversation.isAdmin;

  if (readOnly) {
    return (
      <div className="safe-bottom shrink-0 border-t border-line glass px-5 py-4 text-center">
        <p className="text-[13.5px] text-ink-muted">
          Only admins can send messages in this {conversation.type}.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="safe-bottom relative z-[2] shrink-0 px-2 pb-1.5 pt-1.5 sm:px-3">
        {/* ── reply / edit banner ── */}
        <AnimatePresence>
          {(replyTo || editing) && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="mx-3 mt-2.5 flex items-start gap-2.5 rounded-2xl bg-black/[.04] px-3 py-2 dark:bg-white/[.06]">
                <span className="mt-0.5 shrink-0 text-brand-strong">
                  {editing ? <Pencil size={14} /> : <CornerUpLeft size={14} />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-semibold text-brand-strong">
                    {editing ? 'Editing message' : 'Replying to ' + (replyTo.sender?.name || '')}
                  </p>
                  <p className="truncate text-[13px] text-ink-muted">
                    {plain[(editing || replyTo)._id]?.text || 'Message'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    feedback('tap');
                    clearComposerState();
                    setText(editing ? '' : text);
                  }}
                  className="shrink-0 rounded-full p-1 text-ink-faint"
                >
                  <X size={15} />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── link preview being composed ── */}
        <AnimatePresence>
          {preview && !attachments.length && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="mx-1 mb-1.5 flex items-start gap-2.5 rounded-xl border border-line bg-surface p-2.5">
                {preview.image ? (
                  <img
                    src={preview.image}
                    alt=""
                    className="h-12 w-12 shrink-0 rounded-lg object-cover"
                  />
                ) : (
                  <span className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-surface-2">
                    <img
                      src={preview.favicon || ''}
                      alt=""
                      onError={(e) => {
                        e.currentTarget.style.visibility = 'hidden';
                      }}
                      className="h-5 w-5 object-contain"
                    />
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11px] uppercase tracking-wide text-ink-faint">
                    {preview.siteName || hostOf(preview.url)}
                  </span>
                  {/* A site can resolve with no title at all, so fall back to
                      the link rather than leaving an empty row. */}
                  <span className="line-clamp-2 block break-all text-[13px] font-medium leading-snug">
                    {preview.title || preview.url}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setPreview(null);
                    previewFor.current = 'dismissed';
                  }}
                  className="shrink-0 rounded-full p-1 text-ink-faint hover:text-ink"
                  aria-label="Remove preview"
                >
                  <X size={15} />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── attachment tray ── */}
        <AnimatePresence>
          {attachments.length > 0 && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              {viewOnceEligible && (
                <div className="px-1 pb-1 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      feedback('select');
                      setViewOnce((v) => !v);
                    }}
                    className={cn(
                      'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition-colors',
                      viewOnce
                        ? 'border-brand bg-brand-tint text-brand-strong'
                        : 'border-line bg-surface text-ink-muted hover:bg-surface-2'
                    )}
                  >
                    {viewOnce ? <EyeOff size={14} /> : <Eye size={14} />}
                    {viewOnce ? 'View once is on' : 'Send as view once'}
                  </button>
                  {viewOnce && (
                    <p className="mt-1 px-1 text-[11.5px] leading-snug text-ink-faint">
                      They can open it once. No caption is sent, and it cannot be saved or
                      reopened — not even by you.
                    </p>
                  )}
                </div>
              )}

              <div className="no-scrollbar flex gap-2 overflow-x-auto px-1 pb-1.5 pt-1">
                {attachments.map((a) => (
                  <motion.div
                    key={a.id}
                    layout
                    initial={{ scale: 0.85, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.85, opacity: 0 }}
                    className="relative shrink-0"
                  >
                    {a.previewUrl ? (
                      <img
                        src={a.previewUrl}
                        alt={a.name}
                        className="h-[72px] w-[72px] rounded-xl border border-line object-cover"
                      />
                    ) : (
                      <div className="flex h-[72px] w-[150px] items-center gap-2.5 rounded-xl border border-line bg-surface px-2.5">
                        <FileBadge name={a.name} size="sm" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[11.5px] font-medium leading-tight">
                            {a.name}
                          </span>
                          <span className="mt-0.5 block text-[10.5px] text-ink-faint">
                            {formatBytes(a.size)}
                          </span>
                        </span>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => removeAttachment(a.id)}
                      aria-label={'Remove ' + (a.name || 'attachment')}
                      className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-ink/60 text-white transition-colors hover:bg-ink/80"
                    >
                      <X size={13} strokeWidth={2.6} />
                    </button>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── emoji picker ── */}
        <AnimatePresence>
          {showEmoji && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 340, opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
              className="overflow-hidden border-b border-line"
            >
              <EmojiPicker
                onEmojiClick={(e) => {
                  feedback('tap');
                  setText((t) => t + e.emoji);
                }}
                theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
                width="100%"
                height={340}
                searchPlaceHolder="Search emoji"
                previewConfig={{ showPreview: false }}
                skinTonesDisabled
                lazyLoadEmojis
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── input row ── */}
        <div className="flex items-end gap-1.5">
          <AnimatePresence mode="wait" initial={false}>
            {recorder.recording ? (
              <motion.div
                key="recording"
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -12 }}
                className="flex flex-1 items-center gap-3 rounded-full bg-surface py-2 pl-4 pr-2 shadow-bubble"
              >
                <span className="h-2.5 w-2.5 animate-record-pulse rounded-full bg-danger" />
                <span className="font-mono text-[14px] tabular-nums">
                  {duration(recorder.seconds)}
                </span>

                <div className="flex h-6 flex-1 items-center gap-[2px] overflow-hidden">
                  {recorder.waveform.slice(-46).map((v, i) => (
                    <span
                      key={i}
                      className="w-[2.5px] shrink-0 rounded-full bg-brand"
                      style={{ height: Math.max(3, v * 22) + 'px' }}
                    />
                  ))}
                </div>

                <IconButton
                  icon={Trash2}
                  label="Discard"
                  size="sm"
                  variant="dangerGhost"
                  onClick={() => recorder.cancel()}
                />
                <motion.button
                  type="button"
                  whileTap={{ scale: 0.9 }}
                  onClick={sendVoiceNote}
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-brand text-white"
                >
                  <SendHorizontal size={18} strokeWidth={2.3} />
                </motion.button>
              </motion.div>
            ) : (
              <motion.div
                key="input"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex flex-1 items-end gap-1"
              >
                <IconButton
                  icon={Plus}
                  label="Attach"
                  variant="subtle"
                  onClick={() => setShowAttachMenu(true)}
                  className="shrink-0 self-center bg-surface text-ink-muted hover:bg-surface-3"
                />

                <div className="flex min-h-[44px] flex-1 items-end gap-1 rounded-[22px] bg-surface px-1.5 py-1 shadow-bubble">
                  <textarea
                    ref={textareaRef}
                    rows={1}
                    value={text}
                    onChange={(e) => {
                      setText(e.target.value);
                      if (e.target.value) pingTyping();
                      else stopTyping();
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey && enterToSend) {
                        e.preventDefault();
                        send();
                      }
                      if (e.key === 'Escape') clearComposerState();
                    }}
                    onPaste={(e) => {
                      const files = Array.from(e.clipboardData?.files || []);
                      if (files.length) {
                        e.preventDefault();
                        addFiles(files);
                      }
                    }}
                    placeholder={editing ? 'Edit your message' : 'Message'}
                    className="scroll-soft max-h-[132px] min-h-[34px] flex-1 resize-none bg-transparent px-2 py-[8px] text-[15px] leading-[1.4] outline-none placeholder:text-ink-faint"
                  />

                  <IconButton
                    icon={Smile}
                    label="Emoji"
                    size="sm"
                    active={showEmoji}
                    onClick={() => setShowEmoji((v) => !v)}
                    className="mb-[5px] shrink-0"
                  />
                </div>

                {/* One button that morphs between send and record. Keeping it
                    mounted avoids an unmount/mount race and keeps the tap
                    target stable while you type. */}
                <motion.button
                  type="button"
                  layout
                  whileTap={{ scale: 0.88 }}
                  transition={{ type: 'spring', damping: 20, stiffness: 420 }}
                  /* Tapping any button blurs the textarea, and on a phone that
                     drops the keyboard after every message. preventDefault on
                     mousedown stops the blur outright on pointer devices; on
                     touch the blur has already happened by click time, so the
                     textarea is re-focused synchronously inside the gesture —
                     iOS only re-opens the keyboard from within a user gesture,
                     so this must happen before `send` awaits anything. */
                  onMouseDown={(e) => canSend && e.preventDefault()}
                  onClick={() => {
                    if (!canSend) {
                      recorder.start();
                      return;
                    }
                    textareaRef.current?.focus();
                    send();
                  }}
                  disabled={uploading}
                  aria-label={canSend ? 'Send' : 'Record a voice message'}
                  className={cn(
                    'relative grid h-[46px] w-[46px] shrink-0 place-items-center overflow-hidden rounded-full transition-colors duration-200 disabled:opacity-40',
                    'bg-brand text-white hover:bg-brand-strong'
                  )}
                >
                  <motion.span
                    animate={{
                      scale: canSend ? 1 : 0.4,
                      opacity: canSend ? 1 : 0,
                      rotate: canSend ? 0 : -35,
                    }}
                    transition={{ type: 'spring', damping: 18, stiffness: 420 }}
                    className="absolute"
                  >
                    <SendHorizontal size={19} strokeWidth={2.3} />
                  </motion.span>
                  <motion.span
                    animate={{ scale: canSend ? 0.4 : 1, opacity: canSend ? 0 : 1 }}
                    transition={{ type: 'spring', damping: 18, stiffness: 420 }}
                    className="absolute"
                  >
                    <Mic size={19} strokeWidth={2.1} />
                  </motion.span>
                </motion.button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {uploading && (
          <div className="absolute inset-x-0 top-0 h-0.5 overflow-hidden">
            <motion.div
              initial={{ x: '-100%' }}
              animate={{ x: '100%' }}
              transition={{ duration: 0.9, repeat: Infinity, ease: 'easeInOut' }}
              className="h-full w-1/3 bg-brand"
            />
          </div>
        )}
      </div>

      {/* hidden inputs */}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*,video/*"
        multiple
        hidden
        onChange={(e) => {
          addFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={fileInputRef}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          addFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          sounds.camera();
          addFiles(e.target.files, 'image');
          e.target.value = '';
        }}
      />

      <ActionSheet
        open={showAttachMenu}
        onClose={() => setShowAttachMenu(false)}
        actions={[
          {
            label: 'Photos & videos',
            sublabel: 'Encrypted before upload',
            icon: ImageIcon,
            onClick: () => imageInputRef.current?.click(),
          },
          {
            label: 'Camera',
            sublabel: 'Take a photo right now',
            icon: Camera,
            onClick: () => cameraInputRef.current?.click(),
          },
          {
            label: 'Document',
            sublabel: 'Any file up to 50 MB',
            icon: FileText,
            onClick: () => fileInputRef.current?.click(),
          },
        ]}
      />
    </>
  );
}

/* ────────────────────────── voice recording ────────────────────────── */

function useRecorder(conversationId) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [waveform, setWaveform] = useState([]);

  const mediaRecorder = useRef(null);
  const chunks = useRef([]);
  const stream = useRef(null);
  const analyser = useRef(null);
  const raf = useRef(null);
  const timer = useRef(null);
  const levels = useRef([]);

  const cleanup = useCallback(() => {
    clearInterval(timer.current);
    cancelAnimationFrame(raf.current);
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    analyser.current = null;
    setRecording(false);
    setSeconds(0);
    setWaveform([]);
    emit('recording:stop', { conversationId });
  }, [conversationId]);

  const start = useCallback(async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.current = s;
      chunks.current = [];
      levels.current = [];

      const rec = new MediaRecorder(s);
      mediaRecorder.current = rec;
      rec.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      rec.start(100);

      // Live level metering for the waveform.
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioCtx();
      const source = ctx.createMediaStreamSource(s);
      const node = ctx.createAnalyser();
      node.fftSize = 256;
      source.connect(node);
      analyser.current = node;

      const data = new Uint8Array(node.frequencyBinCount);
      const tick = () => {
        node.getByteFrequencyData(data);
        const avg = data.reduce((a, b) => a + b, 0) / data.length / 255;
        levels.current.push(avg);
        setWaveform((w) => [...w, avg].slice(-160));
        raf.current = requestAnimationFrame(tick);
      };
      tick();

      timer.current = setInterval(() => setSeconds((v) => v + 1), 1000);
      setRecording(true);
      feedback('recordStart');
      emit('recording:start', { conversationId });
    } catch {
      toast.error('Microphone access was blocked');
    }
  }, [conversationId]);

  const stop = useCallback(
    () =>
      new Promise((resolve) => {
        const rec = mediaRecorder.current;
        if (!rec || rec.state === 'inactive') {
          cleanup();
          return resolve(null);
        }

        const elapsed = seconds;
        const samples = levels.current;

        rec.onstop = () => {
          const blob = new Blob(chunks.current, { type: rec.mimeType || 'audio/webm' });
          // Compress the level trace down to 40 bars for the bubble.
          const bars = 40;
          const step = Math.max(1, Math.floor(samples.length / bars));
          const compact = [];
          for (let i = 0; i < samples.length; i += step) {
            compact.push(Number(samples[i].toFixed(2)));
          }
          cleanup();
          feedback('recordStop');
          resolve({ blob, duration: Math.max(1, elapsed), waveform: compact.slice(0, bars) });
        };
        rec.stop();
      }),
    [cleanup, seconds]
  );

  const cancel = useCallback(() => {
    const rec = mediaRecorder.current;
    if (rec && rec.state !== 'inactive') {
      rec.onstop = null;
      rec.stop();
    }
    cleanup();
    feedback('close');
  }, [cleanup]);

  useEffect(() => cleanup, [cleanup]);

  return { recording, seconds, waveform, start, stop, cancel };
}

function imageDimensions(file) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => resolve({});
    img.src = url;
  });
}
