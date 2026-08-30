import { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { Eye, EyeOff } from 'lucide-react-native';
import { useTheme } from '../theme';

export function Field({ label, hint, error, secure, style, ...props }) {
  const theme = useTheme();
  const [hidden, setHidden] = useState(!!secure);

  return (
    <View style={[styles.wrap, style]}>
      {!!label && <Text style={[styles.label, { color: theme.inkSoft }]}>{label}</Text>}

      <View
        style={[
          styles.box,
          { backgroundColor: theme.surface2, borderColor: error ? theme.danger : theme.border },
        ]}
      >
        <TextInput
          {...props}
          secureTextEntry={hidden}
          placeholderTextColor={theme.inkFaint}
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

export function Button({ title, onPress, loading, disabled, variant = 'primary', style }) {
  const theme = useTheme();
  const isPrimary = variant === 'primary';
  const off = disabled || loading;

  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      android_ripple={{ color: 'rgba(0,0,0,.12)' }}
      style={[
        styles.button,
        {
          backgroundColor: isPrimary ? (off ? theme.surface3 : theme.accent) : 'transparent',
          borderColor: isPrimary ? 'transparent' : theme.border,
          borderWidth: isPrimary ? 0 : StyleSheet.hairlineWidth,
          opacity: off && !isPrimary ? 0.6 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={isPrimary ? '#fff' : theme.ink} size="small" />
      ) : (
        <Text
          style={[
            styles.buttonText,
            { color: isPrimary ? (off ? theme.inkFaint : '#fff') : theme.ink },
          ]}
        >
          {title}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  label: { fontSize: 13, fontWeight: '600', letterSpacing: 0.1 },
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    minHeight: 50,
  },
  input: { flex: 1, fontSize: 16, paddingVertical: 13 },
  eye: { paddingLeft: 8 },
  hint: { fontSize: 12.5, lineHeight: 17 },
  button: {
    height: 51,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  buttonText: { fontSize: 16, fontWeight: '700', letterSpacing: -0.1 },
});
