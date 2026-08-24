'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
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

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'unread', label: 'Unread' },
  { value: 'groups', label: 'Groups' },
];

export function ChatListPane() {
  const router = useRouter();
  const params = useParams();
  const search = useSearchParams();
  const activeId = params?.id;
  const archivedView = search.get('archived') === '1';

  const conversations = useChat((s) => s.conversations);
  const loaded = useChat((s) => s.loaded);
  const plain = useChat((s) => s.plain);
  const loadConversations = useChat((s) => s.loadConversations);
  const user = useAuth((s) => s.user);
  const openSheet = useUI((s) => s.openSheet);

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [searching, setSearching] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuBtn = useRef(null);

  const archivedCount = useMemo(
    () => conversations.filter((c) => c.archived).length,
    [conversations]
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

  /* Archived chats live in the same collection, so reload when the view flips. */
  useEffect(() => {
    loadConversations({ archived: archivedView }).catch(() => {});
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
      <div className="scroll-soft min-h-0 flex-1 overflow-y-auto overscroll-contain">
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
                onOpen={() => {
                  feedback('select');
                  router.push('/chats/' + conversation._id);
                }}
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
