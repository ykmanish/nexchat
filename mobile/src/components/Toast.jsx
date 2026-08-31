import { View, Text, StyleSheet, Pressable } from 'react-native';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CircleCheck, CircleAlert, Info } from 'lucide-react-native';
import { useUI } from '../store/ui';
import { useTheme } from '../theme';

const ICONS = { success: CircleCheck, error: CircleAlert, info: Info };

export function ToastStack() {
  const toasts = useUI((s) => s.toasts);
  const dismiss = useUI((s) => s.dismiss);
  const insets = useSafeAreaInsets();
  const theme = useTheme();

  if (!toasts.length) return null;

  return (
    <View style={[styles.stack, { bottom: insets.bottom + 78 }]} pointerEvents="box-none">
      {toasts.map((t) => {
        const Icon = ICONS[t.kind] || Info;
        const tint = t.kind === 'error' ? theme.danger : t.kind === 'success' ? theme.accentStrong : theme.inkMuted;

        return (
          <Animated.View
            key={t.id}
            entering={FadeInDown.duration(180)}
            exiting={FadeOutDown.duration(140)}
          >
            <Pressable
              onPress={() => dismiss(t.id)}
              style={[styles.toast, { backgroundColor: theme.surface3, borderColor: theme.border }]}
            >
              <Icon size={17} color={tint} strokeWidth={2.2} />
              <Text style={[styles.text, { color: theme.ink }]} numberOfLines={3}>
                {t.message}
              </Text>
            </Pressable>
          </Animated.View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { position: 'absolute', left: 12, right: 12, gap: 8, alignItems: 'center' },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: 460,
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  text: { flex: 1, fontSize: 14, fontWeight: '500' },
});
