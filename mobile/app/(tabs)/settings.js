import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Switch, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import {
  Bell, BellOff, ShieldCheck, Smartphone, LogOut, ChevronRight,
  CircleCheck, TriangleAlert, Send,
} from 'lucide-react-native';

import { useAuth } from '../../src/store/auth';
import { Avatar } from '../../src/components/Avatar';
import { useTheme } from '../../src/theme';
import { toast } from '../../src/store/ui';
import * as notifications from '../../src/lib/notifications';
import { HAS_FCM, API_ORIGIN } from '../../src/lib/config';

export default function SettingsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const user = useAuth((s) => s.user);
  const devices = useAuth((s) => s.devices);
  const logout = useAuth((s) => s.logout);
  const updateSettings = useAuth((s) => s.updateSettings);
  const refreshDevices = useAuth((s) => s.refreshDevices);

  const [push, setPush] = useState({ state: 'checking' });
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    refreshDevices?.().catch(() => {});
    notifications
      .pushConfig()
      .then((config) => setPush({ state: 'ready', ...config }))
      .catch(() => setPush({ state: 'ready', enabled: false }));
  }, [refreshDevices]);

  const enablePush = async () => {
    try {
      const { transport } = await notifications.registerForPush();
      setPush((p) => ({ ...p, registered: true, transport }));
      toast.success(
        transport === 'fcm'
          ? 'Notifications are on.'
          : 'Notifications are on while Chax is running.'
      );
    } catch (err) {
      toast.error(err.message);
    }
  };

  const sendTest = async () => {
    setTesting(true);
    try {
      await notifications.sendTestNotification();
      toast.success('Sent — it should arrive in a moment.');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setTesting(false);
    }
  };

  return (
    <ScrollView
      style={{ backgroundColor: theme.app }}
      contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: 40 }}
    >
      <Text style={[styles.screenTitle, { color: theme.ink }]}>Settings</Text>

      {/* ── profile ── */}
      <Pressable
        style={[styles.profile, { backgroundColor: theme.surface }]}
        android_ripple={{ color: theme.surface3 }}
      >
        <Avatar uri={user?.avatar} name={user?.name} id={user?._id} size={58} />
        <View style={styles.profileText}>
          <Text style={[styles.profileName, { color: theme.ink }]} numberOfLines={1}>
            {user?.name || 'You'}
          </Text>
          <Text style={[styles.profileMeta, { color: theme.inkMuted }]} numberOfLines={1}>
            {user?.about || user?.email}
          </Text>
        </View>
        <ChevronRight size={20} color={theme.inkFaint} />
      </Pressable>

      {/* ── notifications ── */}
      <Section title="Notifications" theme={theme}>
        {push.state === 'checking' ? (
          <View style={styles.rowPad}>
            <ActivityIndicator size="small" color={theme.inkMuted} />
          </View>
        ) : (
          <>
            <Row
              theme={theme}
              icon={push.registered ? Bell : BellOff}
              title={push.registered ? 'Notifications are on' : 'Turn on notifications'}
              subtitle={
                push.registered
                  ? push.transport === 'fcm'
                    ? 'Delivered by Firebase, even when Chax is closed.'
                    : 'Delivered while Chax is running.'
                  : 'Be told when someone writes to you.'
              }
              onPress={push.registered ? undefined : enablePush}
              trailing={
                push.registered ? (
                  <CircleCheck size={20} color={theme.accent} strokeWidth={2.2} />
                ) : (
                  <ChevronRight size={20} color={theme.inkFaint} />
                )
              }
            />

            {/* The one configuration problem that is invisible from both ends:
                a server with no VAPID keys mints a pair at boot, and every
                stored subscription stops working at the next restart. */}
            {push.ephemeral && (
              <Warning theme={theme}>
                The server's push keys are temporary — notifications will stop working
                the next time it restarts. Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY
                in its environment.
              </Warning>
            )}

            {!HAS_FCM && (
              <Warning theme={theme}>
                This build has no Firebase config, so notifications only arrive while
                Chax is running. Add google-services.json and rebuild for delivery when
                the app is closed.
              </Warning>
            )}

            <Row
              theme={theme}
              icon={Send}
              title="Send a test notification"
              subtitle="Round-trips through the server, so it tests the whole chain."
              onPress={sendTest}
              trailing={testing ? <ActivityIndicator size="small" color={theme.inkMuted} /> : null}
            />

            <Toggle
              theme={theme}
              title="Typing notices"
              subtitle="Be told when someone starts writing. Off by default."
              value={user?.settings?.notifications?.typing === true}
              onValueChange={(v) => updateSettings({ notifications: { typing: v } })}
            />
          </>
        )}
      </Section>

      {/* ── privacy ── */}
      <Section title="Privacy and security" theme={theme}>
        <Row
          theme={theme}
          icon={ShieldCheck}
          title="Encryption"
          subtitle="Messages, media and stories are end-to-end encrypted."
          trailing={<ChevronRight size={20} color={theme.inkFaint} />}
        />
        <Row
          theme={theme}
          icon={Smartphone}
          title="Linked devices"
          subtitle={`${devices?.length || 1} device${(devices?.length || 1) === 1 ? '' : 's'} signed in`}
          trailing={<ChevronRight size={20} color={theme.inkFaint} />}
        />
      </Section>

      <Section title="Haptics" theme={theme}>
        <Toggle
          theme={theme}
          title="Vibrate on send and receive"
          value={user?.settings?.haptics !== false}
          onValueChange={(v) => updateSettings({ haptics: v })}
        />
      </Section>

      {/* ── sign out ── */}
      <Section theme={theme}>
        <Row
          theme={theme}
          icon={LogOut}
          title="Sign out"
          subtitle="Clears the keys and cached messages on this device."
          danger
          onPress={async () => {
            await logout();
            router.replace('/(auth)/login');
          }}
        />
      </Section>

      <Text style={[styles.footer, { color: theme.inkFaint }]}>
        Chax 1.0.0 · {API_ORIGIN.replace(/^https?:\/\//, '')}
      </Text>
    </ScrollView>
  );
}

