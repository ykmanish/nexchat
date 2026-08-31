'use client';

import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { Heart, MessageCircle, Images, Play, Type } from 'lucide-react';
import { mediaUrl } from '@/lib/api';
import { countLabel } from '@/store/feed';
import { cn } from '@/lib/utils';

/**
 * The square grid — Explore, and a profile's posts.
 *
 * Text-only posts get a tile too, rendered as the words themselves rather than
 * being dropped from the grid. Half of a fused feed has no picture in it, and a
 * grid that silently skips those posts makes a profile look empty.
 */
export function PostGrid({ posts = [], className }) {
  const router = useRouter();

  return (
    <div className={cn('grid grid-cols-3 gap-0.5 sm:gap-1', className)}>
      {posts.map((post, i) => (
        <Tile key={post._id} post={post} index={i} onOpen={() => router.push('/feed/' + post._id)} />
      ))}
    </div>
  );
}

function Tile({ post, index, onOpen }) {
  const body = post.repostOf && !post.text ? post.repostOf : post;
  const cover = body.media?.[0];
  const many = (body.media?.length || 0) > 1;

  return (
    <motion.button
      type="button"
      initial={index < 12 ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      onClick={onOpen}
      className="group relative aspect-square overflow-hidden bg-surface-2 sm:rounded-md"
    >
      {cover ? (
        <>
          {cover.placeholder && (
            <img
              src={cover.placeholder}
              alt=""
              aria-hidden
              className="absolute inset-0 h-full w-full scale-110 object-cover blur-lg"
            />
          )}
          <img
            src={mediaUrl(cover.thumbnail || cover.url)}
            alt={cover.alt || ''}
            loading="lazy"
            decoding="async"
            className="relative h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
          />
        </>
      ) : (
        /* No picture — show the words. */
        <span className="flex h-full w-full flex-col justify-between p-2.5 text-left sm:p-3">
          <Type size={14} className="shrink-0 text-ink-faint" />
          <span className="line-clamp-4 text-[11.5px] font-medium leading-snug text-ink-soft sm:text-[12.5px]">
            {body.text}
          </span>
        </span>
      )}

      {/* Corner marks for a carousel or a video, the way both references do it. */}
      {(many || cover?.kind === 'video') && (
        <span className="absolute right-1.5 top-1.5 text-white drop-shadow-[0_1px_3px_rgba(0,0,0,.6)]">
          {cover?.kind === 'video' ? (
            <Play size={14} fill="currentColor" strokeWidth={0} />
          ) : (
            <Images size={14} strokeWidth={2.2} />
          )}
        </span>
      )}

      {/* Counts on hover, desktop only — on touch there is nothing to hover. */}
      <span className="absolute inset-0 hidden items-center justify-center gap-4 bg-black/45 opacity-0 transition-opacity duration-200 group-hover:opacity-100 md:flex">
        <span className="flex items-center gap-1.5 text-[13px] font-semibold text-white">
          <Heart size={15} fill="currentColor" strokeWidth={0} />
          {countLabel(body.likeCount ?? 0) || 0}
        </span>
        <span className="flex items-center gap-1.5 text-[13px] font-semibold text-white">
          <MessageCircle size={15} fill="currentColor" strokeWidth={0} />
          {countLabel(body.commentCount ?? 0) || 0}
        </span>
      </span>
    </motion.button>
  );
}
