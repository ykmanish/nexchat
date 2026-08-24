'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Fingerprint, KeyRound, Loader2, Lock, ShieldCheck } from 'lucide-react';
import { Sheet } from '@/components/ui/Sheet';
import { Button } from '@/components/ui/Button';
import { RadioRow, Switch } from '@/components/ui/Field';
import { appLock, AUTO_LOCK_OPTIONS } from '@/lib/applock';
import { useAuth } from '@/store/auth';
import { toast } from '@/store/ui';
import { cn } from '@/lib/utils';
import { feedback } from '@/lib/sound';

const METHODS = [
  {
    kind: 'biometric',
    icon: Fingerprint,
    label: 'Fingerprint or face',
    hint: 'Use Touch ID, Windows Hello or this device sensor',
    on: 'Fingerprint unlock is on',
    off: 'Fingerprint unlock is off',
  },
  {
    kind: 'passkey',
    icon: KeyRound,
    label: 'Passkey',
    hint: 'Unlock with a saved passkey, your phone or a security key',
    on: 'Passkey unlock is on',
    off: 'Passkey unlock is off',
  },
];

/**
 * Set, change or remove the local PIN, choose how quickly it re-locks, and
 * register a fingerprint or passkey as a shortcut past the same gate.
 */
export function AppLockSheet({ open, onClose, onChanged }) {
  const [enabled, setEnabled] = useState(false);
  const [autoLock, setAutoLock] = useState(300);
  const [stage, setStage] = useState('idle'); // idle | choose | confirm
  const [pin, setPin] = useState('');
  const [firstPin, setFirstPin] = useState('');
  const [error, setError] = useState(null);

  const user = useAuth((s) => s.user);
  const [methods, setMethods] = useState({ biometric: false, passkey: false });
  // supported starts null — unknown, not unsupported.
  const [capability, setCapability] = useState({ supported: null, reason: null, platform: false });
  const [busy, setBusy] = useState(null); // the kind mid-prompt, if any
  const [methodError, setMethodError] = useState(null);

  useEffect(() => {
    if (!open) return;
    setStage('idle');
    setPin('');
    setFirstPin('');
    setError(null);
    setMethodError(null);
    setBusy(null);
    appLock.config().then((cfg) => {
      setEnabled(!!cfg?.hash);
      setAutoLock(cfg?.autoLockSeconds ?? 300);
      const list = cfg?.credentials || [];
      setMethods({
        biometric: list.some((c) => c.kind === 'biometric'),
        passkey: list.some((c) => c.kind === 'passkey'),
      });
    });
    appLock.availability().then(setCapability);
  }, [open]);

  /** Why a row is greyed out, or null when it is usable. */
  function blockedReason(kind) {
    if (capability.supported === null) return 'Checking this device…';
    if (!capability.supported) return capability.reason || 'Not available in this browser';
    if (kind === 'biometric' && !capability.platform)
      return 'No fingerprint or face sensor on this device';
    return null;
  }

  async function toggleMethod(method, next) {
    if (busy) return;
    setMethodError(null);
    setBusy(method.kind);
    try {
      if (next) {
        await appLock.addCredential(method.kind, {
          id: user?._id,
          name: user?.username || user?.email || 'Chax app lock',
          displayName: user?.name,
        });
        feedback('success');
      } else {
        await appLock.removeCredential(method.kind);
      }
      setMethods((m) => ({ ...m, [method.kind]: next }));
      toast.success(next ? method.on : method.off);
      onChanged?.();
    } catch (err) {
      feedback('error');
      setMethodError(err.message);
    } finally {
      setBusy(null);
    }
  }

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
    // disable() clears the whole record, registered authenticators included —
    // there is no gate left for them to open.
    await appLock.disable();
    setEnabled(false);
    setMethods({ biometric: false, passkey: false });
    setMethodError(null);
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
                A fingerprint or passkey is a shortcut past the same gate; the PIN keeps
                working, so a reset sensor can never lock you out.
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

                <div className="mb-4 overflow-hidden rounded-xl bg-surface-2">
                  <p className="px-4 pb-1 pt-3 text-[12px] font-semibold uppercase tracking-wide text-ink-faint">
                    Faster unlock
                  </p>
                  {METHODS.map((method, i) => {
                    const blocked = blockedReason(method.kind);
                    const Icon = method.icon;
                    return (
                      <div key={method.kind}>
                        {i > 0 && <div className="divider mx-4" />}
                        <div className="flex items-start gap-3 px-5 py-3.5">
                          {busy === method.kind ? (
                            <Loader2
                              size={18}
                              className="mt-0.5 shrink-0 animate-spin text-brand-strong"
                            />
                          ) : (
                            <Icon size={18} className="mt-0.5 shrink-0 text-ink-muted" />
                          )}
                          <Switch
                            label={method.label}
                            sublabel={blocked || method.hint}
                            disabled={!!blocked || busy !== null}
                            checked={methods[method.kind]}
                            onChange={(v) => toggleMethod(method, v)}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>

                {methodError && (
                  <motion.p
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mb-4 text-center text-[13px] font-medium text-danger"
                  >
                    {methodError}
                  </motion.p>
                )}

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
