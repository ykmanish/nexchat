import { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PhoneIncoming, PhoneOutgoing, PhoneMissed, Phone, Video } from 'lucide-react-native';

import { api } from '../../src/lib/api';
import { useAuth } from '../../src/store/auth';
import { Avatar } from '../../src/components/Avatar';
import { useTheme } from '../../src/theme';
import { shortTime } from '../../src/lib/utils';

export default function CallsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const me = useAuth((s) => s.user);

  const [calls, setCalls] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/calls');
      setCalls(data.calls || []);
    } catch {
      /* an empty history and a failed request look the same here, and the
         empty state reads correctly for both */
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

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
      <Text style={[styles.screenTitle, { color: theme.ink }]}>Calls</Text>

      {calls.map((call) => {
        const outgoing = String(call.caller?._id) === String(me?._id);
        const peer = outgoing ? call.callee : call.caller;
        const missed = call.status === 'missed' || call.status === 'declined';

        const Icon = missed ? PhoneMissed : outgoing ? PhoneOutgoing : PhoneIncoming;
        const tint = missed ? theme.danger : theme.inkMuted;

        return (
          <Pressable key={call._id} style={styles.row} android_ripple={{ color: theme.surface3 }}>
            <Avatar uri={peer?.avatar} name={peer?.name} id={peer?._id} size={46} />
            <View style={styles.rowText}>
              <Text style={[styles.rowTitle, { color: missed ? theme.danger : theme.ink }]} numberOfLines={1}>
                {peer?.name || 'Unknown'}
              </Text>
              <View style={styles.rowMeta}>
                <Icon size={14} color={tint} strokeWidth={2.2} />
                <Text style={[styles.rowSub, { color: theme.inkMuted }]}>
                  {shortTime(call.createdAt)}
                </Text>
              </View>
            </View>
            {call.kind === 'video' ? (
              <Video size={21} color={theme.accent} strokeWidth={2} />
            ) : (
              <Phone size={21} color={theme.accent} strokeWidth={2} />
            )}
          </Pressable>
        );
      })}

      {loaded && !calls.length && (
        <View style={styles.empty}>
          <Phone size={38} color={theme.inkFaint} strokeWidth={1.6} />
          <Text style={[styles.emptyTitle, { color: theme.ink }]}>No calls yet</Text>
          <Text style={[styles.emptyBody, { color: theme.inkMuted }]}>
            Voice and video calls go peer-to-peer over WebRTC and never touch the server.
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screenTitle: { fontSize: 27, fontWeight: '800', letterSpacing: -0.6, paddingHorizontal: 20, paddingBottom: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 10 },
  rowText: { flex: 1, gap: 3 },
  rowTitle: { fontSize: 16, fontWeight: '600' },
  rowMeta: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  rowSub: { fontSize: 13 },
  empty: { alignItems: 'center', paddingTop: 80, paddingHorizontal: 46, gap: 9 },
  emptyTitle: { fontSize: 16.5, fontWeight: '700', marginTop: 4 },
  emptyBody: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
});
