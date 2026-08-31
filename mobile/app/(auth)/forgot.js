import { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { Mail, ArrowLeft, TriangleAlert } from 'lucide-react-native';

import { api } from '../../src/lib/api';
import { AuthShell, AuthCard, AuthHeading } from '../../src/components/AuthShell';
import { Field, Button, LinkText } from '../../src/components/Field';
import { useTheme, font } from '../../src/theme';
import { toast } from '../../src/store/ui';

/**
 * Starts a password reset.
 *
 * Deliberately stops at "we sent you a code": the rest of the flow re-wraps the
 * account identity, which only works if the old password is still known, and
 * that is a longer conversation than this screen should have. The web client
 * carries the full version.
 */
export default function ForgotScreen() {
  const theme = useTheme();
  const [email, setEmail] = useState('');
  const [error, setError] = useState(null);
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit() {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('Enter a valid email address');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await api.post('/auth/forgot-password', { email: email.trim().toLowerCase() });
      setSent(true);
    } catch (err) {
      toast.error(err.message || 'Could not start a reset.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell>
      <AuthCard>
        <AuthHeading
          title={sent ? 'Check your email' : 'Reset your password'}
          subtitle={
            sent
              ? `If an account exists for ${email}, a reset code is on its way.`
              : 'We will send a code to the address on your account.'
          }
        />

        {!sent && (
          <View style={styles.form}>
            <Field
              label="Email"
              icon={Mail}
              placeholder="you@example.com"
              value={email}
              onChangeText={(v) => {
                setEmail(v);
                setError(null);
              }}
              error={error}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
            />

            {/* The thing people do not expect, and should hear before they
                start rather than after. */}
            <View style={[styles.warn, { backgroundColor: theme.surface2, borderLeftColor: theme.warn }]}>
              <TriangleAlert size={16} color={theme.warn} strokeWidth={2.2} />
              <Text style={[styles.warnText, { color: theme.inkSoft }]}>
                A reset restores access to your account, but it cannot decrypt old
                messages unless you still know your previous password.
              </Text>
            </View>

            <Button title="Send reset code" onPress={onSubmit} loading={loading} />
          </View>
        )}

        <View style={styles.bottom}>
          <ArrowLeft size={14} color={theme.inkMuted} strokeWidth={2.2} />
          <LinkText onPress={() => router.back()} style={{ color: theme.inkMuted }}>
            Back to sign in
          </LinkText>
        </View>
      </AuthCard>
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  form: { gap: 14 },
  warn: {
    flexDirection: 'row',
    gap: 9,
    padding: 12,
    borderRadius: 10,
    borderLeftWidth: 3,
    alignItems: 'flex-start',
  },
  warnText: { flex: 1, fontSize: 13, lineHeight: 19, fontFamily: font.body },
  bottom: { marginTop: 24, flexDirection: 'row', alignItems: 'center', gap: 5 },
});
