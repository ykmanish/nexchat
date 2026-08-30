import { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, KeyboardAvoidingView, Platform } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Lock, ShieldCheck } from 'lucide-react-native';

import { useAuth } from '../../src/store/auth';
import { Field, Button } from '../../src/components/Field';
import { useTheme } from '../../src/theme';

export default function LoginScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const login = useAuth((s) => s.login);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const onSubmit = async () => {
    if (!email.trim() || !password) {
      setError('Enter your email and password.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await login({ email: email.trim().toLowerCase(), password });
      router.replace('/(tabs)');
    } catch (err) {
      setError(err.message || 'Could not sign in.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 56 }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[styles.logo, { backgroundColor: theme.accent }]}>
          <Lock size={28} color="#fff" strokeWidth={2.4} />
        </View>

        <Text style={[styles.title, { color: theme.ink }]}>Welcome back</Text>
        <Text style={[styles.subtitle, { color: theme.inkMuted }]}>
          Sign in to Chax. Your chats are end-to-end encrypted.
        </Text>

        <View style={styles.form}>
          <Field
            label="Email"
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            textContentType="emailAddress"
          />

          <Field
            label="Password"
            value={password}
            onChangeText={setPassword}
            placeholder="Your password"
            secure
            autoCapitalize="none"
            autoComplete="current-password"
            textContentType="password"
            error={error}
          />

          {/* Setting expectations, because this genuinely takes a moment: the
              key that unlocks your history is derived with 250 000 PBKDF2
              rounds, in JavaScript, on your phone. */}
          <View style={[styles.notice, { backgroundColor: theme.surface2 }]}>
            <ShieldCheck size={15} color={theme.accentDeep} strokeWidth={2.2} />
            <Text style={[styles.noticeText, { color: theme.inkMuted }]}>
              Unlocking your keys takes a few seconds — they are derived from your
              password on this device, never sent to the server.
            </Text>
          </View>

          <Button
            title={busy ? 'Unlocking your keys…' : 'Sign in'}
            onPress={onSubmit}
            loading={busy}
          />

          <Pressable onPress={() => router.push('/(auth)/signup')} style={styles.link}>
            <Text style={[styles.linkText, { color: theme.inkMuted }]}>
              New to Chax? <Text style={{ color: theme.accent, fontWeight: '700' }}>Create an account</Text>
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { paddingHorizontal: 26, paddingBottom: 40 },
  logo: {
    width: 62,
    height: 62,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 22,
  },
  title: { fontSize: 29, fontWeight: '800', letterSpacing: -0.7 },
  subtitle: { fontSize: 15, marginTop: 7, lineHeight: 21 },
  form: { marginTop: 30, gap: 17 },
  notice: { flexDirection: 'row', gap: 9, padding: 12, borderRadius: 10, alignItems: 'flex-start' },
  noticeText: { flex: 1, fontSize: 12.5, lineHeight: 18 },
  link: { alignItems: 'center', paddingVertical: 10 },
  linkText: { fontSize: 14.5 },
});
