'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Archive,
  ArrowLeft,
  MessageSquarePlus,
  MonitorSmartphone,
  MoreVertical,
  Search,
  Settings,
  Siren,
  Star,
  Users,
  X,
} from 'lucide-react';
import { useChat } from '@/store/chat';
import { useAuth } from '@/store/auth';
import { useUI } from '@/store/ui';
import { cn } from '@/lib/utils';
import { feedback } from '@/lib/sound';
import { IconButton, Fab } from '@/components/ui/Button';
import { Dropdown } from '@/components/ui/Dropdown';
import { ChatRow, ChatRowSkeleton } from './ChatRow';
import { StoryRail } from './StoryRail';
import { EmptyState } from './EmptyState';
import { usePaneScroll } from '@/lib/usePaneScroll';

/* A stable identity, so "not searching" never counts as a change. */
const EMPTY_PLAIN = {};

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'unread', label: 'Unread' },
  { value: 'groups', label: 'Groups' },
];

export function ChatListPane() {
  /* The list comes back where it was left, like the feed does. */
  const { ref: listScroll } = usePaneScroll('chats');

  const router = useRouter();
  const params = useParams();
  const search = useSearchParams();
  const activeId = params?.id;
  const archivedView = search.get('archived') === '1';

  const conversations = useChat((s) => s.conversations);
  const loaded = useChat((s) => s.loaded);
  const showArchived = useChat((s) => s.showArchived);
  const loadConversations = useChat((s) => s.loadConversations);
  const user = useAuth((s) => s.user);
  const openSheet = useUI((s) => s.openSheet);

  /* Warm the thread route before anyone taps a row.
     `/chats/[id]` is a single route however many conversations there are, so
     fetching it once for the top of the list loads the code for all of them.
     Opening a chat then begins with the work instead of with a download. */
  const warmed = useRef(false);
  useEffect(() => {
    if (warmed.current || !conversations.length) return;
    warmed.current = true;
    router.prefetch('/chats/' + conversations[0]._id);
  }, [conversations, router]);

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [searching, setSearching] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuBtn = useRef(null);

  const archivedCount = useMemo(
    () => conversations.filter((c) => c.archived).length,
    [conversations]
  );

  /* Message text is only needed to search inside previews, so the subscription
     is taken only while there is something to search for. Selecting `plain`
     unconditionally meant every decrypted message produced a new identity and
     re-ran the filter over the whole list — forty times when opening a chat. */
  const searchingText = query.trim().length > 0;
  const plain = useChat((s) => (searchingText ? s.plain : EMPTY_PLAIN));

  /* One handler for every row, rather than a fresh closure per row per render.
     `ChatRow` is memoised and compares its props, so an inline arrow here would
     look like a changed prop on every single row and defeat the memo entirely —
     the row would still be doing the work the memo was added to avoid. */
  const openChat = useCallback(
    (id) => {
      feedback('select');
      router.push('/chats/' + id);
    },
    [router]
  );

  const visible = useMemo(() => {
    let list = conversations.filter((c) => !!c.archived === archivedView);

    if (filter === 'unread') list = list.filter((c) => c.unreadCount > 0);
    if (filter === 'groups') list = list.filter((c) => c.type !== 'direct');

    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter((c) => {
        if (c.name?.toLowerCase().includes(q)) return true;
        const preview = c.lastMessage ? plain[c.lastMessage._id]?.text : '';
        return preview?.toLowerCase().includes(q);
      });
    }
    return list;
  }, [conversations, filter, query, archivedView, plain]);

  /**
   * Warms the thread route for the chats most likely to be opened next.
   *
   * `/chats/[id]` is a dynamic segment, so the first tap on a chat pays for a
   * round trip that has nothing to do with the message data — the store already
   * holds everything needed to draw it. `router.push` does not prefetch (only
   * `<Link>` does), which is why opening a chat felt slower than it had any
   * right to. Prefetching the visible handful moves that cost to idle time.
   *
   * Bounded at ten and deferred to an idle callback: prefetching a list of two
   * hundred chats would spend more bandwidth than it saves, and doing it during
   * the same frame as the list appearing is exactly the wrong moment.
   *
   * Note that `router.prefetch` is a no-op under `next dev` — Next only
   * prefetches in production builds — so there is nothing to observe in the
   * network panel while developing. Check it against `next start`.
   */
  useEffect(() => {
    if (!visible.length) return undefined;

    const ids = visible.slice(0, 10).map((c) => c._id);
    const schedule =
      typeof window !== 'undefined' && window.requestIdleCallback
        ? window.requestIdleCallback
        : (fn) => setTimeout(fn, 300);
    const cancel =
      typeof window !== 'undefined' && window.cancelIdleCallback
        ? window.cancelIdleCallback
        : clearTimeout;

    const handle = schedule(() => {
      ids.forEach((id) => {
        try {
          router.prefetch('/chats/' + id);
        } catch {
          /* prefetching is an optimisation; failing at it changes nothing */
        }
      });
    });

    return () => cancel(handle);
    // Only the identity of the top slice matters, not every field on it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible.slice(0, 10).map((c) => c._id).join(','), router]);

  /* Archived chats live in the same collection, so reload when the view flips.
     The shell has already asked for the inbox by the time this mounts, so the
     first render skips the duplicate request — two identical fetches racing was
     one of the ways the list ended up empty. */
  useEffect(() => {
    if (loaded && showArchived === archivedView) return;
    loadConversations({ archived: archivedView }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [archivedView, loadConversations]);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col bg-surface">
      {/* ── header ── */}
      <header className="safe-top shrink-0 bg-surface">
        <div className="flex h-14 items-center gap-1 px-2 sm:px-4">
          {archivedView ? (
            <>
              <IconButton
                icon={ArrowLeft}
                label="Back"
                onClick={() => router.push('/chats')}
              />
              <h1 className="flex-1 font-display text-[20px] tracking-tight">Archived</h1>
            </>
          ) : (
            <>
              <h1 className="flex-1 px-2 font-display text-[24px] tracking-tight text-brand-strong">
                Chax
              </h1>
              <IconButton icon={Search} label="Search" onClick={() => setSearching(true)} />
              <IconButton
                ref={menuBtn}
                icon={MoreVertical}
                label="Menu"
                active={menuOpen}
                onClick={() => setMenuOpen((v) => !v)}
              />
            </>
          )}
        </div>

        {/* ── search field ── */}
        <div className="px-3 pb-2 sm:px-4">
          <AnimatePresence initial={false} mode="wait">
            <motion.div
              key={searching ? 'open' : 'closed'}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="flex h-10 items-center gap-3 rounded-full bg-surface-2 px-4"
            >
              {searching ? (
                <button type="button" onClick={() => { setQuery(''); setSearching(false); }}>
                  <ArrowLeft size={18} className="text-brand-strong" />
                </button>
              ) : (
                <Search size={17} className="text-ink-faint" />
              )}
              <input
                value={query}
                onFocus={() => setSearching(true)}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search or start a new chat"
                className="min-w-0 flex-1 bg-transparent text-[14.5px] outline-none placeholder:text-ink-faint"
              />
              {query && (
                <button type="button" onClick={() => setQuery('')} aria-label="Clear">
                  <X size={16} className="text-ink-faint" />
                </button>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* ── filter pills ── */}
        {!archivedView && (
          <div className="flex gap-2 px-3 pb-2 sm:px-4">
            {FILTERS.map((f) => {
              const isActive = filter === f.value;
              const count =
                f.value === 'unread'
                  ? conversations.filter((c) => !c.archived && c.unreadCount > 0).length
                  : 0;
              return (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => {
                    feedback('select');
                    setFilter(f.value);
                  }}
                  className={cn(
                    'rounded-full px-3.5 py-1.5 text-[13.5px] transition-colors',
                    isActive
                      ? 'bg-brand-tint font-medium text-brand-strong'
                      : 'bg-surface-2 text-ink-muted hover:bg-surface-3'
                  )}
                >
                  {f.label}
                  {count > 0 && f.value === 'unread' && ' ' + count}
                </button>
              );
            })}
          </div>
        )}
      </header>

      {/* ── stories ── */}
      {!archivedView && !searching && <StoryRail />}

      {/* ── archived shortcut ── */}
      {!archivedView && archivedCount > 0 && (
        <button
          type="button"
          onClick={() => {
            feedback('select');
            router.push('/chats?archived=1');
          }}
          className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-3 text-left transition-colors hover:bg-surface-2"
        >
          <Archive size={20} className="text-ink-muted" />
          <span className="flex-1 text-[15px]">Archived</span>
          <span className="text-[13px] font-medium text-ink-faint">{archivedCount}</span>
        </button>
      )}

      {/* ── the list ── */}
      <div
        ref={listScroll}
        className="scroll-soft scroll-layer min-h-0 flex-1 overflow-y-auto overscroll-contain"
      >
        {!loaded ? (
          <div>
            {Array.from({ length: 8 }).map((_, i) => (
              <ChatRowSkeleton key={i} />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <EmptyState
            variant={query ? 'search' : archivedView ? 'archive' : 'chats'}
            query={query}
            onAction={() => openSheet('new')}
          />
        ) : (
          <AnimatePresence initial={false}>
            {visible.map((conversation, i) => (
              <ChatRow
                key={conversation._id}
                conversation={conversation}
                active={conversation._id === activeId}
                currentUserId={user?._id}
                showDivider={i < visible.length - 1}
                onOpen={openChat}
              />
            ))}
          </AnimatePresence>
        )}

        <div className="h-24" />
      </div>

      <Dropdown
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        anchorRef={menuBtn}
        items={[
          { label: 'New group', icon: Users, onClick: () => openSheet('newGroup') },
          { label: 'New community', icon: Users, onClick: () => openSheet('newCommunity') },
          { divider: true },
          { label: 'Archived', icon: Archive, onClick: () => router.push('/chats?archived=1') },
          { label: 'Starred messages', icon: Star, onClick: () => router.push('/settings/starred') },
          {
            label: 'Linked devices',
            icon: MonitorSmartphone,
            onClick: () => router.push('/settings/devices'),
          },
          { divider: true },
          /* Below a divider and styled as destructive so it is never a
             mis-tap, but at top level rather than buried in Settings — a
             safety feature two screens deep is not a safety feature. */
          {
            label: 'Emergency share',
            icon: Siren,
            danger: true,
            onClick: () => openSheet('sos'),
          },
          { divider: true },
          { label: 'Settings', icon: Settings, onClick: () => router.push('/settings') },
        ]}
      />

      {/* ── new chat FAB ── */}
      {!archivedView && (
        <div className="pointer-events-none absolute bottom-0 right-0 z-20 p-4 pb-[calc(1rem+var(--safe-bottom))] lg:pb-4">
          <div className="pointer-events-auto">
            <Fab
              icon={MessageSquarePlus}
              label="New chat"
              onClick={() => openSheet('new')}
            />
          </div>
        </div>
      )}
    </div>
  );
}
