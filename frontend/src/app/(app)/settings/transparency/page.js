'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Eye, EyeOff, Loader2, RefreshCw, TriangleAlert } from 'lucide-react';
import {
  SettingsShell,
  SettingsGroup,
  SettingsRow,
  Divider,
} from '@/components/layout/SettingsShell';
import { Button } from '@/components/ui/Button';
import { toast } from '@/store/ui';
import { api } from '@/lib/api';
import { formatBytes } from '@/lib/media';
import { chatTime } from '@/lib/utils';

/**
 * What the server knows.
 *
 * Every encrypted messenger says "we cannot read your messages" and asks to be
 * believed. This screen does not ask: it queries the database and lists what is
 * legible there, item by item, with the reason each one has to be.
 *
 * The design rule that makes it worth having is that nothing is left out for
 * being awkward. Mention ids are cleartext. Drafts are cleartext. Both are on
 * the page, in the visible column, stated as plainly as the flattering entries.
 * A transparency page that only listed reassurances would be marketing.
 */
export default function TransparencyPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    api
      .get('/transparency/me')
      .then(({ data: res }) => setData(res))
      .catch((err) => toast.error(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  if (loading && !data) {
    return (
      <SettingsShell title="What the server knows" subtitle="Checking…">
        <div className="grid place-items-center py-16">
          <Loader2 className="h-5 w-5 animate-spin text-ink-faint" />
        </div>
      </SettingsShell>
    );
  }

  if (!data) return null;

  const v = data.visible;

  return (
    <SettingsShell
      title="What the server knows"
      subtitle="Read straight from the database, not from a policy"
    >
      <SettingsGroup
        footer={
          'Generated ' +
          chatTime(data.generatedAt) +
          '. These are live queries — nothing here is a stored summary.'
        }
      >
        <SettingsRow>
          <div className="flex items-start gap-3">
            <Eye size={17} className="mt-0.5 shrink-0 text-brand-strong" />
            <p className="text-[13px] leading-relaxed text-ink-muted">
              Encryption hides what you say. It does not hide that you said something, to
              whom, or when — and no messenger can claim otherwise. This page is the honest
              version of that, including the parts that are not flattering.
            </p>
          </div>
        </SettingsRow>
      </SettingsGroup>

      {/* ── the awkward bits, first ── */}
      <SettingsGroup title="Worth knowing about">
        <SettingsRow>
          <div className="flex items-start gap-3">
            <TriangleAlert size={17} className="mt-0.5 shrink-0 text-warn" />
            <div className="min-w-0">
              <p className="text-[14.5px] font-medium">Unsent drafts are not encrypted</p>
              <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-muted">
                {v.drafts.why}
              </p>
              <p className="mt-1.5 text-[12.5px] font-medium text-ink">
                {v.drafts.conversationsWithADraft} chat
                {v.drafts.conversationsWithADraft === 1 ? '' : 's'} with a draft ·{' '}
                {v.drafts.totalDraftCharacters} characters readable
              </p>
            </div>
          </div>
        </SettingsRow>
        <Divider />
        <SettingsRow>
          <div className="flex items-start gap-3">
            <TriangleAlert size={17} className="mt-0.5 shrink-0 text-warn" />
            <div className="min-w-0">
              <p className="text-[14.5px] font-medium">Who was @-mentioned is visible</p>
              <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-muted">
                {v.mentions.why}
              </p>
              <p className="mt-1.5 text-[12.5px] font-medium text-ink">
                You have been mentioned {v.mentions.timesYouWereMentioned} time
                {v.mentions.timesYouWereMentioned === 1 ? '' : 's'}
              </p>
            </div>
          </div>
        </SettingsRow>
      </SettingsGroup>

      {/* ── visible ── */}
      <Section title="Your identity" why={v.identity.why}>
        <Fact label="Email" value={v.identity.email} />
        <Fact label="Name" value={v.identity.name} />
        <Fact label="Username" value={v.identity.username || '—'} />
        <Fact label="About" value={v.identity.about || '—'} />
        <Fact label="Account created" value={chatTime(v.identity.accountCreated)} />
        <Fact label="Last sign-in" value={v.identity.lastLogin ? chatTime(v.identity.lastLogin) : '—'} />
        <Fact label="Presence" value={v.identity.presence} />
      </Section>

      <Section title="Keys and credentials" why={v.credentials.why}>
        <Fact label="Password" value={v.credentials.passwordHash} />
        <Fact label="Account identity key" value={v.credentials.identityPublicKey} />
        <Fact label="Wrapped private identity" value={v.credentials.encryptedIdentity} />
        <Fact label="Passkeys registered" value={String(v.credentials.passkeys)} />
      </Section>

      <Section
        title={'Devices · ' + v.devices.active + ' active of ' + v.devices.count}
        why={v.devices.why}
      >
        {v.devices.list.map((d) => (
          <Fact
            key={d.deviceId}
            label={d.name + (d.revokedAt ? ' (revoked)' : '')}
            value={
              [d.os, d.browser, d.lastKnownIp, d.pushSubscribed ? 'push on' : null]
                .filter(Boolean)
                .join(' · ') || d.deviceId
            }
          />
        ))}
      </Section>

      <Section title="Who you talk to" why={v.socialGraph.why}>
        <Fact label="Conversations" value={String(v.socialGraph.conversations)} />
        <Fact label="Distinct people" value={String(v.socialGraph.distinctCounterparties)} />
        <Fact label="Saved contacts" value={String(v.socialGraph.contacts)} />
        <Fact label="Blocked" value={String(v.socialGraph.blocked)} />

        {v.socialGraph.perConversation.map((c, i) => (
          <Fact
            key={i}
            label={(c.name || (c.type === 'direct' ? 'A direct chat' : c.type)) + ' · ' + c.members + ' members'}
            value={
              c.messages +
              ' messages · ' +
              formatBytes(c.ciphertextBytes) +
              ' of ciphertext' +
              (c.lastMessage ? ' · last ' + chatTime(c.lastMessage) : '')
            }
          />
        ))}
      </Section>

      <Section title="Message envelopes" why={v.messages.why}>
        <Fact label="Sent by you" value={String(v.messages.sentByYou)} />
        {Object.entries(v.messages.byType).map(([type, n]) => (
          <Fact key={type} label={'Type: ' + type} value={String(n)} />
        ))}
        <Fact label="Total ciphertext" value={formatBytes(v.messages.totalCiphertextBytes)} />
      </Section>

      <Section title="Activity" why={v.activity.why}>
        <Fact label="Stories posted" value={String(v.activity.storiesPosted)} />
        <Fact label="Calls started" value={String(v.activity.callsStarted)} />
        <Fact label="Calls joined" value={String(v.activity.callsJoined)} />
      </Section>

      <Section title="Opaque blobs held for you" why={v.storedBlobs.why}>
        <Fact
          label="Encrypted backup"
          value={
            v.storedBlobs.encryptedBackup
              ? formatBytes(v.storedBlobs.encryptedBackup.sizeBytes) +
                ' · updated ' +
                chatTime(v.storedBlobs.encryptedBackup.updatedAt)
              : 'none stored'
          }
        />
        <Fact
          label="Device sync snapshot"
          value={
            v.storedBlobs.deviceSyncSnapshot
              ? formatBytes(v.storedBlobs.deviceSyncSnapshot.sizeBytes) +
                ' · v' +
                v.storedBlobs.deviceSyncSnapshot.version
              : 'none stored'
          }
        />
        <Fact label="Forensic attestations" value={String(v.storedBlobs.forensicAttestations)} />
      </Section>

      {/* ── what it cannot see ── */}
      <SettingsGroup
        title="What the server cannot see"
        footer="Each reason names where the decryption key actually lives. None of these is a policy commitment — they are consequences of the design."
      >
        {data.invisible.map((item, i) => (
          <div key={item.item}>
            {i > 0 && <Divider />}
            <SettingsRow>
              <div className="flex items-start gap-3">
                <EyeOff size={16} className="mt-0.5 shrink-0 text-brand-strong" />
                <div className="min-w-0">
                  <p className="text-[14.5px] font-medium">{item.item}</p>
                  <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-muted">
                    {item.reason}
                  </p>
                </div>
              </div>
            </SettingsRow>
          </div>
        ))}
      </SettingsGroup>

      <SettingsGroup>
        <SettingsRow>
          <Button size="block" variant="secondary" icon={RefreshCw} loading={loading} onClick={load}>
            Re-run the queries
          </Button>
        </SettingsRow>
      </SettingsGroup>
    </SettingsShell>
  );
}

function Section({ title, why, children }) {
  return (
    <SettingsGroup title={title} footer={why}>
      {children}
    </SettingsGroup>
  );
}

function Fact({ label, value }) {
  return (
    <SettingsRow>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="flex items-baseline justify-between gap-4"
      >
        <span className="min-w-0 shrink-0 text-[13.5px] text-ink-muted">{label}</span>
        <span className="min-w-0 flex-1 break-words text-right text-[13.5px] font-medium">
          {value}
        </span>
      </motion.div>
    </SettingsRow>
  );
}
