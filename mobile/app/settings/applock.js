import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { Fingerprint, ScanFace, Clock } from 'lucide-react-native';

import * as applock from '../../src/lib/applock';
import { SettingsScreen, Group, Toggle, Note } from '../../src/components/Settings';
import { useTheme, font } from '../../src/theme';
import { toast } from '../../src/store/ui';

export default function AppLockScreen() {
  const theme = useTheme();

  const [caps, setCaps] = useState(null);
  const [enabled, setEnabled] = useState(false);
  const [timeout, setTimeoutValue] = useState(0);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [c, on, ms] = await Promise.all([
      applock.capabilities(),
      applock.isEnabled(),
      applock.timeout(),
    ]);
    setCaps(c);
    setEnabled(on);
    setTimeoutValue(ms);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = async (value) => {
    setBusy(true);
    try {
      if (value) await applock.enable();
      else await applock.disable();
      await load();
      toast.success(value ? 'App lock is on' : 'App lock is off');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (!caps) {
    return (
      <SettingsScreen title="App lock" subtitle="Require your fingerprint to open Chax">
        <View style={styles.centre}>
          <ActivityIndicator color={theme.accentStrong} />
        </View>
      </SettingsScreen>
    );
  }

  const Icon = caps.kinds.includes('face') ? ScanFace : Fingerprint;
  const method = caps.kinds.includes('face')
    ? 'face unlock'
    : caps.kinds.includes('fingerprint')
      ? 'your fingerprint'
      : 'your device PIN';

  return (
    <SettingsScreen title="App lock" subtitle="Require your fingerprint to open Chax">
      {!caps.hasHardware && (
        <Note>This phone has no biometric hardware, so app lock cannot be turned on.</Note>
      )}

      {caps.hasHardware && !caps.enrolled && (
        <Note>
          Set up a fingerprint or face unlock in Android settings first — Chax can only
          use one you have already enrolled.
        </Note>
      )}

      <Group>
        <Toggle
          icon={Icon}
          title="Require unlock"
          subtitle={'Open Chax with ' + method}
          value={enabled}
          disabled={busy || !caps.available}
          onValueChange={toggle}
        />
      </Group>

      {enabled && (
        <Group title="Lock after">
          {applock.TIMEOUTS.map((option) => {
            const on = timeout === option.value;
            return (
              <Pressable
                key={option.value}
                onPress={async () => {
                  await applock.setTimeout_(option.value);
                  setTimeoutValue(option.value);
                }}
                android_ripple={{ color: theme.surface3 }}
                style={styles.row}
              >
                <Clock size={19} color={on ? theme.accentStrong : theme.inkMuted} strokeWidth={2} />
                <Text
                  style={[
                    styles.rowLabel,
                    { color: on ? theme.accentStrong : theme.ink, fontWeight: on ? '700' : '600' },
                  ]}
                >
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </Group>
      )}

      {/* The honest limit. It would be easy to imply more than this does. */}
      <Note>
        App lock covers the screen, not your messages. Your encryption keys are not
        derived from your fingerprint, so this protects against someone picking up your
        unlocked phone — not against someone who can read the phone&apos;s storage.
      </Note>

      <Note>
        The fingerprint and the PIN stay on this device and are never sent anywhere.
        Losing them locks the app, not your history.
      </Note>
    </SettingsScreen>
  );
}

const styles = StyleSheet.create({
  centre: { padding: 44, alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 13 },
  rowLabel: { fontSize: 15.5, fontFamily: font.body },
});
