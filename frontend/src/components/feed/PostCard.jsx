'use client';

import { memo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { MoreHorizontal, Globe, Users, Lock, Repeat2, MapPin, Pin } from 'lucide-react';
import { Avatar } from '@/components/ui/Avatar';
import { useFeed, countLabel } from '@/store/feed';
import { mediaUrl } from '@/lib/api';
import { useUI } from '@/store/ui';
import { feedTime } from '@/lib/feedtext';
import { cn } from '@/lib/utils';
import { PostMedia } from './PostMedia';
import { PostText } from './PostText';
import { PostActions } from './PostActions';
import { FollowButton } from './FollowButton';

const AUDIENCE = {
  public: { icon: Globe, label: 'Everyone' },
  followers: { icon: Users, label: 'Followers' },
  contacts: { icon: Lock, label: 'Contacts' },
};

/**
 * One post.
 *
 * A fusion of the two shapes deliberately, rather than a compromise between
 * them: a post with pictures is laid out like Instagram — media first, edge to
 * edge, caption underneath — and a post that is only words is laid out like
 * Twitter, with the text as the headline and the avatar beside it. The card
 * decides which it is from its own content, so a feed of both reads naturally
 * instead of forcing every post into one mould.
 *
 * Memoised on the fields that actually change. A feed re-renders on every like
 * anywhere in it, and without this every card in the list re-renders to update
 * one heart.
 */
export const PostCard = memo(function PostCard({ post, priority = false, onOpenPost }) {
  const router = useRouter();
  const openSheet = useUI((s) => s.openSheet);
  const openLightbox = useUI((s) => s.openLightbox);

  const toggleLike = useFeed((s) => s.toggleLike);
  const toggleSave = useFeed((s) => s.toggleSave);

  const original = post.repostOf || post;
  const isBoost = !!post.repostOf && !post.text;
  const isQuote = !!post.repostOf && !!post.text;
  const body = isBoost ? original : post;
  const media = body.media || [];
  const hasMedia = media.length > 0;

  const openAuthor = useCallback(
    (e) => {
      e?.stopPropagation();
      router.push('/u/' + body.author?._id);
    },
    [router, body.author?._id]
  );

  const openPost = useCallback(() => {
    if (onOpenPost) onOpenPost(body._id);
    else router.push('/feed/' + body._id);
  }, [onOpenPost, router, body._id]);

  /* Like on the *original* when this is a plain boost — hearting a repost is
     a heart for the thing that was reposted, not for the act of reposting. */
  const like = useCallback(() => toggleLike(body._id), [toggleLike, body._id]);

  const Audience = AUDIENCE[body.audience]?.icon || Globe;

  return (
    <motion.article
      initial={priority ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
      className="list-row border-b border-line bg-surface transition-colors sm:rounded-2xl sm:border"
    >
      {(isBoost || post.pinned) && (
        <div className="flex items-center gap-2 px-4 pb-1 pt-3 text-[12.5px] font-medium text-ink-muted">
          {post.pinned ? (
            <>
              <Pin size={13.5} strokeWidth={2.2} />
              <span>Pinned</span>
            </>
          ) : (
            <>
              <Repeat2 size={15} strokeWidth={2.2} />
              <button type="button" onClick={openAuthorOf(router, post)} className="hover:underline">
                {post.author?.isMe ? 'You' : post.author?.name} reposted
              </button>
            </>
          )}
        </div>
      )}

      {/* ── who ── */}
      <header className="flex items-center gap-3 px-4 pb-2.5 pt-3">
        <button type="button" onClick={openAuthor} className="shrink-0">
          <Avatar
            src={body.author?.avatar}
            name={body.author?.name}
            color={body.author?.avatarColor}
            size="sm"
          />
        </button>

        <div className="min-w-0 flex-1 leading-tight">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={openAuthor}
              className="truncate text-[14.5px] font-semibold hover:underline"
            >
              {body.author?.name}
            </button>
            {body.author?.username && (
              <span className="hidden truncate text-[13px] text-ink-faint xs:inline">
                @{body.author.username}
              </span>
            )}
            <span className="text-ink-faint">·</span>
            <button
              type="button"
              onClick={openPost}
              className="shrink-0 text-[13px] text-ink-faint hover:underline"
            >
              {feedTime(body.createdAt)}
            </button>
          </div>

          <div className="mt-0.5 flex items-center gap-1.5 text-[12px] text-ink-faint">
            <Audience size={11.5} strokeWidth={2} />
            <span>{AUDIENCE[body.audience]?.label || 'Everyone'}</span>
            {body.location && (
              <>
                <span>·</span>
                <MapPin size={11.5} strokeWidth={2} />
                <span className="truncate">{body.location}</span>
              </>
            )}
            {body.editedAt && (
              <>
                <span>·</span>
                <span>edited</span>
              </>
            )}
          </div>
        </div>

        {!body.author?.isMe && !body.author?.isFollowing && (
          <FollowButton
            userId={body.author?._id}
            isFollowing={body.author?.isFollowing}
            className="hidden shrink-0 sm:inline-flex"
          />
        )}

        <button
          type="button"
          aria-label="Post options"
          onClick={(e) => {
            e.stopPropagation();
            openSheet('postOptions', { post: body });
          }}
          className="-mr-1.5 grid h-9 w-9 shrink-0 place-items-center rounded-full text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink"
        >
          <MoreHorizontal size={19} />
        </button>
      </header>

      {/* ── what ──
          The words come first whether or not there is a picture under them.
          Instagram puts the caption below the photo, which reads as a footnote
          to the image; here a post is one thing you wrote, so it is laid out
          top to bottom in the order you wrote it. */}
      {!isQuote && body.text && (
        <div className="px-4 pb-3">
          <PostText
            text={body.text}
            size={!hasMedia && body.text.length < 90 ? 'lg' : 'md'}
            clamp={hasMedia ? 280 : 420}
          />
        </div>
      )}

      {/* A quote's own words sit above the card it quotes. `body` is the
          wrapper here, not the original, so this is the same text the branch
          above would have rendered — hence the exclusion there. */}
      {isQuote && (
        <div className="px-4 pb-3">
          <PostText text={post.text} clamp={280} />
        </div>
      )}

      {hasMedia && (
        <PostMedia
          media={media}
          liked={body.liked}
          onDoubleTapLike={() => {
            if (!body.liked) like();
          }}
          /* The chat lightbox already does everything a viewer needs — swipe,
             arrows, keyboard, download. It expects to decrypt what it is given,
             but it treats `previewUrl` as an already-usable URL and skips
             straight to ready, which is exactly what plaintext feed media is.
             One viewer, not two. */
          onOpen={(index) =>
            openLightbox(
              media.map((m) => ({
                previewUrl: mediaUrl(m.url),
                kind: m.kind === 'video' ? 'video' : 'image',
                name: 'chax-post',
                width: m.width,
                height: m.height,
              })),
              index
            )
          }
        />
      )}

      {/* A quoted post renders as a card inside this one, which is what makes a
          quote legible as commentary rather than as a duplicate. */}
      {isQuote && <QuotedPost post={post.repostOf} />}

      {/* ── actions ── */}
      <div className="px-2.5 pb-1 pt-2">
        <PostActions
          post={body}
          onLike={like}
          onComment={() => openSheet('comments', { postId: body._id })}
          onRepost={() => openSheet('repost', { post: body })}
          onShare={() => openSheet('sharePost', { post: body })}
          onSave={() => toggleSave(body._id)}
        />
      </div>

      {/* ── the tail ── */}
      <div className="space-y-1 px-4 pb-3.5">
        {body.likeCount > 0 && (
          <button
            type="button"
            onClick={() => openSheet('postLikes', { postId: body._id })}
            className="text-[13.5px] font-semibold hover:underline"
          >
            {countLabel(body.likeCount)} {body.likeCount === 1 ? 'like' : 'likes'}
          </button>
        )}

        {body.commentCount > 0 && !body.commentsDisabled && (
          <button
            type="button"
            onClick={() => openSheet('comments', { postId: body._id })}
            className="block text-[13.5px] text-ink-faint transition-colors hover:text-ink-muted"
          >
            View {body.commentCount === 1 ? 'the comment' : 'all ' + countLabel(body.commentCount) + ' comments'}
          </button>
        )}

        {body.commentsDisabled && (
          <p className="text-[12.5px] text-ink-faint">Comments are turned off</p>
        )}
      </div>
    </motion.article>
  );
},
/* Re-render only when something this card actually draws has changed.
   The signature has to cover the quoted post as well as the wrapper: a boost
   renders the original's numbers, so comparing only the wrapper's fields
   froze a reposted card at whatever counts it was first given. */
(prev, next) => prev.post === next.post || signature(prev.post) === signature(next.post));

const fields = (post) =>
  post
    ? [
        post._id,
        post.text,
        post.liked,
        post.saved,
        post.reposted,
        post.likeCount,
        post.commentCount,
        post.repostCount,
        post.shareCount,
        post.commentsDisabled,
        post.hideCounts,
        post.pinned,
        post.audience,
        post.editedAt,
        post.deleted,
        post.media?.length,
        post.author?.isFollowing,
      ].join('|')
    : '';

const signature = (post) => fields(post) + '::' + fields(post.repostOf);

/** The "X reposted" byline needs the booster, not the original author. */
const openAuthorOf = (router, post) => (e) => {
  e.stopPropagation();
  router.push('/u/' + post.author?._id);
};

/** A quoted post, rendered inside the one that quotes it. */
function QuotedPost({ post }) {
  const router = useRouter();
  if (!post) return null;

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        router.push('/feed/' + post._id);
      }}
      className="mx-4 mb-1 block w-[calc(100%-2rem)] overflow-hidden rounded-xl border border-line text-left transition-colors hover:bg-surface-2"
    >
      <div className="flex items-center gap-2 px-3 pt-2.5">
        <Avatar
          src={post.author?.avatar}
          name={post.author?.name}
          color={post.author?.avatarColor}
          size="xs"
        />
        <span className="truncate text-[13.5px] font-semibold">{post.author?.name}</span>
        {post.author?.username && (
          <span className="truncate text-[12.5px] text-ink-faint">@{post.author.username}</span>
        )}
        <span className="text-ink-faint">·</span>
        <span className="shrink-0 text-[12.5px] text-ink-faint">{feedTime(post.createdAt)}</span>
      </div>

      {post.deleted ? (
        <p className="px-3 py-3 text-[13.5px] italic text-ink-faint">
          This post is no longer available.
        </p>
      ) : (
        <>
          {post.text && (
            <p className="line-clamp-3 px-3 py-2 text-[13.5px] leading-relaxed text-ink-soft">
              {post.text}
            </p>
          )}
          {post.media?.length > 0 && (
            <PostMedia media={post.media} className={cn('mb-0', !post.text && 'mt-2')} />
          )}
        </>
      )}
    </button>
  );
}
