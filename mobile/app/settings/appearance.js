import { View, Text, StyleSheet, Pressable, useColorScheme } from 'react-native';
import { Sun, Moon, SunMoon } from 'lucide-react-native';

import { useAuth } from '../../src/store/auth';
import { SettingsScreen, Group, Divider, Note, Toggle } from '../../src/components/Settings';
import { useTheme, font } from '../../src/theme';

/** The wallpapers the web offers, as their flat ground colours. */
const WALLPAPERS = [
  { id: 'default', light: '#efe7de', dark: '#0b100e', name: 'Classic' },
  { id: 'plain', light: '#f2f4f5', dark: '#101614', name: 'Plain' },
  { id: 'sand', light: '#f5ecdf', dark: '#191510', name: 'Sand' },
  { id: 'mint', light: '#e6f2ea', dark: '#0d1713', name: 'Mint' },
  { id: 'sky', light: '#e6eef5', dark: '#0c1319', name: 'Sky' },
  { id: 'rose', light: '#f6e9ec', dark: '#180f12', name: 'Rose' },
];

const SCALES = [
  { value: 0.9, label: 'Small' },
  { value: 1, label: 'Default' },
  { value: 1.15, label: 'Large' },
  { value: 1.3, label: 'Largest' },
];

const THEMES = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
  { value: 'system', label: 'Auto', Icon: SunMoon },
];

export default function AppearanceScreen() {
  const theme = useTheme();
  const scheme = useColorScheme();
  const user = useAuth((s) => s.user);
  const updateSettings = useAuth((s) => s.updateSettings);

  const settings = user?.settings || {};
  const chosenTheme = settings.theme || 'system';
  const wallpaper = settings.wallpaper || 'default';
  const fontScale = settings.fontScale || 1;

  return (
    <SettingsScreen title="Appearance" subtitle="Theme, wallpaper, text size">
      <Group title="Theme">
        <View style={styles.themes}>
          {THEMES.map(({ value, label, Icon }) => {
            const on = chosenTheme === value;
            return (
              <Pressable
                key={value}
                onPress={() => updateSettings({ theme: value })}
                style={[
                  styles.themeCard,
                  {
                    backgroundColor: on ? theme.accentTint : theme.surface3,
                    borderColor: on ? theme.accentStrong : 'transparent',
                  },
                ]}
              >
                <Icon size={22} color={on ? theme.accentStrong : theme.inkMuted} strokeWidth={2} />
                <Text
                  style={[
                    styles.themeLabel,
                    {
                      color: on ? theme.accentStrong : theme.inkMuted,
                      fontWeight: on ? '700' : '600',
                    },
                  ]}
                >
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </Group>

      <Note>
        Auto follows your phone, which right now is set to{' '}
        {scheme === 'dark' ? 'dark' : 'light'}.
      </Note>

      <Group title="Chat wallpaper">
        <View style={styles.wallpapers}>
          {WALLPAPERS.map((w) => {
            const on = wallpaper === w.id;
            const swatch = theme.scheme === 'dark' ? w.dark : w.light;
            return (
              <Pressable
                key={w.id}
                onPress={() => updateSettings({ wallpaper: w.id })}
                style={styles.wallpaperCell}
              >
                <View
                  style={[
                    styles.swatch,
                    {
                      backgroundColor: swatch,
                      borderColor: on ? theme.accentStrong : theme.border,
                      borderWidth: on ? 3 : StyleSheet.hairlineWidth,
                    },
                  ]}
                />
                <Text style={[styles.wallpaperName, { color: on ? theme.ink : theme.inkMuted }]}>
                  {w.name}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </Group>

      <Group title="Text size">
        <View style={styles.scales}>
          {SCALES.map((s) => {
            const on = Math.abs(fontScale - s.value) < 0.01;
            return (
              <Pressable
                key={s.label}
                onPress={() => updateSettings({ fontScale: s.value })}
                style={[
                  styles.scaleChip,
                  { backgroundColor: on ? theme.accent : theme.surface3 },
                ]}
              >
                <Text
                  style={[
                    styles.scaleText,
                    { color: on ? theme.accentInk : theme.inkMuted, fontSize: 13 * s.value },
                  ]}
                >
                  {s.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </Group>

      <Group title="Motion">
        <Toggle
          title="Reduce motion"
          subtitle="Fewer springs and transitions"
          value={!!settings.reduceMotion}
          onValueChange={(v) => updateSettings({ reduceMotion: v })}
        />
        <Divider />
        <Toggle
          title="Haptics"
          subtitle="Vibrate on send, receive and long-press"
          value={settings.haptics !== false}
          onValueChange={(v) => updateSettings({ haptics: v })}
        />
      </Group>
    </SettingsScreen>
  );
}

const styles = StyleSheet.create({
  themes: { flexDirection: 'row', gap: 10, padding: 14 },
  themeCard: {
    flex: 1,
    alignItems: 'center',
    gap: 7,
    paddingVertical: 16,
    borderRadius: 12,
    borderWidth: 2,
  },
  themeLabel: { fontSize: 13.5, fontFamily: font.body },
  wallpapers: { flexDirection: 'row', flexWrap: 'wrap', padding: 12 },
  wallpaperCell: { width: '33.33%', alignItems: 'center', paddingVertical: 8, gap: 6 },
  swatch: { width: 62, height: 62, borderRadius: 12 },
  wallpaperName: { fontSize: 12.5, fontFamily: font.body },
  scales: { flexDirection: 'row', gap: 8, padding: 14 },
  scaleChip: { flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  scaleText: { fontWeight: '700', fontFamily: font.body },
});
