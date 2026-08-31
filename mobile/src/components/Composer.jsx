import { useCallback, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator, ScrollView } from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { Send, Plus, Smile, Mic, X, FileText, Play } from 'lucide-react-native';

import * as e2ee from '../lib/e2ee';
import { send as sendUpload } from '../lib/upload';
import { emit } from '../lib/socket';
import { useTheme, font } from '../theme';
import { toast, useUI } from '../store/ui';
import { bytes as formatBytes } from '../lib/utils';
import { report, trace } from '../lib/report';

/**
 * The composer, with attachments.
 *
 * The order matters and is the same as the web's: **encrypt, then upload**. The
 * server only ever receives opaque bytes, and the key that opens them travels
 * inside the message envelope — so an attachment is unreadable to the server
 * even though it stores the file.
 *
 * A picked file is uploaded immediately rather than on send, so the round trip
 * overlaps with whatever you are still typing. The bubble that appears when you
 * hit send is instant because the bytes are already there.
 */
export function Composer({ conversationId, onSend, disabled }) {
  const theme = useTheme();
  const openSheet = useUI((s) => s.openSheet);

  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);

  const typingSentAt = useRef(0);
  const typingTimer = useRef(null);

  const onChangeText = useCallback(
    (value) => {
      setDraft(value);
      if (!conversationId) return;

      const now = Date.now();
      // One start per three seconds rather than one per keystroke.
      if (now - typingSentAt.current > 3000) {
        typingSentAt.current = now;
        emit('typing:start', { conversationId });
      }

      clearTimeout(typingTimer.current);
      typingTimer.current = setTimeout(() => {
        typingSentAt.current = 0;
        emit('typing:stop', { conversationId });
      }, 2200);
    },
    [conversationId]
  );

  /** Shared tail for every picker: encrypt, upload, keep the local preview. */
  const attach = useCallback(async (file, kind) => {
    setBusy(true);
    setProgress(0);

    try {
      const encrypted = await e2ee.encryptFile({
        uri: file.uri,
        name: file.name,
        mimeType: file.mimeType,
        size: file.size,
      });

      trace('attach:encrypted', { kind, bytes: encrypted.meta.size });

      const uploaded = await sendUpload(encrypted.ciphertext, {
        bucket: kind === 'voice' ? 'voice' : 'media',
        onProgress: (fraction) => setProgress(Math.round(fraction * 100)),
      });

      setAttachments((list) => [
        ...list,
        {
          id: uploaded.id,
          url: uploaded.url,
          kind,
          size: encrypted.meta.size,
          key: encrypted.key,
          iv: encrypted.iv,
          name: encrypted.meta.name,
          mime: encrypted.meta.mime,
          width: file.width ?? null,
          height: file.height ?? null,
          duration: file.duration ?? null,
          // Only meaningful on this device — stripped before it goes on the
          // wire, kept so the preview here is instant.
          localUri: file.uri,
        },
      ]);
    } catch (err) {
      report('attach', err, { kind, name: file?.name, size: file?.size });
      toast.error(err.message || 'Could not attach that file');
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }, []);

  const pickMedia = useCallback(async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      toast.error('Chax needs access to your photos to send them.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      quality: 0.85,
    });
    if (result.canceled || !result.assets?.length) return;

    const asset = result.assets[0];
    await attach(
      {
        uri: asset.uri,
        name: asset.fileName || (asset.type === 'video' ? 'video.mp4' : 'photo.jpg'),
        mimeType: asset.mimeType || (asset.type === 'video' ? 'video/mp4' : 'image/jpeg'),
        size: asset.fileSize,
        width: asset.width,
        height: asset.height,
        duration: asset.duration ? Math.round(asset.duration / 1000) : null,
      },
      asset.type === 'video' ? 'video' : 'image'
    );
  }, [attach]);

  const takePhoto = useCallback(async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      toast.error('Chax needs the camera to take a photo.');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({ quality: 0.85 });
    if (result.canceled || !result.assets?.length) return;

    const asset = result.assets[0];
    await attach(
      {
        uri: asset.uri,
        name: asset.fileName || 'photo.jpg',
        mimeType: asset.mimeType || 'image/jpeg',
        size: asset.fileSize,
        width: asset.width,
        height: asset.height,
      },
      'image'
    );
  }, [attach]);

  const pickDocument = useCallback(async () => {
    const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
    if (result.canceled || !result.assets?.length) return;

    const asset = result.assets[0];
    await attach(
      {
        uri: asset.uri,
        name: asset.name,
        mimeType: asset.mimeType,
        size: asset.size,
      },
      'file'
    );
  }, [attach]);

  const submit = useCallback(async () => {
    const text = draft.trim();
    if ((!text && !attachments.length) || busy) return;

    setDraft('');
    setAttachments([]);
    emit('typing:stop', { conversationId });
    typingSentAt.current = 0;

    await onSend({ text, attachments });
  }, [draft, attachments, busy, conversationId, onSend]);

  const canSend = (draft.trim() || attachments.length) && !busy;

  return (
    <View style={[styles.wrap, { backgroundColor: theme.wallpaper }]}>
      {/* ── staged attachments ── */}
      {(attachments.length > 0 || busy) && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.tray}
          contentContainerStyle={styles.trayContent}
        >
          {attachments.map((a) => (
            <View key={a.id} style={[styles.chip, { backgroundColor: theme.surface3 }]}>
              {a.kind === 'image' || a.kind === 'video' ? (
                <Image source={{ uri: a.localUri }} style={styles.chipImage} contentFit="cover" />
              ) : (
                <View style={styles.chipFile}>
                  <FileText size={20} color={theme.inkMuted} strokeWidth={2} />
                  <Text style={[styles.chipName, { color: theme.inkSoft }]} numberOfLines={1}>
                    {a.name}
                  </Text>
                  <Text style={[styles.chipSize, { color: theme.inkFaint }]}>
                    {formatBytes(a.size)}
                  </Text>
                </View>
              )}

              {a.kind === 'video' && (
                <View style={styles.chipPlay}>
                  <Play size={14} color="#fff" fill="#fff" />
                </View>
              )}

              <Pressable
                hitSlop={8}
                onPress={() => setAttachments((list) => list.filter((x) => x.id !== a.id))}
                style={styles.chipRemove}
              >
                <X size={13} color="#fff" strokeWidth={3} />
              </Pressable>
            </View>
          ))}

          {busy && (
            <View style={[styles.chip, styles.chipBusy, { backgroundColor: theme.surface3 }]}>
              <ActivityIndicator color={theme.accentStrong} />
              {progress != null && (
                <Text style={[styles.chipSize, { color: theme.inkMuted }]}>{progress}%</Text>
              )}
            </View>
          )}
        </ScrollView>
      )}

      {/* ── input row ── */}
      <View style={styles.row}>
        <Pressable
          hitSlop={8}
          disabled={busy}
          onPress={() =>
            openSheet('attach', {
              onPickMedia: pickMedia,
              onPickCamera: takePhoto,
              onPickDocument: pickDocument,
            })
          }
          style={styles.plus}
        >
          <Plus size={26} color={theme.inkSoft} strokeWidth={2.2} />
        </Pressable>

        <View style={[styles.field, { backgroundColor: theme.surface }]}>
          <TextInput
            value={draft}
            onChangeText={onChangeText}
            placeholder="Message"
            placeholderTextColor={theme.inkFaint}
            style={[styles.input, { color: theme.ink }]}
            multiline
            maxLength={4096}
            editable={!disabled}
          />

          <Pressable hitSlop={8} style={styles.icon} disabled={busy}>
            <Smile size={22} color={theme.inkMuted} strokeWidth={2} />
          </Pressable>
        </View>

        <Pressable
          onPress={canSend ? submit : () => toast.info('Voice notes are not built yet.')}
          style={[styles.send, { backgroundColor: theme.accent }]}
        >
          {canSend ? (
            <Send size={20} color={theme.accentInk} strokeWidth={2.2} />
          ) : (
            <Mic size={21} color={theme.accentInk} strokeWidth={2.2} />
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingTop: 6 },
  tray: { maxHeight: 92 },
  trayContent: { paddingHorizontal: 10, paddingBottom: 8, gap: 8 },
  chip: { width: 76, height: 76, borderRadius: 10, overflow: 'hidden' },
  chipBusy: { alignItems: 'center', justifyContent: 'center', gap: 4 },
  chipImage: { width: '100%', height: '100%' },
  chipFile: { flex: 1, padding: 7, gap: 2, justifyContent: 'center' },
  chipName: { fontSize: 11, fontWeight: '600', fontFamily: font.body },
  chipSize: { fontSize: 10.5, fontFamily: font.body },
  chipPlay: {
    position: 'absolute',
    left: 0, right: 0, top: 0, bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipRemove: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, paddingHorizontal: 6 },
  plus: { width: 42, height: 46, alignItems: 'center', justifyContent: 'center' },
  field: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    borderRadius: 24,
    paddingLeft: 16,
    paddingRight: 8,
    paddingVertical: 6,
    minHeight: 46,
    elevation: 1,
  },
  input: { flex: 1, fontSize: 15.5, maxHeight: 120, paddingTop: 6, paddingBottom: 6, fontFamily: font.body },
  icon: { padding: 7 },
  send: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 2,
  },
});
