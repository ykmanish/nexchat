import { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, FlatList, ActivityIndicator } from 'react-native';
import { Check, CheckCheck, Send } from 'lucide-react-native';

import { Sheet } from '../Sheet';
import { Avatar } from '../Avatar';
import { Field, Button } from '../Field';
import { useChat } from '../../store/chat';
import { useAuth } from '../../store/auth';
import { useTheme, font } from '../../theme';
import { toast } from '../../store/ui';
import { clockTime } from '../../lib/utils';

/* ────────────────────────────── emoji picker ────────────────────────────── */

/**
 * A curated set rather than the full Unicode table.
 *
 * The web client uses `emoji-picker-react`, which is a 2 MB dependency built
 * around a search index and a virtualised grid. On a phone, reactions are
 * chosen from the first two rows almost every time, so the useful part is a
 * short list that opens instantly.
 */
const GROUPS = [
  { title: 'Reactions', emoji: ['👍', '👎', '❤️', '🔥', '😂', '🥲', '😮', '😢', '😡', '🙏', '👏', '🎉'] },
  { title: 'Faces', emoji: ['😀', '😅', '😊', '😍', '😘', '🤔', '😴', '🤒', '🥳', '😇', '🙃', '😭'] },
  { title: 'Gestures', emoji: ['👋', '🤝', '✌️', '🤞', '💪', '🫶', '👀', '🧠', '💯', '✅', '❌', '⚠️'] },
  { title: 'Things', emoji: ['☕', '🍕', '🎂', '⚽', '🎧', '📷', '🚗', '✈️', '🏠', '💡', '📌', '🔒'] },
];

export function EmojiPickerSheet({ open, onClose, message, onPick }) {
  const theme = useTheme();
  const toggleReaction = useChat((s) => s.toggleReaction);

  const choose = async (emoji) => {
    onClose();
    if (onPick) return onPick(emoji);
    if (message) await toggleReaction(message, emoji).catch(() => {});
  };

  return (
    <Sheet open={open} onClose={onClose} title="React" maxHeightRatio={0.7}>
      <ScrollView contentContainerStyle={styles.emojiScroll}>
        {GROUPS.map((group) => (
          <View key={group.title} style={styles.emojiGroup}>
            <Text style={[styles.groupTitle, { color: theme.inkMuted }]}>{group.title}</Text>
            <View style={styles.emojiGrid}>
              {group.emoji.map((emoji) => (
                <Pressable key={emoji} onPress={() => choose(emoji)} style={styles.emojiCell}>
                  <Text style={styles.emoji}>{emoji}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ))}
      </ScrollView>
    </Sheet>
  );
}

/* ────────────────────────────── edit ────────────────────────────── */

export function EditMessageSheet({ open, onClose, message, payload }) {
  const editMessage = useChat((s) => s.editMessage);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setText(payload?.text || '');
  }, [open, payload?.text]);

  const save = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      await editMessage(message, text.trim());
      onClose();
    } catch (err) {
      toast.error(err.message || 'Could not edit that message');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Edit message"
      subtitle="Everyone in the chat sees that it was edited."
      footer={<Button title="Save" onPress={save} loading={busy} disabled={!text.trim()} />}
    >
      <View style={styles.form}>
        <Field value={text} onChangeText={setText} multiline placeholder="Message" />
      </View>
    </Sheet>
  );
}

/* ────────────────────────────── forward ────────────────────────────── */

