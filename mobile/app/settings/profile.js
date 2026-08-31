import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Camera } from 'lucide-react-native';

import { useAuth } from '../../src/store/auth';
import { Avatar } from '../../src/components/Avatar';
import { SettingsScreen, Group, Note } from '../../src/components/Settings';
import { Field, Button } from '../../src/components/Field';
import { useTheme, font } from '../../src/theme';
import { toast } from '../../src/store/ui';

export default function ProfileScreen() {
  const theme = useTheme();
  const user = useAuth((s) => s.user);
  const updateProfile = useAuth((s) => s.updateProfile);
  const uploadAvatar = useAuth((s) => s.uploadAvatar);

  const [form, setForm] = useState({ name: '', username: '', about: '' });
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    setForm({
      name: user?.name || '',
      username: user?.username || '',
      about: user?.about || '',
    });
  }, [user?.name, user?.username, user?.about]);

  const dirty =
    form.name !== (user?.name || '') ||
    form.username !== (user?.username || '') ||
    form.about !== (user?.about || '');

  const save = async () => {
    setBusy(true);
    try {
      await updateProfile({
        name: form.name.trim(),
        username: form.username.trim() || undefined,
        about: form.about,
      });
      toast.success('Profile saved');
    } catch (err) {
      toast.error(err.message || 'Could not save that');
    } finally {
      setBusy(false);
    }
  };

  const changePhoto = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      toast.error('Chax needs access to your photos.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
    });
    if (result.canceled || !result.assets?.length) return;

    setUploading(true);
    try {
      await uploadAvatar(result.assets[0]);
      toast.success('Photo updated');
    } catch (err) {
      toast.error(err.message || 'Could not upload that photo');
    } finally {
      setUploading(false);
    }
  };

  return (
    <SettingsScreen title="Profile" subtitle="Name, username, photo">
      <View style={styles.avatarWrap}>
        <Pressable onPress={changePhoto} disabled={uploading}>
          <Avatar uri={user?.avatar} name={user?.name} id={user?._id} size={104} />
          <View style={[styles.camera, { backgroundColor: theme.accent, borderColor: theme.app }]}>
            {uploading ? (
              <ActivityIndicator size="small" color={theme.accentInk} />
            ) : (
              <Camera size={17} color={theme.accentInk} strokeWidth={2.2} />
            )}
          </View>
        </Pressable>
        <Text style={[styles.hint, { color: theme.inkMuted }]}>Tap to change your photo</Text>
      </View>

      <Group>
        <View style={styles.form}>
          <Field
            label="Name"
            value={form.name}
            onChangeText={(v) => setForm((f) => ({ ...f, name: v }))}
            placeholder="Your name"
            autoCapitalize="words"
          />
          <Field
            label="Username"
            value={form.username}
            onChangeText={(v) => setForm((f) => ({ ...f, username: v.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase() }))}
            placeholder="username"
            autoCapitalize="none"
            hint="People can find you by this instead of your email."
          />
          <Field
            label="About"
            value={form.about}
            onChangeText={(v) => setForm((f) => ({ ...f, about: v }))}
            placeholder="Available"
            maxLength={140}
          />
          <Button title="Save" onPress={save} loading={busy} disabled={!dirty} />
        </View>
      </Group>

      <Note>
        Your name, photo and about are visible according to your privacy settings.
        Your email address is never shown to anyone.
      </Note>
    </SettingsScreen>
  );
}

const styles = StyleSheet.create({
  avatarWrap: { alignItems: 'center', paddingTop: 18, gap: 10 },
  camera: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hint: { fontSize: 13, fontFamily: font.body },
  form: { padding: 16, gap: 16 },
});
