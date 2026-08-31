import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { DatabaseBackup, Download, Trash2, TriangleAlert } from 'lucide-react-native';

import { SettingsScreen, Group, Row, Divider, Note } from '../../src/components/Settings';
import { useTheme, font } from '../../src/theme';
import { api, API_ORIGIN } from '../../src/lib/api';
import { toast } from '../../src/store/ui';
import { bytes as formatBytes } from '../../src/lib/utils';

export default function BackupScreen() {
  const theme = useTheme();
  const [backup, setBackup] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = () =>
    api
      .get('/backup')
      .then(({ data }) => setBackup(data.backup || data))
      .catch(() => setBackup(null))
      .finally(() => setLoading(false));

  useEffect(() => {
    load();
  }, []);

  const remove = () => {
    Alert.alert(
      'Delete the backup?',
      'The copy held for you is removed. Your messages on this device are untouched.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.delete('/backup');
              await load();
              toast.success('Backup deleted');
            } catch (err) {
              toast.error(err.message || 'Could not delete that');
            }
          },
        },
      ]
    );
  };

  return (
    <SettingsScreen title="Chat backup" subtitle="Keep a copy you can read">
      {loading ? (
        <View style={styles.centre}>
          <ActivityIndicator color={theme.accentStrong} />
        </View>
      ) : (
        <>
          <Group title="Status">
            <Row
              icon={DatabaseBackup}
              title={backup?.createdAt ? 'Backup available' : 'No backup yet'}
              subtitle={
                backup?.createdAt
                  ? new Date(backup.createdAt).toLocaleString() +
                    (backup.size ? ' · ' + formatBytes(backup.size) : '')
                  : 'Nothing has been archived for this account.'
              }
              chevron={false}
            />
          </Group>

          {!!backup?.createdAt && (
            <Group>
              <Row
                icon={Download}
                title="Download the archive"
                subtitle="Opens in your browser, signed in as you"
                chevron={false}
                onPress={() => toast.info(API_ORIGIN + '/api/backup/archive')}
              />
              <Divider />
              <Row icon={Trash2} title="Delete the backup" danger chevron={false} onPress={remove} />
            </Group>
          )}
        </>
      )}

      <View style={[styles.warn, { backgroundColor: theme.surface2, borderLeftColor: theme.warn }]}>
        <TriangleAlert size={16} color={theme.warn} strokeWidth={2.2} />
        <Text style={[styles.warnText, { color: theme.inkSoft }]}>
          A backup is a readable copy. It is the one place your messages exist outside
          the encrypted envelope, which is exactly what makes it useful and exactly what
          makes it worth thinking about before you keep one.
        </Text>
      </View>

      <Note>
        Creating and restoring backups is available on the web client. This screen shows
        what exists and lets you remove it.
      </Note>
    </SettingsScreen>
  );
}

const styles = StyleSheet.create({
  centre: { padding: 44, alignItems: 'center' },
  warn: {
    flexDirection: 'row',
    gap: 10,
    marginHorizontal: 12,
    marginTop: 18,
    padding: 13,
    borderRadius: 10,
    borderLeftWidth: 3,
    alignItems: 'flex-start',
  },
  warnText: { flex: 1, fontSize: 13, lineHeight: 19, fontFamily: font.body },
});
