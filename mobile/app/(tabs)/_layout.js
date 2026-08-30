import { Tabs } from 'expo-router';
import { Platform, View, Text, StyleSheet } from 'react-native';
import { MessageCircle, CircleDashed, Phone, Settings } from 'lucide-react-native';
import { useTheme } from '../../src/theme';
import { useChat } from '../../src/store/chat';

/**
 * The tab bar.
 *
 * The brief was "smooth like WhatsApp when switching tabs", and on Android that
 * comes down to three settings that fight the defaults:
 *
 *   lazy: false               every tab is rendered at startup, so the first
 *                             switch is not also the first mount. Costs a
 *                             little at launch, which the splash screen hides,
 *                             and removes the blank frame afterwards.
 *
 *   detachInactiveScreens     kept false so the inactive tabs stay in the
 *                             native view hierarchy. This is what preserves
 *                             scroll position — a detached screen comes back
 *                             at the top, which is the single most obvious
 *                             tell that an app is not native.
 *
 *   freezeOnBlur: true        those mounted screens stop re-rendering while
 *                             they are off screen, so keeping them mounted
 *                             costs CPU only when something they show changes.
 *
 * Together with `enableFreeze` in the root layout, switching tabs is a native
 * view swap rather than a React remount, which is why it lands in a frame.
 */
export default function TabsLayout() {
  const theme = useTheme();

  // Sum of unread across chats, for the badge on the Chats tab.
  const unread = useChat((s) =>
    s.conversations.reduce((n, c) => n + (c.archived ? 0 : c.unreadCount || 0), 0)
  );

  return (
    <Tabs
      detachInactiveScreens={false}
      screenOptions={{
        headerShown: false,
        lazy: false,
        freezeOnBlur: true,
        animation: 'shift',
        tabBarActiveTintColor: theme.accent,
        tabBarInactiveTintColor: theme.inkMuted,
        tabBarStyle: {
          backgroundColor: theme.surface,
          borderTopColor: theme.border,
          borderTopWidth: StyleSheet.hairlineWidth,
          height: Platform.OS === 'android' ? 62 : 84,
          paddingTop: 6,
          paddingBottom: Platform.OS === 'android' ? 8 : 26,
          elevation: 0,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600', marginTop: 2 },
        tabBarItemStyle: { paddingVertical: 2 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Chats',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon Icon={MessageCircle} color={color} focused={focused} badge={unread} theme={theme} />
          ),
        }}
      />
      <Tabs.Screen
        name="updates"
        options={{
          title: 'Updates',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon Icon={CircleDashed} color={color} focused={focused} theme={theme} />
          ),
        }}
      />
      <Tabs.Screen
        name="calls"
        options={{
          title: 'Calls',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon Icon={Phone} color={color} focused={focused} theme={theme} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon Icon={Settings} color={color} focused={focused} theme={theme} />
          ),
        }}
      />
    </Tabs>
  );
}

/** The selected tab gets a filled pill behind it, the way Material 3 does. */
function TabIcon({ Icon, color, focused, badge, theme }) {
  return (
    <View style={styles.iconWrap}>
      <View
        style={[
          styles.pill,
          focused && { backgroundColor: theme.accentTint },
        ]}
      >
        <Icon size={21} color={color} strokeWidth={focused ? 2.4 : 1.9} />
      </View>

      {badge > 0 && (
        <View style={[styles.badge, { backgroundColor: theme.accent }]}>
          <Text style={styles.badgeText} numberOfLines={1}>
            {badge > 99 ? '99+' : badge}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  iconWrap: { width: 64, alignItems: 'center', justifyContent: 'center' },
  pill: {
    width: 58,
    height: 30,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: -3,
    right: 8,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '800' },
});
