import { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, RefreshControl, ActivityIndicator, TextInput } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Search, MessageSquarePlus, Archive, X } from 'lucide-react-native';

import { useChat } from '../../src/store/chat';
import { useAuth } from '../../src/store/auth';
import { ChatRow } from '../../src/components/ChatRow';
import { useTheme } from '../../src/theme';

export default function ChatsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const conversations = useChat((s) => s.conversations);
  const plain = useChat((s) => s.plain);
  const presence = useChat((s) => s.presence);
  const loaded = useChat((s) => s.loaded);
  const showArchived = useChat((s) => s.showArchived);
  const loadConversations = useChat((s) => s.loadConversations);
  const me = useAuth((s) => s.user);

  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);

  const visible = useMemo(() => {
    const scoped = conversations.filter((c) => !!c.archived === !!showArchived);
    if (!query.trim()) return scoped;

    const needle = query.trim().toLowerCase();
    return scoped.filter((c) => {
      const title = c.type === 'direct' ? c.peer?.name : c.name;
      return String(title || '').toLowerCase().includes(needle);
    });
  }, [conversations, showArchived, query]);

  const archivedCount = useMemo(
    () => conversations.filter((c) => c.archived).length,
    [conversations]
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadConversations({ archived: showArchived });
    } finally {
      setRefreshing(false);
    }
  }, [loadConversations, showArchived]);

  const renderItem = useCallback(
    ({ item }) => {
      const last = item.lastMessage;
      const mine = last && String(last.sender?._id || last.sender) === String(me?._id);
      const peerId = item.peer?._id;

      return (
        <ChatRow
          conversation={item}
          preview={last ? plain[last._id] : null}
          mine={!!mine}
          online={item.type === 'direct' && !!presence[peerId]}
          onPress={() => router.push('/chat/' + item._id)}
        />
      );
    },
    [plain, presence, me?._id]
  );

  return (
    <View style={[styles.screen, { backgroundColor: theme.surface, paddingTop: insets.top }]}>
      {/* ── header ── */}
      <View style={[styles.header, { borderBottomColor: theme.border }]}>
        {searching ? (
          <View style={[styles.searchBar, { backgroundColor: theme.surface3 }]}>
            <Search size={17} color={theme.inkMuted} strokeWidth={2.2} />
            <TextInput
              autoFocus
              value={query}
              onChangeText={setQuery}
              placeholder="Search chats"
              placeholderTextColor={theme.inkFaint}
              style={[styles.searchInput, { color: theme.ink }]}
            />
            <Pressable
              hitSlop={10}
              onPress={() => {
                setQuery('');
                setSearching(false);
              }}
            >
              <X size={18} color={theme.inkMuted} strokeWidth={2.2} />
            </Pressable>
          </View>
        ) : (
          <>
            <Text style={[styles.brand, { color: theme.ink }]}>
              {showArchived ? 'Archived' : 'Chax'}
            </Text>
            <View style={styles.headerActions}>
              <Pressable hitSlop={10} onPress={() => setSearching(true)}>
                <Search size={22} color={theme.inkSoft} strokeWidth={2.1} />
              </Pressable>
            </View>
          </>
        )}
      </View>

      {/* ── list ── */}
      {!loaded ? (
        <View style={styles.centre}>
          <ActivityIndicator color={theme.accent} />
        </View>
      ) : (
        <FlashList
          data={visible}
          renderItem={renderItem}
          keyExtractor={(item) => item._id}
          contentContainerStyle={{ paddingBottom: 96 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={theme.accent}
              colors={[theme.accent]}
              progressBackgroundColor={theme.surface3}
            />
          }
          ListHeaderComponent={
            !showArchived && archivedCount > 0 && !query ? (
              <Pressable
                onPress={() => loadConversations({ archived: true })}
                android_ripple={{ color: theme.surface3 }}
                style={[styles.archiveRow, { borderBottomColor: theme.border }]}
              >
                <Archive size={20} color={theme.inkMuted} strokeWidth={2} />
                <Text style={[styles.archiveLabel, { color: theme.ink }]}>Archived</Text>
                <Text style={[styles.archiveCount, { color: theme.inkMuted }]}>{archivedCount}</Text>
              </Pressable>
            ) : showArchived ? (
              <Pressable
                onPress={() => loadConversations({ archived: false })}
                android_ripple={{ color: theme.surface3 }}
                style={[styles.archiveRow, { borderBottomColor: theme.border }]}
              >
                <Text style={[styles.archiveLabel, { color: theme.accent }]}>← Back to chats</Text>
              </Pressable>
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={[styles.emptyTitle, { color: theme.ink }]}>
                {query ? 'Nothing matched' : showArchived ? 'No archived chats' : 'No chats yet'}
              </Text>
              <Text style={[styles.emptyBody, { color: theme.inkMuted }]}>
                {query
                  ? 'Try a different name.'
                  : 'Messages are end-to-end encrypted. Start one with the button below.'}
              </Text>
            </View>
          }
        />
      )}

      {/* ── new chat ── */}
      <Pressable
        onPress={() => router.push('/new')}
        android_ripple={{ color: 'rgba(255,255,255,.2)', borderless: false }}
        style={[styles.fab, { backgroundColor: theme.accent, bottom: 22 }]}
      >
        <MessageSquarePlus size={23} color="#fff" strokeWidth={2.2} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    height: 58,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  brand: { fontSize: 25, fontWeight: '700', letterSpacing: -0.5 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 20 },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    height: 40,
    borderRadius: 999,
    paddingHorizontal: 14,
  },
  searchInput: { flex: 1, fontSize: 15.5, padding: 0 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  archiveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  archiveLabel: { flex: 1, fontSize: 15.5, fontWeight: '600' },
  archiveCount: { fontSize: 13, fontWeight: '600' },
  empty: { alignItems: 'center', paddingTop: 90, paddingHorizontal: 44, gap: 8 },
  emptyTitle: { fontSize: 17, fontWeight: '700' },
  emptyBody: { fontSize: 14.5, textAlign: 'center', lineHeight: 21 },
  fab: {
    position: 'absolute',
    right: 18,
    width: 58,
    height: 58,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 5,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
});
