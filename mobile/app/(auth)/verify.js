import { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, KeyboardAvoidingView, Platform } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, MailCheck } from 'lucide-react-native';

import { useAuth } from '../../src/store/auth';
import { api } from '../../src/lib/api';
import { Field, Button } from '../../src/components/Field';
import { useTheme } from '../../src/theme';
import { toast } from '../../src/store/ui';

export default function VerifyScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { email, password } = useLocalSearchParams();
  const verifyEmail = useAuth((s) => s.verifyEmail);

  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const onSubmit = async () => {
    if (code.trim().length !== 6) {
      setError('That code should be six digits.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await verifyEmail({ email, code: code.trim(), password });
      router.replace('/(tabs)');
    } catch (err) {
      setError(err.message || 'That code did not work.');
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    try {
      await api.post('/auth/resend-code', { email });
      toast.success('A new code is on its way.');
    } catch (err) {
      toast.error(err.message || 'Could not send another code.');
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

        <View style={[styles.icon, { backgroundColor: theme.accentTint }]}>
          <MailCheck size={26} color={theme.accentDeep} strokeWidth={2.2} />
        </View>

        <Text style={[styles.title, { color: theme.ink }]}>Check your email</Text>
        <Text style={[styles.subtitle, { color: theme.inkMuted }]}>
          We sent a six-digit code to {email}.
        </Text>

        <View style={styles.form}>
          <Field
            label="Verification code"
            value={code}
            onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
            placeholder="000000"
            keyboardType="number-pad"
            maxLength={6}
            error={error}
            style={styles.codeField}
          />

          <Button
            title={busy ? 'Creating your keys…' : 'Verify and continue'}
            onPress={onSubmit}
            loading={busy}
          />

          <Pressable onPress={resend} style={styles.link}>
            <Text style={[styles.linkText, { color: theme.accent }]}>Send another code</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { paddingHorizontal: 26, paddingBottom: 40 },
  back: { marginBottom: 20, width: 30 },
  icon: {
    width: 56,
    height: 56,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  title: { fontSize: 29, fontWeight: '800', letterSpacing: -0.7 },
  subtitle: { fontSize: 15, marginTop: 7, lineHeight: 21 },
  form: { marginTop: 28, gap: 17 },
  codeField: {},
  link: { alignItems: 'center', paddingVertical: 8 },
  linkText: { fontSize: 14.5, fontWeight: '600' },
});
