import { Stack } from 'expo-router';
import { useTheme } from '../../src/theme';

export default function SettingsLayout() {
  const theme = useTheme();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: theme.app },
        animation: 'slide_from_right',
        animationDuration: 220,
      }}
    />
  );
}
