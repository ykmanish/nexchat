'use client';

import { useRouter } from 'next/navigation';
import {
  Info,
  BellOff,
  Bell,
  Pin,
  PinOff,
  Archive,
  ArchiveRestore,
  Trash2,
  Search,
  Brush,
  CheckCheck,
  Settings,
  MonitorSmartphone,
  Star,
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
            useChat.setState((s) => ({
              messages: { ...s.messages, [conversation._id]: [] },
            }));
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
