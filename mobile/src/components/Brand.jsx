import { View, Text, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import Svg, { Path, Rect } from 'react-native-svg';
import { useTheme, font } from '../theme';

const ICON = require('../../assets/icon.png');

export function Logo({ size = 44, rounded = true }) {
  return (
    <Image
      source={ICON}
      style={{ width: size, height: size, borderRadius: rounded ? size / 2 : 0 }}
      contentFit="contain"
    />
  );
}

/**
 * "NexChat", with the second half in the brand colour.
 *
 * Uses `accentStrong` rather than `accent` — the lime is a fill colour and is
 * unreadable as text on a light background.
 */
export function Wordmark({ size = 'md', showIcon = true }) {
  const theme = useTheme();
  const s = { sm: { logo: 26, text: 17 }, md: { logo: 32, text: 21 }, lg: { logo: 46, text: 29 } }[size];

  return (
    <View style={styles.wordmark}>
      {showIcon && <Logo size={s.logo} />}
      <Text style={[styles.wordmarkText, { fontSize: s.text, color: theme.ink }]}>
        Nex
        <Text style={{ color: theme.accentStrong }}>Chat</Text>
      </Text>
    </View>
  );
}

/** The small padlock used beside every "encrypted" reassurance. */
export function LockIcon({ size = 12, color }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M7 10V7a5 5 0 0 1 10 0v3"
        stroke={color}
        strokeWidth={2.4}
        strokeLinecap="round"
      />
      <Rect x="4" y="10" width="16" height="11" rx="2.5" fill={color} />
    </Svg>
  );
}

export function EncryptedBadge({ label = 'End-to-end encrypted' }) {
  const theme = useTheme();
  return (
    <View style={[styles.badge, { backgroundColor: theme.accentTint }]}>
      <LockIcon size={11} color={theme.accentStrong} />
      <Text style={[styles.badgeText, { color: theme.accentStrong }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wordmark: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  wordmarkText: { fontFamily: font.display, fontWeight: '600', letterSpacing: -0.5 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeText: { fontSize: 11, fontWeight: '600', fontFamily: font.body },
});
