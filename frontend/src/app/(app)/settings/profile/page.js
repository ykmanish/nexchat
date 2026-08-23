'use client';

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Camera, Check, AtSign, User, Trash2, Loader2 } from 'lucide-react';
import { SettingsShell, SettingsGroup, SettingsRow, Divider } from '@/components/layout/SettingsShell';
import { Input, Textarea } from '@/components/ui/Field';
import { Button, ListButton } from '@/components/ui/Button';
import { Avatar } from '@/components/ui/Avatar';
import { useAuth } from '@/store/auth';
import { toast } from '@/store/ui';
import { api } from '@/lib/api';
import { debounce } from '@/lib/utils';
import { feedback } from '@/lib/sound';

export default function ProfileSettingsPage() {
  const user = useAuth((s) => s.user);
  const updateProfile = useAuth((s) => s.updateProfile);
  const uploadAvatar = useAuth((s) => s.uploadAvatar);

  const [form, setForm] = useState({ name: '', about: '', username: '' });
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [usernameState, setUsernameState] = useState(null);
  const fileRef = useRef(null);

  useEffect(() => {
    if (user) {
      setForm({ name: user.name || '', about: user.about || '', username: user.username || '' });
    }
  }, [user]);

  const checkUsername = useRef(
    debounce(async (value) => {
      if (!value || value.length < 3) return setUsernameState(null);
      try {
        const { data } = await api.get('/auth/check-username', { params: { username: value } });
        setUsernameState(data.available ? 'available' : 'taken');
      } catch {
        setUsernameState(null);
      }
    }, 400)
  ).current;

  function set(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
    setDirty(true);
    if (key === 'username') {
      setUsernameState('checking');
      checkUsername(value.toLowerCase());
    }
  }

  async function save() {
    setSaving(true);
    try {
      const patch = { name: form.name.trim(), about: form.about.trim() };
      if (form.username && form.username !== user.username) {
        patch.username = form.username.toLowerCase();
      }
      await updateProfile(patch);
      feedback('success');
      toast.success('Profile updated');
      setDirty(false);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function pickAvatar(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      await uploadAvatar(file);
      feedback('success');
      toast.success('Photo updated');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  return (
    <SettingsShell
      title="Profile"
      subtitle="How you appear to others"
      action={
        dirty ? (
          <Button size="xs" loading={saving} onClick={save}>
            Save
          </Button>
        ) : null
      }
    >
      <div className="mb-6 flex flex-col items-center">
        <motion.button
          type="button"
          whileTap={{ scale: 0.94 }}
          onClick={() => fileRef.current?.click()}
          className="relative"
        >
          <Avatar src={user?.avatar} name={user?.name} color={user?.avatarColor} size="3xl" />
          <span className="absolute bottom-1 right-1 grid h-11 w-11 place-items-center rounded-full bg-brand text-brand-ink ring-4 ring-app">
            {uploading ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <Camera size={18} strokeWidth={2.2} />
            )}
          </span>
        </motion.button>

        {user?.avatar && (
          <button
            type="button"
            onClick={async () => {
              await api.delete('/users/me/avatar');
              useAuth.setState((s) => ({ user: { ...s.user, avatar: null } }));
              toast.success('Photo removed');
            }}
            className="mt-3 text-[13px] font-medium text-danger"
          >
            Remove photo
          </button>
        )}

        <input ref={fileRef} type="file" accept="image/*" hidden onChange={pickAvatar} />
      </div>

      <SettingsGroup footer="Your name and photo are visible to people you chat with.">
        <SettingsRow>
          <Input
            label="Name"
            icon={User}
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            maxLength={60}
          />
        </SettingsRow>
        <Divider />
        <SettingsRow>
          <Input
            label="Username"
            icon={AtSign}
            value={form.username}
            onChange={(e) => set('username', e.target.value.replace(/[^a-zA-Z0-9_.]/g, ''))}
            placeholder="pick a handle"
            maxLength={24}
            hint={
              usernameState === 'available'
                ? 'That one is free'
                : usernameState === 'checking'
                  ? 'Checking…'
                  : 'Letters, numbers, dots and underscores'
            }
            error={usernameState === 'taken' ? 'That username is taken' : null}
            suffix={
              usernameState === 'available' ? (
                <Check size={17} className="shrink-0 text-wa-500" strokeWidth={2.6} />
              ) : null
            }
          />
        </SettingsRow>
        <Divider />
        <SettingsRow>
          <Textarea
            label="About"
            value={form.about}
            onChange={(e) => set('about', e.target.value)}
            maxLength={160}
            rows={2}
            hint={160 - form.about.length + ' characters left'}
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Account" footer="Your email is never shown to other people.">
        <SettingsRow className="flex items-center justify-between">
          <span className="text-[15px]">Email</span>
          <span className="text-[14px] text-ink-muted">{user?.email}</span>
        </SettingsRow>
        <Divider />
        <SettingsRow className="flex items-center justify-between">
          <span className="text-[15px]">Security code</span>
          <span className="font-mono text-[13px] text-ink-muted">
            {user?.securityCode}
          </span>
        </SettingsRow>
      </SettingsGroup>

      {dirty && (
        <Button size="block" loading={saving} onClick={save}>
          Save changes
        </Button>
      )}
    </SettingsShell>
  );
}
