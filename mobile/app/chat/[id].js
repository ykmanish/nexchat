import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { ArrowLeft, Send, Paperclip, Camera, Lock } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';

import { useChat } from '../../src/store/chat';
import { useAuth } from '../../src/store/auth';
import { Avatar } from '../../src/components/Avatar';
import { MessageBubble } from '../../src/components/MessageBubble';
import { useTheme } from '../../src/theme';
import { emit } from '../../src/lib/socket';
import { dayLabel } from '../../src/lib/utils';
import { toast } from '../../src/store/ui';
import * as notifications from '../../src/lib/notifications';

export default function ChatScreen() {
  const { id } = useLocalSearchParams();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const listRef = useRef(null);

  const conversation = useChat((s) => s.conversations.find((c) => c._id === id));
  const messages = useChat((s) => s.messages[id]);
  const plain = useChat((s) => s.plain);
  const typing = useChat((s) => s.typing[id]);
  const presence = useChat((s) => s.presence);
  const hasMore = useChat((s) => s.hasMore[id]);
  const loading = useChat((s) => s.loadingMessages[id]);
  const me = useAuth((s) => s.user);

  const openConversation = useChat((s) => s.openConversation);
  const closeConversation = useChat((s) => s.closeConversation);
  const loadOlder = useChat((s) => s.loadOlder);
  const sendMessage = useChat((s) => s.sendMessage);
  const retryMessage = useChat((s) => s.retryMessage);

  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  /* ─── open / close ─── */
  useEffect(() => {
    if (!id) return undefined;
    openConversation(id);
    // Any notification for this chat is stale the moment it is on screen.
    notifications.dismissFor(id).catch(() => {});

    return () => closeConversation();
  }, [id, openConversation, closeConversation]);

  /* ─── typing indicator, throttled ─── */
  const typingSentAt = useRef(0);
  const typingTimer = useRef(null);

  const onChangeText = useCallback(
    (value) => {
      setDraft(value);
      if (!id) return;

      const now = Date.now();
      // One start per three seconds, rather than one per keystroke.
      if (now - typingSentAt.current > 3000) {
        typingSentAt.current = now;
        emit('typing:start', { conversationId: id });
      }

      clearTimeout(typingTimer.current);
      typingTimer.current = setTimeout(() => {
        typingSentAt.current = 0;
        emit('typing:stop', { conversationId: id });
      }, 2200);
    },
    [id]
  );

  useEffect(() => () => clearTimeout(typingTimer.current), []);

  /* ─── the list, newest first because it is inverted ─── */
  const rows = useMemo(() => {
    const list = messages || [];
    const out = [];

    for (let i = list.length - 1; i >= 0; i -= 1) {
      const message = list[i];
      const older = list[i - 1];
      const newer = list[i + 1];

      const mine = String(message.sender?._id || message.sender) === String(me?._id);
      const nextMine = newer && String(newer.sender?._id || newer.sender) === String(me?._id);
      const prevSender = older && String(older.sender?._id || older.sender);

      out.push({
        kind: 'message',
        key: message._id,
        message,
        mine,
        // Tail on the last bubble of a run, which is what gives the grouped
        // look — a run of five messages has one tail, not five.
        showTail: !newer || nextMine !== mine,
        showSender:
          conversation?.type !== 'direct' &&
          !mine &&
          prevSender !== String(message.sender?._id || message.sender),
      });

      const dayOf = (m) => (m ? new Date(m.createdAt).toDateString() : null);
      if (!older || dayOf(older) !== dayOf(message)) {
        out.push({ kind: 'day', key: 'day-' + message._id, at: message.createdAt });
      }
    }
    return out;
  }, [messages, me?._id, conversation?.type]);

  const typingNames = Object.values(typing || {});

  const onSend = useCallback(async () => {
    const text = draft.trim();
    if (!text || sending) return;

    setDraft('');
    setSending(true);
    emit('typing:stop', { conversationId: id });
    typingSentAt.current = 0;

    try {
      await sendMessage({ conversationId: id, text });
    } catch (err) {
      toast.error(err.message || 'Could not send that message');
    } finally {
      setSending(false);
    }
  }, [draft, sending, id, sendMessage]);

  const onAttach = useCallback(async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      quality: 0.85,
    });
    if (result.canceled) return;
    toast.info('Attachment upload is not wired up in this build yet.');
  }, []);

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
        />
      );
    },
    [plain, theme, id, retryMessage]
  );

  const peerOnline = conversation?.type === 'direct' && presence[conversation?.peer?._id];
  const title =
    conversation?.type === 'direct' ? conversation?.peer?.name : conversation?.name;

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
      </View>

      {/* ── messages ── */}
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        {!messages && loading ? (
          <View style={styles.centre}>
            <ActivityIndicator color={theme.accent} />
          </View>
        ) : (
          <FlashList
            ref={listRef}
            inverted
            data={rows}
            renderItem={renderItem}
            keyExtractor={(item) => item.key}
            contentContainerStyle={{ paddingVertical: 10 }}
            keyboardDismissMode="interactive"
            onEndReached={() => hasMore && loadOlder(id)}
            onEndReachedThreshold={0.4}
            ListFooterComponent={
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

        {/* ── composer ── */}
        <View
          style={[
            styles.composerWrap,
            { paddingBottom: Math.max(insets.bottom, 8), backgroundColor: theme.wallpaper },
          ]}
        >
          <View style={[styles.composer, { backgroundColor: theme.surface }]}>
            <TextInput
              value={draft}
              onChangeText={onChangeText}
              placeholder="Message"
              placeholderTextColor={theme.inkFaint}
              style={[styles.input, { color: theme.ink }]}
              multiline
              maxLength={4096}
            />

            <Pressable hitSlop={8} onPress={onAttach} style={styles.composerIcon}>
              <Paperclip size={21} color={theme.inkMuted} strokeWidth={2} />
            </Pressable>
            <Pressable hitSlop={8} onPress={onAttach} style={styles.composerIcon}>
              <Camera size={21} color={theme.inkMuted} strokeWidth={2} />
            </Pressable>
          </View>

          <Pressable
            onPress={onSend}
            disabled={!draft.trim() || sending}
            style={[
              styles.send,
              { backgroundColor: draft.trim() ? theme.accent : theme.surface3 },
            ]}
          >
            <Send size={20} color={draft.trim() ? '#fff' : theme.inkFaint} strokeWidth={2.2} />
          </Pressable>
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
    gap: 11,
    paddingHorizontal: 12,
    paddingBottom: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
    elevation: 2,
  },
  back: { paddingRight: 2 },
  headerText: { flex: 1, gap: 1 },
  headerTitle: { fontSize: 16.5, fontWeight: '700', letterSpacing: -0.2 },
  headerSub: { fontSize: 12.5 },
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
  },
  emptyWrap: { paddingTop: 40, paddingHorizontal: 30, transform: [{ scaleY: -1 }] },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    padding: 11,
    borderRadius: 8,
  },
  noticeText: { flex: 1, fontSize: 12.5, lineHeight: 18, textAlign: 'center' },
  composerWrap: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 7,
    paddingHorizontal: 8,
    paddingTop: 6,
  },
  composer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    borderRadius: 24,
    paddingLeft: 16,
    paddingRight: 8,
    paddingVertical: 6,
    minHeight: 46,
    elevation: 1,
  },
  input: { flex: 1, fontSize: 15.5, maxHeight: 120, paddingTop: 6, paddingBottom: 6 },
  composerIcon: { padding: 7 },
  send: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 2,
  },
});
