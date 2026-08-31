'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Link2,
  Send,
  Search,
  Repeat2,
  Quote,
  Trash2,
  Pencil,
  Pin,
  PinOff,
  EyeOff,
  Eye,
  MessageCircleOff,
  MessageCircle,
  Globe,
  Users,
  Lock,
  Flag,
  UserMinus,
  UserPlus,
  Loader2,
  Check,
} from 'lucide-react';
import { Sheet, ActionSheet, ConfirmDialog } from '@/components/ui/Sheet';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { useChat } from '@/store/chat';
import { useFeed, countLabel } from '@/store/feed';
import { useUI, toast } from '@/store/ui';
import { api } from '@/lib/api';
import { FollowButton } from '@/components/feed/FollowButton';
import { cn } from '@/lib/utils';
import { feedback } from '@/lib/sound';

const postUrl = (id) =>
  (typeof window === 'undefined' ? '' : window.location.origin) + '/feed/' + id;

/**
 * Sharing a post.
 *
 * The interesting option is the first one: send it into a Chax chat. The post
 * itself is public, but the act of sending somebody a link is a message, so it
 * travels as one — encrypted end to end like everything else in a thread. That
 * is the whole reason for a feed living inside a messenger rather than beside
 * one.
 */
export function SharePostSheet({ open, onClose, post }) {
  const conversations = useChat((s) => s.conversations);
  const sendMessage = useChat((s) => s.sendMessage);
  const countShare = useFeed((s) => s.countShare);

  const [query, setQuery] = useState('');
  const [sent, setSent] = useState([]);
  const [busy, setBusy] = useState(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setSent([]);
    }
  }, [open]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return conversations
      .filter((c) => !c.archived)
      .filter((c) => !q || (c.name || c.peer?.name || '').toLowerCase().includes(q))
      .slice(0, 40);
  }, [conversations, query]);

  const link = post ? postUrl(post._id) : '';

  async function sendTo(conversation) {
    setBusy(conversation._id);
    try {
      const label = post.author?.name ? post.author.name + ' on Chax' : 'A post on Chax';
      await sendMessage({
        conversationId: conversation._id,
        text: label + '\n' + link,
      });
      countShare(post._id);
      setSent((s) => [...s, conversation._id]);
      feedback('send');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(null);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      countShare(post._id);
      toast.success('Link copied');
    } catch {
      toast.error('Could not copy the link');
    }
  }

  async function nativeShare() {
    if (!navigator.share) return copy();
    try {
      await navigator.share({ title: 'Chax', text: post.text?.slice(0, 120) || '', url: link });
      countShare(post._id);
    } catch {
      /* The user dismissed the sheet — not an error worth reporting. */
    }
  }

  if (!post) return null;

  return (
    <Sheet open={open} onClose={onClose} title="Share" size="md">
      <div className="px-5 pb-3">
        <div className="flex gap-2">
          <Button variant="secondary" icon={Link2} size="sm" onClick={copy} className="flex-1">
            Copy link
          </Button>
          {typeof navigator !== 'undefined' && navigator.share && (
            <Button variant="secondary" icon={Send} size="sm" onClick={nativeShare} className="flex-1">
              Share to…
            </Button>
          )}
        </div>

        <label className="mt-4 flex items-center gap-2.5 rounded-xl bg-surface-2 px-3.5 py-2.5">
          <Search size={16} className="shrink-0 text-ink-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Send to a chat"
            className="min-w-0 flex-1 bg-transparent text-[14.5px] outline-none placeholder:text-ink-faint"
          />
        </label>
      </div>

      <div className="px-2 pb-2">
        {!shown.length && (
          <p className="px-5 py-8 text-center text-[13.5px] text-ink-muted">
            No chats to send this to yet.
          </p>
        )}

        {shown.map((conversation) => {
          const done = sent.includes(conversation._id);
          return (
            <div
              key={conversation._id}
              className="flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-surface-2"
            >
              <Avatar
                src={conversation.avatar || conversation.peer?.avatar}
                name={conversation.name || conversation.peer?.name}
                color={conversation.peer?.avatarColor}
                size="sm"
              />
              <span className="min-w-0 flex-1 truncate text-[14.5px] font-medium">
                {conversation.name || conversation.peer?.name || 'Chat'}
              </span>
              <Button
                size="xs"
                variant={done ? 'secondary' : 'primary'}
                disabled={done}
                loading={busy === conversation._id}
                icon={done ? Check : undefined}
                onClick={() => sendTo(conversation)}
              >
                {done ? 'Sent' : 'Send'}
              </Button>
            </div>
          );
        })}
      </div>
    </Sheet>
  );
}

