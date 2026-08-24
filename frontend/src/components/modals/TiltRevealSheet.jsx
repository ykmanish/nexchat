'use client';

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Eye, MoveUp, TriangleAlert } from 'lucide-react';
import { Sheet } from '@/components/ui/Sheet';
import { Switch, RadioRow } from '@/components/ui/Field';
import { toast } from '@/store/ui';
import * as tilt from '@/lib/tiltreveal';
import { cn } from '@/lib/utils';
import { feedback } from '@/lib/sound';

/**
 * Setting up tilt-to-read, with a live preview.
 *
 * The preview earns its place: "reveals at a normal reading angle" means very
 * little as words, and the difference between the three sensitivities is
 * impossible to judge without holding the phone and watching the sample text
 * sharpen. So this sheet reads the sensor while it is open and shows the current
 * angle against the chosen line.
 */
export function TiltRevealSheet({ open, onClose }) {
  const [settings, setSettings] = useState({ enabled: false, threshold: 50 });
  const [busy, setBusy] = useState(false);
  const [noSensor, setNoSensor] = useState(false);
  const [angle, setAngle] = useState(null);

  const supported = tilt.isSupported();
  const blocked = tilt.unsupportedReason();
  const stopLive = useRef(() => {});

  useEffect(() => {
    if (!open) return undefined;
    tilt.config.get().then(setSettings);
    return () => stopLive.current();
  }, [open]);

  /* A live angle read-out while the sheet is open, so the thresholds mean
     something. Reads raw samples rather than going through `watch`, because the
     number wanted here is the angle itself, not the revealed/hidden verdict.
     Throttled to ~10Hz: a person is reading this, and repainting it sixty times
     a second would only make it unreadable. */
  useEffect(() => {
    if (!open || !supported) return undefined;

    let last = 0;
    const handler = (event) => {
      const now = Date.now();
      if (now - last < 100) return;
      last = now;
      const next = tilt.tiltAngle(event.accelerationIncludingGravity || {});
      if (next !== null) setAngle(next);
    };

    window.addEventListener('devicemotion', handler);
    stopLive.current = () => window.removeEventListener('devicemotion', handler);
    return stopLive.current;
  }, [open, supported]);

  async function toggle(next) {
    if (!next) {
      setSettings(await tilt.config.set({ enabled: false }));
      toast.success('Tilt to read off');
      return;
    }

    setBusy(true);
    try {
      const granted = await tilt.requestPermission();
      if (!granted) {
        feedback('error');
        toast.error('Motion access was declined — this needs it');
        return;
      }

      const hasSensor = await tilt.probe();
      if (!hasSensor) {
        feedback('error');
        setNoSensor(true);
        toast.error('No motion sensor found on this device');
        return;
      }

      setSettings(await tilt.config.set({ enabled: true }));
      feedback('success');
      toast.success('Tilt to read on');
    } finally {
      setBusy(false);
    }
  }

  const revealed = angle !== null && angle >= settings.threshold;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Tilt to read"
      subtitle="Blur your messages until you raise the phone to read them."
      size="md"
    >
      <div className="px-5 pb-6">
        <div className="mb-5 flex items-start gap-3 rounded-xl bg-brand-tint px-4 py-3">
          <MoveUp size={17} className="mt-0.5 shrink-0 text-brand-strong" />
          <p className="text-[12.5px] leading-relaxed text-ink-muted">
            A phone lying on a desk is readable by everyone around it. Raised toward your
            face it is not. This blurs message text and chat previews until you lift it —
            good against a glance over your shoulder, and no defence at all against a
            camera.
          </p>
        </div>

        {!supported || noSensor ? (
          <div className="flex items-start gap-3 rounded-xl bg-surface-2 px-4 py-3">
            <TriangleAlert size={17} className="mt-0.5 shrink-0 text-ink-faint" />
            <p className="text-[12.5px] leading-relaxed text-ink-muted">
              {noSensor
                ? 'This device has no motion sensor, so there is no tilt to read. Try it on your phone.'
                : blocked || 'This device cannot detect tilt.'}
            </p>
          </div>
        ) : (
          <>
            <div className="mb-4 overflow-hidden rounded-xl bg-surface-2 px-5 py-3.5">
              <Switch
                label="Tilt to read"
                sublabel={busy ? 'Checking this device…' : 'Blurs messages and previews'}
                checked={settings.enabled}
                disabled={busy}
                onChange={toggle}
              />
            </div>

            {/* ── live preview ── */}
            <div className="mb-4 overflow-hidden rounded-xl bg-surface-2 px-4 py-4">
              <div className="mb-3 flex items-baseline justify-between">
                <p className="text-[12px] font-semibold uppercase tracking-wide text-ink-faint">
                  Try it now
                </p>
                <p className="font-mono text-[12px] tabular-nums text-ink-muted">
                  {angle === null ? '—' : Math.round(angle) + '°'}
                  <span className="text-ink-faint"> / {settings.threshold}°</span>
                </p>
              </div>

              <div
                className={cn(
                  'rounded-lg bg-surface px-3 py-2.5 text-[14px] transition-[filter,opacity] duration-200',
                  !revealed && 'blur-[8px] saturate-50 opacity-50 select-none'
                )}
              >
                Sample message — tilt your phone and watch this sharpen.
              </div>

              {/* A bar showing where the line sits and where the phone is now,
                  which is far easier to read than two numbers. */}
              <div className="relative mt-3 h-1.5 overflow-hidden rounded-full bg-surface-3">
                <div
                  className="absolute inset-y-0 left-0 rounded-full bg-brand transition-[width] duration-150"
                  style={{ width: Math.min(100, ((angle || 0) / 180) * 100) + '%' }}
                />
                <div
                  className="absolute inset-y-[-3px] w-0.5 bg-ink"
                  style={{ left: (settings.threshold / 180) * 100 + '%' }}
                />
              </div>
              <div className="mt-1 flex justify-between text-[10.5px] text-ink-faint">
                <span>Flat</span>
                <span>Upright</span>
                <span>Face-down</span>
              </div>
            </div>

            <div
              className={cn(
                'overflow-hidden rounded-xl bg-surface-2 transition-opacity',
                !settings.enabled && 'pointer-events-none opacity-45'
              )}
            >
              <p className="px-4 pb-1 pt-3 text-[12px] font-semibold uppercase tracking-wide text-ink-faint">
                How far to tilt
              </p>
              {tilt.SENSITIVITY.map((option, i) => (
                <div key={option.value}>
                  {i > 0 && <div className="divider mx-4" />}
                  <RadioRow
                    label={option.label + ' · ' + option.value + '°'}
                    sublabel={option.hint}
                    checked={settings.threshold === option.value}
                    onChange={async () => {
                      setSettings(await tilt.config.set({ threshold: option.value }));
                      feedback('select');
                    }}
                  />
                </div>
              ))}
            </div>

            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="mt-4 flex items-start gap-2 px-1 text-[12px] leading-relaxed text-ink-faint"
            >
              <Eye size={14} className="mt-0.5 shrink-0" />
              <span>
                A phone in a stand never reaches the angle, so tapping the blurred area
                clears it for a few seconds. That tap does nothing else — it will not open
                the chat you tapped.
              </span>
            </motion.p>
          </>
        )}
      </div>
    </Sheet>
  );
}
