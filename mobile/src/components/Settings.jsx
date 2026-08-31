import { View, Text, Pressable, StyleSheet, ScrollView, Switch, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import { useTheme, font, heading } from '../theme';

/**
 * The chrome every settings sub-screen shares.
 *
 * The web client puts these behind a two-pane shell; on a phone each is a
 * pushed screen with a back chevron, which is the same information hierarchy
 * expressed the way the platform expects.
 */
export function SettingsScreen({ title, subtitle, children, scroll = true }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const body = (
    <View style={styles.body}>{children}</View>
  );

  return (
    <View style={[styles.screen, { backgroundColor: theme.app }]}>
      <View
        style={[
          styles.header,
          { backgroundColor: theme.surface, paddingTop: insets.top + 6, borderBottomColor: theme.border },
        ]}
      >
        <Pressable hitSlop={12} onPress={() => router.back()} style={styles.back}>
          <ChevronLeft size={26} color={theme.ink} strokeWidth={2.2} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={[heading(20), { color: theme.ink }]}>{title}</Text>
          {!!subtitle && (
            <Text style={[styles.subtitle, { color: theme.inkMuted }]}>{subtitle}</Text>
          )}
        </View>
      </View>

      {scroll ? (
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}>{body}</ScrollView>
      ) : (
        body
      )}
    </View>
  );
}

/** A titled group of rows on a raised card, as the web renders them. */
export function Group({ title, footer, children }) {
  const theme = useTheme();

  return (
    <View style={styles.group}>
      {!!title && <Text style={[styles.groupTitle, { color: theme.inkMuted }]}>{title}</Text>}
      <View style={[styles.card, { backgroundColor: theme.surface }]}>{children}</View>
      {!!footer && <Text style={[styles.groupFooter, { color: theme.inkMuted }]}>{footer}</Text>}
    </View>
  );
}

export function Row({ icon: Icon, title, subtitle, value, onPress, danger, chevron, loading }) {
  const theme = useTheme();
  const tint = danger ? theme.danger : theme.ink;

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      android_ripple={onPress ? { color: theme.surface3 } : undefined}
      style={styles.row}
    >
      {Icon && (
        <View style={[styles.rowIcon, { backgroundColor: theme.surface3 }]}>
          <Icon size={19} color={danger ? theme.danger : theme.inkSoft} strokeWidth={2} />
        </View>
      )}

      <View style={styles.rowText}>
        <Text style={[styles.rowTitle, { color: tint }]}>{title}</Text>
        {!!subtitle && <Text style={[styles.rowSub, { color: theme.inkMuted }]}>{subtitle}</Text>}
      </View>

      {!!value && <Text style={[styles.rowValue, { color: theme.inkMuted }]}>{value}</Text>}
      {loading && <ActivityIndicator size="small" color={theme.inkMuted} />}
      {chevron !== false && onPress && !loading && (
        <ChevronRight size={19} color={theme.inkFaint} strokeWidth={2} />
      )}
    </Pressable>
  );
}

export function Toggle({ icon: Icon, title, subtitle, value, onValueChange, disabled }) {
  const theme = useTheme();

  return (
    <View style={styles.row}>
      {Icon && (
        <View style={[styles.rowIcon, { backgroundColor: theme.surface3 }]}>
          <Icon size={19} color={theme.inkSoft} strokeWidth={2} />
        </View>
      )}
      <View style={styles.rowText}>
        <Text style={[styles.rowTitle, { color: theme.ink }]}>{title}</Text>
        {!!subtitle && <Text style={[styles.rowSub, { color: theme.inkMuted }]}>{subtitle}</Text>}
      </View>
      <Switch
        value={!!value}
        onValueChange={onValueChange}
        disabled={disabled}
        trackColor={{ true: theme.accent, false: theme.surface3 }}
        thumbColor="#fff"
      />
    </View>
  );
}

/**
 * Everyone / Contacts / Nobody.
 *
 * The web uses a segmented control for each privacy rule, and the shape is
 * worth keeping: three fixed options read as one decision, where three separate
 * rows would read as three.
 */
export function Segmented({ icon: Icon, label, value, options, onChange }) {
  const theme = useTheme();

  return (
    <View style={styles.segmentedWrap}>
      <View style={styles.segmentedLabel}>
        {Icon && <Icon size={18} color={theme.inkSoft} strokeWidth={2} />}
        <Text style={[styles.rowTitle, { color: theme.ink }]}>{label}</Text>
      </View>

      <View style={[styles.segmented, { backgroundColor: theme.surface3 }]}>
        {options.map((option) => {
          const on = value === option.value;
          return (
            <Pressable
              key={option.value}
              onPress={() => onChange(option.value)}
              style={[
                styles.segment,
                on && { backgroundColor: theme.surface },
              ]}
            >
              <Text
                style={[
                  styles.segmentText,
                  { color: on ? theme.ink : theme.inkMuted, fontWeight: on ? '700' : '500' },
                ]}
              >
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export const Divider = () => {
  const theme = useTheme();
  return <View style={[styles.divider, { backgroundColor: theme.border }]} />;
};

/** Explanatory paragraph, the tone the web uses under each group. */
export function Note({ children }) {
  const theme = useTheme();
  return <Text style={[styles.note, { color: theme.inkMuted }]}>{children}</Text>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  back: { padding: 4 },
  headerText: { flex: 1, gap: 2 },
  subtitle: { fontSize: 13.5, fontFamily: font.body },
  body: { paddingTop: 8 },
  group: { marginTop: 18 },
  groupTitle: {
    fontSize: 12.5,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    paddingHorizontal: 22,
    paddingBottom: 8,
    fontFamily: font.body,
  },
  groupFooter: {
    fontSize: 12.5,
    lineHeight: 18,
    paddingHorizontal: 22,
    paddingTop: 9,
    fontFamily: font.body,
  },
  card: { marginHorizontal: 12, borderRadius: 14, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 13 },
  rowIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 15.5, fontWeight: '600', fontFamily: font.body },
  rowSub: { fontSize: 13, lineHeight: 18, fontFamily: font.body },
  rowValue: { fontSize: 14, fontFamily: font.body },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: 68 },
  segmentedWrap: { paddingHorizontal: 16, paddingVertical: 13, gap: 10 },
  segmentedLabel: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  segmented: { flexDirection: 'row', borderRadius: 999, padding: 3 },
  segment: { flex: 1, paddingVertical: 8, borderRadius: 999, alignItems: 'center' },
  segmentText: { fontSize: 13.5, fontFamily: font.body },
  note: {
    fontSize: 12.5,
    lineHeight: 18.5,
    paddingHorizontal: 22,
    paddingTop: 12,
    fontFamily: font.body,
  },
});
