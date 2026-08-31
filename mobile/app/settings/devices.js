import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, Alert, RefreshControl, ScrollView } from 'react-native';
import { Smartphone, Monitor, Tablet, LogOut } from 'lucide-react-native';

import { useAuth } from '../../src/store/auth';
import { SettingsScreen, Group, Row, Divider, Note } from '../../src/components/Settings';
import { useTheme, font } from '../../src/theme';
import { api } from '../../src/lib/api';
import { toast } from '../../src/store/ui';
import { shortTime } from '../../src/lib/utils';

const iconFor = (device) =>
  device.formFactor === 'desktop' ? Monitor : device.formFactor === 'tablet' ? Tablet : Smartphone;

export default function DevicesScreen() {
  const theme = useTheme();
  const devices = useAuth((s) => s.devices);
  const refreshDevices = useAuth((s) => s.refreshDevices);

  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(null);

  useEffect(() => {
    refreshDevices?.().catch(() => {});
  }, [refreshDevices]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refreshDevices?.().catch(() => {});
    setRefreshing(false);
  }, [refreshDevices]);

  const revoke = (device) => {
    Alert.alert(
      'Sign out this device?',
      `${device.name} will lose access immediately and will need your password to sign in again.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign out',
          style: 'destructive',
          onPress: async () => {
            setBusy(device.deviceId);
            try {
              await api.delete('/devices/' + device.deviceId);
              await refreshDevices();
              toast.success('Device signed out');
            } catch (err) {
              toast.error(err.message || 'Could not sign that device out');
            } finally {
              setBusy(null);
            }
          },
        },
      ]
    );
  };

  const revokeOthers = () => {
    Alert.alert(
      'Sign out every other device?',
      'Everything except this phone loses access immediately.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign out all',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.post('/devices/revoke-others');
              await refreshDevices();
              toast.success('Other devices signed out');
            } catch (err) {
              toast.error(err.message || 'That did not work');
            }
          },
        },
      ]
    );
  };

  const others = (devices || []).filter((d) => !d.current);

  return (
    <SettingsScreen title="Linked devices" subtitle="Everywhere you are signed in" scroll={false}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 40 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.accentStrong}
            colors={[theme.accentStrong]}
            progressBackgroundColor={theme.surface3}
          />
        }
      >
        <Group title="This device">
          {(devices || [])
            .filter((d) => d.current)
            .map((d) => (
              <Row
                key={d.deviceId}
                icon={iconFor(d)}
                title={d.name}
                subtitle={[d.os, 'active now'].filter(Boolean).join(' · ')}
                chevron={false}
              />
            ))}
        </Group>

        {others.length > 0 && (
          <Group title={others.length + ' other' + (others.length === 1 ? '' : 's')}>
            {others.map((d, i) => (
              <View key={d.deviceId}>
                {i > 0 && <Divider />}
                <Row
                  icon={iconFor(d)}
                  title={d.name}
                  subtitle={[d.os, d.lastActiveAt ? 'last active ' + shortTime(d.lastActiveAt) : null]
                    .filter(Boolean)
                    .join(' · ')}
                  loading={busy === d.deviceId}
                  chevron={false}
                  onPress={() => revoke(d)}
                />
              </View>
            ))}
          </Group>
        )}

        {others.length > 0 && (
          <Group>
            <Row
              icon={LogOut}
              title="Sign out every other device"
              danger
              chevron={false}
              onPress={revokeOthers}
            />
          </Group>
        )}

        <Note>
          Each device holds its own set of keys. Signing one out removes its access
          immediately — it cannot decrypt anything new, though messages it has
          already opened stay on that device until its app data is cleared.
        </Note>

        <Note>
          Linking a new device by QR code is available on the web client. Scanning
          from the phone is not built here yet.
        </Note>
      </ScrollView>
    </SettingsScreen>
  );
}

const styles = StyleSheet.create({});
