'use client';

import { create } from 'zustand';
import { api } from '@/lib/api';
import { feedback } from '@/lib/sound';
import { toast } from '@/store/ui';

/**
 * The feed store.
 *
 * Posts live in one map keyed by id, and every list — home, explore, a
 * profile grid, saved — is an array of ids into it. That matters more here
 * than anywhere else in the app: the same post is routinely on screen twice
 * at once (in the timeline and open in its detail view), and two copies of it
 * means a heart that fills in one place and not the other.
 *
 * Every action here is optimistic and self-reverting. A like has to land on
 * the frame you tapped it, so the store moves first and the request catches
 * up; if the request fails, the exact fields that were touched go back to
 * what they were rather than the whole post being refetched.
 */

const emptyList = () => ({ ids: [], cursor: null, hasMore: true, loading: false, error: null });

/* One frozen instance for selectors to fall back on.
   A selector must return the same reference for the same state or React's
   store subscription decides the snapshot changed on every render and warns
   about an infinite loop — which is what a fresh `emptyList()` per call did on
   any list that had not been created yet, a profile grid on first paint being
   the obvious one. */
const EMPTY_LIST = Object.freeze(emptyList());

/* Posts this tab has already reported a view for. Deliberately module-level
   rather than store state: it is bookkeeping about requests, not something any
   component renders, and putting it in the store would re-render the feed
   every time a card scrolled past. */
const seenThisSession = new Set();

/* How long a list or a sidebar panel is treated as good enough to show without
   asking again. Returning to a tab you left ten seconds ago should be instant
   and silent; coming back after a couple of minutes should quietly catch up. */
const STALE_MS = 90_000;
const fetchedAt = new Map();

const isFresh = (key) => Date.now() - (fetchedAt.get(key) || 0) < STALE_MS;
const markFetched = (key) => fetchedAt.set(key, Date.now());

