import { View, Text, StyleSheet, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Wordmark, LockIcon } from './Brand';
import { useTheme, font, heading } from '../theme';

/**
 * The auth chrome.
 *
 * The web client is a split layout — brand panel left, form right — but that
 * whole panel is `lg:` only. Below that breakpoint it collapses to exactly what
 * is reproduced here: a centred wordmark, the form in a 420px column, and the
 * encryption line pinned at the bottom. So this is the web design at phone
 * size, not a reinterpretation of it.
 */
export function AuthShell({ children }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <KeyboardAvoidingView
      style={[styles.flex, { backgroundColor: theme.app }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.header, { paddingTop: insets.top + 28 }]}>
        <Wordmark size="md" />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.column}>{children}</View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 18 }]}>
        <LockIcon size={10} color={theme.inkFaint} />
        <Text style={[styles.footerText, { color: theme.inkFaint }]}>
          Your messages are encrypted on this device
        </Text>
      </View>
    </KeyboardAvoidingView>
  );
}

/** Matches the web's AuthCard — borderless, it just carries the entrance. */
export function AuthCard({ children }) {
  return (
    <Animated.View entering={FadeInDown.duration(350).springify().damping(18)}>
      {children}
    </Animated.View>
  );
}

export function AuthHeading({ title, subtitle }) {
  const theme = useTheme();
  return (
    <View style={styles.headingWrap}>
      <Text style={[heading(27), styles.title, { color: theme.ink }]}>{title}</Text>
      {!!subtitle && (
        <Text style={[styles.subtitle, { color: theme.inkMuted }]}>{subtitle}</Text>
      )}
    </View>
  );
}

/** The "or" rule between the primary form and the alternative sign-ins. */
export function Divider({ label = 'or' }) {
  const theme = useTheme();
  return (
    <View style={styles.divider}>
      <View style={[styles.rule, { backgroundColor: theme.border }]} />
      <Text style={[styles.dividerLabel, { color: theme.inkFaint }]}>{label}</Text>
      <View style={[styles.rule, { backgroundColor: theme.border }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { alignItems: 'center', paddingBottom: 8, paddingHorizontal: 24 },
  scroll: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 20, paddingVertical: 24 },
  column: { width: '100%', maxWidth: 420, alignSelf: 'center' },
  headingWrap: { marginBottom: 24, alignItems: 'center' },
  title: { textAlign: 'center' },
  subtitle: {
    marginTop: 8,
    fontSize: 14.5,
    lineHeight: 21,
    textAlign: 'center',
    maxWidth: 340,
    fontFamily: font.body,
  },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 24 },
  footerText: { fontSize: 11.5, fontFamily: font.body },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 20 },
  rule: { flex: 1, height: StyleSheet.hairlineWidth },
  dividerLabel: {
    fontSize: 11.5,
    fontWeight: '600',
    letterSpacing: 1,
    textTransform: 'uppercase',
    fontFamily: font.body,
  },
});