export function ForwardSheet({ open, onClose, message }) {
  const theme = useTheme();
  const conversations = useChat((s) => s.conversations);
  const forwardTo = useChat((s) => s.forwardTo);

  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) setSelected([]);
  }, [open]);

  const targets = useMemo(
    () => conversations.filter((c) => !c.archived),
    [conversations]
  );

  const toggle = (id) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const go = async () => {
    setBusy(true);
    try {
      await forwardTo(message, selected);
      toast.success(
        selected.length === 1 ? 'Forwarded' : `Forwarded to ${selected.length} chats`
      );
      onClose();
    } catch (err) {
      toast.error(err.message || 'Could not forward that');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Forward to"
      subtitle={selected.length ? `${selected.length} selected` : 'Choose one or more chats'}
      maxHeightRatio={0.85}
      footer={
        <Button
          title={busy ? 'Forwarding…' : 'Send'}
          onPress={go}
          loading={busy}
          disabled={!selected.length}
        />
      }
    >
      <FlatList
        data={targets}
        keyExtractor={(item) => item._id}
        style={styles.list}
        renderItem={({ item }) => {
          const on = selected.includes(item._id);
          const title = item.type === 'direct' ? item.peer?.name : item.name;

          return (
            <Pressable
              onPress={() => toggle(item._id)}
              android_ripple={{ color: theme.surface3 }}
              style={styles.row}
            >
              <Avatar
                uri={item.type === 'direct' ? item.peer?.avatar : item.avatar}
                name={title}
                id={item.peer?._id || item._id}
                group={item.type !== 'direct'}
                size={42}
              />
              <Text style={[styles.rowName, { color: theme.ink }]} numberOfLines={1}>
                {title}
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
      />
    </Sheet>
  );
}

/* ────────────────────────────── info ────────────────────────────── */

/**
 * Who has it and who has read it.
 *
 * Reads from the receipts already on the message rather than fetching, so it
 * opens instantly; the socket keeps them current while it is on screen.
 */
export function MessageInfoSheet({ open, onClose, message }) {
  const theme = useTheme();
  const conversations = useChat((s) => s.conversations);

  const people = useMemo(() => {
    if (!message) return [];
    const conversation = conversations.find((c) => c._id === String(message.conversation));
    const byId = new Map(
      (conversation?.participants || []).map((p) => [String(p.user?._id || p.user), p.user])
    );

    return (message.receipts || []).map((r) => ({
      user: byId.get(String(r.user)) || { _id: r.user, name: 'Someone' },
      deliveredAt: r.deliveredAt,
      readAt: r.readAt,
    }));
  }, [message, conversations]);

  const read = people.filter((p) => p.readAt);
  const delivered = people.filter((p) => p.deliveredAt && !p.readAt);
  const pending = people.filter((p) => !p.deliveredAt);

  const section = (label, list, Icon, tint) =>
    list.length > 0 && (
      <View style={styles.infoSection}>
        <View style={styles.infoHeader}>
          <Icon size={15} color={tint} strokeWidth={2.4} />
          <Text style={[styles.infoLabel, { color: theme.inkMuted }]}>
            {label} · {list.length}
          </Text>
        </View>
        {list.map((p) => (
          <View key={String(p.user._id)} style={styles.infoRow}>
            <Avatar uri={p.user.avatar} name={p.user.name} id={p.user._id} size={34} />
            <Text style={[styles.rowName, { color: theme.ink }]} numberOfLines={1}>
              {p.user.name}
            </Text>
            <Text style={[styles.infoTime, { color: theme.inkFaint }]}>
              {clockTime(p.readAt || p.deliveredAt)}
            </Text>
          </View>
        ))}
      </View>
    );

  return (
    <Sheet open={open} onClose={onClose} title="Message info" maxHeightRatio={0.8}>
      <ScrollView contentContainerStyle={styles.infoScroll}>
        {section('Read by', read, CheckCheck, theme.tickRead)}
        {section('Delivered to', delivered, CheckCheck, theme.inkMuted)}
        {section('Sent', pending, Check, theme.inkFaint)}

        {!people.length && (
          <Text style={[styles.empty, { color: theme.inkMuted }]}>
            No receipts yet. People who turned read receipts off never appear here.
          </Text>
        )}
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  emojiScroll: { paddingHorizontal: 14, paddingBottom: 18 },
  emojiGroup: { marginTop: 12 },
  groupTitle: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    paddingHorizontal: 6,
    paddingBottom: 6,
    fontFamily: font.body,
  },
  emojiGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  emojiCell: { width: '16.66%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center' },
  emoji: { fontSize: 27 },
  form: { paddingHorizontal: 20, paddingVertical: 10 },
  list: { maxHeight: 400 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 13, paddingHorizontal: 20, paddingVertical: 9 },
  rowName: { flex: 1, fontSize: 15.5, fontWeight: '600', fontFamily: font.body },
  check: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  infoScroll: { paddingBottom: 20 },
  infoSection: { paddingTop: 10 },
  infoHeader: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 20, paddingBottom: 6 },
  infoLabel: { fontSize: 12.5, fontWeight: '700', letterSpacing: 0.3, textTransform: 'uppercase', fontFamily: font.body },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 20, paddingVertical: 6 },
  infoTime: { fontSize: 12, fontFamily: font.body },
  empty: { fontSize: 14, textAlign: 'center', padding: 28, lineHeight: 20, fontFamily: font.body },
});
