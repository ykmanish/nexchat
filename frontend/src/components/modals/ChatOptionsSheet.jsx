'use client';

import { useRouter } from 'next/navigation';
import {
  Archive,
  ArchiveRestore,
  AtSign,
  Bell,
  BellOff,
  Brush,
  CheckCheck,
  Info,
  MonitorSmartphone,
  Pin,
  PinOff,
  Search,
  Settings,
  Siren,
  Star,
  Trash2,
  Users,
} from 'lucide-react';
import { ActionSheet } from '@/components/ui/Sheet';
import { useChat } from '@/store/chat';
import { useUI, toast } from '@/store/ui';
import { api } from '@/lib/api';

/** Long-press / kebab menu on a single conversation. */
export function ChatOptionsSheet({ open, onClose, conversation: initial }) {
  const router = useRouter();
  const setConversationState = useChat((s) => s.setConversationState);
  const removeConversation = useChat((s) => s.removeConversation);
  const openSheet = useUI((s) => s.openSheet);
  const openSearch = useUI((s) => s.openSearch);

  // Live row, so the menu's labels flip with the state they control.
  const live = useChat((s) => s.conversations.find((c) => c._id === initial?._id));
  const conversation = live || initial;

  if (!conversation) return null;

  return (
    <ActionSheet
      open={open}
      onClose={onClose}
      title={conversation.name}
      actions={[
        {
          label: 'Chat info',
          icon: Info,
          onClick: () => openSheet('chatInfo', { conversation }),
        },
        {
          label: 'Search in chat',
          icon: Search,
          onClick: openSearch,
        },
        {
          label: conversation.muted ? 'Unmute' : 'Mute notifications',
          icon: conversation.muted ? Bell : BellOff,
          onClick: () => setConversationState(conversation._id, { muted: !conversation.muted }),
        },
        /* Only offered for groups, and only while muted — in a direct chat
           every message is addressed to you, so "mentions only" would just be
           a confusing way to spell "unmuted". */
        {
          label:
            conversation.muteMode === 'mentions'
              ? 'Notify for everything'
              : 'Only notify for @mentions',
          icon: AtSign,
          hidden: !conversation.muted || conversation.type === 'direct',
          onClick: () =>
            setConversationState(conversation._id, {
              muteMode: conversation.muteMode === 'mentions' ? 'all' : 'mentions',
            }),
        },
        {
          label: conversation.pinned ? 'Unpin chat' : 'Pin chat',
          icon: conversation.pinned ? PinOff : Pin,
          onClick: () => setConversationState(conversation._id, { pinned: !conversation.pinned }),
        },
        {
          label: conversation.archived ? 'Unarchive' : 'Archive',
          icon: conversation.archived ? ArchiveRestore : Archive,
          onClick: () =>
            setConversationState(conversation._id, { archived: !conversation.archived }),
        },
        {
          label: 'Mark as read',
          icon: CheckCheck,
          onClick: () => useChat.getState().markRead(conversation._id),
        },
        {
          label: 'Clear messages',
          icon: Brush,
          danger: true,
          onClick: async () => {
            await api.post('/conversations/' + conversation._id + '/clear').catch(() => {});
            await useChat.getState().clearLocalHistory(conversation._id);
            toast.success('Chat cleared');
          },
        },
        {
          label: 'Delete chat',
          icon: Trash2,
          danger: true,
          onClick: async () => {
            await api.delete('/conversations/' + conversation._id).catch(() => {});
            removeConversation(conversation._id);
            router.push('/chats');
            toast.success('Chat deleted');
          },
        },
      ]}
    />
  );
}

/** The "…" menu at the top of the chat list. */
export function ChatListMenuSheet({ open, onClose }) {
  const router = useRouter();
  const openSheet = useUI((s) => s.openSheet);
  const openSearch = useUI((s) => s.openSearch);
  const loadConversations = useChat((s) => s.loadConversations);

  return (
    <ActionSheet
      open={open}
      onClose={onClose}
      actions={[
        {
          label: 'New group',
          icon: Users,
          onClick: () => openSheet('newGroup'),
        },
        {
          label: 'Emergency share',
          icon: Siren,
          danger: true,
          onClick: () => openSheet('sos'),
        },
        {
          label: 'Archived chats',
          icon: Archive,
          onClick: () => loadConversations({ archived: true }),
        },
        {
          label: 'Starred messages',
          icon: Star,
          onClick: () => router.push('/settings/starred'),
        },
        {
          label: 'Linked devices',
          icon: MonitorSmartphone,
          onClick: () => router.push('/settings/devices'),
        },
        {
          label: 'Settings',
          icon: Settings,
          onClick: () => router.push('/settings'),
        },
      ]}
    />
  );
}
