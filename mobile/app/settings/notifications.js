import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { Bell, BellOff, Send, CircleCheck, TriangleAlert, AtSign, Keyboard } from 'lucide-react-native';

import { useAuth } from '../../src/store/auth';
import { SettingsScreen, Group, Row, Toggle, Divider, Note } from '../../src/components/Settings';
import { useTheme, font } from '../../src/theme';
import { toast } from '../../src/store/ui';
import * as notifications from '../../src/lib/notifications';
import { HAS_FCM } from '../../src/lib/config';

export default function NotificationsScreen() {
  const theme = useTheme();
  const user = useAuth((s) => s.user);
  const updateSettings = useAuth((s) => s.updateSettings);

  const [push, setPush] = useState({ state: 'checking' });
  const [testing, setTesting] = useState(false);

  const load = useCallback(() => {
    notifications
      .pushStatus()
      .then((s) => setPush({ state: 'ready', ...s }))
      .catch(() => setPush({ state: 'ready', granted: false }));
  }, []);

  useEffect(load, [load]);

  const enable = async () => {
    try {
      const { transport } = await notifications.registerForPush();
      load();
      toast.success(
        transport === 'fcm' ? 'Notifications are on.' : 'Notifications are on while Chax is running.'
      );
    } catch (err) {
      toast.error(err.message);
    }
  };

  /**
   * Round-trips through the server rather than drawing one locally.
   *
   * A local notification proves the phone can render one and nothing else,
   * while everything that actually breaks — the token, FCM's credentials, the
   * subscription the server holds — is on the far side of that call.
   */
  const sendTest = async () => {
    setTesting(true);
    try {
      if (!push.granted) await notifications.registerForPush();
      else await notifications.reconcilePush();
      load();
      await notifications.sendTestNotification();
      toast.success('Sent — it should arrive in a moment.');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setTesting(false);
    }
  };

  const settings = user?.settings?.notifications || {};

  return (
    <SettingsScreen title="Notifications" subtitle="Sounds and alerts">
      {push.state === 'checking' ? (
        <View style={styles.centre}>
          <ActivityIndicator color={theme.accentStrong} />
        </View>
      ) : (
        <>
          <Group title="Delivery">
            <Row
              icon={push.granted ? Bell : BellOff}
              title={push.granted ? 'Notifications are on' : 'Turn on notifications'}
              subtitle={
                push.granted
                  ? push.transport === 'fcm'
                    ? 'Delivered by Firebase, even when Chax is closed.'
                    : 'Delivered while Chax is running.'
                  : 'Be told when someone writes to you.'
              }
              chevron={!push.granted}
              onPress={push.granted ? undefined : enable}
            />
            <Divider />
            <Row
              icon={Send}
              title="Send a test notification"
              subtitle="Round-trips through the server, so it tests the whole chain."
              loading={testing}
              chevron={false}
              onPress={sendTest}
            />
          </Group>

          {push.granted && push.transport === 'fcm' && (
            <View style={styles.okWrap}>
              <CircleCheck size={15} color={theme.accentStrong} strokeWidth={2.3} />
              <Text style={[styles.okText, { color: theme.inkMuted }]}>
                Firebase is configured on both this build and the server.
              </Text>
            </View>
          )}

          {/* The configuration problem that is invisible from both ends. */}
          {push.ephemeral && (
            <Warning theme={theme}>
              The server&apos;s push keys are temporary, so browser notifications will stop
              working after its next restart. Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY
              in its environment.
            </Warning>
          )}

          {(!HAS_FCM || !push.serverFcm) && (
            <Warning theme={theme}>
              {!HAS_FCM
                ? 'This build has no Firebase config, so notifications only arrive while Chax is running.'
                : 'The server has no Firebase credentials, so it can only reach this device while Chax is running.'}
            </Warning>
          )}

          {push.unreachable && (
            <Warning theme={theme}>
              Could not reach the server to check notification settings. That is usually
              a connection problem rather than a configuration one.
            </Warning>
          )}
        </>
      )}

      <Group title="What to notify about">
        <Toggle
          icon={AtSign}
          title="Mentions"
          subtitle="Always ring when a message names you, even in a muted chat"
          value={settings.mentions !== false}
          onValueChange={(v) => updateSettings({ notifications: { mentions: v } })}
        />
        <Divider />
        <Toggle
          icon={Keyboard}
          title="Typing notices"
          subtitle="Be told when someone starts writing. Off by default."
          value={settings.typing === true}
          onValueChange={(v) => updateSettings({ notifications: { typing: v } })}
        />
      </Group>

      <Note>
        Notifications carry who wrote and in which chat, never what they said — the
        server cannot read it. The text is filled in from this device once it has
        already decrypted the message.
      </Note>

      <Note>
        Muting a chat is decided on the server, so a muted conversation stays quiet
        even when Chax is closed.
      </Note>
    </SettingsScreen>
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
  centre: { padding: 40, alignItems: 'center' },
  okWrap: { flexDirection: 'row', gap: 8, alignItems: 'center', paddingHorizontal: 22, paddingTop: 12 },
  okText: { flex: 1, fontSize: 12.5, lineHeight: 18, fontFamily: font.body },
  warning: {
    flexDirection: 'row',
    gap: 9,
    marginHorizontal: 12,
    marginTop: 12,
    padding: 12,
    borderRadius: 10,
    borderLeftWidth: 3,
    alignItems: 'flex-start',
  },
  warningText: { flex: 1, fontSize: 12.5, lineHeight: 18, fontFamily: font.body },
});
