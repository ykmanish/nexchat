import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, AppState, Pressable } from 'react-native';
import { Lock } from 'lucide-react-native';

import { Logo } from './Brand';
import { Button } from './Field';
import * as applock from '../lib/applock';
import { useTheme, font, heading } from '../theme';

/**
 * Covers the app when it has been away long enough.
 *
 * Worth being precise about what this is: it gates the **screen**, not the
 * data. The vault keys are not derived from your fingerprint, so this does not
 * defend against someone with your unlocked phone and a debugger. What it does
 * cover is the ordinary case — a phone handed to somebody, or left on a desk.
 *
 * The cover is rendered over the whole tree rather than as a route, so nothing
 * underneath unmounts: coming back lands on the same chat, at the same scroll
 * position, with the same draft still typed.
 */
export function AppLockGate({ children }) {
  const theme = useTheme();

  const [enabled, setEnabled] = useState(false);
  const [locked, setLocked] = useState(false);
  const [checking, setChecking] = useState(false);

  const backgroundedAt = useRef(0);
  const timeoutMs = useRef(0);

  // Read the setting at launch, and lock immediately if it is on.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const [on, ms] = await Promise.all([applock.isEnabled(), applock.timeout()]);
      if (cancelled) return;
      timeoutMs.current = ms;
      setEnabled(on);
      setLocked(on);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const unlock = useCallback(async () => {
    setChecking(true);
    try {
      const ok = await applock.authenticate({ reason: 'Unlock Chax' });
      if (ok) setLocked(false);
    } finally {
      setChecking(false);
    }
  }, []);

  /* Lock on the way back in rather than on the way out: deciding at
     background-time would mean re-reading the setting while the process may be
     about to be frozen, and the elapsed time is only knowable on return. */
  useEffect(() => {
    if (!enabled) return undefined;

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background' || state === 'inactive') {
        backgroundedAt.current = Date.now();
        return;
      }

      if (state === 'active' && backgroundedAt.current) {
        const away = Date.now() - backgroundedAt.current;
        backgroundedAt.current = 0;
        if (away >= timeoutMs.current) setLocked(true);
      }
    });

    return () => sub.remove();
  }, [enabled]);

  // Prompt as soon as the cover appears, so it is one tap in the common case.
  useEffect(() => {
    if (locked) unlock();
  }, [locked, unlock]);

  return (
    <View style={styles.root}>
      {children}

      {locked && (
        <View style={[styles.cover, { backgroundColor: theme.app }]}>
          <Logo size={72} />
          <Text style={[heading(22), { color: theme.ink, marginTop: 16 }]}>Chax is locked</Text>
          <Text style={[styles.body, { color: theme.inkMuted }]}>
            Unlock with your fingerprint, face or device PIN.
          </Text>

          <Button
            title={checking ? 'Waiting…' : 'Unlock'}
            onPress={unlock}
            loading={checking}
            style={styles.button}
          />

          <View style={styles.footer}>
            <Lock size={11} color={theme.inkFaint} />
            <Text style={[styles.footerText, { color: theme.inkFaint }]}>
              Your messages stay encrypted either way
            </Text>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  cover: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    zIndex: 999,
  },
  body: { fontSize: 14.5, textAlign: 'center', marginTop: 8, lineHeight: 21, fontFamily: font.body },
  button: { marginTop: 26, alignSelf: 'stretch' },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 22 },
  footerText: { fontSize: 12, fontFamily: font.body },
});
