'use client';

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Siren, TriangleAlert, Vibrate, CheckCircle2 } from 'lucide-react';
import { Sheet } from '@/components/ui/Sheet';
import { Switch, RadioRow } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { useUI, toast } from '@/store/ui';
import * as shake from '@/lib/shakegesture';
import * as sos from '@/lib/sos';
import { cn } from '@/lib/utils';
import { feedback } from '@/lib/sound';

/**
 * Setting up shake-to-alert.
 *
 * The practice mode is the part that earns its keep. Sensitivity is the kind of
 * setting nobody can pick from a description — "Normal" means nothing until you
 * have felt it on your own phone, in your own hand — and getting it wrong is
 * expensive in both directions: too gentle and a bus ride sends your location,
 * too firm and the gesture does not work when you need it. So the sheet lets you
 * shake and watch it register, with nothing sent.
 *
 * Three things are stated plainly rather than left to be discovered, because
 * each one would otherwise look like a bug:
 *
 *   - It only works while Chax is on screen. Browsers stop delivering motion
 *     events to a hidden page, and no amount of care here changes that.
 *   - A shake asks before it sends. Five seconds, cancelled by any tap.
 *   - It needs emergency contacts chosen, which live on the Emergency share
 *     screen. Without them a countdown would end in nothing.
 */
