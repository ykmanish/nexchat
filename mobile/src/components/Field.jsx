import { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { Eye, EyeOff } from 'lucide-react-native';
import { useTheme, font } from '../theme';

/** Labelled input with an optional leading icon, mirroring the web's Input. */
export function Field({ label, hint, error, secure, icon: Icon, style, ...props }) {
  const theme = useTheme();
  const [hidden, setHidden] = useState(!!secure);
  const [focused, setFocused] = useState(false);

  const borderColor = error
    ? theme.danger
    : focused
      ? theme.accentStrong
      : theme.border;

  return (
    <View style={[styles.wrap, style]}>
      {!!label && <Text style={[styles.label, { color: theme.inkSoft }]}>{label}</Text>}

      <View style={[styles.box, { backgroundColor: theme.surface2, borderColor }]}>
        {Icon && <Icon size={18} color={theme.inkFaint} strokeWidth={2} style={styles.leading} />}

        <TextInput
          {...props}
          secureTextEntry={hidden}
          placeholderTextColor={theme.inkFaint}
          onFocus={(e) => {
            setFocused(true);
            props.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            props.onBlur?.(e);
          }}
          style={[styles.input, { color: theme.ink }]}
        />

        {secure && (
          <Pressable hitSlop={10} onPress={() => setHidden((v) => !v)} style={styles.eye}>
            {hidden ? (
              <EyeOff size={19} color={theme.inkMuted} strokeWidth={2} />
            ) : (
              <Eye size={19} color={theme.inkMuted} strokeWidth={2} />
            )}
          </Pressable>
        )}
      </View>

      {!!(error || hint) && (
        <Text style={[styles.hint, { color: error ? theme.danger : theme.inkMuted }]}>
          {error || hint}
        </Text>
      )}
    </View>
  );
}

/**
 * `primary` fills with the brand lime and puts dark ink on top — the lime is a
 * fill colour, and white text on it is unreadable. `secondary` is an outlined
 * button whose label is ordinary ink.
 */
export function Button({
  title,
  onPress,
  loading,
  disabled,
  variant = 'primary',
  icon: Icon,
  style,
}) {
  const theme = useTheme();
  const isPrimary = variant === 'primary';
  const off = disabled || loading;

  const background = isPrimary ? (off ? theme.surface3 : theme.accent) : 'transparent';
  const label = isPrimary ? (off ? theme.inkFaint : theme.accentInk) : theme.ink;

  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      android_ripple={{ color: isPrimary ? 'rgba(20,32,10,.12)' : theme.surface3 }}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: pressed && isPrimary && !off ? theme.accentHover : background,
          borderColor: isPrimary ? 'transparent' : theme.borderStrong,
          borderWidth: isPrimary ? 0 : StyleSheet.hairlineWidth,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={label} size="small" />
      ) : (
        <>
          {Icon && <Icon size={18} color={label} strokeWidth={2.1} />}
          <Text style={[styles.buttonText, { color: label }]}>{title}</Text>
        </>
      )}
    </Pressable>
  );
}

/** Brand-coloured text link. Always `accentStrong`, never the raw lime. */
export function LinkText({ children, onPress, style }) {
  const theme = useTheme();
  return (
    <Pressable onPress={onPress} hitSlop={8}>
      <Text style={[styles.link, { color: theme.accentStrong }, style]}>{children}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  label: { fontSize: 13, fontWeight: '600', letterSpacing: 0.1, fontFamily: font.body },
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    minHeight: 50,
  },
  leading: { marginRight: 10 },
  input: { flex: 1, fontSize: 16, paddingVertical: 13, fontFamily: font.body },
  eye: { paddingLeft: 8 },
  hint: { fontSize: 12.5, lineHeight: 17, fontFamily: font.body },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 51,
    borderRadius: 12,
    paddingHorizontal: 20,
  },
  buttonText: { fontSize: 15.5, fontWeight: '700', letterSpacing: -0.1, fontFamily: font.body },
  link: { fontSize: 13.5, fontWeight: '600', fontFamily: font.body },
});
