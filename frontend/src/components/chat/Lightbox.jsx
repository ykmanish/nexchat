'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ChevronLeft, ChevronRight, Download, EyeOff, ShieldAlert } from 'lucide-react';
import { useUI, toast } from '@/store/ui';
import { useDecryptedMedia } from './Attachment';
import { IconButton } from '@/components/ui/Button';
import { feedback } from '@/lib/sound';
import { arm as armCaptureGuard, CAPTURE_CAVEAT } from '@/lib/captureguard';

/** Full-screen media viewer with swipe-to-dismiss. */
export function Lightbox() {
  const lightbox = useUI((s) => s.lightbox);
  const close = useUI((s) => s.closeLightbox);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (lightbox) setIndex(lightbox.index || 0);
  }, [lightbox]);

  useEffect(() => {
    if (!lightbox) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowRight') setIndex((i) => Math.min(i + 1, lightbox.items.length - 1));
      if (e.key === 'ArrowLeft') setIndex((i) => Math.max(i - 1, 0));
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [lightbox, close]);

  /* Armed for view-once media only.
     Not for everything: the guard blacks the screen out whenever focus is lost,
     which is the right trade for a photo that can be opened exactly once and
     wrong for an ordinary picture somebody may well want to keep. Scoping it
     here means the aggressive behaviour applies precisely where the sender was
     promised it would. */
  const guarded = (lightbox?.items || []).some((i) => i?.viewOnce);

  useEffect(() => {
    if (!guarded) return undefined;
    return armCaptureGuard();
  }, [guarded]);

  if (typeof document === 'undefined') return null;

  const items = lightbox?.items || [];
  const current = items[index];

  return createPortal(
    <AnimatePresence>
      {lightbox && current && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[150] flex flex-col bg-black/95"
        >
          <header className="safe-top relative z-10 flex items-center justify-between px-3 py-3">
            <IconButton
              icon={X}
              label="Close"
              onClick={close}
              className="text-white hover:bg-white/10"
            />
            <span className="text-[13px] font-medium text-white/70">
              {guarded
                ? 'View once'
                : items.length > 1
                  ? index + 1 + ' of ' + items.length
                  : ''}
            </span>
            {/* Offering "save" on a photo that exists for one viewing would be
                absurd, and the button was there. */}
            {guarded ? (
              <span className="grid h-10 w-10 place-items-center text-white/50">
                <EyeOff size={18} />
              </span>
            ) : (
              <DownloadButton attachment={current} />
            )}
          </header>

          <div
            className="relative flex min-h-0 flex-1 items-center justify-center"
            {...(guarded ? { 'data-capture-guard': '' } : {})}
          >
            <AnimatePresence mode="wait">
              <LightboxItem key={index} attachment={current} onClose={close} />
            </AnimatePresence>

            {index > 0 && (
              <button
                type="button"
                onClick={() => {
                  feedback('swipe');
                  setIndex(index - 1);
                }}
                className="absolute left-3 grid h-11 w-11 place-items-center rounded-full bg-white/15 text-white transition-colors hover:bg-white/25"
                aria-label="Previous"
              >
                <ChevronLeft size={22} />
              </button>
            )}
            {index < items.length - 1 && (
              <button
                type="button"
                onClick={() => {
                  feedback('swipe');
                  setIndex(index + 1);
                }}
                className="absolute right-3 grid h-11 w-11 place-items-center rounded-full bg-white/15 text-white transition-colors hover:bg-white/25"
                aria-label="Next"
              >
                <ChevronRight size={22} />
              </button>
            )}
          </div>

          {/* Said plainly rather than implied. A guard that claims more than it
              can do is worse than none — somebody deciding whether to send a
              photo needs to know a camera pointed at the screen still works. */}
          {guarded && (
            <div className="safe-bottom px-6 pb-4 pt-3">
              <p className="mx-auto flex max-w-[420px] items-start gap-2 text-[11.5px] leading-relaxed text-white/55">
                <ShieldAlert size={13} className="mt-0.5 shrink-0" />
                {CAPTURE_CAVEAT}
              </p>
            </div>
          )}

          {items.length > 1 && !guarded && (
            <div className="safe-bottom flex justify-center gap-1.5 py-4">
              {items.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setIndex(i)}
                  className={
                    'h-1.5 rounded-full transition-all duration-200 ' +
                    (i === index ? 'w-6 bg-white' : 'w-1.5 bg-white/35')
                  }
                  aria-label={'Go to item ' + (i + 1)}
                />
              ))}
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}

function LightboxItem({ attachment, onClose }) {
  const { url, state, dropPreview } = useDecryptedMedia(attachment);

  if (state !== 'ready' || !url) {
    return (
      <div className="grid place-items-center">
        <span className="h-9 w-9 animate-spin rounded-full border-[3px] border-white/25 border-t-white" />
      </div>
    );
  }

  if (attachment.kind === 'video') {
    return (
      <motion.video
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        src={url}
        onError={dropPreview}
        controls
        autoPlay
        playsInline
        className="max-h-full max-w-full"
      />
    );
  }

  return (
    <motion.img
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      drag="y"
      dragConstraints={{ top: 0, bottom: 0 }}
      dragElastic={0.4}
      onDragEnd={(_e, info) => Math.abs(info.offset.y) > 130 && onClose()}
      src={url}
      onError={dropPreview}
      alt={attachment.name || 'Photo'}
      className="max-h-full max-w-full select-none object-contain"
      draggable={false}
      // A long-press "save image" is the easy way around all of this on a phone.
      onContextMenu={attachment.viewOnce ? (e) => e.preventDefault() : undefined}
    />
  );
}

function DownloadButton({ attachment }) {
  const { url, state } = useDecryptedMedia(attachment);

  return (
    <IconButton
      icon={Download}
      label="Save"
      disabled={state !== 'ready'}
      onClick={() => {
        if (!url) return;
        const a = document.createElement('a');
        a.href = url;
        a.download = attachment.name || 'nexchat-media';
        a.click();
        toast.success('Saved to your device');
      }}
      className="text-white hover:bg-white/10"
    />
  );
}
