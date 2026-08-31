import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { router } from 'expo-router';
import {
  Archive, BellOff, Bell, Pin, PinOff, Trash2, Eraser, Users, ShieldCheck, Ban,
} from 'lucide-react-native';

import { Sheet, SheetRow } from '../Sheet';
import { Avatar } from '../Avatar';
import { EncryptedBadge } from '../Brand';
import { useChat } from '../../store/chat';
import { useTheme, font, heading } from '../../theme';
import { toast } from '../../store/ui';
import { api } from '../../lib/api';

/** Long-press a row in the chat list. */
export function ChatOptionsSheet({ open, onClose, conversation }) {
  const setConversationState = useChat((s) => s.setConversationState);
  const clearLocalHistory = useChat((s) => s.clearLocalHistory);
  const removeConversation = useChat((s) => s.removeConversation);

  if (!conversation) return null;

  const c = conversation;
  const title = c.type === 'direct' ? c.peer?.name : c.name;

  const done = (fn) => async () => {
    onClose();
    try {
      await fn();
    } catch (err) {
      toast.error(err.message || 'That did not work');
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title={title} maxHeightRatio={0.8}>
      <SheetRow
        icon={c.pinned ? PinOff : Pin}
        label={c.pinned ? 'Unpin' : 'Pin to top'}
        onPress={done(() => setConversationState(c._id, { pinned: !c.pinned }))}
      />

      <SheetRow
        icon={c.muted ? Bell : BellOff}
        label={c.muted ? 'Unmute' : 'Mute notifications'}
        description={c.muted ? undefined : 'Muting is decided on the server, so a muted chat stays quiet even when the app is closed'}
        onPress={done(() => setConversationState(c._id, { muted: !c.muted }))}
      />

      <SheetRow
        icon={Archive}
        label={c.archived ? 'Move out of archive' : 'Archive'}
        onPress={done(() => setConversationState(c._id, { archived: !c.archived }))}
      />

      <SheetRow
        icon={Eraser}
        label="Clear messages"
        description="Empties this chat on your devices only"
        onPress={done(async () => {
          await api.post('/conversations/' + c._id + '/clear');
          await clearLocalHistory(c._id);
          toast.success('Chat cleared');
        })}
      />

      <SheetRow
        icon={Trash2}
        label="Delete chat"
        danger
        onPress={done(async () => {
          await api.post('/conversations/' + c._id + '/leave');
          removeConversation(c._id);
        })}
      />
    </Sheet>
  );
}

/** Tapping the header inside a chat. */
export function ChatInfoSheet({ open, onClose, conversation }) {
  const theme = useTheme();
  const setConversationState = useChat((s) => s.setConversationState);

  if (!conversation) return null;

  const c = conversation;
  const isGroup = c.type !== 'direct';
  const title = isGroup ? c.name : c.peer?.name;
  const members = (c.participants || []).filter((p) => !p.leftAt);

  return (
    <Sheet open={open} onClose={onClose} maxHeightRatio={0.88}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.head}>
          <Avatar
            uri={isGroup ? c.avatar : c.peer?.avatar}
            name={title}
            id={c.peer?._id || c._id}
            group={isGroup}
            size={84}
          />
          <Text style={[heading(22), { color: theme.ink, marginTop: 12 }]}>{title}</Text>

          {!isGroup && !!c.peer?.email && (
            <Text style={[styles.meta, { color: theme.inkMuted }]}>{c.peer.email}</Text>
          )}
          {isGroup && (
            <Text style={[styles.meta, { color: theme.inkMuted }]}>
              {members.length} member{members.length === 1 ? '' : 's'}
            </Text>
          )}

          {!!c.about && <Text style={[styles.about, { color: theme.inkSoft }]}>{c.about}</Text>}

          <View style={{ marginTop: 12 }}>
            <EncryptedBadge />
          </View>
        </View>

        <View style={[styles.divider, { backgroundColor: theme.border }]} />

        <SheetRow
          icon={c.muted ? Bell : BellOff}
          label={c.muted ? 'Unmute' : 'Mute notifications'}
          onPress={() => setConversationState(c._id, { muted: !c.muted })}
        />

        <SheetRow
          icon={ShieldCheck}
          label="Encryption"
          description="Messages and media in this chat are end-to-end encrypted"
        />

        {isGroup && (
          <>
            <View style={[styles.divider, { backgroundColor: theme.border }]} />
            <Text style={[styles.sectionTitle, { color: theme.inkMuted }]}>
              {members.length} member{members.length === 1 ? '' : 's'}
            </Text>
            {members.map((p) => (
              <View key={String(p.user?._id || p.user)} style={styles.member}>
                <Avatar uri={p.user?.avatar} name={p.user?.name} id={p.user?._id} size={38} />
                <Text style={[styles.memberName, { color: theme.ink }]} numberOfLines={1}>
                  {p.user?.name || 'Someone'}
                </Text>
                {p.role && p.role !== 'member' && (
                  <Text style={[styles.role, { color: theme.accentStrong }]}>{p.role}</Text>
                )}
              </View>
            ))}
          </>
        )}
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: 20 },
  head: { alignItems: 'center', paddingTop: 12, paddingHorizontal: 24 },
  meta: { fontSize: 14, marginTop: 4, fontFamily: font.body },
  about: { fontSize: 14.5, marginTop: 10, textAlign: 'center', lineHeight: 20, fontFamily: font.body },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 12 },
  sectionTitle: {
    fontSize: 12.5,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    paddingHorizontal: 20,
    paddingBottom: 6,
    fontFamily: font.body,
  },
  member: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 7 },
  memberName: { flex: 1, fontSize: 15, fontWeight: '600', fontFamily: font.body },
  role: { fontSize: 12, fontWeight: '700', textTransform: 'capitalize', fontFamily: font.body },
});
