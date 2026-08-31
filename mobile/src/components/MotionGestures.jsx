import { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, AppState } from 'react-native';
import { EyeOff, Siren } from 'lucide-react-native';

import * as flip from '../lib/flipgesture';
import * as tilt from '../lib/tiltreveal';
import * as shake from '../lib/shakegesture';
import { useTheme, font, heading } from '../theme';
import { feedback } from '../lib/feedback';
import { toast } from '../store/ui';

/**
 * The three motion gestures, and the two overlays they drive.
 *
 * Each detector is a byte-identical port of the web client's — same thresholds,
 * same hysteresis, same reasoning — reading from `lib/motion.js`, which scales
 * expo-sensors' g-units into the m/s² those thresholds were written against.
 * `scripts/gestures.test.mjs` pins that seam down.
 *
 * All three re-read their settings on change (`config.subscribe`) rather than
 * only at mount, because a toggle that needs a relaunch to take effect is a
 * toggle that looks broken.
 */
export function MotionGestures() {
  const theme = useTheme();

  const [hidden, setHidden] = useState(false);
  const [peeking, setPeeking] = useState(false);
  const [countdown, setCountdown] = useState(null);
  const countdownTimer = useRef(null);

  /* ── flip to hide ── */
  useEffect(() => {
    let stop = null;
    let cancelled = false;

    const start = async () => {
      stop?.();
      stop = null;

      const settings = await flip.config.get();
      if (cancelled || !settings.enabled) return;

      stop = flip.watch(() => {
        feedback('select');
        setHidden((on) => !on);
      });
    };

    start();
    const unsubscribe = flip.config.subscribe(start);

    return () => {
      cancelled = true;
      unsubscribe();
      stop?.();
    };
  }, []);

  /* ── tilt to read ── */
  useEffect(() => {
    let stop = null;
    let cancelled = false;

    const start = async () => {
      stop?.();
      stop = null;

      const settings = await tilt.config.get();
      if (cancelled || !settings.enabled) return;

      stop = tilt.watch((on) => setPeeking(on));
    };

    start();
    const unsubscribe = tilt.config.subscribe(start);

    return () => {
      cancelled = true;
      unsubscribe();
      stop?.();
    };
  }, []);

  /* ── shake for emergency ── */
  useEffect(() => {
    let stop = null;
    let cancelled = false;

    const start = async () => {
      stop?.();
      stop = null;

      const settings = await shake.config.get();
      if (cancelled || !settings.enabled) return;

      stop = shake.watch(
        () => {
          /* Deliberately a countdown, not an alert. A gesture this broad will
             have false positives, and a false positive here broadcasts your
             location — so any tap cancels, and only silence sends. */
          feedback('error');
          setCountdown(Math.round(shake.COUNTDOWN / 1000) || 5);
        },
        { sensitivity: settings.sensitivity }
      );
    };

    start();
    const unsubscribe = shake.config.subscribe(start);

    return () => {
      cancelled = true;
      unsubscribe();
      stop?.();
    };
  }, []);

  /* Ticking the countdown down, and firing at zero. */
  useEffect(() => {
    if (countdown === null) return undefined;

    if (countdown <= 0) {
      setCountdown(null);
      toast.info('Emergency share is not built in the app yet — nothing was sent.');
      return undefined;
    }

    countdownTimer.current = setTimeout(() => setCountdown((n) => (n === null ? null : n - 1)), 1000);
    return () => clearTimeout(countdownTimer.current);
  }, [countdown]);

  /* Going to the background clears a pending countdown: the phone is in a
     pocket, and a timer that fires there is exactly the false alarm the
     countdown exists to prevent. */
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') setCountdown(null);
    });
    return () => sub.remove();
  }, []);

  const covered = hidden && !peeking;

  return (
    <>
      {covered && (
        <Pressable
          style={[styles.curtain, { backgroundColor: theme.app }]}
          onPress={() => setHidden(false)}
        >
          <EyeOff size={30} color={theme.inkFaint} strokeWidth={1.8} />
          <Text style={[styles.curtainText, { color: theme.inkMuted }]}>
            Hidden — turn the phone over, or tap
          </Text>
        </Pressable>
      )}

      {countdown !== null && (
        <Pressable
          style={[styles.sos, { backgroundColor: theme.danger }]}
          onPress={() => {
            setCountdown(null);
            feedback('select');
          }}
        >
          <Siren size={26} color="#fff" strokeWidth={2.2} />
          <Text style={[heading(19), styles.sosTitle]}>Emergency share in {countdown}</Text>
          <Text style={styles.sosBody}>Tap anywhere to cancel</Text>
        </Pressable>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  curtain: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    zIndex: 900,
  },
  curtainText: { fontSize: 14, fontFamily: font.body },
  sos: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    zIndex: 950,
  },
  sosTitle: { color: '#fff' },
  sosBody: { color: 'rgba(255,255,255,.85)', fontSize: 14, fontFamily: font.body },
});
