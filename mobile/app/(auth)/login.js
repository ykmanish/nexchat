import { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { Mail, Lock, ArrowLeft } from 'lucide-react-native';

import { useAuth } from '../../src/store/auth';
import { AuthShell, AuthCard, AuthHeading } from '../../src/components/AuthShell';
import { Field, Button, LinkText } from '../../src/components/Field';
import { useTheme, font } from '../../src/theme';
import { toast } from '../../src/store/ui';
import { feedback } from '../../src/lib/feedback';

export default function LoginScreen() {
  const theme = useTheme();
  const login = useAuth((s) => s.login);

  const [form, setForm] = useState({ email: '', password: '' });
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);

  const set = (key) => (value) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((x) => ({ ...x, [key]: null }));
  };

  async function onSubmit() {
    const next = {};
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) next.email = 'Enter a valid email address';
    if (!form.password) next.password = 'Enter your password';
    setErrors(next);
    if (Object.keys(next).length) return;

    setLoading(true);
    try {
      await login({ email: form.email.trim().toLowerCase(), password: form.password });
      feedback('success');
      router.replace('/(tabs)');
    } catch (err) {
      feedback('error');
      if (err.code === 'EMAIL_UNVERIFIED') {
        toast.info('Verify your email first — we sent a new code.');
        router.push({ pathname: '/(auth)/verify', params: { email: form.email.trim().toLowerCase() } });
        return;
      }
      if (err.code === 'BAD_CREDENTIALS') setErrors({ password: 'Wrong email or password' });
      else toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell>
      <AuthCard>
        <AuthHeading title="Welcome back" subtitle="Sign in to pick up where you left off." />

        <View style={styles.form}>
          <Field
            label="Email"
            icon={Mail}
            placeholder="you@example.com"
            value={form.email}
            onChangeText={set('email')}
            error={errors.email}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            textContentType="emailAddress"
          />

          <Field
            label="Password"
            icon={Lock}
            placeholder="Your password"
            value={form.password}
            onChangeText={set('password')}
            error={errors.password}
            secure
            autoCapitalize="none"
            autoComplete="current-password"
            textContentType="password"
          />

          <View style={styles.forgot}>
            <LinkText onPress={() => router.push('/(auth)/forgot')}>Forgot password?</LinkText>
          </View>

          {/* Worth saying out loud: this genuinely takes a few seconds, because
              the key that opens your history is derived from the password on
              this device with 250 000 PBKDF2 rounds. */}
          <Button
            title={loading ? 'Unlocking your keys…' : 'Sign in'}
            onPress={onSubmit}
            loading={loading}
          />
        </View>

        <View style={styles.bottom}>
          <View style={styles.back}>
            <ArrowLeft size={14} color={theme.inkMuted} strokeWidth={2.2} />
            <Text style={[styles.backText, { color: theme.inkMuted }]}>Back</Text>
          </View>
          <LinkText onPress={() => router.push('/(auth)/signup')}>Create an account</LinkText>
        </View>
      </AuthCard>
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  form: { gap: 14 },
  forgot: { alignItems: 'flex-end', marginTop: -2 },
  bottom: {
    marginTop: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  back: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  backText: { fontSize: 13.5, fontFamily: font.body },
});
