'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import {
  Archive,
  Ban,
  Bell,
  BellOff,
  Crown,
  Image as ImageIcon,
  Link2,
  LogOut,
  Pin,
  ShieldCheck,
  Stamp,
  Star,
  Timer,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react';
import { Sheet, ConfirmDialog } from '@/components/ui/Sheet';
import { ListButton, Button } from '@/components/ui/Button';
import { saveContactMenuItem } from '@/components/chat/SaveContactBar';
import { Switch, RadioRow } from '@/components/ui/Field';
import { Avatar } from '@/components/ui/Avatar';
import { useChat } from '@/store/chat';
import { useAuth } from '@/store/auth';
import { toast, useUI } from '@/store/ui';
import { api } from '@/lib/api';
import { safetyNumber } from '@/lib/crypto';
import { cn, lastSeenLabel } from '@/lib/utils';
import { feedback } from '@/lib/sound';

const DISAPPEARING = [
  { value: 0, label: 'Off' },
  { value: 86400, label: '24 hours' },
  { value: 604800, label: '7 days' },
  { value: 7776000, label: '90 days' },
];

export function ChatInfoSheet({ open, onClose, conversation: initial }) {
  const router = useRouter();
  const user = useAuth((s) => s.user);
  const setConversationState = useChat((s) => s.setConversationState);
  const removeConversation = useChat((s) => s.removeConversation);

  // The sheet is opened with a snapshot; read the live row so toggles inside
  // it reflect immediately instead of needing a close-and-reopen.
  const live = useChat((s) => s.conversations.find((c) => c._id === initial?._id));
  const conversation = live || initial;

  const [view, setView] = useState('main');
  const [fingerprint, setFingerprint] = useState('');
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);

  const isDirect = conversation?.type === 'direct';

  const contactAction = saveContactMenuItem(conversation);
  const isAdmin = conversation?.isAdmin;

  useEffect(() => {
    if (open) setView('main');
  }, [open]);

  useEffect(() => {
    if (!open || !isDirect || !conversation?.peer?.identityPublicKey || !user?.identityPublicKey) {
      return;
    }
    safetyNumber(user.identityPublicKey, conversation.peer.identityPublicKey)
      .then(setFingerprint)
      .catch(() => {});
  }, [open, isDirect, conversation, user]);

  if (!conversation) return null;

  const members = (conversation.participants || []).filter((p) => !p.leftAt);

  async function setDisappearing(seconds) {
    try {
      await api.patch('/conversations/' + conversation._id, {
        settings: { disappearingSeconds: seconds },
      });
      useChat.getState().patchConversation(conversation._id, {
        settings: { ...conversation.settings, disappearingSeconds: seconds },
      });
      toast.success(seconds ? 'Messages will disappear' : 'Disappearing messages off');
      setView('main');
    } catch (err) {
      toast.error(err.message);
    }
  }

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        title={view === 'main' ? undefined : view === 'safety' ? 'Safety number' : 'Disappearing messages'}
        size="md"
        showHandle
      >
        {view === 'main' && (
          <div className="pb-4">
            {/* ── identity block ── */}
            <div className="flex flex-col items-center px-6 pb-5 pt-1">
              <Avatar
                src={conversation.avatar}
                name={conversation.name}
                color={conversation.avatarColor}
                size="2xl"
              />
              <h2 className="mt-4 text-center font-display text-[22px] tracking-tight">
                {conversation.name}
              </h2>
              <p className="mt-1 text-center text-[13.5px] text-ink-muted">
                {isDirect
                  ? lastSeenLabel(conversation.peer)
                  : members.length + (members.length === 1 ? ' member' : ' members')}
              </p>
              {conversation.about && (
                <p className="mt-3 max-w-[300px] text-center text-[14px] leading-relaxed text-ink-soft">
                  {conversation.about}
                </p>
              )}

              {isDirect && conversation.peer?.username && (
                <p className="mt-2 font-mono text-[13px] text-ink-faint">
                  @{conversation.peer.username}
                </p>
              )}
            </div>

            {/* ── quick toggles ── */}
            <div className="mx-4 mb-3 overflow-hidden rounded-2xl bg-surface-2">
              <div className="flex items-center justify-between px-5 py-3.5">
                <Switch
                  label="Mute notifications"
                  checked={!!conversation.muted}
                  onChange={(v) => setConversationState(conversation._id, { muted: v })}
                />
              </div>
              <div className="divider mx-5" />
              <div className="flex items-center justify-between px-5 py-3.5">
                <Switch
                  label="Pin to top"
                  checked={!!conversation.pinned}
                  onChange={(v) => setConversationState(conversation._id, { pinned: v })}
                />
              </div>
            </div>

            {/* ── actions ── */}
            <div className="mx-4 mb-3 overflow-hidden rounded-2xl bg-surface-2">
              <ListButton
                icon={ShieldCheck}
                label="Encryption"
                sublabel={isDirect ? 'Compare safety numbers' : 'End-to-end encrypted'}
                chevron
                onClick={() => setView('safety')}
              />
              <div className="divider mx-5" />
              <ListButton
                icon={Timer}
                label="Disappearing messages"
                sublabel={
                  DISAPPEARING.find((d) => d.value === (conversation.settings?.disappearingSeconds || 0))
                    ?.label || 'Off'
                }
                chevron
                onClick={() => setView('disappearing')}
              />
              <div className="divider mx-5" />
              <ListButton
                icon={ImageIcon}
                label="Media, links and docs"
                chevron
                onClick={() => {
                  onClose();
                  router.push('/chats/' + conversation._id);
                  toast.info('Open the chat menu to browse media');
                }}
              />
              <div className="divider mx-5" />
              <ListButton
                icon={Star}
                label="Starred messages"
                chevron
                onClick={() => {
                  onClose();
                  router.push('/settings/starred');
                }}
              />
            </div>

            {/* ── members ── */}
            {!isDirect && (
              <div className="mx-4 mb-3 overflow-hidden rounded-2xl bg-surface-2">
                <div className="flex items-center justify-between px-5 pb-1 pt-4">
                  <h3 className="text-[12px] font-semibold uppercase tracking-wide text-ink-faint">
                    {members.length} members
                  </h3>
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      useUI.getState().openSheet('groupMembers', { conversation });
                    }}
                    className="text-[13px] font-semibold text-brand-strong"
                  >
                    {isAdmin ? 'Manage' : 'See all'}
                  </button>
                </div>
                <div className="max-h-[280px] overflow-y-auto scroll-soft">
                  {members.map((p) => (
                    <div key={p.user._id} className="flex items-center gap-3 px-5 py-2.5">
                      <Avatar
                        src={p.user.avatar}
                        name={p.user.name}
                        color={p.user.avatarColor}
                        size="sm"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[14.5px] font-medium">
                          {String(p.user._id) === String(user?._id) ? 'You' : p.user.name}
                        </p>
                        <p className="truncate text-[12.5px] text-ink-muted">
                          {p.user.about || 'Available'}
                        </p>
                      </div>
                      {p.role !== 'member' && (
                        <span className="flex items-center gap-1 rounded-full bg-brand/15 px-2 py-0.5 text-[10.5px] font-semibold text-brand-strong">
                          {p.role === 'owner' && <Crown size={10} />}
                          {p.role}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── admin controls ──
                Their own card, above the destructive block: these change what
                other people can do, and should not sit next to "Leave". */}
            {!isDirect && isAdmin && (
              <div className="mx-4 mb-3 overflow-hidden rounded-2xl bg-surface-2">
                <ListButton
                  icon={ShieldCheck}
                  label="Moderation"
                  sublabel={
                    [
                      conversation.settings?.slowModeSeconds
                        ? 'Slow mode on'
                        : 'Slow mode off',
                      conversation.bannedCount
                        ? conversation.bannedCount +
                          (conversation.bannedCount === 1 ? ' banned' : ' banned')
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')
                  }
                  chevron
                  onClick={() => useUI.getState().openSheet('moderation', { conversation })}
                />
              </div>
            )}

            {/* Sits above the destructive block rather than in it: producing
                evidence is a read-only act, but it is consequential enough that
                it should not be one row from "Delete chat". */}
            <div className="mx-4 mb-3 overflow-hidden rounded-2xl bg-surface-2">
              <ListButton
                icon={Stamp}
                label="Export as evidence"
                sublabel="Sealed, hash-chained, independently verifiable"
                chevron
                onClick={() => useUI.getState().openSheet('forensicExport', { conversation })}
              />
            </div>

            {/* ── destructive ── */}
            <div className="mx-4 overflow-hidden rounded-2xl bg-surface-2">
              <ListButton
                icon={Archive}
                label={conversation.archived ? 'Unarchive chat' : 'Archive chat'}
                onClick={() =>
                  setConversationState(conversation._id, { archived: !conversation.archived })
                }
              />
              <div className="divider mx-5" />
              {!isDirect && (
                <>
                  <ListButton
                    icon={LogOut}
                    label="Leave"
                    danger
                    onClick={() => setConfirm('leave')}
                  />
                  <div className="divider mx-5" />
                </>
              )}
              {isDirect && contactAction && (
                <>
                  {/* Above Block, not beside it. This screen is where somebody
                      goes to find out who they are talking to, and "save them"
                      is the constructive half of that decision — burying it
                      under the destructive one gets the emphasis backwards. */}
                  <ListButton
                    icon={contactAction.icon}
                    label={contactAction.label}
                    onClick={contactAction.onClick}
                  />
                  <div className="divider mx-5" />
                </>
              )}
              {isDirect && (
                <>
                  <ListButton
                    icon={Ban}
                    label={'Block ' + (conversation.peer?.name || '')}
                    danger
                    onClick={() => setConfirm('block')}
                  />
                  <div className="divider mx-5" />
                </>
              )}
              <ListButton
                icon={Trash2}
                label="Delete chat"
                danger
                onClick={() => setConfirm('delete')}
              />
            </div>
          </div>
        )}

        {view === 'safety' && (
          <div className="px-6 pb-8 pt-2 text-center">
            <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-brand/15 text-brand-strong">
              <ShieldCheck size={26} />
            </div>
            <p className="mx-auto max-w-[300px] text-[14px] leading-relaxed text-ink-muted">
              {isDirect
                ? 'Compare this number with ' +
                  (conversation.peer?.name || 'them') +
                  ' in person or over another channel. If they match, no one is intercepting your messages.'
                : 'Every message in this group is encrypted with keys that only members hold.'}
            </p>

            {fingerprint && (
              <div className="mt-6 rounded-2xl bg-surface-2 p-5">
                <p className="whitespace-pre-wrap break-all font-mono text-[16px] leading-[2] tracking-wider">
                  {fingerprint}
                </p>
              </div>
            )}

            <Button variant="secondary" size="block" className="mt-6" onClick={() => setView('main')}>
              Done
            </Button>
          </div>
        )}

        {view === 'disappearing' && (
          <div className="pb-6">
            <p className="px-6 pb-3 text-[13.5px] leading-relaxed text-ink-muted">
              New messages will vanish from everyone&apos;s devices after the chosen time.
              Messages already sent are unaffected.
            </p>
            <div className="mx-4 overflow-hidden rounded-2xl bg-surface-2">
              {DISAPPEARING.map((option, i) => (
                <div key={option.value}>
                  {i > 0 && <div className="divider mx-5" />}
                  <RadioRow
                    label={option.label}
                    checked={(conversation.settings?.disappearingSeconds || 0) === option.value}
                    onChange={() => setDisappearing(option.value)}
                  />
                </div>
              ))}
            </div>
          </div>
        )}
      </Sheet>

      <ConfirmDialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        loading={busy}
        danger
        title={
          confirm === 'leave'
            ? 'Leave this chat?'
            : confirm === 'block'
              ? 'Block ' + (conversation.peer?.name || 'this person') + '?'
              : 'Delete this chat?'
        }
        message={
          confirm === 'leave'
            ? 'You will stop receiving messages from this group.'
            : confirm === 'block'
              ? 'They will no longer be able to message or call you.'
              : 'The conversation is removed from this account. Others keep their copy.'
        }
        confirmLabel={confirm === 'leave' ? 'Leave' : confirm === 'block' ? 'Block' : 'Delete'}
        onConfirm={async () => {
          setBusy(true);
          try {
            if (confirm === 'leave') {
              await api.post('/conversations/' + conversation._id + '/leave');
            } else if (confirm === 'block') {
              await api.post('/users/block/' + conversation.peer._id);
            } else {
              await api.delete('/conversations/' + conversation._id);
            }
            removeConversation(conversation._id);
            feedback('success');
            onClose();
            router.push('/chats');
          } catch (err) {
            toast.error(err.message);
          } finally {
            setBusy(false);
            setConfirm(null);
          }
        }}
      />
    </>
  );
}
