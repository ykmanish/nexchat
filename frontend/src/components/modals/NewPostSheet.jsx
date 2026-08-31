'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ImagePlus,
  X,
  Globe,
  Users,
  Lock,
  MapPin,
  MessageCircleOff,
  EyeOff,
  Type,
  Check,
} from 'lucide-react';
import { Sheet } from '@/components/ui/Sheet';
import { Button } from '@/components/ui/Button';
import { Avatar } from '@/components/ui/Avatar';
import { useAuth } from '@/store/auth';
import { useFeed } from '@/store/feed';
import { toast } from '@/store/ui';
import { api } from '@/lib/api';
import { prepare, isImage, isVideo } from '@/lib/media';
import { cn } from '@/lib/utils';
import { feedback } from '@/lib/sound';

const MAX_MEDIA = 10;
const MAX_TEXT = 2200;

const AUDIENCES = [
  { value: 'public', icon: Globe, label: 'Everyone', hint: 'Anyone on Chax can see it' },
  { value: 'followers', icon: Users, label: 'Followers', hint: 'Only people who follow you' },
  { value: 'contacts', icon: Lock, label: 'Contacts', hint: 'Only people you chat with' },
];

/**
 * Composing a post.
 *
 * The one thing worth stating out loud, and the sheet does say it: unlike every
 * message in this app, a post is not end-to-end encrypted. The audience of a
 * broadcast is open-ended and grows after the fact, so there is no recipient set
 * to seal it to. The line under the audience picker is not boilerplate — it is
 * the difference between a user who knows that and one who assumes otherwise.
 */
