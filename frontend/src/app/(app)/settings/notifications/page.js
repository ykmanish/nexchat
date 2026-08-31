'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Bell,
  BellRing,
  MessageSquare,
  Users,
  Heart,
  Phone,
  EyeOff,
  PencilLine,
  Send,
  TriangleAlert,
} from 'lucide-react';
import { SettingsShell, SettingsGroup, SettingsRow, Divider } from '@/components/layout/SettingsShell';
import { Switch } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/store/auth';
import { toast } from '@/store/ui';
import { sounds, feedback } from '@/lib/sound';
import {
  enablePush,
  disablePush,
  isSubscribed,
  pushSupported,
  permission,
  sendTestNotification,
  pushConfig,
} from '@/lib/push';

export default function NotificationsPage() {
  const user = useAuth((s) => s.user);
  const updateSettings = useAuth((s) => s.updateSettings);
  const [perm, setPerm] = useState('default');
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [server, setServer] = useState(null);
  const [ringing, setRinging] = useState(false);
  const stopRing = useRef(null);

  const notifications = user?.settings?.notifications || {};
  const supported = pushSupported();

  useEffect(() => {
    setPerm(permission());
    isSubscribed().then(setSubscribed);
    pushConfig().then(setServer);
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

  /**
   * Asks the server to push one notification here.
   *
   * A local `showNotification` would prove only that this browser can draw a
   * notification. Everything that actually breaks — the VAPID keys, the push
   * service, a subscription the browser silently rotated, the worker's push
   * handler — is on the far side of the round trip, so the test has to make it.
   */
  async function runTest() {
    setTesting(true);
    try {
      await sendTestNotification();
      feedback('success');
      toast.success('Sent — it should appear within a second or two');
    } catch (err) {
      toast.error(err.message || 'Could not send a test notification');
    } finally {
      setTesting(false);
    }
  }

  /* Plays one pass of the real ringtone and stops it again. The full cadence
     runs for the same 45 seconds a real call rings for, so this has to be
     stoppable — a preview you cannot switch off is a prank. */
  function previewRingtone() {
    if (stopRing.current) {
      stopRing.current();
      stopRing.current = null;
      setRinging(false);
      return;
    }
    stopRing.current = sounds.ring();
    setRinging(true);
  }

  /* Leaving this page mid-preview must not leave the phone ringing. */
  useEffect(
    () => () => {
      stopRing.current?.();
      stopRing.current = null;
    },
    []
  );

  const rows = [
    { key: 'messages', icon: MessageSquare, label: 'Direct messages' },
    { key: 'groups', icon: Users, label: 'Groups and communities' },
    { key: 'reactions', icon: Heart, label: 'Reactions' },
    { key: 'calls', icon: Phone, label: 'Calls' },
    {
      key: 'typing',
      icon: PencilLine,
      label: 'Someone is typing',
      sublabel: 'A quiet nudge before the message lands',
      // Off by default: this is the one alert for something nobody has said yet.
      defaultOn: false,
    },
  ];

  return (
    <SettingsShell title="Notifications" subtitle="When and how we should nudge you">
      <div className="mb-5 rounded-2xl bg-brand-tint p-5">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand text-brand-ink">
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
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  loading={busy}
                  variant={subscribed ? 'secondary' : 'primary'}
                  onClick={subscribed ? turnOffPush : turnOnPush}
                >
                  {subscribed ? 'Turn off' : 'Turn on push'}
                </Button>

                {/* The one honest way to find out whether this works on *this*
                    phone. Web push has a long chain and every link fails
                    silently, so guessing is not good enough. */}
                {subscribed && (
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={Send}
                    loading={testing}
                    onClick={runTest}
                  >
                    Send a test
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* A configuration problem, stated where somebody wondering why nothing
          arrives will actually look. Left unsaid, this presents as "push worked
          for a day and then stopped" — which is exactly what it is, and exactly
          what nobody can debug from the outside. */}
      {server?.ephemeral && (
        <div className="mb-5 flex items-start gap-3 rounded-2xl bg-warn/10 px-4 py-3.5">
          <TriangleAlert size={17} className="mt-0.5 shrink-0 text-warn" />
          <div className="min-w-0">
            <p className="text-[13.5px] font-semibold">
              This server has no permanent notification keys
            </p>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-muted">
              It generated temporary ones at startup, so notifications will stop the
              next time it restarts and everyone has to turn push on again. Whoever
              runs the server needs to set <code className="font-mono">VAPID_PUBLIC_KEY</code>{' '}
              and <code className="font-mono">VAPID_PRIVATE_KEY</code> — the values are in
              the startup log.
            </p>
          </div>
        </div>
      )}

      {server && !server.enabled && !server.unreachable && (
        <div className="mb-5 flex items-start gap-3 rounded-2xl bg-surface-2 px-4 py-3.5">
          <TriangleAlert size={17} className="mt-0.5 shrink-0 text-ink-faint" />
          <p className="text-[12.5px] leading-relaxed text-ink-muted">
            Push is switched off on this server, so alerts only appear while Chax is
            open in a tab.
          </p>
        </div>
      )}

      <SettingsGroup title="Alert me about">
        {rows.map((row, i) => (
          <div key={row.key}>
            {i > 0 && <Divider />}
            <SettingsRow>
              <div className="flex items-center gap-3">
                <row.icon size={17} className="shrink-0 text-ink-muted" />
                <Switch
                  label={row.label}
                  sublabel={row.sublabel}
                  checked={
                    row.defaultOn === false
                      ? notifications[row.key] === true
                      : notifications[row.key] !== false
                  }
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
        <Divider />
        {/* Separate from the message tone, because it is a separate thing: the
            ringtone is loud, it vibrates, and it follows the Calls switch above
            rather than "Play sounds in the app". Hearing it once here is the
            only way to know that before somebody actually calls. */}
        <SettingsRow>
          <button
            type="button"
            onClick={previewRingtone}
            className="flex items-center gap-2 text-[14.5px] font-medium text-brand-strong"
          >
            <Phone size={16} />
            {ringing ? 'Stop the ringtone' : 'Preview the ringtone'}
          </button>
        </SettingsRow>
      </SettingsGroup>
    </SettingsShell>
  );
}
