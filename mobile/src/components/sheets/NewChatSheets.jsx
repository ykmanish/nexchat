import { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TextInput, Pressable, ActivityIndicator, SectionList } from 'react-native';
import { router } from 'expo-router';
import { MessageSquarePlus, UserPlus, Users, Search, Check } from 'lucide-react-native';

import { Sheet, SheetRow } from '../Sheet';
import { Avatar } from '../Avatar';
import { Field, Button } from '../Field';
import { useChat, idOf } from '../../store/chat';
import { useUI } from '../../store/ui';
import { useTheme, font } from '../../theme';
import { toast } from '../../store/ui';
import { api } from '../../lib/api';

/** The first sheet the ＋ button opens — mirrors the web's `NewMenuSheet`. */
export function NewMenuSheet({ open, onClose }) {
  const openSheet = useUI((s) => s.openSheet);

  return (
    <Sheet open={open} onClose={onClose} title="New" showHandle>
      <SheetRow
        icon={MessageSquarePlus}
        label="New chat"
        description="Message someone you already know"
        onPress={() => openSheet('newChat')}
      />
      <SheetRow
        icon={UserPlus}
        label="New contact"
        description="Add someone by their email address"
        onPress={() => openSheet('newContact')}
      />
      <SheetRow
        icon={Users}
        label="New group"
        description="Start a conversation with several people"
        onPress={() => openSheet('newGroup')}
      />
    </Sheet>
  );
}

/**
 * Who you can write to.
 *
 * Three groups rather than one, because a contact is one-directional: people
 * you saved, people who saved *you*, and people you already share a chat with.
 * Somebody who added you but whom you never saved is reachable and would
 * otherwise be invisible here.
 */
export function NewChatSheet({ open, onClose }) {
  const theme = useTheme();
  const contacts = useChat((s) => s.contacts);
  const addedYou = useChat((s) => s.addedYou);
  const messaged = useChat((s) => s.messaged);
  const contactsLoaded = useChat((s) => s.contactsLoaded);
  const loadContacts = useChat((s) => s.loadContacts);
  const createDirect = useChat((s) => s.createDirect);

  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(null);

  useEffect(() => {
    if (open) loadContacts().catch(() => {});
  }, [open, loadContacts]);

  const sections = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const match = (list) =>
      (list || []).filter(
        (p) =>
          !needle ||
          String(p.name || '').toLowerCase().includes(needle) ||
          String(p.email || '').toLowerCase().includes(needle)
      );

    return [
      { title: 'Contacts', data: match(contacts) },
      { title: 'Added you', data: match(addedYou) },
      { title: 'You have chatted with', data: match(messaged) },
    ].filter((s) => s.data.length);
  }, [contacts, addedYou, messaged, query]);

  const openChat = async (person) => {
    const userId = idOf(person);
    setBusy(userId);
    try {
      const conversation = await createDirect(userId);
      onClose();
      router.push('/chat/' + conversation._id);
    } catch (err) {
      toast.error(err.message || 'Could not open that chat');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="New chat" maxHeightRatio={0.88}>
      <View style={styles.searchWrap}>
        <View style={[styles.searchBar, { backgroundColor: theme.surface3 }]}>
          <Search size={17} color={theme.inkMuted} strokeWidth={2.2} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search name or email"
            placeholderTextColor={theme.inkFaint}
            style={[styles.searchInput, { color: theme.ink }]}
            autoCapitalize="none"
          />
        </View>
      </View>

      {!contactsLoaded ? (
        <View style={styles.centre}>
          <ActivityIndicator color={theme.accentStrong} />
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => idOf(item)}
          style={styles.list}
          stickySectionHeadersEnabled={false}
          keyboardShouldPersistTaps="handled"
          renderSectionHeader={({ section }) => (
            <Text style={[styles.sectionTitle, { color: theme.inkMuted }]}>{section.title}</Text>
          )}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => openChat(item)}
              android_ripple={{ color: theme.surface3 }}
              style={styles.person}
            >
              <Avatar uri={item.avatar} name={item.name} id={idOf(item)} size={44} />
              <View style={styles.personText}>
                <Text style={[styles.personName, { color: theme.ink }]} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={[styles.personMeta, { color: theme.inkMuted }]} numberOfLines={1}>
                  {item.about || item.email}
                </Text>
              </View>
              {busy === idOf(item) && <ActivityIndicator size="small" color={theme.accentStrong} />}
            </Pressable>
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={[styles.emptyText, { color: theme.inkMuted }]}>
                {query
                  ? 'Nobody matched that.'
                  : 'No one yet — add a contact by email to get started.'}
              </Text>
            </View>
          }
        />
      )}
    </Sheet>
  );
}

