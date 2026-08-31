import { useEffect, useState } from 'react';
import { router } from 'expo-router';
import {
  Eye, Image as ImageIcon, Info, UserPlus, Lock, ScanFace, KeyRound, Ban,
} from 'lucide-react-native';

import { useAuth } from '../../src/store/auth';
import {
  SettingsScreen, Group, Row, Toggle, Segmented, Divider, Note,
} from '../../src/components/Settings';
import { api } from '../../src/lib/api';

const VISIBILITY = [
  { value: 'everyone', label: 'Everyone' },
  { value: 'contacts', label: 'Contacts' },
  { value: 'nobody', label: 'Nobody' },
];

export default function PrivacyScreen() {
  const user = useAuth((s) => s.user);
  const updatePrivacy = useAuth((s) => s.updatePrivacy);
  const updateSettings = useAuth((s) => s.updateSettings);

  const [blockedCount, setBlockedCount] = useState(null);

  useEffect(() => {
    api
      .get('/users/blocked')
      .then(({ data }) => setBlockedCount((data.blocked || []).length))
      .catch(() => setBlockedCount(null));
  }, []);

  const privacy = user?.privacy || {};
  const settings = user?.settings || {};

  return (
    <SettingsScreen title="Privacy" subtitle="Control what others can see">
      <Group title="Visibility">
        <Segmented
          icon={Eye}
          label="Last seen and online"
          value={privacy.lastSeen || 'everyone'}
          options={VISIBILITY}
          onChange={(v) => updatePrivacy({ lastSeen: v })}
        />
        <Divider />
        <Segmented
          icon={ImageIcon}
          label="Profile photo"
          value={privacy.avatar || 'everyone'}
          options={VISIBILITY}
          onChange={(v) => updatePrivacy({ avatar: v })}
        />
        <Divider />
        <Segmented
          icon={Info}
          label="About"
          value={privacy.about || 'everyone'}
          options={VISIBILITY}
          onChange={(v) => updatePrivacy({ about: v })}
        />
        <Divider />
        <Segmented
          icon={UserPlus}
          label="Who can add me to groups"
          value={privacy.groups || 'everyone'}
          options={VISIBILITY}
          onChange={(v) => updatePrivacy({ groups: v })}
        />
      </Group>

      <Group title="Messaging">
        <Toggle
          title="Read receipts"
          subtitle="Show blue ticks when you read a message"
          value={privacy.readReceipts !== false}
          onValueChange={(v) => updatePrivacy({ readReceipts: v })}
        />
        <Divider />
        <Toggle
          title="Typing indicators"
          subtitle="Let people see when you are writing"
          value={privacy.typing !== false}
          onValueChange={(v) => updatePrivacy({ typing: v })}
        />
        <Divider />
        <Toggle
          title="Link previews"
          subtitle="Load a preview card for links you receive"
          value={settings.linkPreviews !== false}
          onValueChange={(v) => updateSettings({ linkPreviews: v })}
        />
      </Group>

      <Note>
        Turning read receipts off means you also stop seeing when others read yours.
        Link previews are fetched through Chax, so leaving them on tells the server
        which links you open — the message itself stays encrypted either way.
      </Note>

      <Group title="Security">
        <Row
          icon={Lock}
          title="App lock"
          subtitle="Require your fingerprint or PIN to open Chax"
          onPress={() => router.push('/settings/applock')}
        />
        <Divider />
        <Row
          icon={ScanFace}
          title="Motion gestures"
          subtitle="Flip to hide, tilt to read, shake for emergency"
          onPress={() => router.push('/settings/gestures')}
        />
        <Divider />
        {/* Passkeys need WebAuthn, which has no native equivalent here. */}
        <Row icon={KeyRound} title="Passkeys" value="On the web" chevron={false} />
      </Group>

      <Note>
        App lock covers the screen, not your messages — your keys are not derived from
        your fingerprint. The motion gestures read the accelerometer only while Chax is
        on screen, so none of them can fire from your pocket.
      </Note>

      <Group title="Blocked">
        <Row
          icon={Ban}
          title="Blocked contacts"
          subtitle={blockedCount === null ? 'Loading…' : blockedCount + ' blocked'}
          onPress={() => router.push('/settings/blocked')}
        />
      </Group>
    </SettingsScreen>
  );
}
