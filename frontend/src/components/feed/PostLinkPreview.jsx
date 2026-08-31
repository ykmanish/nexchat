'use client';

import { useState } from 'react';
import { Play, ExternalLink } from 'lucide-react';
import {
  Favicon,
  useResolvedPreview,
  trimUrl,
} from '@/components/chat/LinkPreview';
import { hostOf, isInternalLink, originFavicon, hasResolved } from '@/lib/linkpreview';
import { cn } from '@/lib/utils';

/**
 * The card under a post that carries a link.
 *
 * Same resolver and the same shared cache the chat bubbles use — one request
 * per URL for the whole app, however many places are showing it. What differs
 * is the shape: a bubble gets a compact strip because it has to fit beside a
 * message, and a feed card has the width to show the thing properly, so this
 * one leads with the image and gives the title room to be read.
 *
 * A link back into Chax gets no card, for the same reason it gets none in a
 * chat: there are no tags behind a client-side route to build one from.
 */
export function PostLinkPreview({ url }) {
  const preview = useResolvedPreview(url, null, true);
  const [heroBroken, setHeroBroken] = useState(false);

  if (!url || isInternalLink(url)) return null;

  const host = hostOf(preview?.url || url);
  if (!host) return null;

  const rich = preview && (preview.title || preview.image || preview.description);
  const hero = !heroBroken && preview?.image;

  // Still in flight — a placeholder the right shape, so nothing jumps later.
  if (!preview && !hasResolved(url)) {
    return (
      <div className="mx-4 mb-3 overflow-hidden rounded-xl border border-line">
        <div className="skeleton aspect-[1.91/1] w-full" />
        <div className="space-y-2 px-3.5 py-3">
          <div className="skeleton h-2.5 w-24 rounded-full" />
          <div className="skeleton h-3 w-3/4 rounded-full" />
          <div className="skeleton h-2.5 w-1/2 rounded-full" />
        </div>
      </div>
    );
  }

  return (
    <a
      href={preview?.url || url}
      target="_blank"
      rel="noopener noreferrer nofollow"
      onClick={(e) => e.stopPropagation()}
      className={cn(
        'mx-4 mb-3 block overflow-hidden rounded-xl border border-line',
        'transition-colors hover:bg-surface-2'
      )}
    >
      {hero && (
        <span className="relative block">
          <img
            src={preview.image}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setHeroBroken(true)}
            className="aspect-[1.91/1] w-full bg-surface-3 object-cover"
          />
          {preview.type === 'video' && (
            <span className="absolute inset-0 grid place-items-center">
              <span className="grid h-14 w-14 place-items-center rounded-full bg-black/55 backdrop-blur-[2px]">
                <Play size={24} className="ml-0.5 fill-white text-white" strokeWidth={0} />
              </span>
            </span>
          )}
        </span>
      )}

      <span className="flex items-start gap-2.5 px-3.5 py-3">
        <Favicon src={preview?.favicon} fallback={originFavicon(url)} />

        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1 text-[11.5px] font-medium uppercase tracking-wide text-ink-faint">
            <span className="truncate">{preview?.siteName || host}</span>
            <ExternalLink size={11} className="shrink-0" />
          </span>

          {rich ? (
            <>
              {preview.title && (
                <span className="mt-1 line-clamp-2 block text-[14.5px] font-semibold leading-snug">
                  {preview.title}
                </span>
              )}
              {preview.description && (
                <span className="mt-1 line-clamp-2 block text-[13px] leading-snug text-ink-muted">
                  {preview.description}
                </span>
              )}
            </>
          ) : (
            /* Nothing resolved — the site refuses crawlers, or has no tags.
               Show the link itself rather than an empty card; the favicon and
               host still make it recognisable at a glance. */
            <span className="mt-1 line-clamp-1 block break-all text-[13px] leading-snug text-ink-muted">
              {trimUrl(preview?.url || url)}
            </span>
          )}
        </span>
      </span>
    </a>
  );
}
