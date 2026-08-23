'use client';

import { useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  ChevronLeft,
  Phone,
  Video,
  MoreVertical,
  Search,
  Lock,
  Info,
  Bell,
  BellOff,
  Pin,
  PinOff,
  Archive,
  Brush,
  Trash2,
} from 'lucide-react';
import { Avatar } from '@/components/ui/Avatar';
import { IconButton } from '@/components/ui/Button';
import { Dropdown } from '@/components/ui/Dropdown';
import { useChat } from '@/store/chat';
import { useUI } from '@/store/ui';
import { lastSeenLabel, cn } from '@/lib/utils';
import { feedback } from '@/lib/sound';
import { emitAsync } from '@/lib/socket';

export function ThreadHeader({ conversation, onBack }) {
  const presence = useChat((s) => s.presence);
  const typing = useChat((s) => s.typing[conversation._id]);
  const openSheet = useUI((s) => s.openSheet);
  const setCall = useUI((s) => s.setCall);
  const openSearch = useUI((s) => s.openSearch);
  const setConversationState = useChat((s) => s.setConversationState);
  const removeConversation = useChat((s) => s.removeConversation);

  const [menuOpen, setMenuOpen] = useState(false);
  const menuBtn = useRef(null);

  const typingNames = Object.values(typing || {});
  const isDirect = conversation.type === 'direct';

  const online = isDirect && conversation.peer
    ? (presence[conversation.peer._id] ?? conversation.peer.presence === 'online')
    : false;

  const subtitle = useMemo(() => {
    if (typingNames.length) {
      return isDirect ? 'typing…' : typingNames.slice(0, 2).join(', ') + ' typing…';
    }
    if (isDirect) {
      return online
        ? 'Online'
        : lastSeenLabel({ ...conversation.peer, presence: online ? 'online' : 'offline' });
    }
    const count = conversation.memberCount || conversation.participants?.length || 0;
    return count + (count === 1 ? ' member' : ' members');
  }, [typingNames, isDirect, online, conversation]);

  async function startCall(mode) {
    feedback('select');
    const res = await emitAsync('call:start', { conversationId: conversation._id, mode }).catch(
      () => null
    );
    if (!res?.success) return;

    setCall({
      callId: res.callId,
      mode,
      direction: 'outgoing',
      status: 'ringing',
      conversationId: conversation._id,
      from: conversation.peer || { name: conversation.name, avatar: conversation.avatar },
      conversationName: conversation.name,
    });
  }

  return (
    <header className="safe-top relative z-30 shrink-0 border-b border-line bg-[var(--header)]">
      <div className="flex h-14 items-center gap-1.5 px-1.5 sm:px-3">
        <IconButton icon={ChevronLeft} label="Back" onClick={onBack} className="lg:hidden" />

        <button
          type="button"
          onClick={() => {
            feedback('open');
            openSheet('chatInfo', { conversation });
          }}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl px-1.5 py-1 text-left transition-colors hover:bg-black/[.035] dark:hover:bg-white/[.05]"
        >
          <Avatar
            src={conversation.avatar}
            name={conversation.name}
            color={conversation.avatarColor}
            size="sm"
          />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[16px] font-medium leading-tight">
              {conversation.name}
            </h2>
            <motion.p
              key={subtitle}
              initial={{ opacity: 0, y: 3 }}
              animate={{ opacity: 1, y: 0 }}
              className={cn(
                'truncate text-[12.5px] leading-tight',
                typingNames.length ? 'text-brand-strong' : 'text-ink-muted'
              )}
            >
              {subtitle}
            </motion.p>
          </div>
        </button>

        <div className="flex shrink-0 items-center gap-0.5">
          <IconButton
            icon={Search}
            label="Search in chat"
            onClick={openSearch}
            className="hidden sm:grid"
          />
          <IconButton icon={Phone} label="Voice call" onClick={() => startCall('audio')} />
          <IconButton icon={Video} label="Video call" onClick={() => startCall('video')} />
          <IconButton
            ref={menuBtn}
            icon={MoreVertical}
            label="More"
            active={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          />
        </div>
      </div>

      <Dropdown
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        anchorRef={menuBtn}
        items={[
          {
            label: 'Chat info',
            icon: Info,
            onClick: () => openSheet('chatInfo', { conversation }),
          },
          { label: 'Search in chat', icon: Search, onClick: openSearch },
          {
            label: conversation.muted ? 'Unmute' : 'Mute notifications',
            icon: conversation.muted ? Bell : BellOff,
            onClick: () =>
              setConversationState(conversation._id, { muted: !conversation.muted }),
          },
          {
            label: conversation.pinned ? 'Unpin chat' : 'Pin chat',
            icon: conversation.pinned ? PinOff : Pin,
            onClick: () =>
              setConversationState(conversation._id, { pinned: !conversation.pinned }),
          },
          {
            label: conversation.archived ? 'Unarchive' : 'Archive',
            icon: Archive,
            onClick: () =>
              setConversationState(conversation._id, { archived: !conversation.archived }),
          },
          { divider: true },
          {
            label: 'Clear messages',
            icon: Brush,
            danger: true,
            onClick: async () => {
              const { api } = await import('@/lib/api');
              await api.post('/conversations/' + conversation._id + '/clear').catch(() => {});
              useChat.setState((st) => ({
                messages: { ...st.messages, [conversation._id]: [] },
              }));
            },
          },
          {
            label: 'Delete chat',
            icon: Trash2,
            danger: true,
            onClick: async () => {
              const { api } = await import('@/lib/api');
              await api.delete('/conversations/' + conversation._id).catch(() => {});
              removeConversation(conversation._id);
              onBack();
            },
          },
        ]}
      />

      {conversation.settings?.disappearingSeconds > 0 && (
        <div className="flex items-center justify-center gap-1.5 border-t border-line bg-brand-tint py-1.5 text-[12px] text-brand-strong">
          <Lock size={11} />
          Disappearing messages are on
        </div>
      )}
    </header>
  );
}
