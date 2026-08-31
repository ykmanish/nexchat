import { useEffect, useMemo, useCallback } from 'react';
import {
  View, Text, StyleSheet, Pressable, ActivityIndicator,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { ArrowLeft, Lock, X, Reply, Phone, Video, EllipsisVertical } from 'lucide-react-native';

import { useChat } from '../../src/store/chat';
import { useAuth } from '../../src/store/auth';
import { useUI } from '../../src/store/ui';
import { Avatar } from '../../src/components/Avatar';
import { MessageBubble } from '../../src/components/MessageBubble';
import { Composer } from '../../src/components/Composer';
import { useTheme, font } from '../../src/theme';
import { dayLabel } from '../../src/lib/utils';
import { toast } from '../../src/store/ui';
import { feedback } from '../../src/lib/feedback';
import * as notifications from '../../src/lib/notifications';

export default function ChatScreen() {
  const { id } = useLocalSearchParams();
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const conversation = useChat((s) => s.conversations.find((c) => c._id === id));
  const messages = useChat((s) => s.messages[id]);
  const plain = useChat((s) => s.plain);
  const typing = useChat((s) => s.typing[id]);
  const presence = useChat((s) => s.presence);
  const hasMore = useChat((s) => s.hasMore[id]);
  const loading = useChat((s) => s.loadingMessages[id]);
  const replyTo = useChat((s) => s.replyTo);
  const me = useAuth((s) => s.user);
  const openSheet = useUI((s) => s.openSheet);

  const openConversation = useChat((s) => s.openConversation);
  const closeConversation = useChat((s) => s.closeConversation);
  const loadOlder = useChat((s) => s.loadOlder);
  const sendMessage = useChat((s) => s.sendMessage);
  const retryMessage = useChat((s) => s.retryMessage);
  const clearReplyTo = useChat((s) => s.clearReplyTo);

  useEffect(() => {
    if (!id) return undefined;
    openConversation(id);
    // Any notification for this chat is stale the moment it is on screen.
    notifications.dismissFor(id).catch(() => {});
    return () => closeConversation();
  }, [id, openConversation, closeConversation]);

  /**
   * The list, oldest first.
   *
   * FlashList v2 dropped the `inverted` prop that v1 had, and passing it is
   * silently ignored rather than an error — which is exactly how this ended up
   * rendering newest-at-top with the day separators upside down. The v2 way to
   * build a chat is natural order plus `startRenderingFromBottom`, so the
   * newest message is genuinely the last row and sits at the bottom.
   */
  const rows = useMemo(() => {
    const list = messages || [];
    const out = [];
    const dayOf = (m) => (m ? new Date(m.createdAt).toDateString() : null);

    for (let i = 0; i < list.length; i += 1) {
      const message = list[i];
      const previous = list[i - 1];
      const next = list[i + 1];

      // A separator opens each day, so it is pushed before the first message
      // of that day rather than after it.
      if (!previous || dayOf(previous) !== dayOf(message)) {
        out.push({ kind: 'day', key: 'day-' + message._id, at: message.createdAt });
      }

      const mine = String(message.sender?._id || message.sender) === String(me?._id);
      const nextMine = next && String(next.sender?._id || next.sender) === String(me?._id);
      const previousSender = previous && String(previous.sender?._id || previous.sender);

      out.push({
        kind: 'message',
        key: message._id,
        message,
        mine,
        // Tail on the last bubble of a run — five messages get one tail, not five.
        showTail: !next || nextMine !== mine || dayOf(next) !== dayOf(message),
        showSender:
          conversation?.type !== 'direct' &&
          !mine &&
          previousSender !== String(message.sender?._id || message.sender),
      });
    }
    return out;
  }, [messages, me?._id, conversation?.type]);

  const typingNames = Object.values(typing || {});

  const onSend = useCallback(
    async ({ text, attachments }) => {
      const reply = replyTo;
      clearReplyTo();

      try {
        await sendMessage({
          conversationId: id,
          text,
          attachments,
          replyTo: reply,
          type: attachments?.length ? attachments[0].kind : 'text',
        });
      } catch (err) {
        toast.error(err.message || 'Could not send that message');
      }
    },
    [id, sendMessage, replyTo, clearReplyTo]
  );

  const renderItem = useCallback(
    ({ item }) => {
      if (item.kind === 'day') {
        return (
          <View style={styles.dayWrap}>
            <Text style={[styles.day, { backgroundColor: theme.surface3, color: theme.inkMuted }]}>
              {dayLabel(item.at)}
            </Text>
          </View>
        );
      }

      return (
        <MessageBubble
          message={item.message}
          payload={plain[item.message._id]}
          mine={item.mine}
          showTail={item.showTail}
          showSender={item.showSender}
          onRetry={() => retryMessage(id, item.message.clientId)}
          onLongPress={() => {
            feedback('select');
            openSheet('messageActions', {
              message: item.message,
              payload: plain[item.message._id],
            });
          }}
        />
      );
    },
    [plain, theme, id, retryMessage, openSheet]
  );

  const peerOnline = conversation?.type === 'direct' && presence[conversation?.peer?._id];
  const title = conversation?.type === 'direct' ? conversation?.peer?.name : conversation?.name;
  const replyPayload = replyTo ? plain[replyTo._id] : null;

  return (
    <View style={[styles.screen, { backgroundColor: theme.wallpaper }]}>
      {/* ── header ── */}
      <View
        style={[
          styles.header,
          { backgroundColor: theme.header, paddingTop: insets.top, borderBottomColor: theme.border },
        ]}
      >
        <Pressable hitSlop={10} onPress={() => router.back()} style={styles.back}>
          <ArrowLeft size={24} color={theme.ink} strokeWidth={2.1} />
        </Pressable>

        <Pressable
          style={styles.headerMain}
          onPress={() => openSheet('chatInfo', { conversation })}
        >
          <Avatar
            uri={conversation?.type === 'direct' ? conversation?.peer?.avatar : conversation?.avatar}
            name={title}
            id={conversation?.peer?._id || conversation?._id}
            group={conversation?.type !== 'direct'}
            size={38}
          />

          <View style={styles.headerText}>
            <Text style={[styles.headerTitle, { color: theme.ink }]} numberOfLines={1}>
              {title || 'Chat'}
            </Text>
            <Text style={[styles.headerSub, { color: theme.inkMuted }]} numberOfLines={1}>
              {typingNames.length
                ? typingNames.length === 1
                  ? `${typingNames[0]} is typing…`
                  : 'several people are typing…'
                : peerOnline
                  ? 'online'
                  : conversation?.type !== 'direct'
                    ? `${conversation?.memberCount || 0} members`
                    : 'end-to-end encrypted'}
            </Text>
          </View>
        </Pressable>

        {/* Calls are signalled peer-to-peer over WebRTC on the web; the native
            side has the history screen but not the call itself yet, so these
            say so rather than doing nothing. */}
        <Pressable
          hitSlop={8}
          onPress={() => toast.info('Voice calls are not built in the app yet.')}
          style={styles.headerAction}
        >
          <Phone size={21} color={theme.inkSoft} strokeWidth={2.1} />
        </Pressable>
        <Pressable
          hitSlop={8}
          onPress={() => toast.info('Video calls are not built in the app yet.')}
          style={styles.headerAction}
        >
          <Video size={22} color={theme.inkSoft} strokeWidth={2.1} />
        </Pressable>
        <Pressable
          hitSlop={8}
          onPress={() => openSheet('chatOptions', { conversation })}
          style={styles.headerAction}
        >
          <EllipsisVertical size={21} color={theme.inkSoft} strokeWidth={2.1} />
        </Pressable>
      </View>

      {/* ── messages ── */}
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {!messages && loading ? (
          <View style={styles.centre}>
            <ActivityIndicator color={theme.accentStrong} />
          </View>
        ) : (
          <FlashList
            data={rows}
            renderItem={renderItem}
            keyExtractor={(item) => item.key}
            contentContainerStyle={{ paddingVertical: 10 }}
            keyboardDismissMode="interactive"
            /* Open at the newest message, and stay pinned there when one
               arrives while you are already at the bottom — but do not yank the
               view if you have scrolled up to read something. */
            maintainVisibleContentPosition={{
              startRenderingFromBottom: true,
              autoscrollToBottomThreshold: 0.2,
              animateAutoScrollToBottom: true,
            }}
            /* Older history is at the top now, so it pages from the start. */
            onStartReached={() => hasMore && loadOlder(id)}
            onStartReachedThreshold={0.4}
            ListHeaderComponent={
              loading && messages?.length ? (
                <View style={styles.more}>
                  <ActivityIndicator size="small" color={theme.inkMuted} />
                </View>
              ) : null
            }
            ListEmptyComponent={
              <View style={styles.emptyWrap}>
                <View style={[styles.notice, { backgroundColor: theme.surface3 }]}>
                  <Lock size={13} color={theme.inkMuted} />
                  <Text style={[styles.noticeText, { color: theme.inkMuted }]}>
                    Messages are end-to-end encrypted. No one outside this chat can read them.
                  </Text>
                </View>
              </View>
            }
          />
        )}

        {/* ── replying to ── */}
        {!!replyTo && (
          <View
            style={[
              styles.replyBar,
              { backgroundColor: theme.surface2, borderLeftColor: theme.accentStrong },
            ]}
          >
            <Reply size={15} color={theme.accentStrong} strokeWidth={2.2} />
            <View style={styles.replyText}>
              <Text style={[styles.replyName, { color: theme.accentStrong }]} numberOfLines={1}>
                {String(replyTo.sender?._id || replyTo.sender) === String(me?._id)
                  ? 'You'
                  : replyTo.sender?.name || 'Message'}
              </Text>
              <Text style={[styles.replyBody, { color: theme.inkMuted }]} numberOfLines={1}>
                {replyPayload?.text || 'Attachment'}
              </Text>
            </View>
            <Pressable hitSlop={10} onPress={clearReplyTo}>
              <X size={18} color={theme.inkMuted} strokeWidth={2.2} />
            </Pressable>
          </View>
        )}

        <View style={{ paddingBottom: Math.max(insets.bottom, 8) }}>
          <Composer conversationId={id} onSend={onSend} />
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingBottom: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
    elevation: 2,
  },
  back: { paddingRight: 2 },
  headerMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 11 },
  headerAction: { paddingHorizontal: 5 },
  headerText: { flex: 1, gap: 1 },
  headerTitle: { fontFamily: font.display, fontSize: 16.5, letterSpacing: -0.3 },
  headerSub: { fontSize: 12.5, fontFamily: font.body },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  more: { paddingVertical: 14, alignItems: 'center' },
  dayWrap: { alignItems: 'center', marginVertical: 9 },
  day: {
    fontSize: 12,
    fontWeight: '600',
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: 7,
    overflow: 'hidden',
    fontFamily: font.body,
  },
  emptyWrap: { paddingTop: 40, paddingHorizontal: 30 },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 7, padding: 11, borderRadius: 8 },
  noticeText: { flex: 1, fontSize: 12.5, lineHeight: 18, textAlign: 'center', fontFamily: font.body },
  replyBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 8,
    marginBottom: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderLeftWidth: 3,
  },
  replyText: { flex: 1, gap: 1 },
  replyName: { fontSize: 12.5, fontWeight: '700', fontFamily: font.body },
  replyBody: { fontSize: 13, fontFamily: font.body },
});
