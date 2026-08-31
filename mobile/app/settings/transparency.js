import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { MessageSquare, Users, Smartphone, Clock, HardDrive, Eye, EyeOff } from 'lucide-react-native';

import { SettingsScreen, Group, Row, Divider, Note } from '../../src/components/Settings';
import { useTheme, font } from '../../src/theme';
import { api } from '../../src/lib/api';
import { bytes as formatBytes } from '../../src/lib/utils';

/**
 * What the server actually holds about you.
 *
 * The point of this screen is the second list: being specific about what
 * encryption does *not* cover is more honest than a padlock and a promise.
 */
export default function TransparencyScreen() {
  const theme = useTheme();
  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api
      .get('/transparency/me')
      .then(({ data }) => setReport(data.report || data))
      .catch((err) => setError(err.message || 'Could not load that'));
  }, []);

  if (error) {
    return (
      <SettingsScreen title="What the server knows" subtitle="Your metadata footprint, live">
        <Note>{error}</Note>
      </SettingsScreen>
    );
  }

  if (!report) {
    return (
      <SettingsScreen title="What the server knows" subtitle="Your metadata footprint, live">
        <View style={styles.centre}>
          <ActivityIndicator color={theme.accentStrong} />
        </View>
      </SettingsScreen>
    );
  }

  const n = (value) => (value === undefined || value === null ? '—' : String(value));

  return (
    <SettingsScreen title="What the server knows" subtitle="Your metadata footprint, live">
      <Group title="Counted right now">
        <Row icon={MessageSquare} title="Messages stored" value={n(report.messages)} chevron={false} />
        <Divider />
        <Row icon={Users} title="Conversations" value={n(report.conversations)} chevron={false} />
        <Divider />
        <Row icon={Smartphone} title="Devices" value={n(report.devices)} chevron={false} />
        <Divider />
        <Row
          icon={HardDrive}
          title="Attachment storage"
          value={report.storageBytes != null ? formatBytes(report.storageBytes) : '—'}
          chevron={false}
        />
        <Divider />
        <Row
          icon={Clock}
          title="Account created"
          value={report.createdAt ? new Date(report.createdAt).toLocaleDateString() : '—'}
          chevron={false}
        />
      </Group>

      <Group title="Unreadable to the server">
        <Row icon={EyeOff} title="Message text" subtitle="Encrypted before it leaves your device" chevron={false} />
        <Divider />
        <Row icon={EyeOff} title="Photos, video and documents" subtitle="Encrypted; the server stores opaque bytes" chevron={false} />
        <Divider />
        <Row icon={EyeOff} title="Voice notes and stories" subtitle="Same envelope as any other message" chevron={false} />
      </Group>

      <Group title="Visible to the server">
        <Row icon={Eye} title="Who is in which conversation" chevron={false} />
        <Divider />
        <Row icon={Eye} title="When messages were sent, and how large" chevron={false} />
        <Divider />
        <Row icon={Eye} title="Delivery and read receipts" chevron={false} />
        <Divider />
        <Row icon={Eye} title="Emoji reactions and group names" subtitle="Stored in plaintext, deliberately" chevron={false} />
      </Group>

      <Note>
        Reactions and group names are a trade: keeping them readable is what lets the
        server summarise reactions and let you search your chat list. Everything in
        the first list is impossible for the server to read, not merely policy.
      </Note>

      <Note>
        System events — &quot;Ada added Grace&quot; — are written by the server, so they are
        plaintext by necessity.
      </Note>
    </SettingsScreen>
  );
}

const styles = StyleSheet.create({
  centre: { padding: 44, alignItems: 'center' },
});
