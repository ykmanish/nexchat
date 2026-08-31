import { useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import {
  User, Lock, MonitorSmartphone, DatabaseBackup, ScanEye,
  Palette, Bell, Star, ShieldCheck, CircleHelp, LogOut, ChevronRight,
} from 'lucide-react-native';

import { useAuth } from '../../src/store/auth';
import { Avatar } from '../../src/components/Avatar';
import { LockIcon } from '../../src/components/Brand';
import { Group, Row, Divider } from '../../src/components/Settings';
import { useTheme, font, heading } from '../../src/theme';

export default function YouScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const user = useAuth((s) => s.user);
  const devices = useAuth((s) => s.devices);
  const logout = useAuth((s) => s.logout);
  const refreshDevices = useAuth((s) => s.refreshDevices);

  useEffect(() => {
    refreshDevices?.().catch(() => {});
  }, [refreshDevices]);

  const go = (path) => () => router.push(path);

  return (
    <ScrollView
      style={{ backgroundColor: theme.app }}
      contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: 40 }}
    >
      <Text style={[heading(27), styles.screenTitle, { color: theme.ink }]}>Settings</Text>

      <Pressable
        onPress={go('/settings/profile')}
        android_ripple={{ color: theme.surface3 }}
        style={[styles.profile, { backgroundColor: theme.surface }]}
      >
        <Avatar uri={user?.avatar} name={user?.name} id={user?._id} size={62} />
        <View style={styles.profileText}>
          <Text style={[heading(20), { color: theme.ink }]} numberOfLines={1}>
            {user?.name || 'You'}
          </Text>
          <Text style={[styles.profileAbout, { color: theme.inkMuted }]} numberOfLines={1}>
            {user?.about || 'Available'}
          </Text>
          {!!user?.username && (
            <Text style={[styles.profileHandle, { color: theme.inkFaint }]} numberOfLines={1}>
              @{user.username}
            </Text>
          )}
        </View>
        <ChevronRight size={20} color={theme.inkFaint} />
      </Pressable>

      {/* The reassurance the web puts directly under the profile card. */}
      <View style={styles.badgeWrap}>
        <View style={[styles.badge, { backgroundColor: theme.accentTint }]}>
          <LockIcon size={11} color={theme.accentStrong} />
          <Text style={[styles.badgeText, { color: theme.accentStrong }]}>
            Your keys live on this device only
          </Text>
        </View>
      </View>

      <Group>
        <Row icon={User} title="Profile" subtitle="Name, username, photo" onPress={go('/settings/profile')} />
        <Divider />
        <Row icon={Lock} title="Privacy" subtitle="Last seen, read receipts, blocked" onPress={go('/settings/privacy')} />
        <Divider />
        <Row
          icon={MonitorSmartphone}
          title="Linked devices"
          subtitle={(devices?.length || 1) + ' active'}
          onPress={go('/settings/devices')}
        />
        <Divider />
        <Row icon={DatabaseBackup} title="Chat backup" subtitle="Keep a copy you can read" onPress={go('/settings/backup')} />
        <Divider />
        <Row icon={ScanEye} title="What the server knows" subtitle="Your metadata footprint, live" onPress={go('/settings/transparency')} />
      </Group>

      <Group>
        <Row icon={Palette} title="Appearance" subtitle="Theme, wallpaper, text size" onPress={go('/settings/appearance')} />
        <Divider />
        <Row icon={Bell} title="Notifications" subtitle="Sounds and alerts" onPress={go('/settings/notifications')} />
        <Divider />
        <Row icon={Star} title="Starred messages" onPress={go('/settings/starred')} />
      </Group>

      <Group>
        <Row icon={ShieldCheck} title="How encryption works" subtitle="What Chax can and cannot see" onPress={go('/settings/encryption')} />
        <Divider />
        <Row icon={CircleHelp} title="About Chax" subtitle="Version 1.0.0" onPress={go('/settings/about')} />
      </Group>

      <Group>
        <Row
          icon={LogOut}
          title="Sign out"
          subtitle="Removes your keys from this device"
          danger
          chevron={false}
          onPress={async () => {
            await logout();
            router.replace('/(auth)/login');
          }}
        />
      </Group>

      <View style={styles.footer}>
        <Text style={[styles.footerText, { color: theme.inkFaint }]}>
          Signed in as {user?.email}
        </Text>
        {!!user?.securityCode && (
          <Text style={[styles.footerText, { color: theme.inkFaint }]}>
            Security code {user.securityCode}
          </Text>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screenTitle: { paddingHorizontal: 20, paddingBottom: 14 },
  profile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginHorizontal: 12,
    paddingHorizontal: 14,
    paddingVertical: 15,
    borderRadius: 14,
  },
  profileText: { flex: 1, gap: 2 },
  profileAbout: { fontSize: 14, fontFamily: font.body },
  profileHandle: { fontSize: 13, fontFamily: font.body },
  badgeWrap: { alignItems: 'center', paddingTop: 14 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  badgeText: { fontSize: 12.5, fontWeight: '600', fontFamily: font.body },
  footer: { alignItems: 'center', paddingTop: 22, gap: 3 },
  footerText: { fontSize: 12, fontFamily: font.body },
});
