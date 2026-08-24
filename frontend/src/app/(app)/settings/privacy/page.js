'use client';

import { useEffect, useState } from 'react';
import { Ban, Eye, UserPlus, Image as ImageIcon, Info, Lock } from 'lucide-react';
import { SettingsShell, SettingsGroup, SettingsRow, Divider } from '@/components/layout/SettingsShell';
import { Switch, Segmented } from '@/components/ui/Field';
import { ListButton } from '@/components/ui/Button';
import { Avatar } from '@/components/ui/Avatar';
import { Sheet } from '@/components/ui/Sheet';
import { useAuth } from '@/store/auth';
import { toast } from '@/store/ui';
import { api } from '@/lib/api';
import { feedback } from '@/lib/sound';
import { AppLockSheet } from '@/components/modals/AppLockSheet';
import { appLock, AUTO_LOCK_OPTIONS } from '@/lib/applock';

/** "On · After 5 minutes · fingerprint and passkey" */
function lockSummary({ enabled, autoLockSeconds, kinds }) {
  if (!enabled) return 'Off';
  const timing =
    AUTO_LOCK_OPTIONS.find((o) => o.value === autoLockSeconds)?.label || 'After 5 minutes';
  const extras = [
    kinds.includes('biometric') && 'fingerprint',
    kinds.includes('passkey') && 'passkey',
  ].filter(Boolean);
  return ['On', timing, extras.join(' and ')].filter(Boolean).join(' · ');
}

const VISIBILITY = [
  { value: 'everyone', label: 'Everyone' },
  { value: 'contacts', label: 'Contacts' },
  { value: 'nobody', label: 'Nobody' },
];

export default function PrivacyPage() {
  const user = useAuth((s) => s.user);
  const updatePrivacy = useAuth((s) => s.updatePrivacy);

  const [blocked, setBlocked] = useState([]);
  const [showBlocked, setShowBlocked] = useState(false);
  const [showLock, setShowLock] = useState(false);
  const [lockState, setLockState] = useState({
    enabled: false,
    autoLockSeconds: 300,
    kinds: [],
  });

  const refreshLock = () =>
    appLock.config().then((cfg) =>
      setLockState({
        enabled: !!cfg?.hash,
        autoLockSeconds: cfg?.autoLockSeconds ?? 300,
        kinds: (cfg?.credentials || []).map((c) => c.kind),
      })
    );

  const privacy = user?.privacy || {};

  useEffect(() => {
    api
      .get('/users/blocked')
      .then(({ data }) => setBlocked(data.blocked))
      .catch(() => {});
    refreshLock();
  }, []);

  const rows = [
    { key: 'lastSeen', icon: Eye, label: 'Last seen and online' },
    { key: 'avatar', icon: ImageIcon, label: 'Profile photo' },
    { key: 'about', icon: Info, label: 'About' },
    { key: 'groupAdd', icon: UserPlus, label: 'Who can add me to groups' },
  ];

  return (
    <SettingsShell title="Privacy" subtitle="Control what others can see">
      <SettingsGroup title="Visibility">
        {rows.map((row, i) => (
          <div key={row.key}>
            {i > 0 && <Divider />}
            <SettingsRow>
              <div className="mb-2.5 flex items-center gap-3">
                <row.icon size={17} className="text-ink-muted" />
                <span className="text-[15px] font-medium">{row.label}</span>
              </div>
              <Segmented
                className={'seg-' + row.key}
                options={VISIBILITY}
                value={privacy[row.key] || 'everyone'}
                onChange={(value) => updatePrivacy({ [row.key]: value })}
              />
            </SettingsRow>
          </div>
        ))}
      </SettingsGroup>

      <SettingsGroup
        title="Messaging"
        footer="Turning read receipts off means you also stop seeing when others read yours. Link previews are fetched through Chax, so leaving them on tells the server which links you open — the message itself stays encrypted either way."
      >
        <SettingsRow>
          <Switch
            label="Read receipts"
            sublabel="Show blue ticks when you read a message"
            checked={privacy.readReceipts !== false}
            onChange={(v) => updatePrivacy({ readReceipts: v })}
          />
        </SettingsRow>
        <Divider />
        <SettingsRow>
          <Switch
            label="Typing indicator"
            sublabel="Let people see when you are writing"
            checked={privacy.typingIndicator !== false}
            onChange={(v) => updatePrivacy({ typingIndicator: v })}
          />
        </SettingsRow>
        <Divider />
        <SettingsRow>
          <Switch
            label="Link previews"
            sublabel="Load a preview card for links you receive"
            checked={privacy.linkPreviews !== false}
            onChange={(v) => updatePrivacy({ linkPreviews: v })}
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup
        title="Security"
        footer="The PIN lives on this device only, and so does any fingerprint or passkey you add to it. None of them is your account password."
      >
        <ListButton
          icon={Lock}
          label="App lock"
          sublabel={lockSummary(lockState)}
          chevron
          onClick={() => {
            feedback('open');
            setShowLock(true);
          }}
        />
      </SettingsGroup>

      <SettingsGroup title="Blocked">
        <ListButton
          icon={Ban}
          label="Blocked contacts"
          sublabel={blocked.length + (blocked.length === 1 ? ' person' : ' people')}
          chevron
          onClick={() => {
            feedback('open');
            setShowBlocked(true);
          }}
        />
      </SettingsGroup>

      <Sheet
        open={showBlocked}
        onClose={() => setShowBlocked(false)}
        title="Blocked contacts"
        subtitle="They cannot message or call you."
        size="sm"
      >
        <div className="pb-6">
          {blocked.length === 0 && (
            <p className="px-5 py-10 text-center text-[13.5px] text-ink-muted">
              You haven&apos;t blocked anyone.
            </p>
          )}
          {blocked.map((person) => (
            <div key={person._id} className="flex items-center gap-3 px-5 py-2.5">
              <Avatar src={person.avatar} name={person.name} color={person.avatarColor} size="md" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-medium">{person.name}</p>
                {person.username && (
                  <p className="truncate text-[12.5px] text-ink-muted">
                    @{person.username}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={async () => {
                  await api.delete('/users/block/' + person._id);
                  setBlocked((list) => list.filter((p) => p._id !== person._id));
                  toast.success(person.name + ' unblocked');
                }}
                className="shrink-0 rounded-full bg-surface-2 px-3 py-1.5 text-[13px] font-semibold"
              >
                Unblock
              </button>
            </div>
          ))}
        </div>
      </Sheet>

      <AppLockSheet open={showLock} onClose={() => setShowLock(false)} onChanged={refreshLock} />
    </SettingsShell>
  );
}
