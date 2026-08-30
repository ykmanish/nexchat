import { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, KeyboardAvoidingView, Platform } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, TriangleAlert } from 'lucide-react-native';

import { useAuth } from '../../src/store/auth';
import { Field, Button } from '../../src/components/Field';
import { useTheme } from '../../src/theme';

export default function SignupScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const register = useAuth((s) => s.register);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const onSubmit = async () => {
    if (!name.trim() || !email.trim() || password.length < 8) {
      setError('Fill everything in — the password needs at least 8 characters.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await register({ name: name.trim(), email: email.trim().toLowerCase(), password });
      router.push({
        pathname: '/(auth)/verify',
        params: { email: email.trim().toLowerCase(), password },
      });
    } catch (err) {
      setError(err.message || 'Could not create that account.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 14 }]}
        keyboardShouldPersistTaps="handled"
      >
        <Pressable hitSlop={12} onPress={() => router.back()} style={styles.back}>
          <ArrowLeft size={24} color={theme.ink} strokeWidth={2.1} />
        </Pressable>

        <Text style={[styles.title, { color: theme.ink }]}>Create your account</Text>
        <Text style={[styles.subtitle, { color: theme.inkMuted }]}>
          We will email you a six-digit code to confirm it is you.
        </Text>

        <View style={styles.form}>
          <Field label="Name" value={name} onChangeText={setName} placeholder="Your name" autoCapitalize="words" />
          <Field
            label="Email"
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            keyboardType="email-address"
            autoCapitalize="none"
          />
          <Field
            label="Password"
            value={password}
            onChangeText={setPassword}
            placeholder="At least 8 characters"
            secure
            autoCapitalize="none"
            error={error}
          />

          {/* The single most important thing to say before someone commits. */}
          <View style={[styles.warn, { backgroundColor: theme.surface2, borderColor: theme.warn }]}>
            <TriangleAlert size={16} color={theme.warn} strokeWidth={2.2} />
            <Text style={[styles.warnText, { color: theme.inkSoft }]}>
              Your password is what decrypts your messages. Nobody — including us — can
              recover your history if you forget it.
            </Text>
          </View>

          <Button title="Continue" onPress={onSubmit} loading={busy} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { paddingHorizontal: 26, paddingBottom: 40 },
  back: { marginBottom: 22, width: 30 },
  title: { fontSize: 29, fontWeight: '800', letterSpacing: -0.7 },
  subtitle: { fontSize: 15, marginTop: 7, lineHeight: 21 },
  form: { marginTop: 26, gap: 17 },
  warn: {
    flexDirection: 'row',
    gap: 9,
    padding: 12,
    borderRadius: 10,
    borderLeftWidth: 3,
    alignItems: 'flex-start',
  },
  warnText: { flex: 1, fontSize: 13, lineHeight: 19 },
});
