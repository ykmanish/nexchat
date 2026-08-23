'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Lock, ShieldCheck } from 'lucide-react';
import { Sheet } from '@/components/ui/Sheet';
import { Button } from '@/components/ui/Button';
import { RadioRow } from '@/components/ui/Field';
import { appLock, AUTO_LOCK_OPTIONS } from '@/lib/applock';
import { toast } from '@/store/ui';
import { cn } from '@/lib/utils';
import { feedback } from '@/lib/sound';

/** Set, change or remove the local PIN, and choose how quickly it re-locks. */
export function AppLockSheet({ open, onClose, onChanged }) {
  const [enabled, setEnabled] = useState(false);
  const [autoLock, setAutoLock] = useState(300);
  const [stage, setStage] = useState('idle'); // idle | choose | confirm
  const [pin, setPin] = useState('');
  const [firstPin, setFirstPin] = useState('');
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    setStage('idle');
    setPin('');
    setFirstPin('');
    setError(null);
    appLock.config().then((cfg) => {
      setEnabled(!!cfg?.hash);
      setAutoLock(cfg?.autoLockSeconds ?? 300);
    });
  }, [open]);

  async function submitPin() {
    setError(null);

    if (stage === 'choose') {
      if (!/^\d{4,8}$/.test(pin)) return setError('Use 4 to 8 digits');
      setFirstPin(pin);
      setPin('');
      setStage('confirm');
      return;
    }

    if (pin !== firstPin) {
      feedback('error');
      setError('Those did not match — try again');
      setPin('');
      setStage('choose');
      setFirstPin('');
      return;
    }

    await appLock.enable(firstPin, { autoLockSeconds: autoLock });
    await appLock.markBackgrounded();
    feedback('success');
    toast.success('App lock is on');
    setEnabled(true);
    setStage('idle');
    onChanged?.();
  }

  async function turnOff() {
    await appLock.disable();
    setEnabled(false);
    toast.success('App lock turned off');
    onChanged?.();
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="App lock"
      subtitle="Ask for a PIN before showing your chats on this device."
      size="sm"
    >
      <div className="px-5 pb-6">
        {stage === 'idle' ? (
          <>
            <div className="mb-5 flex items-start gap-3 rounded-xl bg-brand-tint px-4 py-3">
              <ShieldCheck size={17} className="mt-0.5 shrink-0 text-brand-strong" />
              <p className="text-[12.5px] leading-relaxed text-ink-muted">
                The PIN is stored only on this device and never sent to our servers. It keeps
                a passer-by out of your chats — it does not replace your account password.
              </p>
            </div>

            {enabled ? (
              <>
                <div className="mb-4 overflow-hidden rounded-xl bg-surface-2">
                  <p className="px-4 pb-1 pt-3 text-[12px] font-semibold uppercase tracking-wide text-ink-faint">
                    Lock the app
                  </p>
                  {AUTO_LOCK_OPTIONS.map((option, i) => (
                    <div key={option.value}>
                      {i > 0 && <div className="divider mx-4" />}
                      <RadioRow
                        label={option.label}
                        checked={autoLock === option.value}
                        onChange={async () => {
                          setAutoLock(option.value);
                          await appLock.setAutoLock(option.value);
                          onChanged?.();
                        }}
                      />
                    </div>
                  ))}
                </div>

                <div className="space-y-2.5">
                  <Button
                    size="block"
                    variant="secondary"
                    icon={Lock}
                    onClick={() => {
                      setStage('choose');
                      setPin('');
                    }}
                  >
                    Change PIN
                  </Button>
                  <Button size="block" variant="dangerGhost" onClick={turnOff}>
                    Turn off app lock
                  </Button>
                </div>
              </>
            ) : (
              <Button
                size="block"
                icon={Lock}
                onClick={() => {
                  feedback('select');
                  setStage('choose');
                }}
              >
                Set a PIN
              </Button>
            )}
          </>
        ) : (
          <div>
            <p className="mb-4 text-center text-[15px] font-medium">
              {stage === 'choose' ? 'Choose a PIN' : 'Enter it again'}
            </p>

            <div className="mb-4 flex justify-center gap-3">
              {Array.from({ length: Math.max(4, pin.length) }).map((_, i) => (
                <span
                  key={i}
                  className={cn(
                    'h-3.5 w-3.5 rounded-full transition-colors',
                    i < pin.length ? 'bg-brand' : 'bg-surface-3'
                  )}
                />
              ))}
            </div>

            <input
              value={pin}
              onChange={(e) => {
                setPin(e.target.value.replace(/\D/g, '').slice(0, 8));
                setError(null);
              }}
              onKeyDown={(e) => e.key === 'Enter' && submitPin()}
              inputMode="numeric"
              autoFocus
              aria-label="PIN"
              className="mx-auto block w-full rounded-xl border border-line bg-surface px-4 py-3 text-center font-mono text-[22px] tracking-[0.5em] outline-none focus:border-brand"
            />

            {error && (
              <motion.p
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-3 text-center text-[13px] font-medium text-danger"
              >
                {error}
              </motion.p>
            )}

            <div className="mt-5 flex gap-3">
              <Button
                variant="secondary"
                size="block"
                onClick={() => {
                  setStage('idle');
                  setPin('');
                  setFirstPin('');
                }}
              >
                Cancel
              </Button>
              <Button size="block" disabled={pin.length < 4} onClick={submitPin}>
                {stage === 'choose' ? 'Next' : 'Turn on'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Sheet>
  );
}