export const useFeed = create((set, get) => ({
  posts: {}, // id -> post
  lists: {
    home: emptyList(),
    explore: emptyList(),
    saved: emptyList(),
  },
  /** True when the home feed is showing strangers because you follow nobody. */
  discover: false,

  comments: {}, // postId -> { items, cursor, hasMore, loading }
  profiles: {}, // userId -> profile
  suggestions: [],
  trending: [],

  /* ────────────────────────────── reading ────────────────────────────── */

  mergePosts(incoming) {
    set((s) => {
      const posts = { ...s.posts };
      incoming.forEach((p) => {
        if (!p?._id) return;
        // A repost carries the original inline; store both so either can update.
        if (p.repostOf?._id) posts[p.repostOf._id] = { ...posts[p.repostOf._id], ...p.repostOf };
        posts[p._id] = { ...posts[p._id], ...p };
      });
      return { posts };
    });
  },

  /**
   * Loads one page of a list.
   *
   * `refresh` starts from the top and replaces the ids; otherwise the cursor
   * is followed and the page is appended. Ids are de-duplicated on append
   * because a socket can insert a post at the top between two pages.
   */
  async loadList(key, { refresh = false, params = {}, force = false } = {}) {
    const list = get().lists[key] || EMPTY_LIST;
    if (list.loading) return;
    if (!refresh && !list.hasMore) return;

    /* Already have this, and it is recent — leave it alone. This is the whole
       difference between a tab that reappears and a tab that reloads. */
    const cacheKey = key + JSON.stringify(params);
    if (refresh && !force && list.ids.length && isFresh(cacheKey)) return;

    set((s) => ({
      lists: {
        ...s.lists,
        /* Only claim to be loading when there is nothing to show. With rows
           already on screen this is a background refresh, and flipping the
           flag would swap them for a skeleton for no reason. */
        [key]: { ...list, loading: list.ids.length ? list.loading : true, error: null },
      },
    }));

    const paths = { home: '/posts/feed', explore: '/posts/explore', saved: '/posts/saved' };

    try {
      const { data } = await api.get(paths[key] || paths.home, {
        params: { ...params, ...(refresh ? {} : { cursor: list.cursor || undefined }) },
      });

      get().mergePosts(data.posts || []);
      markFetched(cacheKey);

      set((s) => {
        const current = s.lists[key] || EMPTY_LIST;
        const incoming = (data.posts || []).map((p) => p._id);
        const ids = refresh
          ? incoming
          : [...current.ids, ...incoming.filter((id) => !current.ids.includes(id))];

        return {
          discover: key === 'home' ? !!data.discover : s.discover,
          lists: {
            ...s.lists,
            [key]: {
              ids,
              cursor: data.nextCursor,
              hasMore: !!data.nextCursor,
              loading: false,
              error: null,
            },
          },
        };
      });
    } catch (err) {
      set((s) => ({
        lists: {
          ...s.lists,
          [key]: { ...(s.lists[key] || EMPTY_LIST), loading: false, error: err.message },
        },
      }));
    }
  },

  async loadPost(id) {
    const { data } = await api.get('/posts/' + id);
    get().mergePosts([data.post]);
    return data.post;
  },

  /**
   * A post by permalink, which may be being read by nobody in particular.
   *
   * The `/shared` route answers for a signed-in reader and a stranger alike —
   * with the viewer's own likes and saves for the first, and a stripped public
   * shape for the second — so the permalink page has one path through it
   * rather than a branch at the top.
   */
  async loadSharedPost(id) {
    const { data } = await api.get('/posts/' + id + '/shared');
    get().mergePosts([data.post]);
    return data;
  },

  async loadProfile(userId, { refresh = false } = {}) {
    const key = 'profile:' + userId;
    const list = get().lists[key] || EMPTY_LIST;
    if (list.loading) return null;
    if (!refresh && !list.hasMore && list.ids.length) return get().profiles[userId];

    set((s) => ({ lists: { ...s.lists, [key]: { ...list, loading: true } } }));

    try {
      const { data } = await api.get('/posts/user/' + userId, {
        params: refresh ? {} : { cursor: list.cursor || undefined },
      });

      get().mergePosts(data.posts || []);

      set((s) => {
        const current = s.lists[key] || EMPTY_LIST;
        const incoming = (data.posts || []).map((p) => p._id);
        return {
          profiles: { ...s.profiles, [userId]: data.profile },
          lists: {
            ...s.lists,
            [key]: {
              ids: refresh
                ? incoming
                : [...current.ids, ...incoming.filter((id) => !current.ids.includes(id))],
              cursor: data.nextCursor,
              hasMore: !!data.nextCursor,
              loading: false,
              error: null,
            },
          },
        };
      });
      return data.profile;
    } catch (err) {
      set((s) => ({
        lists: {
          ...s.lists,
          [key]: { ...(s.lists[key] || EMPTY_LIST), loading: false, error: err.message },
        },
      }));
      return null;
    }
  },

  /* ────────────────────────────── writing ────────────────────────────── */

  async createPost(payload) {
    const { data } = await api.post('/posts', payload);
    get().mergePosts([data.post]);

    // Straight to the top of the home feed, where the author expects it.
    set((s) => ({
      lists: {
        ...s.lists,
        home: {
          ...s.lists.home,
          ids: [data.post._id, ...s.lists.home.ids.filter((id) => id !== data.post._id)],
        },
      },
    }));
    return data.post;
  },

  async updatePost(id, patch) {
    const { data } = await api.patch('/posts/' + id, patch);
    get().mergePosts([data.post]);
    return data.post;
  },

  async deletePost(id) {
    await api.delete('/posts/' + id);
    set((s) => {
      const posts = { ...s.posts };
      delete posts[id];
      const lists = Object.fromEntries(
        Object.entries(s.lists).map(([key, list]) => [
          key,
          { ...list, ids: list.ids.filter((postId) => postId !== id) },
        ])
      );
      return { posts, lists };
    });
  },

  /**
   * Applies a patch to one post without disturbing anything else in the map.
   *
   * A repost carries its own inline snapshot of what it points at, so the same
   * post can exist twice: once under its own id and once inside a wrapper. If
   * only the first is patched, the boost goes on showing the numbers it was
   * born with — a like registers on the original card and does nothing on the
   * repost of it three rows above. Both copies move together.
   */
  patchPost(id, patch) {
    set((s) => {
      if (!s.posts[id]) return {};

      const posts = { ...s.posts, [id]: { ...s.posts[id], ...patch } };
      for (const [key, post] of Object.entries(s.posts)) {
        if (post.repostOf?._id === id) {
          posts[key] = { ...post, repostOf: { ...post.repostOf, ...patch } };
        }
      }
      return { posts };
    });
  },

  /* ────────────────────────────── reactions ──────────────────────────────
     Optimistic, and each one remembers only the fields it changed so a failed
     request can put those back without clobbering anything that arrived in the
     meantime. */

  async toggleLike(id) {
    const post = get().posts[id];
    if (!post) return;

    const next = !post.liked;
    const before = { liked: post.liked, likeCount: post.likeCount };

    feedback(next ? 'react' : 'tap');
    get().patchPost(id, {
      liked: next,
      // A null count means the author hid it; leave it null rather than doing arithmetic on it.
      likeCount: post.likeCount === null ? null : Math.max(0, post.likeCount + (next ? 1 : -1)),
    });

    try {
      const { data } = await api[next ? 'post' : 'delete']('/posts/' + id + '/like');
      // Trust the server's count — two tabs can be liking the same post.
      if (typeof data.likeCount === 'number' && get().posts[id]?.likeCount !== null) {
        get().patchPost(id, { likeCount: data.likeCount });
      }
    } catch (err) {
      get().patchPost(id, before);
      toast.error(err.message);
    }
  },

  async toggleSave(id) {
    const post = get().posts[id];
    if (!post) return;

    const next = !post.saved;
    feedback(next ? 'success' : 'tap');
    get().patchPost(id, { saved: next });

    try {
      await api[next ? 'post' : 'delete']('/posts/' + id + '/save');
      // Dropping a save has to leave the Saved list too, or it lingers there.
      if (!next) {
        set((s) => ({
          lists: {
            ...s.lists,
            saved: { ...s.lists.saved, ids: s.lists.saved.ids.filter((postId) => postId !== id) },
          },
        }));
      }
    } catch (err) {
      get().patchPost(id, { saved: !next });
      toast.error(err.message);
    }
  },

  async toggleRepost(id, { quote = '' } = {}) {
    const post = get().posts[id];
    if (!post) return null;

    if (post.reposted && !quote) {
      get().patchPost(id, {
        reposted: false,
        repostCount: Math.max(0, (post.repostCount || 1) - 1),
      });
      try {
        await api.delete('/posts/' + id + '/repost');
      } catch (err) {
        get().patchPost(id, { reposted: true, repostCount: post.repostCount });
        toast.error(err.message);
      }
      return null;
    }

    try {
      const created = await get().createPost({ repostOf: id, text: quote });
      get().patchPost(id, { reposted: true, repostCount: (post.repostCount || 0) + 1 });
      feedback('success');
      return created;
    } catch (err) {
      toast.error(err.message);
      return null;
    }
  },

  /**
   * Records that this device has seen a post.
   *
   * Fired once per post per session — `seenThisSession` stops a card that
   * scrolls in and out of view a dozen times from sending a dozen requests.
   * The server counts once per person regardless; this just keeps the traffic
   * honest. Failures are ignored: a view is a nicety, and there is nothing the
   * reader could do about it.
   */
  markViewed(id) {
    if (!id || seenThisSession.has(id)) return;
    seenThisSession.add(id);
    api.post('/posts/' + id + '/view').catch(() => {});
  },

  /**
   * Counters pushed from the server because somebody, somewhere, acted.
   *
   * Only counts arrive — never `liked` or `saved`, which are answers about the
   * viewer and would otherwise be overwritten with a stranger's.
   */
  applyStats({ postId, ...counts }) {
    const known = Object.fromEntries(
      Object.entries(counts).filter(([, value]) => typeof value === 'number')
    );
    if (Object.keys(known).length) get().patchPost(postId, known);
  },

  /** Counted server-side; the copy or native share happens at the call site. */
  countShare(id) {
    const post = get().posts[id];
    if (post) get().patchPost(id, { shareCount: (post.shareCount || 0) + 1 });
    api.post('/posts/' + id + '/share').catch(() => {});
  },

  /* ────────────────────────────── comments ────────────────────────────── */

  async loadComments(postId, { refresh = false } = {}) {
    const thread = get().comments[postId] || { items: [], cursor: null, hasMore: true };
    if (thread.loading) return;
    if (!refresh && !thread.hasMore && thread.items.length) return;

    set((s) => ({
      comments: { ...s.comments, [postId]: { ...thread, loading: true } },
    }));

    try {
      const { data } = await api.get('/posts/' + postId + '/comments', {
        params: refresh ? {} : { cursor: thread.cursor || undefined },
      });

      set((s) => {
        const current = s.comments[postId] || { items: [] };
        const seen = new Set(refresh ? [] : current.items.map((c) => c._id));
        return {
          comments: {
            ...s.comments,
            [postId]: {
              items: refresh
                ? data.comments
                : [...current.items, ...data.comments.filter((c) => !seen.has(c._id))],
              cursor: data.nextCursor,
              hasMore: !!data.nextCursor,
              loading: false,
            },
          },
        };
      });
    } catch (err) {
      set((s) => ({
        comments: {
          ...s.comments,
          [postId]: { ...(s.comments[postId] || { items: [] }), loading: false },
        },
      }));
      toast.error(err.message);
    }
  },

  async addComment(postId, text, { parent = null } = {}) {
    const { data } = await api.post('/posts/' + postId + '/comments', { text, parent });
    const comment = data.comment;

    set((s) => {
      const thread = s.comments[postId] || { items: [], cursor: null, hasMore: false };
      const items = parent
        ? thread.items.map((c) =>
            c._id === comment.parent
              ? {
                  ...c,
                  replyCount: (c.replyCount || 0) + 1,
                  // The preview shows two; a third reply is behind "view replies".
                  replies: [...(c.replies || []), comment].slice(-2),
                }
              : c
          )
        : [comment, ...thread.items];

      return { comments: { ...s.comments, [postId]: { ...thread, items } } };
    });

    get().patchPost(postId, {
      commentCount: (get().posts[postId]?.commentCount || 0) + 1,
    });
    feedback('send');
    return comment;
  },

  async deleteComment(postId, commentId) {
    await api.delete('/posts/comments/' + commentId);

    set((s) => {
      const thread = s.comments[postId];
      if (!thread) return {};

      const top = thread.items.find((c) => c._id === commentId);
      let items;

      if (top) {
        /* A comment with replies survives as a tombstone — the server keeps the
           row for exactly that reason, so the thread under it still has a root. */
        items = top.replyCount
          ? thread.items.map((c) => (c._id === commentId ? { ...c, deleted: true, text: '' } : c))
          : thread.items.filter((c) => c._id !== commentId);
      } else {
        items = thread.items.map((c) => ({
          ...c,
          replies: (c.replies || []).filter((r) => r._id !== commentId),
          replyCount: (c.replies || []).some((r) => r._id === commentId)
            ? Math.max(0, (c.replyCount || 1) - 1)
            : c.replyCount,
        }));
      }

      return { comments: { ...s.comments, [postId]: { ...thread, items } } };
    });

    get().patchPost(postId, {
      commentCount: Math.max(0, (get().posts[postId]?.commentCount || 1) - 1),
    });
  },

  async toggleCommentLike(postId, commentId) {
    const thread = get().comments[postId];
    if (!thread) return;

    const find = (list) => list.find((c) => c._id === commentId);
    const target = find(thread.items) || thread.items.flatMap((c) => c.replies || []).find((r) => r._id === commentId);
    if (!target) return;

    const next = !target.liked;
    feedback(next ? 'react' : 'tap');

    const apply = (c) =>
      c._id === commentId
        ? { ...c, liked: next, likeCount: Math.max(0, (c.likeCount || 0) + (next ? 1 : -1)) }
        : { ...c, replies: (c.replies || []).map(apply) };

    set((s) => ({
      comments: {
        ...s.comments,
        [postId]: { ...s.comments[postId], items: s.comments[postId].items.map(apply) },
      },
    }));

    try {
      await api[next ? 'post' : 'delete']('/posts/comments/' + commentId + '/like');
    } catch (err) {
      const revert = (c) =>
        c._id === commentId
          ? { ...c, liked: target.liked, likeCount: target.likeCount }
          : { ...c, replies: (c.replies || []).map(revert) };
      set((s) => ({
        comments: {
          ...s.comments,
          [postId]: { ...s.comments[postId], items: s.comments[postId].items.map(revert) },
        },
      }));
      toast.error(err.message);
    }
  },

  async loadReplies(postId, commentId) {
    const { data } = await api.get('/posts/comments/' + commentId + '/replies');
    set((s) => {
      const thread = s.comments[postId];
      if (!thread) return {};
      return {
        comments: {
          ...s.comments,
          [postId]: {
            ...thread,
            items: thread.items.map((c) =>
              c._id === commentId ? { ...c, replies: data.replies, repliesExpanded: true } : c
            ),
          },
        },
      };
    });
  },

  /* ────────────────────────────── the graph ────────────────────────────── */

  /**
   * Follow or unfollow, everywhere at once.
   *
   * One person's `isFollowing` is stamped on every post they wrote, on their
   * profile, and on any suggestion card showing them — so tapping Follow in one
   * place has to move all of them, or the button flips back the moment you
   * scroll past a second post by the same author.
   */
  async toggleFollow(userId) {
    const { profiles, posts, suggestions } = get();
    const current =
      profiles[userId]?.isFollowing ??
      Object.values(posts).find((p) => p.author?._id === userId)?.author?.isFollowing ??
      suggestions.find((u) => u._id === userId)?.isFollowing ??
      false;

    const next = !current;
    feedback(next ? 'success' : 'tap');
    stampFollow(set, userId, next);

    try {
      const { data } = await api[next ? 'post' : 'delete']('/follows/' + userId);
      set((s) => ({
        profiles: s.profiles[userId]
          ? {
              ...s.profiles,
              [userId]: { ...s.profiles[userId], followerCount: data.followerCount },
            }
          : s.profiles,
      }));

      /* Following somebody changes what the home feed is, and an empty
         discover feed that stays empty after you follow someone reads as a
         broken button. */
      if (next) get().loadList('home', { refresh: true });
    } catch (err) {
      stampFollow(set, userId, current);
      toast.error(err.message);
    }
  },

  async loadSuggestions({ force = false } = {}) {
    if (!force && get().suggestions.length && isFresh('suggestions')) return;
    try {
      const { data } = await api.get('/follows/suggestions');
      set({ suggestions: data.users || [] });
      markFetched('suggestions');
    } catch {
      /* Suggestions are a nicety; a failure must not take the feed with it. */
    }
  },

  async loadTrending({ force = false } = {}) {
    if (!force && get().trending.length && isFresh('trending')) return;
    try {
      const { data } = await api.get('/posts/trending');
      set({ trending: data.tags || [] });
      markFetched('trending');
    } catch {
      /* as above */
    }
  },

  /* ────────────────────────────── realtime ────────────────────────────── */

  /** A post from somebody you follow, arriving while you are looking at the feed. */
  receivePost(post) {
    if (!post?._id || get().posts[post._id]) return;
    get().mergePosts([post]);
    set((s) => ({
      lists: { ...s.lists, home: { ...s.lists.home, ids: [post._id, ...s.lists.home.ids] } },
    }));
  },

  removePost(id) {
    set((s) => {
      if (!s.posts[id]) return {};
      const posts = { ...s.posts };
      delete posts[id];
      return {
        posts,
        lists: Object.fromEntries(
          Object.entries(s.lists).map(([key, list]) => [
            key,
            { ...list, ids: list.ids.filter((postId) => postId !== id) },
          ])
        ),
      };
    });
  },

  reset: () => {
    fetchedAt.clear();
    seenThisSession.clear();
    return set({
      posts: {},
      lists: { home: emptyList(), explore: emptyList(), saved: emptyList() },
      comments: {},
      profiles: {},
      suggestions: [],
      trending: [],
      discover: false,
    });
  },
}));

/* ────────────────────────────── helpers ────────────────────────────── */

/** Writes one person's follow state into every place it is shown. */
function stampFollow(set, userId, isFollowing) {
  set((s) => ({
    posts: Object.fromEntries(
      Object.entries(s.posts).map(([id, post]) => [
        id,
        post.author?._id === userId
          ? { ...post, author: { ...post.author, isFollowing } }
          : post,
      ])
    ),
    profiles: s.profiles[userId]
      ? { ...s.profiles, [userId]: { ...s.profiles[userId], isFollowing } }
      : s.profiles,
    suggestions: s.suggestions.map((u) => (u._id === userId ? { ...u, isFollowing } : u)),
  }));
}

/** Selector for a list, safe before its first load. */
export const selectList = (key) => (s) => s.lists[key] || EMPTY_LIST;

/** Compact engagement numbers: 1234 -> 1.2K, 1200000 -> 1.2M */
export function countLabel(n) {
  if (n === null || n === undefined) return '';
  if (n < 1000) return String(n);
  if (n < 1_000_000) return (n / 1000).toFixed(n % 1000 < 100 ? 0 : 1).replace(/\.0$/, '') + 'K';
  return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
}
