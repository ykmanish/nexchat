import { View, Text, StyleSheet } from 'react-native';
import { KeyRound, Lock, Smartphone, RefreshCw, FileLock, Eye } from 'lucide-react-native';

import { useAuth } from '../../src/store/auth';
import { SettingsScreen, Group, Row, Divider, Note } from '../../src/components/Settings';
import { EncryptedBadge } from '../../src/components/Brand';
import { useTheme, font, heading } from '../../src/theme';

/** The plain-language version of the README's cryptography section. */
export default function EncryptionScreen() {
  const theme = useTheme();
  const user = useAuth((s) => s.user);

  return (
    <SettingsScreen title="How encryption works" subtitle="What Chax can and cannot see">
      <View style={styles.head}>
        <EncryptedBadge label="End-to-end encrypted" />
        <Text style={[styles.lead, { color: theme.inkSoft }]}>
          Your keys are made on your device and never leave it. The server only ever
          receives public keys and ciphertext, so it has no way to read a message even
          if it wanted to.
        </Text>
      </View>

      <Group title="Your keys">
        <Row
          icon={KeyRound}
          title="Account identity"
          subtitle="An ECDH P-256 pair, wrapped with a key derived from your password"
          chevron={false}
        />
        <Divider />
        <Row
          icon={Smartphone}
          title="Device keys"
          subtitle="A fresh set every sign-in, plus sixty single-use prekeys"
          chevron={false}
        />
        <Divider />
        <Row
          icon={RefreshCw}
          title="Forward secrecy"
          subtitle="Each direction runs its own ratchet, so today's key cannot open yesterday's messages"
          chevron={false}
        />
      </Group>

      <Group title="Every message">
        <Row
          icon={Lock}
          title="Encrypted once, sealed for each device"
          subtitle="A random content key per message, sealed to your account and to each device separately"
          chevron={false}
        />
        <Divider />
        <Row
          icon={FileLock}
          title="Attachments too"
          subtitle="Encrypted before upload; the file's key travels inside the message, never with the file"
          chevron={false}
        />
      </Group>

      <Group title="What the server can still see">
        <Row icon={Eye} title="Who is in which conversation" chevron={false} />
        <Divider />
        <Row icon={Eye} title="Timestamps, message sizes, receipts" chevron={false} />
        <Divider />
        <Row icon={Eye} title="Reactions and group names" subtitle="Plaintext, deliberately" chevron={false} />
      </Group>

      <Note>
        Being straight about the limits matters more than the padlock. Metadata is not
        encrypted and cannot be — the server has to know where to deliver a message.
      </Note>

      {!!user?.securityCode && (
        <>
          <Text style={[heading(15), styles.codeTitle, { color: theme.ink }]}>
            Your security code
          </Text>
          <View style={[styles.code, { backgroundColor: theme.surface }]}>
            <Text style={[styles.codeText, { color: theme.ink }]}>{user.securityCode}</Text>
          </View>
          <Note>
            Compare this with someone out of band — read it aloud, or check it in person —
            to be certain nobody has swapped a key in the middle.
          </Note>
        </>
      )}

      <Note>
        Forget your password and your history cannot be recovered by anyone, including
        us. That is the trade the design makes.
      </Note>
    </SettingsScreen>
  );
}

const styles = StyleSheet.create({
  head: { paddingHorizontal: 22, paddingTop: 8, gap: 12 },
  lead: { fontSize: 14.5, lineHeight: 21, fontFamily: font.body },
  codeTitle: { paddingHorizontal: 22, paddingTop: 22, paddingBottom: 8 },
  code: { marginHorizontal: 12, padding: 16, borderRadius: 12 },
  codeText: { fontSize: 16, letterSpacing: 2, textAlign: 'center', fontFamily: font.body },
});
