'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  MessageSquarePlus,
  UserPlus,
  Users,
  Search,
  Check,
  X,
  AtSign,
  Mail,
  Camera,
  ArrowRight,
} from 'lucide-react';
import { Sheet, ActionSheet } from '@/components/ui/Sheet';
import { Input } from '@/components/ui/Field';
import { Button, ListButton } from '@/components/ui/Button';
import { Avatar } from '@/components/ui/Avatar';
import { useChat } from '@/store/chat';
import { useUI, toast } from '@/store/ui';
import { api } from '@/lib/api';
import { cn, debounce, colorFor } from '@/lib/utils';
import { feedback } from '@/lib/sound';

/** The three-way menu from the reference design. */
export function NewMenuSheet({ open, onClose }) {
  const openSheet = useUI((s) => s.openSheet);

  return (
    <ActionSheet
      open={open}
      onClose={onClose}
      actions={[
        {
          label: 'New Chat',
          sublabel: 'Send a message to your contact',
          icon: MessageSquarePlus,
          onClick: () => openSheet('newChat'),
        },
        {
          label: 'New Contact',
          sublabel: 'Add a contact to be able to send messages',
          icon: UserPlus,
          onClick: () => openSheet('newContact'),
        },
        {
          label: 'New Community',
          sublabel: 'Join the community around you',
          icon: Users,
          onClick: () => openSheet('newCommunity'),
        },
      ]}
    />
  );
}

/* ────────────────────────── pick someone to chat with ────────────────────────── */

export function NewChatSheet({ open, onClose }) {
  const router = useRouter();
  const createDirect = useChat((s) => s.createDirect);
  const openSheet = useUI((s) => s.openSheet);

  const [contacts, setContacts] = useState([]);
  const [results, setResults] = useState([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    if (!open) return;
    api
      .get('/users/contacts')
      .then(({ data }) => setContacts(data.contacts))
      .catch(() => {});
    setQuery('');
    setResults([]);
  }, [open]);

  const search = useMemo(
    () =>
      debounce(async (q) => {
        if (q.trim().length < 2) {
          setResults([]);
          setLoading(false);
          return;
        }
        try {
          const { data } = await api.get('/users/search', { params: { q } });
          setResults(data.users);
        } catch {
          setResults([]);
        } finally {
          setLoading(false);
        }
      }, 320),
    []
  );

  async function start(person) {
    setBusyId(person._id || person.id);
    try {
      const conversation = await createDirect(person._id || person.id);
      feedback('success');
      onClose();
      router.push('/chats/' + conversation._id);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusyId(null);
    }
  }

  const showing = query.trim().length >= 2 ? results : contacts;

  return (
    <Sheet open={open} onClose={onClose} title="New chat" size="md">
      <div className="px-5 pb-2">
        <Input
          icon={Search}
          placeholder="Search by name, username or email"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setLoading(true);
            search(e.target.value);
          }}
          autoFocus
        />
      </div>

      <div className="px-2 pb-2">
        <ListButton
          icon={Users}
          label="New group"
          sublabel="Chat with several people at once"
          onClick={() => {
            onClose();
            openSheet('newGroup');
          }}
          className="rounded-2xl"
        />
        <ListButton
          icon={UserPlus}
          label="New contact"
          sublabel="Add someone by email or username"
          onClick={() => {
            onClose();
            openSheet('newContact');
          }}
          className="rounded-2xl"
        />
      </div>

      <div className="px-5 pb-1 pt-2">
        <h3 className="text-[12px] font-semibold uppercase tracking-wide text-ink-faint">
          {query.trim().length >= 2 ? 'Search results' : 'Your contacts'}
        </h3>
      </div>

      <div className="pb-4">
        {loading && (
          <div className="flex justify-center py-6">
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-line border-t-brand" />
          </div>
        )}

        {!loading && showing.length === 0 && (
          <p className="px-5 py-8 text-center text-[13.5px] text-ink-muted">
            {query.trim().length >= 2
              ? 'No one found. Check the spelling, or add them as a contact.'
              : 'No contacts yet. Add someone to get started.'}
          </p>
        )}

        {showing.map((person) => (
          <PersonRow
            key={person._id || person.id}
            person={person}
            busy={busyId === (person._id || person.id)}
            onClick={() => start(person)}
          />
        ))}
      </div>
    </Sheet>
  );
}

