import { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { Mail, Lock, User, TriangleAlert, ArrowLeft } from 'lucide-react-native';

import { useAuth } from '../../src/store/auth';
import { AuthShell, AuthCard, AuthHeading } from '../../src/components/AuthShell';
import { Field, Button, LinkText } from '../../src/components/Field';
import { useTheme, font } from '../../src/theme';
import { toast } from '../../src/store/ui';
import { feedback } from '../../src/lib/feedback';

export default function SignupScreen() {
  const theme = useTheme();
  const register = useAuth((s) => s.register);

  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);

  const set = (key) => (value) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((x) => ({ ...x, [key]: null }));
  };

  async function onSubmit() {
    const next = {};
    if (!form.name.trim()) next.name = 'What should people call you?';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) next.email = 'Enter a valid email address';
    if (form.password.length < 8) next.password = 'At least 8 characters';
    setErrors(next);
    if (Object.keys(next).length) return;

    setLoading(true);
    try {
      const email = form.email.trim().toLowerCase();
      await register({ name: form.name.trim(), email, password: form.password });
      feedback('success');
      router.push({ pathname: '/(auth)/verify', params: { email, password: form.password } });
    } catch (err) {
      feedback('error');
      if (err.code === 'EMAIL_TAKEN') setErrors({ email: 'That email already has an account' });
      else toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell>
      <AuthCard>
        <AuthHeading
          title="Create your account"
          subtitle="We will email you a six-digit code to confirm it is you."
        />

        <View style={styles.form}>
          <Field
            label="Name"
            icon={User}
            placeholder="Your name"
            value={form.name}
            onChangeText={set('name')}
            error={errors.name}
            autoCapitalize="words"
            autoComplete="name"
          />

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
          />

          <Field
            label="Password"
            icon={Lock}
            placeholder="At least 8 characters"
            value={form.password}
            onChangeText={set('password')}
            error={errors.password}
            secure
            autoCapitalize="none"
            autoComplete="new-password"
          />

          {/* The single most important thing to say before someone commits. */}
          <View style={[styles.warn, { backgroundColor: theme.surface2, borderLeftColor: theme.warn }]}>
            <TriangleAlert size={16} color={theme.warn} strokeWidth={2.2} />
            <Text style={[styles.warnText, { color: theme.inkSoft }]}>
              Your password is what decrypts your messages. Nobody — including us — can
              recover your history if you forget it.
            </Text>
          </View>

          <Button title="Continue" onPress={onSubmit} loading={loading} />
        </View>

        <View style={styles.bottom}>
          <View style={styles.back}>
            <ArrowLeft size={14} color={theme.inkMuted} strokeWidth={2.2} />
            <LinkText onPress={() => router.back()} style={{ color: theme.inkMuted }}>
              Back
            </LinkText>
          </View>
          <LinkText onPress={() => router.replace('/(auth)/login')}>I already have one</LinkText>
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
  bottom: {
    marginTop: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  back: { flexDirection: 'row', alignItems: 'center', gap: 5 },
});
