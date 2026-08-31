'use client';

import { motion } from 'framer-motion';
import { Heart, MessageCircle, Repeat2, Send, Bookmark, Eye } from 'lucide-react';
import { cn } from '@/lib/utils';
import { countLabel } from '@/store/feed';

/**
 * The action row: like, comment, repost, share, save.
 *
 * Save sits apart on the right, the way both references do it, because it is
 * the one action that is nobody's business but yours — the other four are
 * conversation, and grouping them says so.
 *
 * Counts sit beside their own icon rather than in a separate line of totals.
 * A row of five numbers under a post reads as a scoreboard; a number next to
 * the thing it counts reads as information.
 */
export function PostActions({
  post,
  onLike,
  onComment,
  onRepost,
  onShare,
  onSave,
  compact = false,
}) {
  const size = compact ? 19 : 21;

  return (
    <div className="flex items-center justify-between">
      <div className={cn('flex items-center', compact ? 'gap-1' : 'gap-0.5')}>
        <Action
          icon={Heart}
          label={post.liked ? 'Unlike' : 'Like'}
          count={post.likeCount}
          active={post.liked}
          activeClass="text-danger"
          filled={post.liked}
          size={size}
          onClick={onLike}
          bounce
        />
        <Action
          icon={MessageCircle}
          label="Comment"
          count={post.commentCount}
          size={size}
          onClick={onComment}
          disabled={post.commentsDisabled}
        />
        <Action
          icon={Repeat2}
          label={post.reposted ? 'Undo repost' : 'Repost'}
          count={post.repostCount}
          active={post.reposted}
          activeClass="text-wa-500"
          size={size + 1}
          onClick={onRepost}
        />
        <Action
          icon={Send}
          label="Share"
          count={compact ? null : post.shareCount}
          size={size - 1}
          onClick={onShare}
        />

        {/* Not a button — nobody can act on a view, and a control that does
            nothing when tapped is worse than a number that never looked like
            one. Sits with the rest because that is where the eye already is. */}
        {post.viewCount > 0 && (
          <span
            title={countLabel(post.viewCount) + ' viewed this'}
            className="flex select-none items-center gap-1.5 py-1.5 pl-2 pr-2.5 text-ink-muted"
          >
            <Eye size={size - 2} strokeWidth={1.85} />
            <span className="text-[13px] font-medium tabular-nums leading-none">
              {countLabel(post.viewCount)}
            </span>
          </span>
        )}
      </div>

      <Action
        icon={Bookmark}
        label={post.saved ? 'Remove from saved' : 'Save'}
        active={post.saved}
        activeClass="text-ink"
        filled={post.saved}
        size={size}
        onClick={onSave}
      />
    </div>
  );
}

function Action({
  icon: Icon,
  label,
  count,
  active,
  activeClass = 'text-ink',
  filled,
  size = 21,
  onClick,
  disabled,
  bounce,
}) {
  const showCount = count !== null && count !== undefined && count > 0;

  return (
    <motion.button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      whileTap={disabled ? undefined : { scale: 0.86 }}
      transition={{ type: 'spring', stiffness: 600, damping: 22 }}
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onClick?.();
      }}
      className={cn(
        'group flex items-center gap-1.5 rounded-full py-1.5 pl-2 pr-2.5 transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-35',
        active ? activeClass : 'text-ink-muted hover:text-ink',
        !disabled && 'hover:bg-black/[.045] dark:hover:bg-white/[.06]'
      )}
    >
      {/* The heart gets its own spring on the icon so a like has a physical
          snap to it, rather than only the button scaling. */}
      <motion.span
        key={String(active)}
        initial={bounce && active ? { scale: 0.6 } : false}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 700, damping: 15 }}
        className="grid place-items-center"
      >
        <Icon
          size={size}
          strokeWidth={active ? 2.1 : 1.85}
          fill={filled ? 'currentColor' : 'none'}
        />
      </motion.span>

      {showCount && (
        <span className="text-[13px] font-medium tabular-nums leading-none">
          {countLabel(count)}
        </span>
      )}
    </motion.button>
  );
}