function PersonRow({ person, onClick, busy, selected, trailing }) {
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.985 }}
      onClick={onClick}
      className="flex w-full items-center gap-3 px-5 py-2.5 text-left transition-colors hover:bg-black/[.035] dark:hover:bg-white/[.05]"
    >
      <Avatar src={person.avatar} name={person.name} color={person.avatarColor} size="md" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-medium">{person.name}</p>
        <p className="truncate text-[13px] text-ink-muted">
          {person.username ? '@' + person.username : person.about || 'Available'}
        </p>
      </div>
      {busy ? (
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-line border-t-brand" />
      ) : selected !== undefined ? (
        <span
          className={cn(
            'grid h-6 w-6 place-items-center rounded-full border-2 transition-colors',
            selected ? 'border-brand bg-brand text-brand-ink' : 'border-line-strong'
          )}
        >
          {selected && <Check size={14} strokeWidth={3} />}
        </span>
      ) : (
        trailing
      )}
    </motion.button>
  );
}

/* ────────────────────────── add a contact ────────────────────────── */

export function NewContactSheet({ open, onClose }) {
  const [mode, setMode] = useState('email');
  const [value, setValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [found, setFound] = useState(null);
  const [error, setError] = useState(null);
  const router = useRouter();
  const createDirect = useChat((s) => s.createDirect);

  useEffect(() => {
    if (open) {
      setValue('');
      setFound(null);
      setError(null);
    }
  }, [open]);

  async function add() {
    if (!value.trim()) return;
    setLoading(true);
    setError(null);

    try {
      const payload = mode === 'email' ? { email: value.trim() } : { username: value.trim().replace('@', '') };
      const { data } = await api.post('/users/contacts', payload);
      setFound(data.contact);
      feedback('success');
      toast.success(data.already ? 'Already in your contacts' : data.contact.name + ' added');
    } catch (err) {
      setError(err.message);
      feedback('error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="New contact"
      subtitle="Add someone by the email or username they signed up with."
      size="sm"
    >
      <div className="space-y-4 px-5 pb-6">
        <div className="flex gap-2">
          {[
            { key: 'email', label: 'Email', icon: Mail },
            { key: 'username', label: 'Username', icon: AtSign },
          ].map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => {
                feedback('select');
                setMode(option.key);
                setFound(null);
              }}
              className={cn(
                'flex flex-1 items-center justify-center gap-2 rounded-2xl border px-4 py-2.5 text-[14px] font-medium transition-colors',
                mode === option.key
                  ? 'border-brand bg-brand/[0.12] text-ink'
                  : 'border-line text-ink-muted'
              )}
            >
              <option.icon size={16} />
              {option.label}
            </button>
          ))}
        </div>

        <Input
          icon={mode === 'email' ? Mail : AtSign}
          type={mode === 'email' ? 'email' : 'text'}
          inputMode={mode === 'email' ? 'email' : 'text'}
          placeholder={mode === 'email' ? 'friend@example.com' : 'username'}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          error={error}
          autoFocus
        />

        <AnimatePresence>
          {found && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="flex items-center gap-3 rounded-2xl bg-wa-500/10 p-3"
            >
              <Avatar src={found.avatar} name={found.name} color={found.avatarColor} size="md" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-semibold">{found.name}</p>
                <p className="truncate text-[13px] text-ink-muted">
                  {found.username ? '@' + found.username : found.about}
                </p>
              </div>
              <Button
                size="xs"
                iconRight={ArrowRight}
                onClick={async () => {
                  const conversation = await createDirect(found.id || found._id);
                  onClose();
                  router.push('/chats/' + conversation._id);
                }}
              >
                Chat
              </Button>
            </motion.div>
          )}
        </AnimatePresence>

        <Button size="block" loading={loading} onClick={add} disabled={!value.trim()}>
          Add contact
        </Button>
      </div>
    </Sheet>
  );
}

/* ────────────────────────── create a group / community ────────────────────────── */

