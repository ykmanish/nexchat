import { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { ScanFace, MoveUp, Siren } from 'lucide-react-native';

import * as flip from '../../src/lib/flipgesture';
import * as tilt from '../../src/lib/tiltreveal';
import * as shake from '../../src/lib/shakegesture';
import * as motion from '../../src/lib/motion';
import { SettingsScreen, Group, Toggle, Divider, Note } from '../../src/components/Settings';
import { useTheme, font } from '../../src/theme';
import { toast } from '../../src/store/ui';

export default function GesturesScreen() {
  const theme = useTheme();

  const [sensor, setSensor] = useState('checking');
  const [flipOn, setFlipOn] = useState(false);
  const [tiltOn, setTiltOn] = useState(false);
  const [shakeOn, setShakeOn] = useState(false);
  const [sensitivity, setSensitivity] = useState('normal');

  const load = useCallback(async () => {
    const [f, t, s] = await Promise.all([flip.config.get(), tilt.config.get(), shake.config.get()]);
    setFlipOn(!!f.enabled);
    setTiltOn(!!t.enabled);
    setShakeOn(!!s.enabled);
    setSensitivity(s.sensitivity || 'normal');
  }, []);

  useEffect(() => {
    load();
    /* A real sample rather than a capability flag: an emulator answers yes to
       `isAvailableAsync` and then never emits, which would let someone arm a
       gesture that can never fire. */
    motion.probe().then((ok) => setSensor(ok ? 'ok' : 'absent'));
  }, [load]);

  const guard = (fn) => async (value) => {
    if (value && sensor !== 'ok') {
      toast.error('This phone has no usable motion sensor.');
      return;
    }
    await fn(value);
    load();
  };

  return (
    <SettingsScreen title="Motion gestures" subtitle="Things the phone does when you move it">
      {sensor === 'checking' && (
        <View style={styles.centre}>
          <ActivityIndicator color={theme.accentStrong} />
        </View>
      )}

      {sensor === 'absent' && (
        <Note>
          This phone reports no usable accelerometer, so none of these can fire. They
          are left visible rather than hidden so it is clear why.
        </Note>
      )}

      <Group title="Privacy">
        <Toggle
          icon={ScanFace}
          title="Flip to hide"
          subtitle="Turn the phone face down to blank the screen, and back up to restore it"
          value={flipOn}
          disabled={sensor !== 'ok'}
          onValueChange={guard((v) => flip.config.set({ enabled: v }))}
        />
        <Divider />
        <Toggle
          icon={MoveUp}
          title="Tilt to read"
          subtitle="Keep messages blurred until the phone is tilted towards you"
          value={tiltOn}
          disabled={sensor !== 'ok'}
          onValueChange={guard((v) => tilt.config.set({ enabled: v }))}
        />
      </Group>

      <Group title="Emergency">
        <Toggle
          icon={Siren}
          title="Shake for emergency"
          subtitle="Shake hard to raise the emergency share without looking at the screen"
          value={shakeOn}
          disabled={sensor !== 'ok'}
          onValueChange={guard((v) => shake.config.set({ enabled: v }))}
        />

        {shakeOn && (
          <View style={styles.sensitivity}>
            {shake.SENSITIVITY.map((s) => {
              const on = sensitivity === s.value;
              return (
                <Pressable
                  key={s.value}
                  onPress={async () => {
                    await shake.config.set({ sensitivity: s.value });
                    load();
                  }}
                  style={[
                    styles.option,
                    {
                      backgroundColor: on ? theme.accentTint : theme.surface3,
                      borderColor: on ? theme.accentStrong : 'transparent',
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.optionLabel,
                      { color: on ? theme.accentStrong : theme.ink },
                    ]}
                  >
                    {s.label}
                  </Text>
                  <Text style={[styles.optionHint, { color: theme.inkMuted }]}>{s.hint}</Text>
                </Pressable>
              );
            })}
          </View>
        )}
      </Group>

      <Note>
        A shake never sends anything on its own. It starts a five-second countdown that
        any tap cancels, because a gesture this broad will have false positives — and a
        false positive here would broadcast your location.
      </Note>

      <Note>
        These read the accelerometer only while Chax is on screen. Android stops
        delivering sensor events to a backgrounded app, so none of them can fire from
        your pocket.
      </Note>
    </SettingsScreen>
  );
}

const styles = StyleSheet.create({
  centre: { padding: 30, alignItems: 'center' },
  sensitivity: { paddingHorizontal: 16, paddingBottom: 14, gap: 8 },
  option: { padding: 12, borderRadius: 10, borderWidth: 2, gap: 2 },
  optionLabel: { fontSize: 14.5, fontWeight: '700', fontFamily: font.body },
  optionHint: { fontSize: 12.5, fontFamily: font.body },
});