export function NewPostSheet({ open, onClose, withMedia = false, quoting = null }) {
  const user = useAuth((s) => s.user);
  const createPost = useFeed((s) => s.createPost);

  const [text, setText] = useState('');
  const [items, setItems] = useState([]); // { id, file, url, kind, width, height, alt }
  const [audience, setAudience] = useState('public');
  const [location, setLocation] = useState('');
  const [commentsDisabled, setCommentsDisabled] = useState(false);
  const [hideCounts, setHideCounts] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [posting, setPosting] = useState(false);
  const [progress, setProgress] = useState(0);

  const fileRef = useRef(null);
  const textRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setText('');
    setItems([]);
    setAudience('public');
    setLocation('');
    setCommentsDisabled(false);
    setHideCounts(false);
    setShowOptions(false);
    setPosting(false);
    setProgress(0);
    // Opened from the photo button: go straight to the picker.
    if (withMedia) setTimeout(() => fileRef.current?.click(), 220);
    else setTimeout(() => textRef.current?.focus(), 260);
  }, [open, withMedia]);

  /* Object URLs are revoked when the sheet closes rather than on every change:
     revoking one that is still painted leaves a broken thumbnail behind. */
  useEffect(() => {
    if (open) return undefined;
    return () => items.forEach((i) => i.url && URL.revokeObjectURL(i.url));
  }, [open, items]);

  const pick = useCallback(async (files) => {
    const room = MAX_MEDIA - items.length;
    if (room <= 0) {
      toast.error('Ten photos is the limit for one post');
      return;
    }

    const chosen = [...files].filter((f) => isImage(f) || isVideo(f)).slice(0, room);
    if (!chosen.length) return;

    const prepared = await Promise.all(
      chosen.map(async (file) => {
        // Shrink before it leaves the browser. The server resizes too, but a
        // 12 MB phone photo should never be on the wire in the first place.
        const ready = await prepare(file, { preset: 'story' });
        return {
          id: Math.random().toString(36).slice(2),
          file: ready.blob,
          name: file.name,
          url: URL.createObjectURL(ready.blob),
          kind: ready.kind === 'video' ? 'video' : 'image',
          width: ready.width,
          height: ready.height,
          alt: '',
        };
      })
    );

    setItems((current) => [...current, ...prepared].slice(0, MAX_MEDIA));
    feedback('select');
  }, [items.length]);

  async function submit() {
    const body = text.trim();
    if (!body && !items.length && !quoting) return;

    setPosting(true);
    setProgress(0);

    try {
      let media = [];

      if (items.length) {
        const form = new FormData();
        items.forEach((item, i) =>
          form.append('files', item.file, item.name || 'post-' + i + '.bin')
        );

        const { data } = await api.post('/uploads/post-media', form, {
          headers: { 'Content-Type': 'multipart/form-data' },
          onUploadProgress: (e) => setProgress(e.total ? e.loaded / e.total : 0),
        });

        /* The server hands back the processed dimensions and the placeholder;
           only the alt text is ours to add, and it is matched by position. */
        media = data.files.map((file, i) => ({ ...file, alt: items[i]?.alt || '' }));
      }

      await createPost({
        text: body,
        media,
        audience,
        location: location.trim() || null,
        commentsDisabled,
        hideCounts,
        repostOf: quoting?._id || null,
      });

      feedback('send');
      toast.success(quoting ? 'Quoted' : 'Posted');
      onClose?.();

      /* `posting` is deliberately left set here, and cleared when the sheet is
         next opened instead.
         It feeds `dismissible`, which decides whether the panel is draggable.
         Flipping that back on the same tick the sheet starts animating away
         re-arms the drag gesture on a component framer-motion is already
         exiting, and the exit-complete callback is then never delivered: the
         panel slides off screen but stays mounted, leaving its full-screen
         backdrop — invisible, still clickable — over the whole app. Every tap
         after publishing a post went into it. */
    } catch (err) {
      toast.error(err.message);
      setPosting(false);
      setProgress(0);
    }
  }

  const remaining = MAX_TEXT - text.length;
  const canPost = (!!text.trim() || items.length > 0 || !!quoting) && !posting;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={quoting ? 'Quote post' : 'New post'}
      size="lg"
      dismissible={!posting}
      footer={
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            {posting && items.length > 0 ? (
              <div className="space-y-1.5">
                <div className="h-1 overflow-hidden rounded-full bg-surface-3">
                  <div
                    className="h-full rounded-full bg-brand transition-[width] duration-200"
                    style={{ width: Math.round(progress * 100) + '%' }}
                  />
                </div>
                <p className="text-[12px] text-ink-muted">
                  Uploading {items.length} {items.length === 1 ? 'file' : 'files'}…
                </p>
              </div>
            ) : (
              <span
                className={cn(
                  'text-[12.5px] tabular-nums',
                  remaining < 0
                    ? 'font-semibold text-danger'
                    : remaining < 120
                      ? 'text-warn'
                      : 'text-ink-faint'
                )}
              >
                {remaining < 200 ? remaining + ' left' : ''}
              </span>
            )}
          </div>

          <Button
            onClick={submit}
            loading={posting}
            disabled={!canPost || remaining < 0}
            className="shrink-0"
          >
            {quoting ? 'Quote' : 'Post'}
          </Button>
        </div>
      }
    >
      <div className="px-5 pb-2">
        <div className="flex gap-3">
          <Avatar src={user?.avatar} name={user?.name} color={user?.avatarColor} size="sm" />

          <textarea
            ref={textRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={
              quoting ? 'Add your take…' : items.length ? 'Write a caption…' : "What's happening?"
            }
            rows={items.length || quoting ? 3 : 5}
            className="selectable min-h-[76px] w-full resize-none bg-transparent text-[16px] leading-relaxed outline-none placeholder:text-ink-faint"
          />
        </div>

        {/* ── the quoted post ── */}
        {quoting && (
          <div className="mt-2 rounded-xl border border-line p-3">
            <div className="flex items-center gap-2">
              <Avatar
                src={quoting.author?.avatar}
                name={quoting.author?.name}
                color={quoting.author?.avatarColor}
                size="xs"
              />
              <span className="truncate text-[13.5px] font-semibold">{quoting.author?.name}</span>
            </div>
            {quoting.text && (
              <p className="mt-1.5 line-clamp-3 text-[13px] leading-relaxed text-ink-muted">
                {quoting.text}
              </p>
            )}
            {quoting.media?.length > 0 && (
              <p className="mt-1.5 text-[12.5px] text-ink-faint">
                {quoting.media.length} {quoting.media.length === 1 ? 'photo' : 'photos'}
              </p>
            )}
          </div>
        )}

        {/* ── chosen media ── */}
        <AnimatePresence>
          {items.length > 0 && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-3 overflow-hidden"
            >
              <div className="no-scrollbar flex gap-2.5 overflow-x-auto pb-1">
                {items.map((item, i) => (
                  <div
                    key={item.id}
                    className="group relative h-[124px] w-[100px] shrink-0 overflow-hidden rounded-xl bg-surface-3"
                  >
                    {item.kind === 'video' ? (
                      <video
                        src={item.url}
                        muted
                        playsInline
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <img src={item.url} alt="" className="h-full w-full object-cover" />
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        URL.revokeObjectURL(item.url);
                        setItems((c) => c.filter((x) => x.id !== item.id));
                      }}
                      aria-label="Remove"
                      className="absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full bg-black/60 text-white transition hover:bg-black/80"
                    >
                      <X size={13} strokeWidth={2.6} />
                    </button>

                    {/* Alt text, on the thumbnail rather than behind a dialog.
                        Anything further away than this does not get written. */}
                    <label className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-1.5">
                      <span className="sr-only">Describe photo {i + 1}</span>
                      <input
                        value={item.alt}
                        onChange={(e) =>
                          setItems((c) =>
                            c.map((x) => (x.id === item.id ? { ...x, alt: e.target.value } : x))
                          )
                        }
                        placeholder="Alt text"
                        className="w-full bg-transparent text-[10.5px] text-white outline-none placeholder:text-white/60"
                      />
                    </label>
                  </div>
                ))}

                {items.length < MAX_MEDIA && (
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="grid h-[124px] w-[100px] shrink-0 place-items-center rounded-xl border-[1.5px] border-dashed border-line-strong text-ink-faint transition-colors hover:border-brand hover:text-brand-strong"
                  >
                    <ImagePlus size={22} strokeWidth={1.8} />
                  </button>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <input
          ref={fileRef}
          type="file"
          accept="image/*,video/*"
          multiple
          hidden
          onChange={(e) => {
            pick(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      {/* ── who can see it ── */}
      <div className="border-t border-line px-5 py-4">
        <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink-faint">
          Who can see this
        </p>

        <div className="grid grid-cols-3 gap-2">
          {AUDIENCES.map((option) => {
            const active = audience === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  feedback('select');
                  setAudience(option.value);
                }}
                className={cn(
                  'flex flex-col items-center gap-1.5 rounded-xl border px-2 py-3 transition-colors',
                  active
                    ? 'border-brand bg-brand-tint text-brand-strong'
                    : 'border-line text-ink-muted hover:bg-surface-2'
                )}
              >
                <option.icon size={18} strokeWidth={1.9} />
                <span className="text-[12.5px] font-medium">{option.label}</span>
              </button>
            );
          })}
        </div>

        <p className="mt-2 text-[12px] leading-relaxed text-ink-faint">
          {AUDIENCES.find((a) => a.value === audience)?.hint}. Unlike your chats, posts are{' '}
          <span className="font-medium text-ink-muted">not end-to-end encrypted</span> — a feed has
          no fixed set of readers to encrypt to.
        </p>
      </div>

      {/* ── the rest, folded away ── */}
      <div className="border-t border-line px-5 py-3">
        <button
          type="button"
          onClick={() => setShowOptions((v) => !v)}
          className="flex w-full items-center justify-between py-1 text-[14px] font-medium text-ink-muted transition-colors hover:text-ink"
        >
          <span className="flex items-center gap-2">
            <Type size={16} strokeWidth={1.9} />
            More options
          </span>
          <span className="text-[12.5px] text-ink-faint">{showOptions ? 'Hide' : 'Show'}</span>
        </button>

        <AnimatePresence>
          {showOptions && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="space-y-1 pt-2">
                <label className="flex items-center gap-3 rounded-xl px-1 py-2.5">
                  <MapPin size={17} className="shrink-0 text-ink-faint" strokeWidth={1.9} />
                  <input
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    placeholder="Add a location"
                    maxLength={120}
                    className="min-w-0 flex-1 bg-transparent text-[14.5px] outline-none placeholder:text-ink-faint"
                  />
                </label>

                <Toggle
                  icon={MessageCircleOff}
                  label="Turn off commenting"
                  hint="Nobody can reply to this post"
                  value={commentsDisabled}
                  onChange={setCommentsDisabled}
                />
                <Toggle
                  icon={EyeOff}
                  label="Hide like and save counts"
                  hint="You will still see your own numbers"
                  value={hideCounts}
                  onChange={setHideCounts}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {!items.length && !quoting && (
        <div className="px-5 pb-4">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex w-full items-center justify-center gap-2 rounded-xl border-[1.5px] border-dashed border-line-strong py-4 text-[14px] font-medium text-ink-muted transition-colors hover:border-brand hover:text-brand-strong"
          >
            <ImagePlus size={18} strokeWidth={1.9} />
            Add photos or video
          </button>
        </div>
      )}
    </Sheet>
  );
}

function Toggle({ icon: Icon, label, hint, value, onChange }) {
  return (
    <button
      type="button"
      onClick={() => {
        feedback('select');
        onChange(!value);
      }}
      className="flex w-full items-center gap-3 rounded-xl px-1 py-2.5 text-left transition-colors hover:bg-surface-2"
    >
      <Icon size={17} className="shrink-0 text-ink-faint" strokeWidth={1.9} />
      <span className="min-w-0 flex-1">
        <span className="block text-[14.5px]">{label}</span>
        <span className="block text-[12px] text-ink-faint">{hint}</span>
      </span>
      <span
        className={cn(
          'grid h-6 w-6 shrink-0 place-items-center rounded-md border transition-colors',
          value ? 'border-brand bg-brand text-brand-ink' : 'border-line-strong'
        )}
      >
        {value && <Check size={14} strokeWidth={3} />}
      </span>
    </button>
  );
}
