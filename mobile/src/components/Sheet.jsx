import { useEffect } from 'react';
import { View, Text, Pressable, StyleSheet, BackHandler, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';
import { useTheme, font, heading } from '../theme';

/**
 * The bottom sheet every modal in the app is built on.
 *
 * A port of the web client's `ui/Sheet.jsx`, including its spring — damping 34,
 * stiffness 380 — so a sheet opens with the same weight on both. Drag down to
 * dismiss, and the scrim fades in proportion to the drag rather than snapping,
 * which is what makes a half-pull feel like it is tracking your thumb.
 *
 * Everything runs on the UI thread through Reanimated, so a sheet that opens
 * while a chat is decrypting in the background does not stutter.
 */
const SPRING = { damping: 34, stiffness: 380, mass: 0.8 };
const DISMISS_DISTANCE = 110;
const DISMISS_VELOCITY = 640;

export function Sheet({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  dismissible = true,
  showHandle = true,
  maxHeightRatio = 0.92,
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();

  const translateY = useSharedValue(screenHeight);
  const opened = useSharedValue(0);

  useEffect(() => {
    if (open) {
      translateY.value = withSpring(0, SPRING);
      opened.value = withTiming(1, { duration: 200 });
    } else {
      translateY.value = withTiming(screenHeight, { duration: 200 });
      opened.value = withTiming(0, { duration: 160 });
    }
  }, [open, screenHeight, translateY, opened]);

  /* Android's back button closes the sheet rather than leaving the screen —
     otherwise a sheet is a trap you can only leave by navigating away. */
  useEffect(() => {
    if (!open || !dismissible) return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose?.();
      return true;
    });
    return () => sub.remove();
  }, [open, dismissible, onClose]);

  const pan = Gesture.Pan()
    .enabled(dismissible)
    // Only a downward drag that starts vertically should move the sheet, or a
    // horizontal swipe inside its content would drag it too.
    .activeOffsetY(12)
    .failOffsetX([-20, 20])
    .onUpdate((e) => {
      translateY.value = Math.max(0, e.translationY);
    })
    .onEnd((e) => {
      if (e.translationY > DISMISS_DISTANCE || e.velocityY > DISMISS_VELOCITY) {
        translateY.value = withTiming(screenHeight, { duration: 180 });
        runOnJS(onClose)();
      } else {
        translateY.value = withSpring(0, SPRING);
      }
    });

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  const scrimStyle = useAnimatedStyle(() => ({
    opacity:
      opened.value *
      interpolate(translateY.value, [0, screenHeight * 0.5], [1, 0], Extrapolation.CLAMP),
  }));

  if (!open) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, scrimStyle]}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => dismissible && onClose?.()}
        />
      </Animated.View>

      <GestureDetector gesture={pan}>
        <Animated.View
          style={[
            styles.sheet,
            {
              backgroundColor: theme.raised,
              maxHeight: screenHeight * maxHeightRatio,
              paddingBottom: insets.bottom,
            },
            sheetStyle,
          ]}
        >
          {showHandle && (
            <View style={styles.handleWrap}>
              <View style={[styles.handle, { backgroundColor: theme.borderStrong }]} />
            </View>
          )}

          {!!title && (
            <View style={[styles.header, { borderBottomColor: theme.border }]}>
              <View style={styles.headerText}>
                <Text style={[heading(18), { color: theme.ink }]}>{title}</Text>
                {!!subtitle && (
                  <Text style={[styles.subtitle, { color: theme.inkMuted }]}>{subtitle}</Text>
                )}
              </View>

              {dismissible && (
                <Pressable
                  hitSlop={12}
                  onPress={onClose}
                  style={[styles.close, { backgroundColor: theme.surface3 }]}
                >
                  <X size={17} color={theme.inkMuted} strokeWidth={2.4} />
                </Pressable>
              )}
            </View>
          )}

          <View style={styles.body}>{children}</View>

          {!!footer && (
            <View style={[styles.footer, { borderTopColor: theme.border }]}>{footer}</View>
          )}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

/** A tappable row inside a sheet — the menu idiom used across the web client. */
export function SheetRow({ icon: Icon, label, description, onPress, danger, trailing }) {
  const theme = useTheme();
  const tint = danger ? theme.danger : theme.ink;

  return (
    <Pressable
      onPress={onPress}
      android_ripple={{ color: theme.surface3 }}
      style={styles.row}
    >
      {Icon && (
        <View style={[styles.rowIcon, { backgroundColor: theme.surface3 }]}>
          <Icon size={19} color={danger ? theme.danger : theme.inkSoft} strokeWidth={2} />
        </View>
      )}
      <View style={styles.rowText}>
        <Text style={[styles.rowLabel, { color: tint }]}>{label}</Text>
        {!!description && (
          <Text style={[styles.rowDescription, { color: theme.inkMuted }]}>{description}</Text>
        )}
      </View>
      {trailing}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scrim: { backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: 'hidden',
    elevation: 24,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: -6 },
  },
  handleWrap: { alignItems: 'center', paddingTop: 8, paddingBottom: 4 },
  handle: { width: 38, height: 4, borderRadius: 2 },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerText: { flex: 1, gap: 3 },
  subtitle: { fontSize: 13.5, lineHeight: 19, fontFamily: font.body },
  close: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  body: { paddingVertical: 6 },
  footer: { paddingHorizontal: 20, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingVertical: 13 },
  rowIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1, gap: 2 },
  rowLabel: { fontSize: 15.5, fontWeight: '600', fontFamily: font.body },
  rowDescription: { fontSize: 13, lineHeight: 18, fontFamily: font.body },
});
