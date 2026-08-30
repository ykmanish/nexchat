import { useEffect, useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CircleDashed } from 'lucide-react-native';

import { useChat } from '../../src/store/chat';
import { useAuth } from '../../src/store/auth';
import { Avatar } from '../../src/components/Avatar';
import { useTheme } from '../../src/theme';
import { shortTime } from '../../src/lib/utils';

/** Stories — 24-hour encrypted updates, grouped into one ring per person. */
export default function UpdatesScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const stories = useChat((s) => s.stories);
  const loadStories = useChat((s) => s.loadStories);
  const me = useAuth((s) => s.user);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    loadStories().catch(() => {});
  }, [loadStories]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadStories();
    } catch {
      /* the empty state already says there is nothing */
    } finally {
      setRefreshing(false);
    }
  }, [loadStories]);

  const mine = stories.find((r) => String(r.user?._id) === String(me?._id));
  const others = stories.filter((r) => String(r.user?._id) !== String(me?._id));

  return (
    <ScrollView
      style={{ backgroundColor: theme.surface }}
      contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: 40 }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={theme.accent}
          colors={[theme.accent]}
          progressBackgroundColor={theme.surface3}
        />
      }
    >
      <Text style={[styles.screenTitle, { color: theme.ink }]}>Updates</Text>

      <Text style={[styles.sectionTitle, { color: theme.inkMuted }]}>Status</Text>

      <Pressable style={styles.row} android_ripple={{ color: theme.surface3 }}>
        <View>
          <Avatar uri={me?.avatar} name={me?.name} id={me?._id} size={50} />
          <View style={[styles.plus, { backgroundColor: theme.accent, borderColor: theme.surface }]}>
            <Text style={styles.plusText}>+</Text>
          </View>
        </View>
        <View style={styles.rowText}>
          <Text style={[styles.rowTitle, { color: theme.ink }]}>My status</Text>
          <Text style={[styles.rowSub, { color: theme.inkMuted }]}>
            {mine ? `${mine.stories?.length || 0} update${mine.stories?.length === 1 ? '' : 's'}` : 'Tap to add an update'}
          </Text>
        </View>
      </Pressable>

      {others.length > 0 && (
        <>
          <Text style={[styles.sectionTitle, { color: theme.inkMuted }]}>Recent</Text>
          {others.map((ring) => (
            <Pressable key={ring.user?._id} style={styles.row} android_ripple={{ color: theme.surface3 }}>
              <View
                style={[
                  styles.ring,
                  { borderColor: ring.allViewed ? theme.borderStrong : theme.accent },
                ]}
              >
                <Avatar uri={ring.user?.avatar} name={ring.user?.name} id={ring.user?._id} size={46} />
              </View>
              <View style={styles.rowText}>
                <Text style={[styles.rowTitle, { color: theme.ink }]}>{ring.user?.name}</Text>
                <Text style={[styles.rowSub, { color: theme.inkMuted }]}>
                  {shortTime(ring.latestAt)}
                </Text>
              </View>
            </Pressable>
          ))}
        </>
      )}

      {!others.length && (
        <View style={styles.empty}>
          <CircleDashed size={38} color={theme.inkFaint} strokeWidth={1.6} />
          <Text style={[styles.emptyTitle, { color: theme.ink }]}>No recent updates</Text>
          <Text style={[styles.emptyBody, { color: theme.inkMuted }]}>
            Updates from your contacts appear here for 24 hours, encrypted end to end.
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screenTitle: { fontSize: 27, fontWeight: '800', letterSpacing: -0.6, paddingHorizontal: 20, paddingBottom: 10 },
  sectionTitle: {
    fontSize: 12.5,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 6,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 9 },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 16, fontWeight: '600' },
  rowSub: { fontSize: 13.5 },
  ring: { padding: 2, borderRadius: 999, borderWidth: 2.2 },
  plus: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 21,
    height: 21,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  plusText: { color: '#fff', fontSize: 14, fontWeight: '800', lineHeight: 16 },
  empty: { alignItems: 'center', paddingTop: 60, paddingHorizontal: 46, gap: 9 },
  emptyTitle: { fontSize: 16.5, fontWeight: '700', marginTop: 4 },
  emptyBody: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
});
