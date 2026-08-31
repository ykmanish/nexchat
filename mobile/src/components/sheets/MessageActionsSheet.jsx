import { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import {
  Reply, Copy, Star, Pin, Trash2, Forward, Pencil, Info,
} from 'lucide-react-native';

import { Sheet, SheetRow } from '../Sheet';
import { useChat } from '../../store/chat';
import { useAuth } from '../../store/auth';
import { useUI, toast } from '../../store/ui';
import { useTheme, font } from '../../theme';
import { feedback } from '../../lib/feedback';

/** The reactions offered without opening the full picker. */
const QUICK = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

/** Edits close after fifteen minutes, matching the server's window. */
const EDIT_WINDOW_MS = 15 * 60 * 1000;

export function MessageActionsSheet({ open, onClose, message, payload }) {
  const theme = useTheme();
  const me = useAuth((s) => s.user);
  const openSheet = useUI((s) => s.openSheet);

  const toggleReaction = useChat((s) => s.toggleReaction);
  const toggleStar = useChat((s) => s.toggleStar);
  const togglePin = useChat((s) => s.togglePin);
  const deleteMessage = useChat((s) => s.deleteMessage);
  const setReplyTo = useChat((s) => s.setReplyTo);

  const [confirming, setConfirming] = useState(false);

  if (!message) return null;

  const mine = String(message.sender?._id || message.sender) === String(me?._id);
  const editable =
    mine && Date.now() - new Date(message.createdAt).getTime() < EDIT_WINDOW_MS;

  const done = (fn) => async () => {
    onClose();
    try {
      await fn();
    } catch (err) {
      toast.error(err.message || 'That did not work');
    }
  };

  const react = async (emoji) => {
    onClose();
    await toggleReaction(message, emoji).catch(() => {});
  };

  return (
    <Sheet open={open} onClose={onClose} showHandle>
      {/* ── quick reactions ── */}
      <View style={[styles.reactions, { borderBottomColor: theme.border }]}>
        {QUICK.map((emoji) => {
          const chosen = message.reactions?.some(
            (r) => r.emoji === emoji && String(r.user) === String(me?._id)
          );
          return (
            <Pressable
              key={emoji}
              onPress={() => react(emoji)}
              style={[
                styles.reaction,
                chosen && { backgroundColor: theme.accentTint },
              ]}
            >
              <Text style={styles.reactionEmoji}>{emoji}</Text>
            </Pressable>
          );
        })}
        <Pressable
          onPress={() => openSheet('emojiPicker', { message })}
          style={[styles.reaction, { backgroundColor: theme.surface3 }]}
        >
          <Text style={[styles.more, { color: theme.inkMuted }]}>＋</Text>
        </Pressable>
      </View>

      {/* ── actions ── */}
      <SheetRow
        icon={Reply}
        label="Reply"
        onPress={() => {
          onClose();
          setReplyTo(message);
          feedback('select');
        }}
      />

      {!!payload?.text && (
        <SheetRow
          icon={Copy}
          label="Copy text"
          onPress={done(async () => {
            await Clipboard.setStringAsync(payload.text);
            toast.success('Copied');
          })}
        />
      )}

      {editable && (
        <SheetRow
          icon={Pencil}
          label="Edit"
          description="Up to fifteen minutes after sending"
          onPress={() => {
            onClose();
            openSheet('editMessage', { message, payload });
          }}
        />
      )}

      <SheetRow
        icon={Forward}
        label="Forward"
        onPress={() => {
          onClose();
          openSheet('forward', { message });
        }}
      />

      <SheetRow
        icon={Star}
        label={message.starred ? 'Remove from starred' : 'Star'}
        onPress={done(() => toggleStar(message))}
      />

      <SheetRow
        icon={Pin}
        label={message.pinned ? 'Unpin' : 'Pin'}
        onPress={done(() => togglePin(message))}
      />

      <SheetRow
        icon={Info}
        label="Message info"
        description="Who has received and read it"
        onPress={() => {
          onClose();
          openSheet('messageInfo', { message });
        }}
      />

      {/* Delete asks a second question, because "for everyone" is not
          recoverable and the two options are one row apart. */}
      {confirming ? (
        <View style={[styles.confirm, { borderTopColor: theme.border }]}>
          <Text style={[styles.confirmText, { color: theme.inkMuted }]}>Delete this message?</Text>

          <SheetRow
            icon={Trash2}
            label="Delete for me"
            description="It stays on everyone else's device"
            onPress={done(() => deleteMessage(message, 'me'))}
          />

          {mine && (
            <SheetRow
              icon={Trash2}
              label="Delete for everyone"
              description="Removed wherever it was delivered"
              danger
              onPress={done(() => deleteMessage(message, 'everyone'))}
            />
          )}
        </View>
      ) : (
        <SheetRow
          icon={Trash2}
          label="Delete"
          danger
          onPress={() => setConfirming(true)}
        />
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  reactions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  reaction: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reactionEmoji: { fontSize: 24 },
  more: { fontSize: 20, fontWeight: '600' },
  confirm: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 8 },
  confirmText: {
    fontSize: 13,
    paddingHorizontal: 20,
    paddingBottom: 4,
    fontFamily: font.body,
  },
});
