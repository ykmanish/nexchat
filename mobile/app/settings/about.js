import { View, Text, StyleSheet } from 'react-native';
import * as Application from 'expo-application';
import { Server, Cpu, ShieldCheck } from 'lucide-react-native';

import { SettingsScreen, Group, Row, Divider, Note } from '../../src/components/Settings';
import { Logo } from '../../src/components/Brand';
import { useTheme, font, heading } from '../../src/theme';
import { API_ORIGIN, HAS_FCM } from '../../src/lib/config';

export default function AboutScreen() {
  const theme = useTheme();

  return (
    <SettingsScreen title="About Chax">
      <View style={styles.head}>
        <Logo size={78} />
        <Text style={[heading(24), { color: theme.ink }]}>Chax</Text>
        <Text style={[styles.version, { color: theme.inkMuted }]}>
          Version {Application.nativeApplicationVersion || '1.0.0'}
          {Application.nativeBuildVersion ? ` (${Application.nativeBuildVersion})` : ''}
        </Text>
      </View>

      <Group title="This build">
        <Row icon={Server} title="Server" value={API_ORIGIN.replace(/^https?:\/\//, '')} chevron={false} />
        <Divider />
        <Row
          icon={Cpu}
          title="Push transport"
          value={HAS_FCM ? 'FCM + socket' : 'Socket only'}
          chevron={false}
        />
        <Divider />
        <Row icon={ShieldCheck} title="Encryption" value="X3DH · AES-GCM-256" chevron={false} />
      </Group>

      <Note>
        A fast, end-to-end encrypted messenger. Your conversations stay between you and
        the people in them.
      </Note>
    </SettingsScreen>
  );
}

const styles = StyleSheet.create({
  head: { alignItems: 'center', paddingTop: 24, gap: 10 },
  version: { fontSize: 14, fontFamily: font.body },
});
