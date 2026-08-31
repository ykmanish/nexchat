'use client';

import { useEffect, useState } from 'react';
import { Globe, Play } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  cachedPreview,
  hasResolved,
  hostOf,
  originFavicon,
  resolvePreview,
  subscribe,
} from '@/lib/linkpreview';

/**
 * The preview card above a link.
 *
 * Two things can feed it. A preview the *sender* resolved travels inside the
 * encrypted payload and renders with no network call at all. When there isn't
 * one — the sender hit send before their fetch landed, or came from a client
 * that doesn't attach previews — the viewing client resolves it instead, which
 * is what `enabled` gates.
 */
export function LinkPreview({ url, preview: attached, isMine, enabled = true }) {
  const preview = useResolvedPreview(url, attached, enabled);

  const host = hostOf(preview?.url || url);
  if (!host) return null;

  const rich = preview && (preview.title || preview.image || preview.description);

  return (
    <a
      href={preview?.url || url}
      target="_blank"
      rel="noopener noreferrer nofollow"
      onClick={(e) => e.stopPropagation()}
      className={cn(
        'mb-1 block overflow-hidden rounded-[7px] transition-colors',
        isMine
          ? 'bg-black/[.12] hover:bg-black/[.17] dark:bg-black/25 dark:hover:bg-black/30'
          : 'bg-black/[.05] hover:bg-black/[.09] dark:bg-white/[.06] dark:hover:bg-white/[.1]'
      )}
    >
      {rich && preview.image && (
        <Hero src={preview.image} isVideo={preview.type === 'video'} />
      )}

      <div className="flex items-start gap-2.5 px-2.5 py-2">
        <Favicon src={preview?.favicon} fallback={originFavicon(url)} />

        <span className="min-w-0 flex-1">
          <span className="block truncate text-[11.5px] font-medium uppercase tracking-wide opacity-60">
            {preview?.siteName || host}
          </span>

          {rich ? (
            <>
              {preview.title && (
                <span className="mt-0.5 line-clamp-2 block text-[13.5px] font-medium leading-snug">
                  {preview.title}
                </span>
              )}
              {preview.description && (
                <span className="mt-0.5 line-clamp-2 block text-[12.5px] leading-snug opacity-65">
                  {preview.description}
                </span>
              )}
            </>
          ) : (
            /* Nothing resolved, so show the link itself rather than an empty
               card — the favicon and host still make it recognisable. */
            <span className="mt-0.5 line-clamp-1 block break-all text-[12.5px] leading-snug opacity-70">
              {trimUrl(preview?.url || url)}
            </span>
          )}
        </span>
      </div>
    </a>
  );
}

/* ───────────────────────────── pieces ───────────────────────────── */

function Hero({ src, isVideo }) {
  const [broken, setBroken] = useState(false);
  if (broken) return null;

  return (
    <span className="relative block">
      <img
        src={src}
        alt=""
        onError={() => setBroken(true)}
        referrerPolicy="no-referrer"
        className="max-h-[190px] w-full bg-black/10 object-cover"
        loading="lazy"
      />
      {isVideo && (
        <span className="absolute inset-0 grid place-items-center">
          <span className="grid h-11 w-11 place-items-center rounded-full bg-black/60 backdrop-blur-[2px]">
            <Play size={20} className="ml-0.5 fill-white text-white" />
          </span>
        </span>
      )}
    </span>
  );
}

/**
 * Falls back through the declared icon, then the origin's /favicon.ico, then a
 * glyph — a surprising number of sites declare an icon that 404s.
 *
 * Loaded eagerly on purpose: it is a couple of KB and it is what makes the
 * card recognisable, and `loading="lazy"` on an 18px image inside the chat
 * scroller left it permanently un-fetched.
 */
export function Favicon({ src, fallback }) {
  const [step, setStep] = useState(0);
  const chain = [src, fallback].filter(Boolean);

  useEffect(() => setStep(0), [src, fallback]);

  const current = chain[step];

  return (
    <span className="mt-0.5 grid h-[18px] w-[18px] shrink-0 place-items-center overflow-hidden rounded-[4px]">
      {current ? (
        <img
          src={current}
          alt=""
          onError={() => setStep((s) => s + 1)}
          referrerPolicy="no-referrer"
          className="h-full w-full object-contain"
        />
      ) : (
        <Globe size={14} className="opacity-55" />
      )}
    </span>
  );
}

/** Placeholder while the sender is still fetching metadata. */
export function LinkPreviewSkeleton() {
  return (
    <div className="mb-1 flex items-center gap-2.5 rounded-[7px] bg-black/[.05] px-2.5 py-2 dark:bg-white/[.06]">
      <div className="skeleton h-[18px] w-[18px] shrink-0 rounded-[4px]" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="skeleton h-2.5 w-1/3 rounded-full" />
        <div className="skeleton h-2.5 w-2/3 rounded-full" />
      </div>
    </div>
  );
}

/* ───────────────────────────── plumbing ───────────────────────────── */

export function useResolvedPreview(url, attached, enabled) {
  const [, bump] = useState(0);

  useEffect(() => {
    if (attached || !url || !enabled || hasResolved(url)) return undefined;
    resolvePreview(url);
    // Any bubble showing this URL repaints when the shared cache fills.
    return subscribe((changed) => {
      if (changed === url) bump((n) => n + 1);
    });
  }, [url, attached, enabled]);

  if (attached) return attached;
  if (!enabled) return null;
  return cachedPreview(url) || null;
}

export function trimUrl(url) {
  try {
    const u = new URL(url);
    const rest = (u.pathname === '/' ? '' : u.pathname) + u.search;
    return u.hostname.replace(/^www\./, '') + rest;
  } catch {
    return url;
  }
}