export function ShakeSosSheet({ open, onClose }) {
  const openSheet = useUI((s) => s.openSheet);

  const [settings, setSettings] = useState({ enabled: false, sensitivity: 'normal' });
  const [busy, setBusy] = useState(false);
  const [noSensor, setNoSensor] = useState(false);

  /* Practice mode: counts shakes and sends nothing. */
  const [practising, setPractising] = useState(false);
  const [detected, setDetected] = useState(0);
  const stopPractice = useRef(() => {});

  const [contactCount, setContactCount] = useState(null);

  const supported = shake.isSupported();
  const blocked = shake.unsupportedReason();

  useEffect(() => {
    if (!open) return undefined;
    shake.config.get().then(setSettings);
    sos.config.get().then((c) => setContactCount((c.contactIds || []).length));

    return () => {
      stopPractice.current();
      setPractising(false);
      setDetected(0);
    };
  }, [open]);

  // Practising while the sheet is closed would be a sensor running for nothing.
  useEffect(() => () => stopPractice.current(), []);

  async function toggle(next) {
    if (!next) {
      setSettings(await shake.config.set({ enabled: false }));
      toast.success('Shake for emergency off');
      return;
    }

    setBusy(true);
    try {
      // iOS only grants motion access from inside a real tap, which is why it
      // is asked for here rather than when the watcher starts.
      const granted = await shake.requestPermission();
      if (!granted) {
        feedback('error');
        toast.error('Motion access was declined — the gesture needs it');
        return;
      }

      // The API exists on desktops with no accelerometer, so arming it there
      // would promise something that can never happen.
      const hasSensor = await shake.probe();
      if (!hasSensor) {
        feedback('error');
        setNoSensor(true);
        toast.error('No motion sensor found on this device');
        return;
      }

      setSettings(await shake.config.set({ enabled: true }));
      feedback('success');
      toast.success('Shake for emergency on');
    } finally {
      setBusy(false);
    }
  }

  async function choose(sensitivity) {
    setSettings(await shake.config.set({ sensitivity }));
    feedback('select');
    // Re-arm practice at the new setting, so the change can be felt at once.
    if (practising) startPractice(sensitivity);
  }

  function startPractice(sensitivity = settings.sensitivity) {
    stopPractice.current();
    setDetected(0);
    setPractising(true);
    stopPractice.current = shake.watch(
      () => {
        feedback('success');
        setDetected((n) => n + 1);
      },
      { sensitivity }
    );
  }

  function endPractice() {
    stopPractice.current();
    stopPractice.current = () => {};
    setPractising(false);
  }

  return (
    <Sheet
      open={open}
      onClose={() => {
        endPractice();
        onClose();
      }}
      title="Shake for emergency"
      subtitle="Shake the phone to start an emergency share without looking at it."
      size="md"
    >
      <div className="px-5 pb-6">
        <div className="mb-5 flex items-start gap-3 rounded-xl bg-danger/10 px-4 py-3">
          <Siren size={17} className="mt-0.5 shrink-0 text-danger" />
          <p className="text-[12.5px] leading-relaxed text-ink-muted">
            A shake does not send anything on its own. It starts a{' '}
            {Math.round(shake.COUNTDOWN_MS / 1000)}-second countdown that any tap cancels —
            so an accidental shake in a bag costs you a tap, not a false alarm.
          </p>
        </div>

        {!supported || noSensor ? (
          <div className="flex items-start gap-3 rounded-xl bg-surface-2 px-4 py-3">
            <TriangleAlert size={17} className="mt-0.5 shrink-0 text-ink-faint" />
            <p className="text-[12.5px] leading-relaxed text-ink-muted">
              {noSensor
                ? 'This device has no motion sensor, so there is no shake to detect. Try it on your phone.'
                : blocked || 'This device cannot detect the gesture.'}
            </p>
          </div>
        ) : (
          <>
            <div className="mb-4 overflow-hidden rounded-xl bg-surface-2 px-5 py-3.5">
              <Switch
                label="Shake for emergency"
                checked={settings.enabled}
                disabled={busy}
                onChange={toggle}
                sublabel={busy ? 'Checking this device…' : 'Only while Chax is open on screen'}
              />
            </div>

            <div
              className={cn(
                'overflow-hidden rounded-xl bg-surface-2 transition-opacity',
                !settings.enabled && 'pointer-events-none opacity-45'
              )}
            >
              <p className="px-4 pb-1 pt-3 text-[12px] font-semibold uppercase tracking-wide text-ink-faint">
                How hard a shake
              </p>

              {shake.SENSITIVITY.map((option, i) => (
                <div key={option.value}>
                  {i > 0 && <div className="divider mx-4" />}
                  <div className="px-5">
                    <RadioRow
                      label={option.label}
                      sublabel={option.hint}
                      checked={settings.sensitivity === option.value}
                      onChange={() => choose(option.value)}
                    />
                  </div>
                </div>
              ))}
            </div>

            {/* Practice. Nobody can pick a sensitivity from a description. */}
            {settings.enabled && (
              <div className="mt-4 rounded-xl border border-line px-4 py-3.5">
                <div className="flex items-start gap-3">
                  <Vibrate size={17} className="mt-0.5 shrink-0 text-ink-muted" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13.5px] font-semibold">Try it safely</p>
                    <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-muted">
                      Shake your phone and watch it register. Nothing is sent while you
                      are practising.
                    </p>

                    {practising && (
                      <motion.p
                        key={detected}
                        initial={{ scale: detected ? 1.1 : 1, opacity: 0.6 }}
                        animate={{ scale: 1, opacity: 1 }}
                        className={cn(
                          'mt-2 flex items-center gap-1.5 text-[13px] font-semibold',
                          detected ? 'text-brand-strong' : 'text-ink-faint'
                        )}
                      >
                        {detected > 0 && <CheckCircle2 size={14} />}
                        {detected === 0
                          ? 'Listening — shake now'
                          : detected === 1
                            ? 'Detected once'
                            : 'Detected ' + detected + ' times'}
                      </motion.p>
                    )}

                    <Button
                      size="xs"
                      variant="secondary"
                      className="mt-2.5"
                      onClick={practising ? endPractice : () => startPractice()}
                    >
                      {practising ? 'Stop practising' : 'Start practising'}
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* A countdown that ends in nothing would be the worst outcome, so
                the gap is named here rather than discovered at the wrong time. */}
            {settings.enabled && contactCount === 0 && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-4 rounded-xl bg-warn/10 px-4 py-3"
              >
                <p className="flex items-start gap-2 text-[12.5px] leading-relaxed text-ink">
                  <TriangleAlert size={15} className="mt-0.5 shrink-0 text-warn" />
                  <span>
                    You have no emergency contacts yet, so a shake would have nobody to
                    tell.
                  </span>
                </p>
                <Button
                  size="xs"
                  variant="secondary"
                  className="mt-2.5"
                  onClick={() => {
                    endPractice();
                    openSheet('sos');
                  }}
                >
                  Choose contacts
                </Button>
              </motion.div>
            )}
          </>
        )}
      </div>
    </Sheet>
  );
}
