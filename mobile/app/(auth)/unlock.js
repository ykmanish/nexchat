import { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, KeyboardAvoidingView, Platform } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyRound } from 'lucide-react-native';

import { useAuth } from '../../src/store/auth';
import { Field, Button } from '../../src/components/Field';
import { useTheme } from '../../src/theme';

/**
 * The session is valid but this device has no keys.
 *
 * Happens after a reinstall, or after the app data has been cleared: the
 * refresh token survives in the keystore while the vault does not. Asking for
 * the password re-derives the account identity and mints a fresh device key
 * set, rather than making somebody sign in from scratch.
 */
export default function UnlockScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const unlock = useAuth((s) => s.unlock);
  const logout = useAuth((s) => s.logout);
  const user = useAuth((s) => s.user);

  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const onSubmit = async () => {
    if (!password) {
      setError('Enter your password.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await unlock(password);
      router.replace('/(tabs)');
    } catch (err) {
      setError(err.message || 'That password did not unlock your keys.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 60 }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[styles.icon, { backgroundColor: theme.accentTint }]}>
          <KeyRound size={26} color={theme.accentDeep} strokeWidth={2.2} />
        </View>

        <Text style={[styles.title, { color: theme.ink }]}>Unlock your chats</Text>
        <Text style={[styles.subtitle, { color: theme.inkMuted }]}>
          {user?.name ? `Welcome back, ${user.name.split(' ')[0]}. ` : ''}
          This device needs your password to rebuild its encryption keys.
        </Text>

        <View style={styles.form}>
          <Field
            label="Password"
            value={password}
            onChangeText={setPassword}
            placeholder="Your password"
            secure
            autoCapitalize="none"
            error={error}
          />

          <Button title={busy ? 'Unlocking…' : 'Unlock'} onPress={onSubmit} loading={busy} />

          <Pressable
            onPress={async () => {
              await logout();
              router.replace('/(auth)/login');
            }}
            style={styles.link}
          >
            <Text style={[styles.linkText, { color: theme.inkMuted }]}>Sign in as someone else</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { paddingHorizontal: 26, paddingBottom: 40 },
  icon: {
    width: 56,
    height: 56,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  title: { fontSize: 29, fontWeight: '800', letterSpacing: -0.7 },
  subtitle: { fontSize: 15, marginTop: 7, lineHeight: 21 },
  form: { marginTop: 28, gap: 17 },
  link: { alignItems: 'center', paddingVertical: 8 },
  linkText: { fontSize: 14.5, fontWeight: '600' },
});