/** Who liked a post. */
export function PostLikesSheet({ open, onClose, postId }) {
  const router = useRouter();
  const post = useFeed((s) => (postId ? s.posts[postId] : null));

  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !postId) return;
    setLoading(true);
    api
      .get('/posts/' + postId + '/likes')
      .then(({ data }) => setUsers(data.users || []))
      .catch(() => setUsers([]))
      .finally(() => setLoading(false));
  }, [open, postId]);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Likes"
      subtitle={post?.likeCount ? countLabel(post.likeCount) + ' people' : undefined}
      size="sm"
    >
      <div className="px-2 pb-3">
        {loading && (
          <div className="grid place-items-center py-12 text-ink-faint">
            <Loader2 size={20} className="animate-spin" />
          </div>
        )}

        {!loading && !users.length && (
          <p className="px-5 py-10 text-center text-[13.5px] text-ink-muted">No likes yet.</p>
        )}

        {users.map((person) => (
          <div
            key={person._id}
            className="flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-surface-2"
          >
            <button
              type="button"
              onClick={() => {
                onClose();
                router.push('/u/' + person._id);
              }}
              className="flex min-w-0 flex-1 items-center gap-3 text-left"
            >
              <Avatar
                src={person.avatar}
                name={person.name}
                color={person.avatarColor}
                size="sm"
              />
              <span className="min-w-0">
                <span className="block truncate text-[14.5px] font-semibold">{person.name}</span>
                {person.username && (
                  <span className="block truncate text-[12.5px] text-ink-faint">
                    @{person.username}
                  </span>
                )}
              </span>
            </button>

            {!person.isMe && (
              <FollowButton userId={person._id} isFollowing={person.isFollowing} size="xs" />
            )}
          </div>
        ))}
      </div>
    </Sheet>
  );
}

/** Repost, or quote it with your own words. */
export function RepostSheet({ open, onClose, post }) {
  const toggleRepost = useFeed((s) => s.toggleRepost);
  const openSheet = useUI((s) => s.openSheet);

  if (!post) return null;

  return (
    <ActionSheet
      open={open}
      onClose={onClose}
      title={post.reposted ? 'You reposted this' : undefined}
      actions={[
        {
          icon: Repeat2,
          label: post.reposted ? 'Undo repost' : 'Repost',
          sublabel: post.reposted
            ? 'Remove it from your profile'
            : 'Share it with your followers as-is',
          danger: post.reposted,
          onClick: () => toggleRepost(post._id),
        },
        {
          icon: Quote,
          label: 'Quote',
          sublabel: 'Add your own words above it',
          onClick: () => openSheet('newPost', { quoting: post }),
        },
      ]}
    />
  );
}

/**
 * The per-post menu.
 *
 * Two quite different menus behind one entry point, because "my post" and
 * "somebody else's post" have almost nothing in common: mine offers editing,
 * pinning and deletion; theirs offers following, reporting and a link.
 */
