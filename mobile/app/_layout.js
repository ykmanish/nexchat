// Must be first: everything below reaches for crypto.getRandomValues.
import '../src/lib/polyfills';

import { useEffect, useRef } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Stack, router } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Notifications from 'expo-notifications';
import * as SplashScreen from 'expo-splash-screen';
import { enableFreeze } from 'react-native-screens';

import { useTheme } from '../src/theme';
import { useAuth } from '../src/store/auth';
import { useChat, setMe } from '../src/store/chat';
import { onUnauthorized } from '../src/lib/api';
import { attachRealtime } from '../src/lib/realtime';
import * as notifications from '../src/lib/notifications';
import { toast } from '../src/store/ui';
import { ToastStack } from '../src/components/Toast';

/**
 * Freeze inactive screens.
 *
 * This is half of what makes tab switching feel native: a screen that is not
 * on top stops re-rendering entirely, so a chat list with two hundred rows
 * costs nothing while you are on another tab, and comes back with its scroll
 * position and its React state exactly as they were. The other half is in
 * `(tabs)/_layout.js`, which keeps those screens mounted rather than tearing
 * them down.
 */
enableFreeze(true);

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const theme = useTheme();
  const status = useAuth((s) => s.status);
  const bootstrap = useAuth((s) => s.bootstrap);
  const user = useAuth((s) => s.user);

  /* ─── restore the session once ─── */
  useEffect(() => {
    bootstrap().finally(() => SplashScreen.hideAsync().catch(() => {}));
  }, [bootstrap]);

  /* The chat store needs to know who "me" is to tell my messages from others'. */
  useEffect(() => {
    setMe(user);
  }, [user]);

  /* ─── a lost session tears everything down ─── */
  useEffect(
    () =>
      onUnauthorized((code) => {
        useAuth.setState({ status: 'guest', user: null });
        useChat.getState().reset();
        toast.error(
          code === 'DEVICE_REVOKED'
            ? 'This device was signed out from another device.'
            : 'Your session expired. Please sign in again.'
        );
      }),
    []
  );

  /* ─── realtime, only while signed in ─── */
  useEffect(() => {
    if (status !== 'authed') return undefined;

    const detach = attachRealtime();
    const chat = useChat.getState();
    chat.loadConversations().catch(() => {});
    chat.loadContacts().catch(() => {});

    // Anything typed into a notification that could not be sent at the time.
    notifications.flushOutbox().catch(() => {});
    notifications.registerBackgroundHandler().catch(() => {});
    notifications.configureCategories().catch(() => {});

    return detach;
  }, [status]);

  /* ─── notification taps and replies ─── */
  const routed = useRef(false);

  useEffect(() => {
    /* A response that arrived while the app was not running. Drained once, on
       the first render after boot, because `getLastNotificationResponseAsync`
       keeps returning the same one. */
    if (!routed.current) {
      routed.current = true;
      Notifications.getLastNotificationResponseAsync()
        .then(async (response) => {
          if (!response) return;
          const { opened } = await notifications.handleResponse(response);
          if (opened) router.push('/chat/' + opened);
        })
        .catch(() => {});
    }

    const sub = Notifications.addNotificationResponseReceivedListener(async (response) => {
      const { opened } = await notifications.handleResponse(response);
      if (opened) router.push('/chat/' + opened);
    });

    return () => sub.remove();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: theme.app }}>
      <SafeAreaProvider>
        <StatusBar style={theme.scheme === 'dark' ? 'light' : 'dark'} />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: theme.app },
            // Native stack animations run on the UI thread, so a push stays at
            // 60fps even while the chat is decrypting in the background.
            animation: 'slide_from_right',
            animationDuration: 220,
          }}
        >
          <Stack.Screen name="index" />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="chat/[id]" />
        </Stack>
        <ToastStack />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
