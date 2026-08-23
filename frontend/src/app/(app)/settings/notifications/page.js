'use client';

import { useEffect, useState } from 'react';
import { Bell, BellRing, MessageSquare, Users, Heart, Phone, EyeOff } from 'lucide-react';
import { SettingsShell, SettingsGroup, SettingsRow, Divider } from '@/components/layout/SettingsShell';
import { Switch } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/store/auth';
import { toast } from '@/store/ui';
import { sounds, feedback } from '@/lib/sound';
import { enablePush, disablePush, isSubscribed, pushSupported, permission } from '@/lib/push';

export default function NotificationsPage() {
  const user = useAuth((s) => s.user);
  const updateSettings = useAuth((s) => s.updateSettings);
  const [perm, setPerm] = useState('default');
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);

  const notifications = user?.settings?.notifications || {};
  const supported = pushSupported();

  useEffect(() => {
    setPerm(permission());
    isSubscribed().then(setSubscribed);
  }, []);

  /** Turning this on registers the worker and hands the server a subscription,
   *  so messages arrive even with every Chax tab closed. */
  async function turnOnPush() {
    setBusy(true);
    try {
      await enablePush();
      setPerm(permission());
      setSubscribed(true);
      feedback('success');
      toast.success('Push notifications are on');
    } catch (err) {
      toast.error(err.message);
      setPerm(permission());
    } finally {
      setBusy(false);
    }
  }

  async function turnOffPush() {
    setBusy(true);
    try {
      await disablePush();
      setSubscribed(false);
      toast.success('Push notifications are off');
    } finally {
      setBusy(false);
    }
  }

  const rows = [
    { key: 'messages', icon: MessageSquare, label: 'Direct messages' },
    { key: 'groups', icon: Users, label: 'Groups and communities' },
    { key: 'reactions', icon: Heart, label: 'Reactions' },
    { key: 'calls', icon: Phone, label: 'Calls' },
  ];

  return (
    <SettingsShell title="Notifications" subtitle="When and how we should nudge you">
      <div className="mb-5 rounded-2xl bg-brand-tint p-5">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand text-white">
            <BellRing size={19} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold">
              {!supported
                ? 'Push is unavailable here'
                : subscribed
                  ? 'Push notifications are on'
                  : perm === 'denied'
                    ? 'Notifications are blocked'
                    : 'Get messages while Chax is closed'}
            </p>
            <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">
              {!supported
                ? 'This browser does not support the Push API. Notifications will only appear while a tab is open.'
                : subscribed
                  ? 'Alerts say who wrote to you. The text stays encrypted until you open the app.'
                  : perm === 'denied'
                    ? 'Allow notifications for this site in your browser settings, then come back.'
                    : 'Delivered even with every tab closed.'}
            </p>

            {supported && perm !== 'denied' && (
              <Button
                size="sm"
                className="mt-3"
                loading={busy}
                variant={subscribed ? 'secondary' : 'primary'}
                onClick={subscribed ? turnOffPush : turnOnPush}
              >
                {subscribed ? 'Turn off' : 'Turn on push'}
              </Button>
            )}
          </div>
        </div>
      </div>

      <SettingsGroup title="Alert me about">
        {rows.map((row, i) => (
          <div key={row.key}>
            {i > 0 && <Divider />}
            <SettingsRow>
              <div className="flex items-center gap-3">
                <row.icon size={17} className="shrink-0 text-ink-muted" />
                <Switch
                  label={row.label}
                  checked={notifications[row.key] !== false}
                  onChange={(v) => updateSettings({ notifications: { [row.key]: v } })}
                />
              </div>
            </SettingsRow>
          </div>
        ))}
      </SettingsGroup>

      <SettingsGroup
        title="Content"
        footer="With previews off, notifications say a message arrived but not what it says."
      >
        <SettingsRow>
          <div className="flex items-center gap-3">
            <EyeOff size={17} className="shrink-0 text-ink-muted" />
            <Switch
              label="Show message previews"
              checked={notifications.previews !== false}
              onChange={(v) => updateSettings({ notifications: { previews: v } })}
            />
          </div>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Sound">
        <SettingsRow>
          <Switch
            label="Play sounds in the app"
            sublabel="Send, receive, and reaction tones"
            checked={user?.settings?.sounds !== false}
            onChange={(v) => {
              updateSettings({ sounds: v });
              if (v) setTimeout(() => sounds.receive(), 60);
            }}
          />
        </SettingsRow>
        <Divider />
        <SettingsRow>
          <button
            type="button"
            onClick={() => sounds.receive()}
            className="flex items-center gap-2 text-[14.5px] font-medium text-brand-strong"
          >
            <Bell size={16} />
            Preview the message tone
          </button>
        </SettingsRow>
      </SettingsGroup>
    </SettingsShell>
  );
}
