import { memo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Check, CheckCheck, Pin, BellOff, Image as ImageIcon, Mic, FileText, Video } from 'lucide-react-native';
import { Avatar } from './Avatar';
import { shortTime } from '../lib/utils';
import { useTheme } from '../theme';

/**
 * One row of the chat list.
 *
 * Memoised on the fields it actually draws rather than on the whole
 * conversation object: a presence update for one person otherwise re-renders
 * every row in the list, which is what makes a long chat list stutter while
 * somebody is typing.
 */
function ChatRowInner({ conversation, preview, mine, online, onPress, onLongPress }) {
  const theme = useTheme();
  const c = conversation;
  const isGroup = c.type !== 'direct';
  const unread = c.unreadCount || 0;

  const title = isGroup ? c.name : c.peer?.name || c.name || 'Unknown';
  const avatarUri = isGroup ? c.avatar : c.peer?.avatar;

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      android_ripple={{ color: theme.surface3 }}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: pressed ? theme.surface2 : theme.surface },
      ]}
    >
      <Avatar
        uri={avatarUri}
        name={title}
        id={isGroup ? c._id : c.peer?._id}
        group={isGroup}
        online={online}
        size={50}
      />

      <View style={styles.body}>
        <View style={styles.topLine}>
          <Text style={[styles.title, { color: theme.ink }]} numberOfLines={1}>
            {title}
          </Text>
          <Text
            style={[
              styles.time,
              { color: unread ? theme.accent : theme.inkFaint },
              unread > 0 && styles.timeUnread,
            ]}
          >
            {shortTime(c.lastMessageAt)}
          </Text>
        </View>

        <View style={styles.bottomLine}>
          {mine && <Ticks message={c.lastMessage} theme={theme} />}
          <Preview preview={preview} lastMessage={c.lastMessage} isGroup={isGroup} theme={theme} />

          <View style={styles.trailing}>
            {c.muted && <BellOff size={14} color={theme.inkFaint} strokeWidth={2} />}
            {c.pinned && <Pin size={14} color={theme.inkFaint} strokeWidth={2} />}
            {unread > 0 && (
              <View style={[styles.badge, { backgroundColor: theme.accent }]}>
                <Text style={styles.badgeText}>{unread > 999 ? '999+' : unread}</Text>
              </View>
            )}
          </View>
        </View>
      </View>
    </Pressable>
  );
}

/**
 * The preview line.
 *
 * `preview` is the decrypted text when this device has the keys and has already
 * opened that message. When it does not, the row says what *kind* of thing
 * arrived rather than inventing content — the server cannot tell us, and
 * showing nothing at all reads as an empty chat.
 */
function Preview({ preview, lastMessage, isGroup, theme }) {
  if (!lastMessage) {
    return (
      <Text style={[styles.preview, { color: theme.inkFaint, fontStyle: 'italic' }]} numberOfLines={1}>
        No messages yet
      </Text>
    );
  }

  if (lastMessage.deletedForEveryone) {
    return (
      <Text style={[styles.preview, { color: theme.inkFaint, fontStyle: 'italic' }]} numberOfLines={1}>
        This message was deleted
      </Text>
    );
  }

  if (lastMessage.type === 'system') {
    return (
      <Text style={[styles.preview, { color: theme.inkFaint }]} numberOfLines={1}>
        {lastMessage.systemText || 'Updated'}
      </Text>
    );
  }

  const attachment = lastMessage.attachments?.[0];
  const senderName = isGroup ? (lastMessage.sender?.name || '').split(' ')[0] : null;

  if (!preview?.text && attachment) {
    const kinds = {
      image: [ImageIcon, 'Photo'],
      video: [Video, 'Video'],
      audio: [Mic, 'Voice note'],
    };
    const [Icon, label] = kinds[attachment.kind] || [FileText, attachment.name || 'Document'];

    return (
      <View style={styles.previewRow}>
        {senderName && (
          <Text style={[styles.preview, { color: theme.inkMuted }]}>{senderName}: </Text>
        )}
        <Icon size={14} color={theme.inkMuted} strokeWidth={2} />
        <Text style={[styles.preview, { color: theme.inkMuted }]} numberOfLines={1}>
          {' ' + label}
        </Text>
      </View>
    );
  }

  return (
    <Text style={[styles.preview, { color: theme.inkMuted }]} numberOfLines={1}>
      {senderName ? senderName + ': ' : ''}
      {preview?.text || 'Encrypted message'}
    </Text>
  );
}

/** Sent / delivered / read, for our own last message. */
function Ticks({ message, theme }) {
  if (!message?.receipts?.length) {
    return <Check size={15} color={theme.inkFaint} strokeWidth={2.4} style={styles.tick} />;
  }

  const everyoneRead = message.receipts.every((r) => r.readAt);
  const everyoneGot = message.receipts.every((r) => r.deliveredAt);

  if (everyoneRead) {
    return <CheckCheck size={15} color={theme.tickRead} strokeWidth={2.4} style={styles.tick} />;
  }
  if (everyoneGot) {
    return <CheckCheck size={15} color={theme.inkFaint} strokeWidth={2.4} style={styles.tick} />;
  }
  return <Check size={15} color={theme.inkFaint} strokeWidth={2.4} style={styles.tick} />;
}

export const ChatRow = memo(
  ChatRowInner,
  (a, b) =>
    a.conversation._id === b.conversation._id &&
    a.conversation.lastMessageAt === b.conversation.lastMessageAt &&
    a.conversation.unreadCount === b.conversation.unreadCount &&
    a.conversation.pinned === b.conversation.pinned &&
    a.conversation.muted === b.conversation.muted &&
    a.conversation.name === b.conversation.name &&
    a.conversation.lastMessage?._id === b.conversation.lastMessage?._id &&
    a.conversation.lastMessage?.receipts === b.conversation.lastMessage?.receipts &&
    a.preview === b.preview &&
    a.online === b.online &&
    a.mine === b.mine
);

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, gap: 13 },
  body: { flex: 1, gap: 3 },
  topLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { flex: 1, fontSize: 16.5, fontWeight: '600', letterSpacing: -0.2 },
  time: { fontSize: 12 },
  timeUnread: { fontWeight: '700' },
  bottomLine: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  previewRow: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  preview: { flex: 1, fontSize: 14.5 },
  tick: { marginRight: 2 },
  trailing: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 6 },
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#fff', fontSize: 11.5, fontWeight: '700' },
});
