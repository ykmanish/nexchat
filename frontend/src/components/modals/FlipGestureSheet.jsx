'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { FlipVertical, LockKeyhole, LogOut, TriangleAlert } from 'lucide-react';
import { Sheet } from '@/components/ui/Sheet';
import { Switch, RadioRow } from '@/components/ui/Field';
import { toast } from '@/store/ui';
import * as flip from '@/lib/flipgesture';
import { appLock } from '@/lib/applock';
import { cn } from '@/lib/utils';
import { feedback } from '@/lib/sound';

/**
 * Setting up the flip-to-hide gesture.
 *
 * Two things this screen has to be straight about, because both are easy to
 * assume wrongly and either one would make the feature feel broken:
 *
 *   - It only works while Chax is on screen. Browsers stop delivering motion
 *     events to a hidden page, so a flip with the app in the background does
 *     nothing.
 *   - Locking needs a PIN. Without one there is nothing to lock behind, so the
 *     gesture signs out instead — stated here rather than discovered later.
 */
export function FlipGestureSheet({ open, onClose }) {
  const [settings, setSettings] = useState({ enabled: false, action: 'lock' });
  const [hasPin, setHasPin] = useState(false);
  const [busy, setBusy] = useState(false);
  /* Set once a probe has come back empty, so the sheet can say why rather than
     leaving a switch that refuses to stay on with no explanation. */
  const [noSensor, setNoSensor] = useState(false);

  const supported = flip.isSupported();
  const blocked = flip.unsupportedReason();

  useEffect(() => {
    if (!open) return;
    flip.config.get().then(setSettings);
    appLock.isEnabled().then(setHasPin);
  }, [open]);

  async function toggle(next) {
    if (!next) {
      setSettings(await flip.config.set({ enabled: false }));
      toast.success('Flip gesture off');
      return;
    }

    setBusy(true);
    try {
      // iOS will only grant motion access from inside a real tap, which is why
      // this is asked for here and not when the watcher starts.
      const granted = await flip.requestPermission();
      if (!granted) {
        feedback('error');
        toast.error('Motion access was declined — the gesture needs it');
        return;
      }

      // The API exists on desktops with no accelerometer, so arming it there
      // would promise something that can never happen. Wait for real gravity.
      const hasSensor = await flip.probe();
      if (!hasSensor) {
        feedback('error');
        setNoSensor(true);
        toast.error('No motion sensor found on this device');
        return;
      }

      setSettings(await flip.config.set({ enabled: true }));
      feedback('success');
      toast.success('Flip gesture on');
    } finally {
      setBusy(false);
    }
  }

  async function choose(action) {
    setSettings(await flip.config.set({ action }));
    feedback('select');
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Flip to hide"
      subtitle="Turn your phone face-down and back up to hide Chax fast."
      size="md"
    >
      <div className="px-5 pb-6">
        <div className="mb-5 flex items-start gap-3 rounded-xl bg-brand-tint px-4 py-3">
          <FlipVertical size={17} className="mt-0.5 shrink-0 text-brand-strong" />
          <p className="text-[12.5px] leading-relaxed text-ink-muted">
            A quick flip — down and back up within about a second — triggers it. Leaving
            the phone face-down on a table does not, so putting it down and picking it up
            later is safe.
          </p>
        </div>

        {!supported || noSensor ? (
          <div className="flex items-start gap-3 rounded-xl bg-surface-2 px-4 py-3">
            <TriangleAlert size={17} className="mt-0.5 shrink-0 text-ink-faint" />
            <p className="text-[12.5px] leading-relaxed text-ink-muted">
              {noSensor
                ? 'This device has no motion sensor, so there is no flip to detect. Try it on your phone.'
                : blocked || 'This device cannot detect the gesture.'}
            </p>
          </div>
        ) : (
          <>
            <div className="mb-4 overflow-hidden rounded-xl bg-surface-2 px-5 py-3.5">
              <Switch
                label="Flip to hide"
                checked={settings.enabled}
                disabled={busy}
                onChange={toggle}
                sublabel={
                  busy ? 'Checking this device…' : 'Only while Chax is open on screen'
                }
              />
            </div>

            <div
              className={cn(
                'overflow-hidden rounded-xl bg-surface-2 transition-opacity',
                !settings.enabled && 'pointer-events-none opacity-45'
              )}
            >
              <p className="px-4 pb-1 pt-3 text-[12px] font-semibold uppercase tracking-wide text-ink-faint">
                When I flip
              </p>

              {flip.ACTIONS.map((action, i) => (
                <div key={action.value}>
                  {i > 0 && <div className="divider mx-4" />}
                  <div className="flex items-start gap-3 px-5 py-1">
                    <span className="mt-4 shrink-0 text-ink-muted">
                      {action.value === 'lock' ? (
                        <LockKeyhole size={16} />
                      ) : (
                        <LogOut size={16} />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <RadioRow
                        label={action.label}
                        sublabel={
                          action.value === 'lock' && !hasPin
                            ? 'Needs a PIN — without one this signs you out instead'
                            : action.hint
                        }
                        checked={settings.action === action.value}
                        onChange={() => choose(action.value)}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {settings.enabled && settings.action === 'logout' && (
              <motion.p
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-4 flex items-start gap-2 rounded-xl bg-danger/10 px-4 py-3 text-[12.5px] leading-relaxed text-danger"
              >
                <TriangleAlert size={15} className="mt-0.5 shrink-0" />
                <span>
                  Signing out clears this device&apos;s local history. Set up a backup or
                  device sync first, or choose &ldquo;Lock Chax&rdquo; instead.
                </span>
              </motion.p>
            )}
          </>
        )}
      </div>
    </Sheet>
  );
}