/* ────────────────────────────── pieces ────────────────────────────── */

function Section({ title, children, theme }) {
  return (
    <View style={styles.section}>
      {!!title && <Text style={[styles.sectionTitle, { color: theme.inkMuted }]}>{title}</Text>}
      <View style={[styles.card, { backgroundColor: theme.surface }]}>{children}</View>
    </View>
  );
}

function Row({ icon: Icon, title, subtitle, onPress, trailing, danger, theme }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      android_ripple={onPress ? { color: theme.surface3 } : undefined}
      style={styles.row}
    >
      {Icon && (
        <Icon size={21} color={danger ? theme.danger : theme.inkMuted} strokeWidth={2} />
      )}
      <View style={styles.rowText}>
        <Text style={[styles.rowTitle, { color: danger ? theme.danger : theme.ink }]}>{title}</Text>
        {!!subtitle && (
          <Text style={[styles.rowSub, { color: theme.inkMuted }]}>{subtitle}</Text>
        )}
      </View>
      {trailing}
    </Pressable>
  );
}

function Toggle({ title, subtitle, value, onValueChange, theme }) {
  return (
    <View style={styles.row}>
      <View style={styles.rowText}>
        <Text style={[styles.rowTitle, { color: theme.ink }]}>{title}</Text>
        {!!subtitle && <Text style={[styles.rowSub, { color: theme.inkMuted }]}>{subtitle}</Text>}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ true: theme.accent, false: theme.surface3 }}
        thumbColor="#fff"
      />
    </View>
  );
}

function Warning({ children, theme }) {
  return (
    <View style={[styles.warning, { backgroundColor: theme.surface2, borderLeftColor: theme.warn }]}>
      <TriangleAlert size={15} color={theme.warn} strokeWidth={2.2} />
      <Text style={[styles.warningText, { color: theme.inkSoft }]}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screenTitle: { fontSize: 27, fontWeight: '800', letterSpacing: -0.6, paddingHorizontal: 20, paddingBottom: 14 },
  profile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 18,
    paddingVertical: 15,
    marginBottom: 8,
  },
  profileText: { flex: 1, gap: 3 },
  profileName: { fontSize: 19, fontWeight: '700', letterSpacing: -0.3 },
  profileMeta: { fontSize: 14 },
  section: { marginTop: 16 },
  sectionTitle: {
    fontSize: 12.5,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    paddingHorizontal: 20,
    paddingBottom: 7,
  },
  card: { paddingVertical: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 15, paddingHorizontal: 18, paddingVertical: 13 },
  rowPad: { padding: 18 },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 15.5, fontWeight: '600' },
  rowSub: { fontSize: 13, lineHeight: 18 },
  warning: {
    flexDirection: 'row',
    gap: 9,
    marginHorizontal: 14,
    marginBottom: 8,
    padding: 11,
    borderRadius: 9,
    borderLeftWidth: 3,
    alignItems: 'flex-start',
  },
  warningText: { flex: 1, fontSize: 12.5, lineHeight: 18 },
  footer: { textAlign: 'center', fontSize: 12, marginTop: 26 },
});
