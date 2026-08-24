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

  /* Read from the store rather than fetched here. The sheet used to hold the
     list in its own state, so every open started from empty and a request that
     failed left "No contacts yet" on screen — indistinguishable from actually
     having none. */
  const contacts = useChat((s) => s.contacts);
  const addedYou = useChat((s) => s.addedYou);
  const messaged = useChat((s) => s.messaged);
  const contactsLoaded = useChat((s) => s.contactsLoaded);
  const loadContacts = useChat((s) => s.loadContacts);

  const [results, setResults] = useState([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setResults([]);
    setFailed(false);
    loadContacts({ force: true }).catch(() => setFailed(true));
  }, [open, loadContacts]);

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

  const searching = query.trim().length >= 2;

  /* Three groups, in the order they are useful. Saved contacts first; then
     people whose address book already has this account, who can message you
     whether or not you ever save them; then anyone there is already a chat
     with. Everybody reachable is on this screen, which is the fix — a
     one-directional contact used to be invisible here. */
  const groups = searching
    ? [{ key: 'results', title: 'Search results', people: results }]
    : [
        { key: 'contacts', title: 'Your contacts', people: contacts },
        {
          key: 'addedYou',
          title: 'Added you',
          hint: 'They have you in their contacts',
          people: addedYou,
          saveable: true,
        },
        {
          key: 'messaged',
          title: 'You have chatted with',
          people: messaged,
          saveable: true,
        },
      ].filter((g) => g.people.length > 0);

  const nobody = groups.every((g) => g.people.length === 0);

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

      <div className="pb-4">
        {loading && (
          <div className="flex justify-center py-6">
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-line border-t-brand" />
          </div>
        )}

        {!loading && !searching && !contactsLoaded && !failed && (
          <div className="flex justify-center py-8">
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-line border-t-brand" />
          </div>
        )}

        {failed && !searching && (
          <div className="px-5 py-8 text-center">
            <p className="text-[13.5px] text-ink-muted">
              Could not load your people. Check your connection.
            </p>
            <Button
              size="xs"
              variant="secondary"
              className="mt-3"
              onClick={() => {
                setFailed(false);
                loadContacts({ force: true }).catch(() => setFailed(true));
              }}
            >
              Try again
            </Button>
          </div>
        )}

        {!loading && !failed && (searching || contactsLoaded) && nobody && (
          <p className="px-5 py-8 text-center text-[13.5px] text-ink-muted">
            {searching
              ? 'No one found. Check the spelling, or add them as a contact.'
              : 'Nobody to show yet. Add someone by email or username to get started.'}
          </p>
        )}

        {groups.map((group) => (
          <section key={group.key}>
            <div className="px-5 pb-1 pt-3">
              <h3 className="text-[12px] font-semibold uppercase tracking-wide text-ink-faint">
                {group.title}
              </h3>
              {group.hint && (
                <p className="mt-0.5 text-[12px] text-ink-faint">{group.hint}</p>
              )}
            </div>
            {group.people.map((person) => (
              <PersonRow
                key={person._id || person.id}
                person={person}
                busy={busyId === (person._id || person.id)}
                onClick={() => start(person)}
                trailing={group.saveable ? <SaveContactButton person={person} /> : undefined}
              />
            ))}
          </section>
        ))}
      </div>
    </Sheet>
  );
}

/**
 * The little "save" on a person who is reachable but not saved.
 *
 * Sits inside the row rather than replacing it, because tapping the row should
 * still just open the chat — saving is the secondary action, and making the
 * whole row mean "save" would be a trap for anyone who only wanted to reply.
 */
function SaveContactButton({ person }) {
  const saveContact = useChat((s) => s.saveContact);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  if (done) {
    return (
      <span className="shrink-0 text-[12px] font-semibold text-brand-strong">Saved</span>
    );
  }

  return (
    <span
      role="button"
      tabIndex={0}
      aria-label={'Save ' + person.name + ' to contacts'}
      onClick={async (e) => {
        // The row underneath opens the chat; this does not.
        e.stopPropagation();
        if (busy) return;
        setBusy(true);
        try {
          await saveContact(person._id || person.id, { name: person.name });
          feedback('success');
          setDone(true);
        } catch (err) {
          toast.error(err.message || 'Could not save that contact');
        } finally {
          setBusy(false);
        }
      }}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.click()}
      className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface-2 text-ink-muted transition-colors hover:bg-surface-3 hover:text-ink"
    >
      {busy ? (
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-line border-t-brand" />
      ) : (
        <UserPlus size={15} />
      )}
    </span>
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
      // The shared list is what New chat and New group render from; without
      // this the person just added would not be there until the next reload.
      useChat.getState().loadContacts({ force: true }).catch(() => {});
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

  /* Anyone reachable can be put in a group, not only saved contacts — the same
     reasoning as New chat. Someone who messaged you first should not have to be
     saved before they can be invited. */
  const contacts = useChat((s) => s.contacts);
  const addedYou = useChat((s) => s.addedYou);
  const messaged = useChat((s) => s.messaged);
  const loadContacts = useChat((s) => s.loadContacts);

  const [step, setStep] = useState('members');
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
    loadContacts({ force: true }).catch(() => {});
  }, [open, loadContacts]);

  const people = useMemo(() => {
    const map = new Map();
    [...contacts, ...addedYou, ...messaged].forEach((p) => map.set(String(p._id || p.id), p));
    return [...map.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }, [contacts, addedYou, messaged]);

  const filtered = people.filter((c) =>
    String(c.name || '').toLowerCase().includes(query.trim().toLowerCase())
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
                  Nobody to show yet. Add a contact, or start a chat first.
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
