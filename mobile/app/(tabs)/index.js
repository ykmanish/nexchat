import { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, RefreshControl, ActivityIndicator, TextInput, ScrollView,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Search, MessageSquarePlus, Archive, X, EllipsisVertical, Plus } from 'lucide-react-native';

import { useChat } from '../../src/store/chat';
import { useUI } from '../../src/store/ui';
import { useAuth } from '../../src/store/auth';
import { ChatRow } from '../../src/components/ChatRow';
import { Avatar } from '../../src/components/Avatar';
import { useTheme, font, heading } from '../../src/theme';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'unread', label: 'Unread' },
  { id: 'groups', label: 'Groups' },
];

export default function ChatsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const conversations = useChat((s) => s.conversations);
  const plain = useChat((s) => s.plain);
  const presence = useChat((s) => s.presence);
  const loaded = useChat((s) => s.loaded);
  const showArchived = useChat((s) => s.showArchived);
  const stories = useChat((s) => s.stories);
  const loadConversations = useChat((s) => s.loadConversations);
  const me = useAuth((s) => s.user);
  const openSheet = useUI((s) => s.openSheet);

  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');

  const visible = useMemo(() => {
    let scoped = conversations.filter((c) => !!c.archived === !!showArchived);

    if (filter === 'unread') scoped = scoped.filter((c) => (c.unreadCount || 0) > 0);
    if (filter === 'groups') scoped = scoped.filter((c) => c.type !== 'direct');

    const needle = query.trim().toLowerCase();
    if (!needle) return scoped;

    return scoped.filter((c) => {
      const title = c.type === 'direct' ? c.peer?.name : c.name;
      return String(title || '').toLowerCase().includes(needle);
    });
  }, [conversations, showArchived, query, filter]);

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

      return (
        <ChatRow
          conversation={item}
          preview={last ? plain[last._id] : null}
          mine={!!mine}
          online={item.type === 'direct' && !!presence[item.peer?._id]}
          onPress={() => router.push('/chat/' + item._id)}
          onLongPress={() => openSheet('chatOptions', { conversation: item })}
        />
      );
    },
    [plain, presence, me?._id, openSheet]
  );

  return (
    <View style={[styles.screen, { backgroundColor: theme.surface, paddingTop: insets.top }]}>
      {/* ── brand row ── */}
      <View style={styles.brandRow}>
        <Text style={[heading(26), { color: theme.accentStrong }]}>
          {showArchived ? 'Archived' : 'Chax'}
        </Text>
        <View style={styles.brandActions}>
          <Pressable hitSlop={10} onPress={() => openSheet('chatListMenu')}>
            <EllipsisVertical size={22} color={theme.inkSoft} strokeWidth={2.1} />
          </Pressable>
        </View>
      </View>

      {/* ── search ── */}
      <View style={styles.searchWrap}>
        <View style={[styles.searchBar, { backgroundColor: theme.surface3 }]}>
          <Search size={18} color={theme.inkMuted} strokeWidth={2.2} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search or start a new chat"
            placeholderTextColor={theme.inkFaint}
            style={[styles.searchInput, { color: theme.ink }]}
          />
          {!!query && (
            <Pressable hitSlop={10} onPress={() => setQuery('')}>
              <X size={17} color={theme.inkMuted} strokeWidth={2.2} />
            </Pressable>
          )}
        </View>
      </View>

      {/* ── filter pills ── */}
      <View style={styles.filters}>
        {FILTERS.map((f) => {
          const on = filter === f.id;
          return (
            <Pressable
              key={f.id}
              onPress={() => setFilter(f.id)}
              style={[styles.pill, { backgroundColor: on ? theme.accentTint : theme.surface3 }]}
            >
              <Text
                style={[
                  styles.pillText,
                  {
                    color: on ? theme.accentStrong : theme.inkMuted,
                    fontWeight: on ? '700' : '600',
                  },
                ]}
              >
                {f.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* ── list ── */}
      {!loaded ? (
        <View style={styles.centre}>
          <ActivityIndicator color={theme.accentStrong} />
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
              tintColor={theme.accentStrong}
              colors={[theme.accentStrong]}
              progressBackgroundColor={theme.surface3}
            />
          }
          ListHeaderComponent={
            <View>
              {/* story rail */}
              {!showArchived && !query && (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.rail}
                >
                  <Pressable style={styles.railItem} onPress={() => router.push('/(tabs)/updates')}>
                    <View style={[styles.addStory, { borderColor: theme.borderStrong }]}>
                      <Plus size={22} color={theme.inkMuted} strokeWidth={2.2} />
                    </View>
                    <Text style={[styles.railLabel, { color: theme.inkMuted }]} numberOfLines={1}>
                      Add story
                    </Text>
                  </Pressable>

                  {(stories || []).map((ring) => (
                    <Pressable
                      key={String(ring.user?._id)}
                      style={styles.railItem}
                      onPress={() => router.push('/(tabs)/updates')}
                    >
                      <View
                        style={[
                          styles.ring,
                          { borderColor: ring.allViewed ? theme.borderStrong : theme.accentStrong },
                        ]}
                      >
                        <Avatar
                          uri={ring.user?.avatar}
                          name={ring.user?.name}
                          id={ring.user?._id}
                          size={52}
                        />
                      </View>
                      <Text style={[styles.railLabel, { color: theme.inkMuted }]} numberOfLines={1}>
                        {(ring.user?.name || '').split(' ')[0]}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>
              )}

              {!showArchived && archivedCount > 0 && !query ? (
                <Pressable
                  onPress={() => loadConversations({ archived: true })}
                  android_ripple={{ color: theme.surface3 }}
                  style={[styles.archiveRow, { borderBottomColor: theme.border }]}
                >
                  <Archive size={20} color={theme.inkMuted} strokeWidth={2} />
                  <Text style={[styles.archiveLabel, { color: theme.ink }]}>Archived</Text>
                  <Text style={[styles.archiveCount, { color: theme.inkMuted }]}>
                    {archivedCount}
                  </Text>
                </Pressable>
              ) : showArchived ? (
                <Pressable
                  onPress={() => loadConversations({ archived: false })}
                  android_ripple={{ color: theme.surface3 }}
                  style={[styles.archiveRow, { borderBottomColor: theme.border }]}
                >
                  <Text style={[styles.archiveLabel, { color: theme.accentStrong }]}>
                    ← Back to chats
                  </Text>
                </Pressable>
              ) : null}
            </View>
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={[styles.emptyTitle, { color: theme.ink }]}>
                {query
                  ? 'Nothing matched'
                  : filter === 'unread'
                    ? 'Nothing unread'
                    : filter === 'groups'
                      ? 'No groups yet'
                      : showArchived
                        ? 'No archived chats'
                        : 'No chats yet'}
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
        onPress={() => openSheet('new')}
        android_ripple={{ color: 'rgba(20,32,10,.15)', borderless: false }}
        style={[styles.fab, { backgroundColor: theme.accent }]}
      >
        <MessageSquarePlus size={23} color={theme.accentInk} strokeWidth={2.2} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 6,
  },
  brandActions: { flexDirection: 'row', alignItems: 'center', gap: 22 },
  searchWrap: { paddingHorizontal: 14, paddingVertical: 6 },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 44,
    borderRadius: 999,
    paddingHorizontal: 16,
  },
  searchInput: { flex: 1, fontSize: 15.5, padding: 0, fontFamily: font.body },
  filters: { flexDirection: 'row', gap: 8, paddingHorizontal: 14, paddingBottom: 10 },
  pill: { paddingHorizontal: 18, paddingVertical: 8, borderRadius: 999 },
  pillText: { fontSize: 14, fontFamily: font.body },
  rail: { paddingHorizontal: 14, paddingBottom: 12, gap: 16 },
  railItem: { alignItems: 'center', gap: 6, width: 64 },
  addStory: {
    width: 58,
    height: 58,
    borderRadius: 29,
    borderWidth: 2,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: { padding: 2, borderRadius: 999, borderWidth: 2.2 },
  railLabel: { fontSize: 12, fontFamily: font.body },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  archiveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  archiveLabel: { flex: 1, fontSize: 15.5, fontWeight: '600', fontFamily: font.body },
  archiveCount: { fontSize: 13, fontWeight: '600', fontFamily: font.body },
  empty: { alignItems: 'center', paddingTop: 70, paddingHorizontal: 44, gap: 8 },
  emptyTitle: { fontSize: 17, fontWeight: '700', fontFamily: font.body },
  emptyBody: { fontSize: 14.5, textAlign: 'center', lineHeight: 21, fontFamily: font.body },
  fab: {
    position: 'absolute',
    right: 18,
    bottom: 22,
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
