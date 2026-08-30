import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { Redirect } from 'expo-router';
import { useAuth } from '../src/store/auth';
import { useTheme } from '../src/theme';

/**
 * The gate.
 *
 * `bootstrap` in the root layout decides which of these four states we are in;
 * until it has, nothing is rendered but a spinner — routing to the sign-in
 * screen and then bouncing to the chat list is a flash every launch.
 */
export default function Index() {
  const status = useAuth((s) => s.status);
  const theme = useTheme();

  if (status === 'loading') {
    return (
      <View style={[styles.centre, { backgroundColor: theme.app }]}>
        <ActivityIndicator size="large" color={theme.accent} />
      </View>
    );
  }

  if (status === 'authed') return <Redirect href="/(tabs)" />;
  if (status === 'locked') return <Redirect href="/(auth)/unlock" />;
  return <Redirect href="/(auth)/login" />;
}

const styles = StyleSheet.create({
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
