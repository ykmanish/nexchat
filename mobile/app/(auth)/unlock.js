import { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { Lock } from 'lucide-react-native';

import { useAuth } from '../../src/store/auth';
import { AuthShell, AuthCard, AuthHeading } from '../../src/components/AuthShell';
import { Field, Button, LinkText } from '../../src/components/Field';
import { useTheme } from '../../src/theme';
import { feedback } from '../../src/lib/feedback';

/**
 * The session is valid but this device has no keys.
 *
 * Happens after a reinstall, or after the app's data has been cleared: the
 * refresh token survives in the keystore while the vault does not. Asking for
 * the password re-derives the account identity and mints a fresh device key
 * set, rather than making somebody sign in from scratch.
 */
export default function UnlockScreen() {
  const theme = useTheme();
  const unlock = useAuth((s) => s.unlock);
  const logout = useAuth((s) => s.logout);
  const user = useAuth((s) => s.user);

  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit() {
    if (!password) {
      setError('Enter your password.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await unlock(password);
      feedback('success');
      router.replace('/(tabs)');
    } catch (err) {
      feedback('error');
      setError(err.message || 'That password did not unlock your keys.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell>
      <AuthCard>
        <AuthHeading
          title="Unlock your chats"
          subtitle={
            (user?.name ? `Welcome back, ${user.name.split(' ')[0]}. ` : '') +
            'This device needs your password to rebuild its encryption keys.'
          }
        />

        <View style={styles.form}>
          <Field
            label="Password"
            icon={Lock}
            placeholder="Your password"
            value={password}
            onChangeText={(v) => {
              setPassword(v);
              setError(null);
            }}
            error={error}
            secure
            autoCapitalize="none"
            autoComplete="current-password"
          />

          <Button
            title={loading ? 'Unlocking…' : 'Unlock'}
            onPress={onSubmit}
            loading={loading}
          />

          <View style={styles.alt}>
            <LinkText
              style={{ color: theme.inkMuted }}
              onPress={async () => {
                await logout();
                router.replace('/(auth)/login');
              }}
            >
              Sign in as someone else
            </LinkText>
          </View>
        </View>
      </AuthCard>
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  form: { gap: 14 },
  alt: { alignItems: 'center', paddingTop: 4 },
});
