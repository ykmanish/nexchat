import { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator, FlatList } from 'react-native';
import { router } from 'expo-router';
import { Star } from 'lucide-react-native';

import { useChat } from '../../src/store/chat';
import { SettingsScreen } from '../../src/components/Settings';
import { Avatar } from '../../src/components/Avatar';
import { useTheme, font } from '../../src/theme';
import { api } from '../../src/lib/api';
import { shortTime } from '../../src/lib/utils';

export default function StarredScreen() {
  const theme = useTheme();
  const decryptMany = useChat((s) => s.decryptMany);
  const plain = useChat((s) => s.plain);

  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/messages/starred');
      const list = data.messages || [];
      setMessages(list);
      // Starred messages come back as envelopes like any other, so they still
      // have to be opened locally before there is anything to show.
      await decryptMany(list);
    } catch {
      setMessages([]);
    } finally {
      setLoading(false);
    }
  }, [decryptMany]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <SettingsScreen title="Starred messages" scroll={false}>
      {loading ? (
        <View style={styles.centre}>
          <ActivityIndicator color={theme.accentStrong} />
        </View>
      ) : (
        <FlatList
          data={messages}
          keyExtractor={(m) => m._id}
          contentContainerStyle={{ paddingBottom: 40 }}
          renderItem={({ item }) => {
            const payload = plain[item._id];
            return (
              <Pressable
                onPress={() => router.push('/chat/' + String(item.conversation))}
                android_ripple={{ color: theme.surface3 }}
                style={[styles.row, { backgroundColor: theme.surface }]}
              >
                <Avatar
                  uri={item.sender?.avatar}
                  name={item.sender?.name}
                  id={item.sender?._id}
                  size={40}
                />
                <View style={styles.text}>
                  <View style={styles.top}>
                    <Text style={[styles.name, { color: theme.ink }]} numberOfLines={1}>
                      {item.sender?.name || 'Someone'}
                    </Text>
                    <Text style={[styles.time, { color: theme.inkFaint }]}>
                      {shortTime(item.createdAt)}
                    </Text>
                  </View>
                  <Text style={[styles.body, { color: theme.inkMuted }]} numberOfLines={2}>
                    {payload?.text || 'Encrypted message'}
                  </Text>
                </View>
                <Star size={15} color={theme.accentStrong} fill={theme.accentStrong} />
              </Pressable>
            );
          }}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Star size={38} color={theme.inkFaint} strokeWidth={1.6} />
              <Text style={[styles.emptyTitle, { color: theme.ink }]}>Nothing starred</Text>
              <Text style={[styles.emptyBody, { color: theme.inkMuted }]}>
                Long-press any message and choose Star to keep it here.
              </Text>
            </View>
          }
        />
      )}
    </SettingsScreen>
  );
}

const styles = StyleSheet.create({
  centre: { padding: 44, alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  text: { flex: 1, gap: 3 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { flex: 1, fontSize: 15, fontWeight: '700', fontFamily: font.body },
  time: { fontSize: 12, fontFamily: font.body },
  body: { fontSize: 14, lineHeight: 19, fontFamily: font.body },
  empty: { alignItems: 'center', paddingTop: 80, paddingHorizontal: 44, gap: 9 },
  emptyTitle: { fontSize: 16.5, fontWeight: '700', marginTop: 4, fontFamily: font.body },
  emptyBody: { fontSize: 14, textAlign: 'center', lineHeight: 20, fontFamily: font.body },
});
