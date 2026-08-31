'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Gauge, Loader2, ShieldBan, ShieldCheck, UserX } from 'lucide-react';
import { Sheet, ChoiceDialog } from '@/components/ui/Sheet';
import { Button } from '@/components/ui/Button';
import { RadioRow } from '@/components/ui/Field';
import { Avatar } from '@/components/ui/Avatar';
import { useChat } from '@/store/chat';
import { toast } from '@/store/ui';
import { api } from '@/lib/api';
import { chatTime } from '@/lib/utils';
import { feedback } from '@/lib/sound';

/**
 * The admin controls for a group: slow mode and the ban list.
 *
 * Deliberately apart from "Chat info", which anyone can open. These are the
 * levers that change what other people can do, and mixing them in with the
 * group photo invites the wrong kind of accident.
 *
 * Removing a member and banning one are different acts. A plain remove is undone
 * by the invite link still sitting in their scrollback; a ban is the one that
 * holds, which is why it is here and phrased as what it is.
 */

const SLOW_MODE = [
  { value: 0, label: 'Off' },
  { value: 5, label: '5 seconds' },
  { value: 30, label: '30 seconds' },
  { value: 60, label: '1 minute' },
  { value: 300, label: '5 minutes' },
  { value: 3600, label: '1 hour' },
];

export function ModerationSheet({ open, onClose, conversation }) {
  const patchConversation = useChat((s) => s.patchConversation);

  const [slowMode, setSlowMode] = useState(0);
  const [bans, setBans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [confirmBan, setConfirmBan] = useState(null);

  useEffect(() => {
    if (!open || !conversation) return;
    setSlowMode(conversation.settings?.slowModeSeconds || 0);
    setLoading(true);
    api
      .get('/conversations/' + conversation._id + '/bans')
      .then(({ data }) => setBans(data.bans))
      .catch((err) => toast.error(err.message))
      .finally(() => setLoading(false));
  }, [open, conversation]);

  async function applySlowMode(seconds) {
    const previous = slowMode;
    setSlowMode(seconds); // optimistic: the radio should not lag the tap
    setSaving(true);
    try {
      const { data } = await api.patch('/conversations/' + conversation._id, {
        settings: { slowModeSeconds: seconds },
      });
      patchConversation(conversation._id, { settings: data.conversation.settings });
      feedback('select');
    } catch (err) {
      setSlowMode(previous);
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function ban(person) {
    try {
      await api.post('/conversations/' + conversation._id + '/bans/' + person._id);
      setBans((list) => [{ user: person, at: new Date().toISOString() }, ...list]);
      toast.success(person.name + ' was removed and banned');
      feedback('success');
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function unban(userId) {
    try {
      await api.delete('/conversations/' + conversation._id + '/bans/' + userId);
      setBans((list) => list.filter((b) => String(b.user._id) !== String(userId)));
      toast.success('Ban lifted');
    } catch (err) {
      toast.error(err.message);
    }
  }

  // As elsewhere: no user, no member. The rows below read `p.user._id`.
  const members = (conversation?.participants || []).filter(
    (p) => !p.leftAt && p.user && p.role === 'member'
  );

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        title="Moderation"
        subtitle={conversation?.name || 'Group controls'}
        size="md"
      >
        <div className="px-5 pb-6">
          <div className="mb-5 flex items-start gap-3 rounded-xl bg-brand-tint px-4 py-3">
            <ShieldCheck size={17} className="mt-0.5 shrink-0 text-brand-strong" />
            <p className="text-[12.5px] leading-relaxed text-ink-muted">
              Only admins see this. Slow mode does not apply to admins, and a ban survives
              the invite link — a plain removal does not.
            </p>
          </div>

          {/* ── slow mode ── */}
          <div className="mb-5 overflow-hidden rounded-xl bg-surface-2">
            <p className="flex items-center gap-2 px-4 pb-1 pt-3 text-[12px] font-semibold uppercase tracking-wide text-ink-faint">
              <Gauge size={13} />
              Slow mode
            </p>
            <p className="px-4 pb-2 text-[12.5px] leading-relaxed text-ink-muted">
              The least time between one member&apos;s messages.
            </p>
            {SLOW_MODE.map((option, i) => (
              <div key={option.value}>
                {i > 0 && <div className="divider mx-4" />}
                <RadioRow
                  label={option.label}
                  checked={slowMode === option.value}
                  onChange={() => !saving && applySlowMode(option.value)}
                />
              </div>
            ))}
          </div>

          {/* ── banning ── */}
          {members.length > 0 && (
            <div className="mb-5">
              <p className="mb-2 px-1 text-[12px] font-semibold uppercase tracking-wide text-ink-faint">
                Remove and ban
              </p>
              <div className="space-y-1.5">
                {members.map((p) => (
                  <div
                    key={p.user._id}
                    className="flex items-center gap-3 rounded-xl bg-surface-2 px-3 py-2"
                  >
                    <Avatar
                      src={p.user.avatar}
                      name={p.user.name}
                      color={p.user.avatarColor}
                      size="sm"
                    />
                    <span className="min-w-0 flex-1 truncate text-[14.5px]">{p.user.name}</span>
                    <button
                      type="button"
                      onClick={() => setConfirmBan(p.user)}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[12.5px] font-semibold text-danger transition-colors hover:bg-danger/10"
                    >
                      <UserX size={14} />
                      Ban
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── the list ── */}
          <p className="mb-2 px-1 text-[12px] font-semibold uppercase tracking-wide text-ink-faint">
            Banned {bans.length > 0 && '· ' + bans.length}
          </p>

          {loading ? (
            <div className="grid place-items-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-ink-faint" />
            </div>
          ) : bans.length === 0 ? (
            <p className="px-4 py-6 text-center text-[13.5px] text-ink-muted">
              Nobody is banned.
            </p>
          ) : (
            <div className="space-y-1.5">
              {bans.map((entry) => (
                <motion.div
                  key={entry.user._id}
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-center gap-3 rounded-xl bg-surface-2 px-3 py-2"
                >
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-danger/10 text-danger">
                    <ShieldBan size={16} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14.5px] font-medium">
                      {entry.user.name}
                    </span>
                    <span className="block truncate text-[11.5px] text-ink-faint">
                      {entry.by?.name ? 'by ' + entry.by.name + ' · ' : ''}
                      {chatTime(entry.at)}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => unban(entry.user._id)}
                    className="shrink-0 rounded-full bg-surface-3 px-3 py-1.5 text-[12.5px] font-semibold"
                  >
                    Unban
                  </button>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      </Sheet>

      <ChoiceDialog
        open={!!confirmBan}
        onClose={() => setConfirmBan(null)}
        title={'Ban ' + (confirmBan?.name || 'this person') + '?'}
        message="They are removed from the chat and cannot rejoin, including through the invite link. You can lift it later."
        choices={[
          {
            label: 'Remove and ban',
            sublabel: 'They cannot rejoin, even with the invite link',
            danger: true,
            onClick: () => {
              const person = confirmBan;
              setConfirmBan(null);
              ban(person);
            },
          },
        ]}
      />
    </>
  );
}
