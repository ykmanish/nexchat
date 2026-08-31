import { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';

import { useAuth } from '../../src/store/auth';
import { api } from '../../src/lib/api';
import { AuthShell, AuthCard, AuthHeading } from '../../src/components/AuthShell';
import { Field, Button, LinkText } from '../../src/components/Field';
import { useTheme, font } from '../../src/theme';
import { toast } from '../../src/store/ui';
import { feedback } from '../../src/lib/feedback';

export default function VerifyScreen() {
  const theme = useTheme();
  const { email, password } = useLocalSearchParams();
  const verifyEmail = useAuth((s) => s.verifyEmail);

  const [code, setCode] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);

  async function onSubmit() {
    if (code.trim().length !== 6) {
      setError('That code should be six digits.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await verifyEmail({ email, code: code.trim(), password });
      feedback('success');
      router.replace('/(tabs)');
    } catch (err) {
      feedback('error');
      setError(err.message || 'That code did not work.');
    } finally {
      setLoading(false);
    }
  }

  async function resend() {
    setResending(true);
    try {
      await api.post('/auth/resend-code', { email });
      toast.success('A new code is on its way.');
    } catch (err) {
      toast.error(err.message || 'Could not send another code.');
    } finally {
      setResending(false);
    }
  }

  return (
    <AuthShell>
      <AuthCard>
        <AuthHeading
          title="Check your email"
          subtitle={`We sent a six-digit code to ${email}.`}
        />

        <View style={styles.form}>
          <Field
            label="Verification code"
            placeholder="000000"
            value={code}
            onChangeText={(v) => {
              setCode(v.replace(/\D/g, '').slice(0, 6));
              setError(null);
            }}
            error={error}
            keyboardType="number-pad"
            maxLength={6}
            style={styles.codeField}
          />

          {/* Verifying is also when this device mints its account identity and
              sixty prekeys, which is why it is not instant. */}
          <Button
            title={loading ? 'Creating your keys…' : 'Verify and continue'}
            onPress={onSubmit}
            loading={loading}
          />

          <View style={styles.resend}>
            <LinkText onPress={resend}>
              {resending ? 'Sending…' : 'Send another code'}
            </LinkText>
          </View>
        </View>

        <View style={styles.bottom}>
          <ArrowLeft size={14} color={theme.inkMuted} strokeWidth={2.2} />
          <LinkText onPress={() => router.back()} style={{ color: theme.inkMuted }}>
            Back
          </LinkText>
        </View>
      </AuthCard>
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  form: { gap: 14 },
  codeField: {},
  resend: { alignItems: 'center', paddingTop: 2 },
  bottom: { marginTop: 24, flexDirection: 'row', alignItems: 'center', gap: 5 },
});
