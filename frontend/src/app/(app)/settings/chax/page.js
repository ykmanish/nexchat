'use client';

import { Bot, BellRing, Contact, WandSparkles } from 'lucide-react';
import { SettingsShell, SettingsGroup, SettingsRow, Divider } from '@/components/layout/SettingsShell';
import { Switch } from '@/components/ui/Field';
import { Logo } from '@/components/brand/Logo';
import { useAuth } from '@/store/auth';

export default function ChaxAssistantSettingsPage() {
  const user = useAuth((s) => s.user);
  const updateSettings = useAuth((s) => s.updateSettings);
  const assistant = user?.settings?.assistant || {};

  const setAssistant = (patch) =>
    updateSettings({ assistant: { ...assistant, ...patch } });

  return (
    <SettingsShell title="Chax assistant" subtitle="Control what Chax is allowed to use">
      <div className="mb-5 rounded-2xl bg-brand-tint p-5">
        <div className="flex items-start gap-3">
          <Logo size={42} />
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold">Chax only uses what you allow</p>
            <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">
              Normal chats stay encrypted. Chax receives only the command you send with @chax,
              plus the permission-backed context you enable here.
            </p>
          </div>
        </div>
      </div>

      <SettingsGroup
        title="Access"
        footer="Contacts access lets Chax understand names and usernames when you ask it to remind or coordinate with people."
      >
        <SettingsRow>
          <div className="flex items-center gap-3">
            <Contact size={17} className="shrink-0 text-ink-muted" />
            <Switch
              label="Allow contacts access"
              sublabel="Share saved contact names, usernames, and emails with Chax"
              checked={assistant.contacts === true}
              onChange={(v) => setAssistant({ contacts: v })}
            />
          </div>
        </SettingsRow>
        <Divider />
        <SettingsRow>
          <div className="flex items-center gap-3">
            <BellRing size={17} className="shrink-0 text-ink-muted" />
            <Switch
              label="Allow reminders"
              sublabel="Let Chax schedule reminder messages in chats"
              checked={assistant.reminders !== false}
              onChange={(v) => setAssistant({ reminders: v })}
            />
          </div>
        </SettingsRow>
        <Divider />
        <SettingsRow>
          <div className="flex items-center gap-3">
            <WandSparkles size={17} className="shrink-0 text-ink-muted" />
            <Switch
              label="Allow action access"
              sublabel="Let Chax use supported app actions when you ask directly"
              checked={assistant.actions === true}
              onChange={(v) => setAssistant({ actions: v })}
            />
          </div>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="How to use">
        <SettingsRow>
          <div className="flex items-start gap-3">
            <Bot size={17} className="mt-0.5 shrink-0 text-ink-muted" />
            <p className="text-[13.5px] leading-relaxed text-ink-muted">
              Type @chax in any personal or group chat. Chax can answer, draft, plan,
              and set reminders when the relevant access is enabled.
            </p>
          </div>
        </SettingsRow>
      </SettingsGroup>
    </SettingsShell>
  );
}
