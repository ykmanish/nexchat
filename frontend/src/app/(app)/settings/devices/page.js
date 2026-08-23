'use client';

import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Smartphone,
  Monitor,
  Tablet,
  QrCode,
  Trash2,
  ShieldCheck,
  X,
  Camera,
  KeyRound,
  Check,
} from 'lucide-react';
import { SettingsShell, SettingsGroup, Divider } from '@/components/layout/SettingsShell';
import { Button, IconButton } from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { Sheet, ConfirmDialog } from '@/components/ui/Sheet';
import { useAuth } from '@/store/auth';
import { toast } from '@/store/ui';
import { api } from '@/lib/api';
import { sealIdentityForLink } from '@/lib/e2ee';
import { cn, chatTime } from '@/lib/utils';
import { feedback } from '@/lib/sound';

const ICONS = { mobile: Smartphone, tablet: Tablet, desktop: Monitor };

export default function DevicesPage() {
  const devices = useAuth((s) => s.devices);
  const refreshDevices = useAuth((s) => s.refreshDevices);
  const currentDeviceId = useAuth((s) => s.device?.deviceId);

  const [scanning, setScanning] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    refreshDevices().catch(() => {});
  }, [refreshDevices]);

  return (
    <SettingsShell
      title="Linked devices"
      subtitle="Use Chax on a laptop, tablet or second phone"
    >
      <motion.button
        type="button"
        whileTap={{ scale: 0.98 }}
        onClick={() => {
          feedback('open');
          setScanning(true);
        }}
        className="mb-5 flex w-full items-center gap-4 rounded-3xl bg-brand p-5 text-left text-white shadow-fab"
      >
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-black/10">
          <QrCode size={24} strokeWidth={2} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[16px] font-semibold">Link a device</span>
          <span className="mt-0.5 block text-[13px] opacity-75">
            Scan the code shown on the other screen
          </span>
        </span>
      </motion.button>

      <SettingsGroup
        title={(devices?.length || 0) + ' active'}
        footer="Each device holds its own key set. Removing one signs it out immediately and revokes its keys."
      >
        {(devices || []).map((device, i) => {
          const Icon = ICONS[device.formFactor] || Monitor;
          const isCurrent = device.deviceId === currentDeviceId;

          return (
            <div key={device.deviceId}>
              {i > 0 && <Divider />}
              <div className="flex items-center gap-3.5 px-5 py-3.5">
                <span
                  className={cn(
                    'grid h-11 w-11 shrink-0 place-items-center rounded-2xl',
                    isCurrent
                      ? 'bg-brand/20 text-brand-strong'
                      : 'bg-surface-3 text-ink-muted dark:bg-surface-3'
                  )}
                >
                  <Icon size={20} strokeWidth={1.9} />
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-[15px] font-medium">{device.name}</p>
                    {isCurrent && (
                      <span className="shrink-0 rounded-full bg-wa-500/15 px-2 py-0.5 text-[10.5px] font-semibold text-wa-500">
                        This device
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-[12.5px] text-ink-muted">
                    {device.os || 'Unknown OS'}
                    {device.linkedVia === 'qr' && ' · linked by QR'}
                  </p>
                  <p className="mt-0.5 text-[11.5px] text-ink-faint">
                    Last active {chatTime(device.lastActiveAt)}
                  </p>
                </div>

                {!isCurrent && (
                  <IconButton
                    icon={Trash2}
                    label="Sign out this device"
                    size="sm"
                    variant="dangerGhost"
                    onClick={() => setConfirmRevoke(device)}
                  />
                )}
              </div>
            </div>
          );
        })}
      </SettingsGroup>

      {devices?.length > 1 && (
        <Button
          variant="dangerGhost"
          size="block"
          onClick={async () => {
            await api.post('/devices/revoke-others');
            await refreshDevices();
            toast.success('All other devices signed out');
          }}
        >
          Sign out all other devices
        </Button>
      )}

      <LinkScannerSheet
        open={scanning}
        onClose={() => setScanning(false)}
        onLinked={() => refreshDevices()}
      />

      <ConfirmDialog
        open={!!confirmRevoke}
        onClose={() => setConfirmRevoke(null)}
        title={'Sign out ' + (confirmRevoke?.name || 'this device') + '?'}
        message="It will lose access straight away and its keys are destroyed."
        confirmLabel="Sign out"
        danger
        loading={busy}
        onConfirm={async () => {
          setBusy(true);
          try {
            await api.delete('/devices/' + confirmRevoke.deviceId);
            await refreshDevices();
            feedback('success');
            toast.success('Device signed out');
          } catch (err) {
            toast.error(err.message);
          } finally {
            setBusy(false);
            setConfirmRevoke(null);
          }
        }}
      />
    </SettingsShell>
  );
}

/* ────────────────────────── the scanner ────────────────────────── */

function LinkScannerSheet({ open, onClose, onLinked }) {
  const [stage, setStage] = useState('scan'); // scan | confirm | linking | done
  const [manualCode, setManualCode] = useState('');
  const [session, setSession] = useState(null);
  const [error, setError] = useState(null);
  const [cameraReady, setCameraReady] = useState(false);

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);

  useEffect(() => {
    if (!open) {
      stopCamera();
      setStage('scan');
      setSession(null);
      setError(null);
      setManualCode('');
      return undefined;
    }

    startCamera();
    return stopCamera;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function stopCamera() {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraReady(false);
  }

  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setCameraReady(true);
        scanLoop();
      }
    } catch {
      setCameraReady(false);
    }
  }

  async function scanLoop() {
    const jsQR = (await import('jsqr')).default;

    const tick = () => {
      const video = videoRef.current;
      const canvas = canvasRef.current;

      if (video?.readyState === video?.HAVE_ENOUGH_DATA && canvas) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const found = jsQR(image.data, image.width, image.height, {
          inversionAttempts: 'dontInvert',
        });

        if (found?.data) {
          try {
            const parsed = JSON.parse(found.data);
            if (parsed?.c) {
              stopCamera();
              lookup(parsed.c);
              return;
            }
          } catch {
            /* not one of our codes — keep scanning */
          }
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    tick();
  }

  async function lookup(code) {
    setError(null);
    try {
      const { data } = await api.post('/devices/link/scan', { code: code.toUpperCase() });
      setSession(data.session);
      setStage('confirm');
      feedback('select');
    } catch (err) {
      setError(err.message);
      feedback('error');
      startCamera();
    }
  }

  async function approve() {
    setStage('linking');
    try {
      const payload = await sealIdentityForLink(session.ephemeralPublicKey);
      await api.post('/devices/link/approve', { code: session.code, payload });
      feedback('linked');
      setStage('done');
      onLinked?.();
      setTimeout(onClose, 1400);
    } catch (err) {
      setError(err.message);
      setStage('confirm');
      feedback('error');
    }
  }

  async function reject() {
    await api.post('/devices/link/reject', { code: session.code }).catch(() => {});
    onClose();
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={stage === 'confirm' ? 'Link this device?' : 'Scan the code'}
      subtitle={
        stage === 'scan'
          ? 'Point your camera at the QR code on the other screen.'
          : stage === 'confirm'
            ? 'Check the details match what you see there.'
            : undefined
      }
      size="sm"
    >
      <div className="px-5 pb-6">
        <AnimatePresence mode="wait">
          {stage === 'scan' && (
            <motion.div key="scan" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <div className="relative mx-auto aspect-square w-full max-w-[280px] overflow-hidden rounded-3xl bg-ink">
                <video
                  ref={videoRef}
                  playsInline
                  muted
                  className="h-full w-full object-cover"
                />
                <canvas ref={canvasRef} className="hidden" />

                {/* framing corners */}
                <div className="pointer-events-none absolute inset-6">
                  {['top-0 left-0 border-t-[3px] border-l-[3px] rounded-tl-xl',
                    'top-0 right-0 border-t-[3px] border-r-[3px] rounded-tr-xl',
                    'bottom-0 left-0 border-b-[3px] border-l-[3px] rounded-bl-xl',
                    'bottom-0 right-0 border-b-[3px] border-r-[3px] rounded-br-xl',
                  ].map((corner) => (
                    <span key={corner} className={'absolute h-8 w-8 border-brand ' + corner} />
                  ))}
                  {cameraReady && (
                    <motion.div
                      initial={{ top: '0%' }}
                      animate={{ top: ['0%', '100%', '0%'] }}
                      transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
                      className="absolute inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-brand to-transparent"
                    />
                  )}
                </div>

                {!cameraReady && (
                  <div className="absolute inset-0 grid place-items-center bg-ink text-center text-white/70">
                    <div className="px-6">
                      <Camera size={26} className="mx-auto mb-2 opacity-60" />
                      <p className="text-[13px]">Camera unavailable — enter the code below.</p>
                    </div>
                  </div>
                )}
              </div>

              <div className="mt-5">
                <Input
                  label="Or type the 8-character code"
                  placeholder="ABCD1234"
                  value={manualCode}
                  onChange={(e) => {
                    setManualCode(e.target.value.toUpperCase().slice(0, 8));
                    setError(null);
                  }}
                  error={error}
                  className="font-mono tracking-[0.25em]"
                />
                <Button
                  size="block"
                  className="mt-3"
                  disabled={manualCode.length !== 8}
                  onClick={() => lookup(manualCode)}
                >
                  Continue
                </Button>
              </div>
            </motion.div>
          )}

          {stage === 'confirm' && session && (
            <motion.div
              key="confirm"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="space-y-4"
            >
              <div className="rounded-2xl bg-surface-2 p-4">
                <div className="flex items-center gap-3">
                  <span className="grid h-11 w-11 place-items-center rounded-2xl bg-brand/20 text-brand-strong">
                    <Monitor size={20} />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-[15px] font-semibold">
                      {session.device?.name || 'New device'}
                    </p>
                    <p className="truncate text-[12.5px] text-ink-muted">
                      {session.device?.os} · {session.device?.browser}
                    </p>
                  </div>
                </div>

                <div className="mt-4 rounded-xl bg-surface p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                    Safety number
                  </p>
                  <p className="mt-1 font-mono text-[15px] tracking-wider">{session.fingerprint}</p>
                  <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-faint">
                    This must match the number on the other screen.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-2.5 rounded-2xl bg-warn/8 px-4 py-3">
                <KeyRound size={15} className="mt-0.5 shrink-0 text-warn" />
                <p className="text-[12.5px] leading-relaxed text-ink-muted">
                  Approving copies your encryption keys to that device so it can read your
                  history. Only do this for a device you own.
                </p>
              </div>

              {error && <p className="text-center text-[13px] text-danger">{error}</p>}

              <div className="flex gap-3">
                <Button variant="secondary" size="block" onClick={reject}>
                  Cancel
                </Button>
                <Button size="block" icon={ShieldCheck} onClick={approve}>
                  Link device
                </Button>
              </div>
            </motion.div>
          )}

          {(stage === 'linking' || stage === 'done') && (
            <motion.div
              key="linking"
              initial={{ opacity: 0, scale: 0.94 }}
              animate={{ opacity: 1, scale: 1 }}
              className="py-10 text-center"
            >
              <div
                className={cn(
                  'mx-auto mb-4 grid h-16 w-16 place-items-center rounded-full',
                  stage === 'done' ? 'bg-wa-500/15 text-wa-500' : 'bg-brand/15 text-brand-strong'
                )}
              >
                {stage === 'done' ? (
                  <Check size={30} strokeWidth={3} />
                ) : (
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1.2, repeat: Infinity, ease: 'linear' }}
                  >
                    <ShieldCheck size={28} />
                  </motion.div>
                )}
              </div>
              <p className="text-[16px] font-semibold">
                {stage === 'done' ? 'Device linked' : 'Sending your keys…'}
              </p>
              <p className="mt-1.5 text-[13px] text-ink-muted">
                {stage === 'done'
                  ? 'It can now read your conversations.'
                  : 'Sealed so only that device can open them.'}
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Sheet>
  );
}
