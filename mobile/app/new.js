import { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, TextInput, ActivityIndicator, SectionList } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ArrowLeft, Search, UserPlus } from 'lucide-react-native';

import { useChat, idOf } from '../src/store/chat';
import { Avatar } from '../src/components/Avatar';
import { useTheme } from '../src/theme';
import { toast } from '../src/store/ui';

/**
 * Who you can start a chat with.
 *
 * A contact is one-directional, so the list is three groups rather than one:
 * people you saved, people who saved *you*, and people you already share a chat
 * with. Somebody who added you but whom you never saved is reachable and would
 * otherwise be invisible here — which is how a message from a stranger becomes
 * a conversation you cannot reply to from a fresh screen.
 */
export default function NewChatScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const contacts = useChat((s) => s.contacts);
  const addedYou = useChat((s) => s.addedYou);
  const messaged = useChat((s) => s.messaged);
  const contactsLoaded = useChat((s) => s.contactsLoaded);
  const loadContacts = useChat((s) => s.loadContacts);
  const createDirect = useChat((s) => s.createDirect);

  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(null);

  useEffect(() => {
    loadContacts().catch(() => {});
  }, [loadContacts]);

  const sections = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const match = (list) =>
      (list || []).filter(
        (p) =>
          !needle ||
          String(p.name || '').toLowerCase().includes(needle) ||
          String(p.email || '').toLowerCase().includes(needle)
      );

    return [
      { title: 'Contacts', data: match(contacts) },
      { title: 'Added you', data: match(addedYou) },
      { title: 'You have chatted with', data: match(messaged) },
    ].filter((s) => s.data.length);
  }, [contacts, addedYou, messaged, query]);

  const open = async (person) => {
    const userId = idOf(person);
    setBusy(userId);
    try {
      const conversation = await createDirect(userId);
      router.replace('/chat/' + conversation._id);
    } catch (err) {
      toast.error(err.message || 'Could not open that chat');
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={[styles.screen, { backgroundColor: theme.surface, paddingTop: insets.top }]}>
      <View style={[styles.header, { borderBottomColor: theme.border }]}>
        <Pressable hitSlop={12} onPress={() => router.back()}>
          <ArrowLeft size={24} color={theme.ink} strokeWidth={2.1} />
        </Pressable>
        <Text style={[styles.title, { color: theme.ink }]}>New chat</Text>
      </View>

      <View style={styles.searchWrap}>
        <View style={[styles.searchBar, { backgroundColor: theme.surface3 }]}>
          <Search size={17} color={theme.inkMuted} strokeWidth={2.2} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search name or email"
            placeholderTextColor={theme.inkFaint}
            style={[styles.searchInput, { color: theme.ink }]}
            autoCapitalize="none"
          />
        </View>
      </View>

      {!contactsLoaded ? (
        <View style={styles.centre}>
          <ActivityIndicator color={theme.accent} />
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => idOf(item)}
          contentContainerStyle={{ paddingBottom: 30 }}
          stickySectionHeadersEnabled={false}
          renderSectionHeader={({ section }) => (
            <Text style={[styles.sectionTitle, { color: theme.inkMuted, backgroundColor: theme.surface }]}>
              {section.title}
            </Text>
          )}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => open(item)}
              android_ripple={{ color: theme.surface3 }}
              style={styles.row}
            >
              <Avatar uri={item.avatar} name={item.name} id={idOf(item)} size={46} />
              <View style={styles.rowText}>
                <Text style={[styles.rowTitle, { color: theme.ink }]} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={[styles.rowSub, { color: theme.inkMuted }]} numberOfLines={1}>
                  {item.about || item.email}
                </Text>
              </View>
              {busy === idOf(item) && <ActivityIndicator size="small" color={theme.accent} />}
            </Pressable>
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <UserPlus size={36} color={theme.inkFaint} strokeWidth={1.6} />
              <Text style={[styles.emptyTitle, { color: theme.ink }]}>
                {query ? 'Nobody matched' : 'No one to chat with yet'}
              </Text>
              <Text style={[styles.emptyBody, { color: theme.inkMuted }]}>
                {query
                  ? 'Try a different name or email.'
                  : 'People who add you show up here too, so they can write first.'}
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
    height: 56,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: 19, fontWeight: '700', letterSpacing: -0.3 },
  searchWrap: { paddingHorizontal: 14, paddingVertical: 10 },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    height: 42,
    borderRadius: 999,
    paddingHorizontal: 14,
  },
  searchInput: { flex: 1, fontSize: 15.5, padding: 0 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  sectionTitle: {
    fontSize: 12.5,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 6,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 13, paddingHorizontal: 16, paddingVertical: 9 },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 16, fontWeight: '600' },
  rowSub: { fontSize: 13.5 },
  empty: { alignItems: 'center', paddingTop: 70, paddingHorizontal: 46, gap: 9 },
  emptyTitle: { fontSize: 16.5, fontWeight: '700', marginTop: 4 },
  emptyBody: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
});