export function NewGroupSheet({ open, onClose, mode = 'group' }) {
  const router = useRouter();
  const createGroup = useChat((s) => s.createGroup);
  const createCommunity = useChat((s) => s.createCommunity);

  const [step, setStep] = useState('members');
  const [contacts, setContacts] = useState([]);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState([]);
  const [name, setName] = useState('');
  const [about, setAbout] = useState('');
  const [loading, setLoading] = useState(false);

  const isCommunity = mode === 'community';

  useEffect(() => {
    if (!open) return;
    setStep('members');
    setSelected([]);
    setName('');
    setAbout('');
    setQuery('');
    api
      .get('/users/contacts')
      .then(({ data }) => setContacts(data.contacts))
      .catch(() => {});
  }, [open]);

  const filtered = contacts.filter((c) =>
    c.name.toLowerCase().includes(query.trim().toLowerCase())
  );

  function toggle(person) {
    const id = person._id || person.id;
    feedback('select');
    setSelected((list) =>
      list.some((p) => (p._id || p.id) === id) ? list.filter((p) => (p._id || p.id) !== id) : [...list, person]
    );
  }

  async function create() {
    if (!name.trim()) return;
    setLoading(true);

    try {
      const payload = {
        name: name.trim(),
        about: about.trim(),
        memberIds: selected.map((p) => p._id || p.id),
      };
      const conversation = isCommunity
        ? await createCommunity(payload)
        : await createGroup(payload);

      feedback('success');
      toast.success((isCommunity ? 'Community' : 'Group') + ' created');
      onClose();
      router.push('/chats/' + conversation._id);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={step === 'members' ? 'Add people' : isCommunity ? 'New community' : 'New group'}
      subtitle={
        step === 'members'
          ? selected.length
            ? selected.length + ' selected'
            : 'Choose who to include'
          : 'Give it a name so people know what it is.'
      }
      size="md"
      footer={
        step === 'members' ? (
          <Button
            size="block"
            onClick={() => {
              feedback('select');
              setStep('details');
            }}
            iconRight={ArrowRight}
          >
            Next
          </Button>
        ) : (
          <div className="flex gap-3">
            <Button variant="secondary" size="block" onClick={() => setStep('members')}>
              Back
            </Button>
            <Button size="block" loading={loading} onClick={create} disabled={!name.trim()}>
              Create
            </Button>
          </div>
        )
      }
    >
      <AnimatePresence mode="wait">
        {step === 'members' ? (
          <motion.div key="members" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }}>
            {selected.length > 0 && (
              <div className="no-scrollbar flex gap-3 overflow-x-auto px-5 pb-3">
                {selected.map((person) => (
                  <motion.button
                    key={person._id || person.id}
                    layout
                    initial={{ scale: 0.7, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.7, opacity: 0 }}
                    onClick={() => toggle(person)}
                    className="relative flex w-[56px] shrink-0 flex-col items-center gap-1"
                  >
                    <Avatar src={person.avatar} name={person.name} color={person.avatarColor} size="md" />
                    <span className="absolute -right-0.5 -top-0.5 grid h-5 w-5 place-items-center rounded-full bg-ink text-white ring-2 ring-surface">
                      <X size={11} strokeWidth={3} />
                    </span>
                    <span className="w-full truncate text-center text-[10.5px]">
                      {person.name.split(' ')[0]}
                    </span>
                  </motion.button>
                ))}
              </div>
            )}

            <div className="px-5 pb-2">
              <Input
                icon={Search}
                placeholder="Search contacts"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>

            <div className="pb-4">
              {filtered.length === 0 && (
                <p className="px-5 py-8 text-center text-[13.5px] text-ink-muted">
                  No contacts to show. Add contacts first.
                </p>
              )}
              {filtered.map((person) => (
                <PersonRow
                  key={person._id || person.id}
                  person={person}
                  selected={selected.some((p) => (p._id || p.id) === (person._id || person.id))}
                  onClick={() => toggle(person)}
                />
              ))}
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="details"
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 10 }}
            className="space-y-4 px-5 py-2"
          >
            <div className="flex flex-col items-center gap-3 py-2">
              <div
                className="grid h-20 w-20 place-items-center rounded-full text-white"
                style={{ background: colorFor(name || 'group') }}
              >
                <Camera size={26} strokeWidth={1.8} />
              </div>
              <p className="text-[12.5px] text-ink-faint">
                A photo can be added after creating
              </p>
            </div>

            <Input
              label={isCommunity ? 'Community name' : 'Group name'}
              placeholder={isCommunity ? 'Neighbourhood' : 'Weekend trip'}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              autoFocus
            />

            <Input
              label="Description"
              placeholder="What is this for?"
              value={about}
              onChange={(e) => setAbout(e.target.value)}
              maxLength={500}
            />

            <div className="rounded-2xl bg-brand/[0.08] px-4 py-3">
              <p className="text-[12.5px] leading-relaxed text-ink-muted">
                {selected.length} {selected.length === 1 ? 'person' : 'people'} will be added.
                {isCommunity && ' A General room is created alongside the announcements feed.'}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Sheet>
  );
}

export { PersonRow };
