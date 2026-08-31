import { router } from 'expo-router';
import { Users, UserPlus, Archive, Star, Settings, ShieldCheck } from 'lucide-react-native';

import { Sheet, SheetRow } from '../Sheet';
import { useChat } from '../../store/chat';
import { useUI } from '../../store/ui';

/** The kebab beside the wordmark, matching the web's chat-list menu. */
export function ChatListMenuSheet({ open, onClose }) {
  const openSheet = useUI((s) => s.openSheet);
  const loadConversations = useChat((s) => s.loadConversations);
  const showArchived = useChat((s) => s.showArchived);

  const go = (path) => () => {
    onClose();
    router.push(path);
  };

  return (
    <Sheet open={open} onClose={onClose} showHandle>
      <SheetRow
        icon={Users}
        label="New group"
        description="Start a conversation with several people"
        onPress={() => openSheet('newGroup')}
      />
      <SheetRow
        icon={UserPlus}
        label="New contact"
        description="Add someone by their email address"
        onPress={() => openSheet('newContact')}
      />
      <SheetRow
        icon={Archive}
        label={showArchived ? 'Back to chats' : 'Archived'}
        onPress={() => {
          onClose();
          loadConversations({ archived: !showArchived }).catch(() => {});
        }}
      />
      <SheetRow icon={Star} label="Starred messages" onPress={go('/settings/starred')} />
      <SheetRow
        icon={ShieldCheck}
        label="How encryption works"
        onPress={go('/settings/encryption')}
      />
      <SheetRow icon={Settings} label="Settings" onPress={go('/(tabs)/settings')} />
    </Sheet>
  );
}