export function PostOptionsSheet({ open, onClose, post }) {
  const router = useRouter();
  const openSheet = useUI((s) => s.openSheet);
  const updatePost = useFeed((s) => s.updatePost);
  const deletePost = useFeed((s) => s.deletePost);
  const toggleFollow = useFeed((s) => s.toggleFollow);

  /* The post being confirmed for deletion is held here rather than read from
     the `post` prop, and that is the whole fix for a confusing bug: ActionSheet
     closes the sheet *before* it runs the chosen action, so by the time Delete
     fired, SheetHost had already cleared `post` back to undefined — the early
     return below then unmounted the dialog before it could ever appear. The
     `confirming` flag survived, so opening the menu again showed the dialog for
     a tap made a minute earlier. Capturing the post detaches the confirmation
     from the menu that opened it. */
  const [pending, setPending] = useState(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (open) setPending(null);
  }, [open]);

  const patch = async (body, message) => {
    if (!post) return;
    try {
      await updatePost(post._id, body);
      if (message) toast.success(message);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const AudienceIcon =
    { public: Globe, followers: Users, contacts: Lock }[post?.audience] || Globe;

  const menuFor = (item) => (item.isMine ? mine(item) : theirs(item));

  const mine = (item) => [
    {
      icon: Pencil,
      label: 'Edit post',
      onClick: () => openSheet('editPost', { post: item }),
    },
    {
      icon: item.pinned ? PinOff : Pin,
      label: item.pinned ? 'Unpin from profile' : 'Pin to profile',
      sublabel: item.pinned ? undefined : 'It sits at the top of your grid',
      onClick: () => patch({ pinned: !item.pinned }, item.pinned ? 'Unpinned' : 'Pinned'),
    },
    {
      icon: AudienceIcon,
      label: 'Change who can see it',
      sublabel: { public: 'Everyone', followers: 'Followers', contacts: 'Contacts' }[item.audience],
      onClick: () => openSheet('postAudience', { post: item }),
    },
    {
      icon: item.commentsDisabled ? MessageCircle : MessageCircleOff,
      label: item.commentsDisabled ? 'Turn commenting on' : 'Turn commenting off',
      onClick: () =>
        patch(
          { commentsDisabled: !item.commentsDisabled },
          item.commentsDisabled ? 'Comments are on' : 'Comments are off'
        ),
    },
    {
      icon: item.hideCounts ? Eye : EyeOff,
      label: item.hideCounts ? 'Show like counts' : 'Hide like counts',
      onClick: () => patch({ hideCounts: !item.hideCounts }),
    },
    {
      icon: Link2,
      label: 'Copy link',
      onClick: async () => {
        await navigator.clipboard.writeText(postUrl(item._id)).catch(() => {});
        toast.success('Link copied');
      },
    },
    {
      icon: Trash2,
      label: 'Delete post',
      danger: true,
      onClick: () => setPending(item),
    },
  ];

  const theirs = (item) => [
    {
      icon: item.author?.isFollowing ? UserMinus : UserPlus,
      label: (item.author?.isFollowing ? 'Unfollow ' : 'Follow ') + (item.author?.name || ''),
      danger: item.author?.isFollowing,
      onClick: () => toggleFollow(item.author._id),
    },
    {
      icon: Link2,
      label: 'Copy link',
      onClick: async () => {
        await navigator.clipboard.writeText(postUrl(item._id)).catch(() => {});
        toast.success('Link copied');
      },
    },
    {
      icon: Send,
      label: 'Share this post',
      onClick: () => openSheet('sharePost', { post: item }),
    },
    {
      icon: Flag,
      /* Routed into the safety flow that already exists for scam reports rather
         than inventing a second, parallel reporting system. */
      label: 'Report this account',
      danger: true,
      onClick: () => openSheet('reportScam', { user: item.author }),
    },
  ];

  return (
    <>
      {post && <ActionSheet open={open} onClose={onClose} actions={menuFor(post)} />}

      <ConfirmDialog
        open={!!pending}
        onClose={() => setPending(null)}
        title="Delete this post?"
        message="It disappears from your profile and from everyone's feed. Comments and likes go with it. This cannot be undone."
        confirmLabel="Delete"
        danger
        loading={deleting}
        onConfirm={async () => {
          if (!pending) return;
          setDeleting(true);
          try {
            await deletePost(pending._id);
            feedback('close');
            toast.success('Post deleted');
            setPending(null);
            // A permalink for a post that no longer exists is a dead end.
            if (window.location.pathname === '/feed/' + pending._id) router.replace('/feed');
          } catch (err) {
            toast.error(err.message);
          } finally {
            setDeleting(false);
          }
        }}
      />
    </>
  );
}

/** Editing a caption after the fact. The edit is stamped, never silent. */
export function EditPostSheet({ open, onClose, post }) {
  const updatePost = useFeed((s) => s.updatePost);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && post) setText(post.text || '');
  }, [open, post]);

  if (!post) return null;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Edit post"
      subtitle="Everyone will see that this post was edited."
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={saving}
            disabled={text === (post.text || '')}
            onClick={async () => {
              setSaving(true);
              try {
                await updatePost(post._id, { text });
                toast.success('Post updated');
                onClose();
              } catch (err) {
                toast.error(err.message);
              } finally {
                setSaving(false);
              }
            }}
          >
            Save
          </Button>
        </div>
      }
    >
      <div className="px-5 pb-4">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          maxLength={2200}
          className="selectable w-full resize-none rounded-xl bg-surface-2 p-3.5 text-[15px] leading-relaxed outline-none focus:ring-2 focus:ring-brand-tint"
        />
        <p className="mt-1.5 text-right text-[12px] tabular-nums text-ink-faint">
          {2200 - text.length} left
        </p>
      </div>
    </Sheet>
  );
}

/** Changing who can see a post that is already up. */
export function PostAudienceSheet({ open, onClose, post }) {
  const updatePost = useFeed((s) => s.updatePost);
  if (!post) return null;

  const choose = async (audience) => {
    try {
      await updatePost(post._id, { audience });
      toast.success('Audience updated');
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <ActionSheet
      open={open}
      onClose={onClose}
      title="Who can see this post"
      actions={[
        {
          icon: Globe,
          label: 'Everyone',
          sublabel: 'Anyone on Chax, and it can appear in Explore',
          onClick: () => choose('public'),
        },
        {
          icon: Users,
          label: 'Followers',
          sublabel: 'Only the people who follow you',
          onClick: () => choose('followers'),
        },
        {
          icon: Lock,
          label: 'Contacts',
          sublabel: 'Only the people you chat with',
          onClick: () => choose('contacts'),
        },
      ]}
    />
  );
}