/** Add someone by email, which is the only handle the server exposes. */
export function NewContactSheet({ open, onClose }) {
  const theme = useTheme();
  const saveContact = useChat((s) => s.saveContact);
  const createDirect = useChat((s) => s.createDirect);

  const [email, setEmail] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const onAdd = async () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('Enter a valid email address');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const { data } = await api.get('/users/search', {
        params: { email: email.trim().toLowerCase() },
      });
      const person = data.user;
      if (!person) {
        setError('Nobody on Chax uses that address');
        return;
      }

      await saveContact(idOf(person), { name: person.name });
      const conversation = await createDirect(idOf(person));
      setEmail('');
      onClose();
      router.push('/chat/' + conversation._id);
    } catch (err) {
      setError(err.message || 'Could not add that person');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="New contact"
      subtitle="They will be able to write to you once you have been introduced."
    >
      <View style={styles.form}>
        <Field
          label="Email"
          placeholder="them@example.com"
          value={email}
          onChangeText={(v) => {
            setEmail(v);
            setError(null);
          }}
          error={error}
          keyboardType="email-address"
          autoCapitalize="none"
        />
        <Button title="Add and open chat" onPress={onAdd} loading={busy} />
      </View>
    </Sheet>
  );
}

/** Pick people, name it, create it. */
export function NewGroupSheet({ open, onClose }) {
  const theme = useTheme();
  const contacts = useChat((s) => s.contacts);
  const addedYou = useChat((s) => s.addedYou);
  const messaged = useChat((s) => s.messaged);
  const loadContacts = useChat((s) => s.loadContacts);
  const createGroup = useChat((s) => s.createGroup);

  const [selected, setSelected] = useState([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) loadContacts().catch(() => {});
    if (!open) {
      setSelected([]);
      setName('');
    }
  }, [open, loadContacts]);

  // One list, deduped — the three-group split matters for starting a 1:1, but
  // for picking group members it is just noise.
  const people = useMemo(() => {
    const map = new Map();
    [...contacts, ...addedYou, ...messaged].forEach((p) => map.set(idOf(p), p));
    return [...map.values()].sort((a, b) =>
      String(a.name || '').localeCompare(String(b.name || ''))
    );
  }, [contacts, addedYou, messaged]);

  const toggle = (person) => {
    const id = idOf(person);
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  };

  const onCreate = async () => {
    if (!name.trim() || selected.length === 0) return;
    setBusy(true);
    try {
      const conversation = await createGroup({ name: name.trim(), memberIds: selected });
      onClose();
      router.push('/chat/' + conversation._id);
    } catch (err) {
      toast.error(err.message || 'Could not create that group');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="New group"
      subtitle={selected.length ? `${selected.length} selected` : 'Choose who is in it'}
      maxHeightRatio={0.9}
      footer={
        <Button
          title={busy ? 'Creating…' : 'Create group'}
          onPress={onCreate}
          loading={busy}
          disabled={!name.trim() || !selected.length}
        />
      }
    >
      <View style={styles.form}>
        <Field label="Group name" placeholder="Weekend plans" value={name} onChangeText={setName} />
      </View>

      <SectionList
        sections={[{ title: 'People', data: people }]}
        keyExtractor={(item) => idOf(item)}
        style={styles.list}
        stickySectionHeadersEnabled={false}
        keyboardShouldPersistTaps="handled"
        renderSectionHeader={() => null}
        renderItem={({ item }) => {
          const on = selected.includes(idOf(item));
          return (
            <Pressable
              onPress={() => toggle(item)}
              android_ripple={{ color: theme.surface3 }}
              style={styles.person}
            >
              <Avatar uri={item.avatar} name={item.name} id={idOf(item)} size={42} />
              <Text style={[styles.personName, { flex: 1, color: theme.ink }]} numberOfLines={1}>
                {item.name}
              </Text>
              <View
                style={[
                  styles.check,
                  {
                    backgroundColor: on ? theme.accent : 'transparent',
                    borderColor: on ? theme.accent : theme.borderStrong,
                  },
                ]}
              >
                {on && <Check size={14} color={theme.accentInk} strokeWidth={3} />}
              </View>
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={[styles.emptyText, { color: theme.inkMuted }]}>
              Add some contacts first.
            </Text>
          </View>
        }
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  searchWrap: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 6 },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    height: 42,
    borderRadius: 999,
    paddingHorizontal: 14,
  },
  searchInput: { flex: 1, fontSize: 15.5, padding: 0, fontFamily: font.body },
  list: { maxHeight: 380 },
  centre: { padding: 34, alignItems: 'center' },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 6,
    fontFamily: font.body,
  },
  person: { flexDirection: 'row', alignItems: 'center', gap: 13, paddingHorizontal: 20, paddingVertical: 8 },
  personText: { flex: 1, gap: 2 },
  personName: { fontSize: 15.5, fontWeight: '600', fontFamily: font.body },
  personMeta: { fontSize: 13, fontFamily: font.body },
  check: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  form: { paddingHorizontal: 20, paddingVertical: 10, gap: 12 },
  empty: { padding: 28, alignItems: 'center' },
  emptyText: { fontSize: 14, textAlign: 'center', lineHeight: 20, fontFamily: font.body },
});
