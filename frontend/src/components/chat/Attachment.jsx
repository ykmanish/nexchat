'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Download, Play, AlertTriangle, Lock, Loader2 } from 'lucide-react';
import { FileBadge } from '@/components/ui/FileIcon';
import { decryptFile } from '@/lib/e2ee';
import { useUI, toast } from '@/store/ui';
import { cn, formatBytes, duration } from '@/lib/utils';
import { feedback } from '@/lib/sound';

/**
 * Attachments arrive as opaque bytes. We fetch, decrypt in the browser, and
 * hand the result to an object URL — the plaintext never touches the network.
 */
export function useDecryptedMedia(attachment) {
  /* A previewUrl is a blob: URL from the device that sent the file. Older
     messages have one baked into their payload, and on any other device it
     points at nothing. Treat it as a hint that is allowed to fail: `dropped`
     flips when it does, and the normal fetch-and-decrypt path takes over. */
  const [dropped, setDropped] = useState(false);
  const preview = dropped ? null : attachment?.previewUrl || null;

  const [url, setUrl] = useState(preview);
  const [state, setState] = useState(preview ? 'ready' : 'idle');

  useEffect(() => {
    if (!attachment?.url || !attachment?.key || preview) return undefined;

    let objectUrl = null;
    let cancelled = false;

    (async () => {
      setState('loading');
      try {
        const blob = await decryptFile({
          url: attachment.url,
          key: attachment.key,
          iv: attachment.iv,
          mime: attachment.mime,
        });
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
        setState('ready');
      } catch {
        if (!cancelled) setState('error');
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attachment?.url, attachment?.key, attachment?.iv, attachment?.mime, preview]);

  /** Called when a previewUrl fails to render, so decryption can take over. */
  const dropPreview = () => {
    if (attachment?.previewUrl && !dropped) {
      setDropped(true);
      setUrl(null);
      setState('idle');
    }
  };

  return { url, state, dropPreview };
}

export function Attachment({ attachment, meta, isMine, all = [], index = 0 }) {
  const openLightbox = useUI((s) => s.openLightbox);
  const { url, state, dropPreview } = useDecryptedMedia(attachment);

  const width = attachment.width || meta?.width;
  const height = attachment.height || meta?.height;
  const ratio = width && height ? width / height : 4 / 3;

  if (attachment.kind === 'image' || attachment.kind === 'gif' || attachment.kind === 'sticker') {
    return (
      <motion.button
        type="button"
        whileTap={{ scale: 0.98 }}
        onClick={(e) => {
          e.stopPropagation();
          if (state !== 'ready') return;
          feedback('open');
          openLightbox(
            all.filter((a) => ['image', 'gif', 'video'].includes(a.kind)),
            index
          );
        }}
        className={cn(
          'relative block w-full overflow-hidden rounded-2xl bg-black/5 dark:bg-white/5',
          attachment.kind === 'sticker' && 'max-w-[160px] bg-transparent'
        )}
        style={{ aspectRatio: Math.max(0.6, Math.min(ratio, 2)) }}
      >
        {state === 'ready' && url ? (
          <motion.img
            initial={{ opacity: 0, scale: 1.02 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.35 }}
            src={url}
            alt={attachment.name || 'Photo'}
            onError={dropPreview}
            className="h-full w-full object-cover"
            draggable={false}
          />
        ) : (
          <MediaPlaceholder state={state} />
        )}
      </motion.button>
    );
  }

  if (attachment.kind === 'video') {
    return (
      <div className="relative w-full overflow-hidden rounded-2xl bg-black/10">
        {state === 'ready' && url ? (
          <video
            src={url}
            onError={dropPreview}
            controls
            playsInline
            preload="metadata"
            className="w-full rounded-2xl"
            style={{ maxHeight: 380 }}
          />
        ) : (
          <div style={{ aspectRatio: Math.max(0.6, Math.min(ratio, 2)) }}>
            <MediaPlaceholder state={state} icon={Play} />
          </div>
        )}
      </div>
    );
  }

  if (attachment.kind === 'audio') {
    return state === 'ready' && url ? (
      <audio src={url} controls className="w-full max-w-[280px]" />
    ) : (
      <div className="h-12 w-[240px] rounded-xl bg-black/5">
        <MediaPlaceholder state={state} />
      </div>
    );
  }

  // Document card — coloured by file type so the format reads at a glance.
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.98 }}
      onClick={(e) => {
        e.stopPropagation();
        if (state !== 'ready' || !url) return;
        feedback('tap');
        const a = document.createElement('a');
        a.href = url;
        a.download = attachment.name || 'file';
        a.click();
        toast.success('Saved ' + (attachment.name || 'file'));
      }}
      className={cn(
        'flex w-full min-w-[240px] max-w-[320px] items-center gap-3 rounded-lg px-2.5 py-2.5 pb-4 text-left',
        'bg-black/[.05] transition-colors hover:bg-black/[.08] dark:bg-white/[.06] dark:hover:bg-white/[.1]'
      )}
    >
      {state === 'loading' ? (
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-black/[.06] dark:bg-white/[.08]">
          <Loader2 size={19} className="animate-spin opacity-60" />
        </span>
      ) : state === 'error' ? (
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-danger/12 text-danger">
          <AlertTriangle size={19} />
        </span>
      ) : (
        <FileBadge name={attachment.name} size="md" />
      )}

      <span className="min-w-0 flex-1">
        <span className="block truncate pr-1 text-[14px] font-medium leading-snug">
          {attachment.name || 'Document'}
        </span>
        <span className="mt-0.5 block text-[12px] opacity-60">
          {formatBytes(attachment.size || meta?.size)}
          {state === 'error' && ' · could not decrypt'}
        </span>
      </span>

      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-black/[.06] dark:bg-white/[.08]">
        <Download size={15} className="opacity-70" />
      </span>
    </motion.button>
  );
}

function MediaPlaceholder({ state, icon: Icon = Lock }) {
  return (
    <div className="absolute inset-0 grid place-items-center">
      {state === 'error' ? (
        <div className="flex flex-col items-center gap-1.5 text-ink-faint">
          <AlertTriangle size={20} />
          <span className="text-[11px]">Could not decrypt</span>
        </div>
      ) : state === 'loading' ? (
        <div className="skeleton absolute inset-0">
          <div className="absolute inset-0 grid place-items-center">
            <span className="h-6 w-6 animate-spin rounded-full border-2 border-ink-faint border-t-transparent" />
          </div>
        </div>
      ) : (
        <Icon size={20} className="text-ink-faint" />
      )}
    </div>
  );
}
