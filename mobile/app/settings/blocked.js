import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, FlatList, Alert } from 'react-native';
import { Ban } from 'lucide-react-native';

import { SettingsScreen, Row } from '../../src/components/Settings';
import { Avatar } from '../../src/components/Avatar';
import { useTheme, font } from '../../src/theme';
import { api } from '../../src/lib/api';
import { toast } from '../../src/store/ui';
import { idOf } from '../../src/lib/utils';

export default function BlockedScreen() {
  const theme = useTheme();
  const [people, setPeople] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);

  const load = useCallback(() => {
    api
      .get('/users/blocked')
      .then(({ data }) => setPeople(data.blocked || []))
      .catch(() => setPeople([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const unblock = (person) => {
    Alert.alert('Unblock ' + person.name + '?', 'They will be able to message you again.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Unblock',
        onPress: async () => {
          setBusy(idOf(person));
          try {
            await api.delete('/users/block/' + idOf(person));
            load();
            toast.success(person.name + ' unblocked');
          } catch (err) {
            toast.error(err.message || 'That did not work');
          } finally {
            setBusy(null);
          }
        },
      },
    ]);
  };

  return (
    <SettingsScreen title="Blocked contacts" subtitle="People who cannot reach you" scroll={false}>
      {loading ? (
        <View style={styles.centre}>
          <ActivityIndicator color={theme.accentStrong} />
        </View>
      ) : (
        <FlatList
          data={people}
          keyExtractor={(p) => idOf(p)}
          contentContainerStyle={{ paddingTop: 8, paddingBottom: 40 }}
          renderItem={({ item }) => (
            <View style={{ backgroundColor: theme.surface }}>
              <Row
                title={item.name}
                subtitle={item.username ? '@' + item.username : item.email}
                value="Unblock"
                chevron={false}
                loading={busy === idOf(item)}
                onPress={() => unblock(item)}
              />
            </View>
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ban size={36} color={theme.inkFaint} strokeWidth={1.6} />
              <Text style={[styles.emptyTitle, { color: theme.ink }]}>Nobody is blocked</Text>
              <Text style={[styles.emptyBody, { color: theme.inkMuted }]}>
                Blocking someone stops their messages and hides your last seen from them.
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
  empty: { alignItems: 'center', paddingTop: 80, paddingHorizontal: 44, gap: 9 },
  emptyTitle: { fontSize: 16.5, fontWeight: '700', marginTop: 4, fontFamily: font.body },
  emptyBody: { fontSize: 14, textAlign: 'center', lineHeight: 20, fontFamily: font.body },
});
