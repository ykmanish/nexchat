import { View, Text, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { Users } from 'lucide-react-native';
import { mediaUrl } from '../lib/api';
import { initialsOf, avatarColour } from '../lib/utils';
import { useTheme } from '../theme';

/**
 * Someone's picture, or their initials on a colour derived from their id — so
 * the same person is always the same colour, on every device, without the
 * server having to store one.
 */
export function Avatar({ uri, name, id, size = 48, group = false, online = false }) {
  const theme = useTheme();
  const source = mediaUrl(uri);

  return (
    <View style={{ width: size, height: size }}>
      {source ? (
        <Image
          source={{ uri: source }}
          style={[styles.image, { width: size, height: size, borderRadius: size / 2 }]}
          contentFit="cover"
          transition={120}
          cachePolicy="memory-disk"
        />
      ) : (
        <View
          style={[
            styles.fallback,
            {
              width: size,
              height: size,
              borderRadius: size / 2,
              backgroundColor: group ? theme.surface3 : avatarColour(id || name),
            },
          ]}
        >
          {group ? (
            <Users size={size * 0.46} color={theme.inkMuted} strokeWidth={2} />
          ) : (
            <Text style={[styles.initials, { fontSize: size * 0.38 }]}>{initialsOf(name)}</Text>
          )}
        </View>
      )}

      {online && (
        <View
          style={[
            styles.dot,
            {
              backgroundColor: theme.accentStrong,
              borderColor: theme.surface,
              width: size * 0.28,
              height: size * 0.28,
              borderRadius: size * 0.14,
            },
          ]}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  image: { backgroundColor: 'transparent' },
  fallback: { alignItems: 'center', justifyContent: 'center' },
  initials: { color: '#fff', fontWeight: '700' },
  dot: { position: 'absolute', right: 0, bottom: 0, borderWidth: 2 },
});
