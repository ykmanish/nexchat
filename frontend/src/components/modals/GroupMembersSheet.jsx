'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Crown,
  Shield,
  ShieldOff,
  UserMinus,
  UserPlus,
  Search,
  MessageSquare,
  MoreVertical,
} from 'lucide-react';
import { Sheet, ConfirmDialog } from '@/components/ui/Sheet';
import { Dropdown } from '@/components/ui/Dropdown';
import { Input, Switch } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { Avatar } from '@/components/ui/Avatar';
import { useChat } from '@/store/chat';
import { useAuth } from '@/store/auth';
import { toast } from '@/store/ui';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { feedback } from '@/lib/sound';

/** Member list with the admin controls: promote, demote, remove, add. */
export function GroupMembersSheet({ open, onClose, conversation: initial }) {
  const me = useAuth((s) => s.user);
  const upsertConversation = useChat((s) => s.upsertConversation);

  const live = useChat((s) => s.conversations.find((c) => c._id === initial?._id));
  const conversation = live || initial;

  const [query, setQuery] = useState('');
  const [menuFor, setMenuFor] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [contacts, setContacts] = useState([]);
  const [selected, setSelected] = useState([]);
  const menuAnchor = useRef(null);

  const isAdmin = conversation?.isAdmin;
  const members = useMemo(
    () => (conversation?.participants || []).filter((p) => !p.leftAt),
    [conversation]
  );

  const filtered = members.filter((p) =>
    p.user?.name?.toLowerCase().includes(query.trim().toLowerCase())
  );

  useEffect(() => {
    if (!open) {
      setAdding(false);
      setSelected([]);
      setQuery('');
    }
  }, [open]);

  useEffect(() => {
    if (!adding) return;
    api
      .get('/users/contacts')
      .then(({ data }) => setContacts(data.contacts))
      .catch(() => {});
  }, [adding]);

  async function refresh() {
    const { data } = await api.get('/conversations/' + conversation._id);
    upsertConversation(data.conversation);
  }

  async function setRole(userId, role) {
    try {
      await api.patch('/conversations/' + conversation._id + '/members/' + userId + '/role', {
        role,
      });
      await refresh();
      feedback('success');
      toast.success(role === 'admin' ? 'Promoted to admin' : 'Removed as admin');
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function removeMember(userId) {
    setBusy(true);
    try {
      await api.delete('/conversations/' + conversation._id + '/members/' + userId);
      await refresh();
      feedback('success');
      toast.success('Member removed');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  }

  async function addMembers() {
    if (!selected.length) return;
    setBusy(true);
    try {
      await api.post('/conversations/' + conversation._id + '/members', {
        memberIds: selected,
      });
      await refresh();
      feedback('success');
      toast.success(selected.length + ' added');
      setAdding(false);
      setSelected([]);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function setSetting(patch) {
    try {
      const { data } = await api.patch('/conversations/' + conversation._id, {
        settings: { ...conversation.settings, ...patch },
      });
      upsertConversation(data.conversation);
    } catch (err) {
      toast.error(err.message);
    }
  }

  if (!conversation) return null;

  const existing = new Set(members.map((p) => String(p.user._id || p.user)));
  const addable = contacts.filter((c) => !existing.has(String(c._id || c.id)));

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        title={adding ? 'Add members' : 'Members'}
        subtitle={
          adding
            ? selected.length
              ? selected.length + ' selected'
              : 'Choose who to add'
            : members.length + (members.length === 1 ? ' member' : ' members')
        }
        size="md"
        footer={
          adding ? (
            <div className="flex gap-3">
              <Button variant="secondary" size="block" onClick={() => setAdding(false)}>
                Cancel
              </Button>
              <Button size="block" loading={busy} disabled={!selected.length} onClick={addMembers}>
                Add
              </Button>
            </div>
          ) : null
        }
      >
        {adding ? (
          <div className="pb-4">
            {addable.length === 0 && (
              <p className="px-5 py-10 text-center text-[13.5px] text-ink-muted">
                Everyone in your contacts is already here.
              </p>
            )}
            {addable.map((c) => {
              const id = String(c._id || c.id);
              const on = selected.includes(id);
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    feedback('select');
                    setSelected((list) =>
                      on ? list.filter((x) => x !== id) : [...list, id]
                    );
                  }}
                  className="flex w-full items-center gap-3 px-5 py-2.5 text-left transition-colors hover:bg-surface-2"
                >
                  <Avatar src={c.avatar} name={c.name} color={c.avatarColor} size="md" />
                  <span className="min-w-0 flex-1 truncate text-[15px]">{c.name}</span>
                  <span
                    className={cn(
                      'grid h-6 w-6 place-items-center rounded-full border-2 transition-colors',
                      on ? 'border-brand bg-brand text-brand-ink' : 'border-line-strong'
                    )}
                  >
                    {on && <UserPlus size={12} />}
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <>
            {isAdmin && (
              <div className="mx-4 mb-3 space-y-3 rounded-xl bg-surface-2 px-4 py-3">
                <Switch
                  label="Only admins can send messages"
                  sublabel="Turns this into an announcement group"
                  checked={conversation.settings?.whoCanSend === 'admins'}
                  onChange={(v) => setSetting({ whoCanSend: v ? 'admins' : 'everyone' })}
                />
                <div className="divider" />
                <Switch
                  label="Only admins can edit group info"
                  sublabel="Name, description and photo"
                  checked={conversation.settings?.whoCanEditInfo === 'admins'}
                  onChange={(v) => setSetting({ whoCanEditInfo: v ? 'admins' : 'everyone' })}
                />
                <div className="divider" />
                <Switch
                  label="Only admins can add members"
                  checked={conversation.settings?.whoCanAddMembers === 'admins'}
                  onChange={(v) => setSetting({ whoCanAddMembers: v ? 'admins' : 'everyone' })}
                />
              </div>
            )}

            <div className="px-5 pb-2">
              <Input
                icon={Search}
                placeholder="Search members"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>

            {isAdmin && (
              <button
                type="button"
                onClick={() => {
                  feedback('select');
                  setAdding(true);
                }}
                className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-surface-2"
              >
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand text-brand-ink">
                  <UserPlus size={19} />
                </span>
                <span className="text-[15px] font-medium text-brand-strong">Add members</span>
              </button>
            )}

            <div className="pb-4">
              {filtered.map((p) => {
                const id = String(p.user._id || p.user);
                const isMe = id === String(me?._id);
                const canManage = isAdmin && !isMe && p.role !== 'owner';

                return (
                  <div
                    key={id}
                    className="flex items-center gap-3 px-5 py-2.5 transition-colors hover:bg-surface-2"
                  >
                    <Avatar
                      src={p.user.avatar}
                      name={p.user.name}
                      color={p.user.avatarColor}
                      size="md"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px]">{isMe ? 'You' : p.user.name}</p>
                      <p className="truncate text-[12.5px] text-ink-muted">
                        {p.user.about || 'Available'}
                      </p>
                    </div>

                    {p.role !== 'member' && (
                      <span className="flex shrink-0 items-center gap-1 rounded-full bg-brand-tint px-2 py-0.5 text-[10.5px] font-semibold text-brand-strong">
                        {p.role === 'owner' && <Crown size={10} />}
                        {p.role}
                      </span>
                    )}

                    {canManage && (
                      <button
                        type="button"
                        ref={menuFor === id ? menuAnchor : null}
                        onClick={() => setMenuFor(menuFor === id ? null : id)}
                        className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-ink-faint transition-colors hover:bg-surface-3"
                        aria-label={'Manage ' + p.user.name}
                      >
                        <MoreVertical size={17} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </Sheet>

      <Dropdown
        open={!!menuFor}
        onClose={() => setMenuFor(null)}
        anchorRef={menuAnchor}
        items={(() => {
          const p = members.find((m) => String(m.user._id || m.user) === menuFor);
          if (!p) return [];
          return [
            {
              label: 'Message ' + (p.user.name || '').split(' ')[0],
              icon: MessageSquare,
              onClick: () => useChat.getState().createDirect(menuFor),
            },
            p.role === 'admin'
              ? { label: 'Dismiss as admin', icon: ShieldOff, onClick: () => setRole(menuFor, 'member') }
              : { label: 'Make group admin', icon: Shield, onClick: () => setRole(menuFor, 'admin') },
            { divider: true },
            {
              label: 'Remove from group',
              icon: UserMinus,
              danger: true,
              onClick: () => setConfirm({ id: menuFor, name: p.user.name }),
            },
          ];
        })()}
      />

      <ConfirmDialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title={'Remove ' + (confirm?.name || 'this member') + '?'}
        message="They will lose access to this group and its future messages."
        confirmLabel="Remove"
        danger
        loading={busy}
        onConfirm={() => removeMember(confirm.id)}
      />
    </>
  );
}
