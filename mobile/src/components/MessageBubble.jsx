import { memo } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { Check, CheckCheck, TriangleAlert, Star, Pin } from 'lucide-react-native';
import { clockTime } from '../lib/utils';
import { useTheme } from '../theme';
import { Attachment } from './Attachment';

/**
 * One message.
 *
 * `payload` is the decrypted body. A bubble with no payload is not an error —
 * it is a message this device has not been able to open, which happens when the
 * account slot was sealed before this device existed and the sender is offline.
 * Saying so plainly beats an empty bubble that looks like a bug.
 */
function MessageBubbleInner({ message, payload, mine, showTail, showSender, onLongPress, onRetry }) {
  const theme = useTheme();

  if (message.type === 'system') {
    return (
      <View style={styles.systemWrap}>
        <Text style={[styles.system, { backgroundColor: theme.surface3, color: theme.inkMuted }]}>
          {message.systemText || 'Updated'}
        </Text>
      </View>
    );
  }

  const deleted = message.deletedForEveryone;
  const bg = mine ? theme.bubbleOut : theme.bubbleIn;
  const ink = mine ? theme.bubbleOutInk : theme.bubbleInInk;
  const attachments = payload?.attachments || message.attachments || [];

  return (
    <Pressable
      onLongPress={deleted ? undefined : onLongPress}
      delayLongPress={220}
      style={[styles.row, mine ? styles.rowMine : styles.rowTheirs]}
    >
      <View
        style={[
          styles.bubble,
          { backgroundColor: bg },
          mine ? styles.bubbleMine : styles.bubbleTheirs,
          showTail && (mine ? styles.tailMine : styles.tailTheirs),
        ]}
      >
        {showSender && !mine && (
          <Text style={[styles.sender, { color: theme.accentDeep }]} numberOfLines={1}>
            {message.sender?.name || 'Unknown'}
          </Text>
        )}

        {message.replyTo && (
          <View style={[styles.quote, { borderLeftColor: theme.accentStrong, backgroundColor: theme.overlay }]}>
            <Text style={[styles.quoteName, { color: theme.accentStrong }]} numberOfLines={1}>
              {message.replyTo.sender?.name || 'Message'}
            </Text>
            <Text style={[styles.quoteText, { color: ink }]} numberOfLines={2}>
              {message.replyTo.preview || 'Encrypted message'}
            </Text>
          </View>
        )}

        {deleted ? (
          <Text style={[styles.deleted, { color: theme.inkFaint }]}>
            This message was deleted
          </Text>
        ) : (
          <>
            {attachments.map((a, i) => (
              <Attachment key={a.url || i} attachment={a} />
            ))}

            {!!payload?.text && (
              <Text style={[styles.text, { color: ink }]} selectable>
                {payload.text}
              </Text>
            )}

            {!payload?.text && !attachments.length && (
              <Text style={[styles.text, { color: ink, fontStyle: 'italic', opacity: 0.7 }]}>
                Message could not be decrypted on this device
              </Text>
            )}
          </>
        )}

        {/* meta line — time, ticks, and the little flags */}
        <View style={styles.meta}>
          {message.editedAt && (
            <Text style={[styles.metaText, { color: mine ? theme.meta : theme.inkFaint }]}>
              edited
            </Text>
          )}
          {message.starred && <Star size={11} color={mine ? theme.meta : theme.inkFaint} fill={mine ? theme.meta : theme.inkFaint} />}
          {message.pinned && <Pin size={11} color={mine ? theme.meta : theme.inkFaint} />}

          <Text style={[styles.metaText, { color: mine ? theme.meta : theme.inkFaint }]}>
            {clockTime(message.createdAt)}
          </Text>

          {mine && <Status message={message} theme={theme} onRetry={onRetry} />}
        </View>
      </View>

      {!!message.reactions?.length && (
        <View
          style={[
            styles.reactions,
            { backgroundColor: theme.surface3, borderColor: theme.app },
            mine ? styles.reactionsMine : styles.reactionsTheirs,
          ]}
        >
          <Text style={styles.reactionText}>
            {[...new Set(message.reactions.map((r) => r.emoji))].join(' ')}
            {message.reactions.length > 1 ? ' ' + message.reactions.length : ''}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

function Status({ message, theme, onRetry }) {
  if (message.failed) {
    return (
      <Pressable onPress={onRetry} hitSlop={8} style={styles.failed}>
        <TriangleAlert size={12} color={theme.danger} strokeWidth={2.4} />
        <Text style={[styles.retry, { color: theme.danger }]}>Tap to retry</Text>
      </Pressable>
    );
  }

  if (message.pending) {
    return <ActivityIndicator size={10} color={theme.meta} style={{ marginLeft: 2 }} />;
  }

  const receipts = message.receipts || [];
  if (!receipts.length) return <Check size={14} color={theme.meta} strokeWidth={2.6} />;

  if (receipts.every((r) => r.readAt)) {
    return <CheckCheck size={14} color={theme.tickRead} strokeWidth={2.6} />;
  }
  if (receipts.every((r) => r.deliveredAt)) {
    return <CheckCheck size={14} color={theme.meta} strokeWidth={2.6} />;
  }
  return <Check size={14} color={theme.meta} strokeWidth={2.6} />;
}

export const MessageBubble = memo(
  MessageBubbleInner,
  (a, b) =>
    a.message._id === b.message._id &&
    a.message.pending === b.message.pending &&
    a.message.failed === b.message.failed &&
    a.message.editedAt === b.message.editedAt &&
    a.message.starred === b.message.starred &&
    a.message.pinned === b.message.pinned &&
    a.message.deletedForEveryone === b.message.deletedForEveryone &&
    a.message.reactions === b.message.reactions &&
    a.message.receipts === b.message.receipts &&
    a.payload === b.payload &&
    a.showTail === b.showTail &&
    a.showSender === b.showSender
);

const styles = StyleSheet.create({
  row: { paddingHorizontal: 9, marginBottom: 2, maxWidth: '100%' },
  rowMine: { alignItems: 'flex-end' },
  rowTheirs: { alignItems: 'flex-start' },
  bubble: {
    maxWidth: '82%',
    paddingHorizontal: 9,
    paddingTop: 6,
    paddingBottom: 5,
    borderRadius: 8,
    elevation: 1,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 1,
    shadowOffset: { width: 0, height: 1 },
  },
  bubbleMine: { borderTopRightRadius: 8 },
  bubbleTheirs: { borderTopLeftRadius: 8 },
  tailMine: { borderTopRightRadius: 2 },
  tailTheirs: { borderTopLeftRadius: 2 },
  sender: { fontSize: 13, fontWeight: '700', marginBottom: 2 },
  text: { fontSize: 15.5, lineHeight: 21 },
  deleted: { fontSize: 15, fontStyle: 'italic' },
  quote: {
    borderLeftWidth: 3,
    borderRadius: 4,
    paddingHorizontal: 7,
    paddingVertical: 4,
    marginBottom: 4,
    opacity: 0.92,
  },
  quoteName: { fontSize: 12.5, fontWeight: '700' },
  quoteText: { fontSize: 13.5, opacity: 0.8 },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-end',
    gap: 4,
    marginTop: 1,
    marginLeft: 8,
  },
  metaText: { fontSize: 11 },
  failed: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  retry: { fontSize: 11, fontWeight: '600' },
  systemWrap: { alignItems: 'center', marginVertical: 8, paddingHorizontal: 30 },
  system: {
    fontSize: 12.5,
    textAlign: 'center',
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: 7,
    overflow: 'hidden',
  },
  reactions: {
    marginTop: -7,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 2,
  },
  reactionsMine: { marginRight: 6 },
  reactionsTheirs: { marginLeft: 6 },
  reactionText: { fontSize: 12 },
});
