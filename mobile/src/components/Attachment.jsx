import { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator, Linking } from 'react-native';
import { Image } from 'expo-image';
import { FileText, Play, Download } from 'lucide-react-native';
import { decryptFile } from '../lib/e2ee';
import { bytes } from '../lib/utils';
import { useTheme } from '../theme';

/**
 * An encrypted attachment.
 *
 * The server stores opaque bytes, so nothing can be rendered until the file has
 * been downloaded and decrypted with the key that travelled inside the message
 * body. `decryptFile` caches the plaintext to disk, so this cost is paid once
 * per attachment per device.
 *
 * `localUri` short-circuits all of that for the sender's own optimistic bubble:
 * the file is already on this phone, and waiting for a round trip to see the
 * photo you just picked would feel broken.
 */
export function Attachment({ attachment }) {
  const theme = useTheme();
  const [path, setPath] = useState(attachment.localUri || null);
  const [failed, setFailed] = useState(false);

  const isImage = attachment.kind === 'image';
  const isVideo = attachment.kind === 'video';

  useEffect(() => {
    if (path || !attachment.url || !attachment.key) return undefined;

    let cancelled = false;
    decryptFile({
      url: attachment.url,
      key: attachment.key,
      iv: attachment.iv,
      mime: attachment.mime,
    })
      .then((uri) => {
        if (!cancelled) setPath(uri);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [attachment.url, attachment.key, attachment.iv, attachment.mime, path]);

  if (isImage || isVideo) {
    return (
      <View style={[styles.media, { backgroundColor: theme.surface3 }]}>
        {path ? (
          <Image
            source={{ uri: path }}
            style={styles.image}
            contentFit="cover"
            transition={140}
          />
        ) : (
          <View style={styles.placeholder}>
            {failed ? (
              <Text style={[styles.failedText, { color: theme.inkFaint }]}>
                Could not load
              </Text>
            ) : (
              <ActivityIndicator color={theme.inkMuted} />
            )}
          </View>
        )}

        {isVideo && path && (
          <View style={styles.playOverlay}>
            <View style={styles.playButton}>
              <Play size={22} color="#fff" fill="#fff" />
            </View>
          </View>
        )}
      </View>
    );
  }

  return (
    <Pressable
      onPress={() => path && Linking.openURL(path).catch(() => {})}
      style={[styles.file, { backgroundColor: theme.surface3 }]}
    >
      <View style={[styles.fileIcon, { backgroundColor: theme.accentTint }]}>
        {path ? (
          <FileText size={19} color={theme.accentDeep} strokeWidth={2} />
        ) : failed ? (
          <Download size={19} color={theme.inkFaint} strokeWidth={2} />
        ) : (
          <ActivityIndicator size="small" color={theme.accentDeep} />
        )}
      </View>
      <View style={styles.fileMeta}>
        <Text style={[styles.fileName, { color: theme.ink }]} numberOfLines={1}>
          {attachment.name || 'Document'}
        </Text>
        <Text style={[styles.fileSize, { color: theme.inkMuted }]}>
          {bytes(attachment.size)}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  media: {
    width: 232,
    height: 232,
    borderRadius: 6,
    overflow: 'hidden',
    marginBottom: 3,
  },
  image: { width: '100%', height: '100%' },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  failedText: { fontSize: 13 },
  playOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  playButton: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(0,0,0,.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  file: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 9,
    borderRadius: 7,
    marginBottom: 3,
    minWidth: 210,
  },
  fileIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  fileMeta: { flex: 1, gap: 1 },
  fileName: { fontSize: 14.5, fontWeight: '600' },
  fileSize: { fontSize: 12 },
});
