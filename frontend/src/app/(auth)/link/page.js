'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, RotateCw, Smartphone, ShieldCheck, Check, X } from 'lucide-react';
import { AuthCard, AuthHeading } from '@/components/auth/AuthShell';
import { Button } from '@/components/ui/Button';
import { api } from '@/lib/api';
import { connectLinkSocket } from '@/lib/socket';
import { useAuth } from '@/store/auth';
import { toast } from '@/store/ui';
import { feedback } from '@/lib/sound';
import * as C from '@/lib/crypto';
import * as e2ee from '@/lib/e2ee';
import { cn } from '@/lib/utils';

const STEPS = [
  'Open NexChat on your phone',
  'Go to Settings → Linked devices',
  'Tap "Link a device" and scan this code',
];

export default function LinkDevicePage() {
  const router = useRouter();
  const finishDeviceLink = useAuth((s) => s.finishDeviceLink);

  const [session, setSession] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | waiting | scanned | linking | done | expired | error
  const [scannedBy, setScannedBy] = useState(null);
  const [secondsLeft, setSecondsLeft] = useState(120);
  const [error, setError] = useState(null);

  // Held across renders because the sealed payload is opened with them.
  const ephemeral = useRef(null);
  const devicePrivate = useRef(null);
  const claimed = useRef(false);
  const socketRef = useRef(null);

  const startSession = useCallback(async () => {
    setStatus('loading');
    setError(null);
    setScannedBy(null);
    claimed.current = false;

    try {
      const pair = await C.generateEcdhKeyPair();
      ephemeral.current = pair;

      const device = await e2ee.buildDeviceKeys();
      devicePrivate.current = device.privateBundle;

      const { data } = await api.post('/devices/link/init', {
        ephemeralPublicKey: await C.exportPublicKey(pair.publicKey),
        deviceKeys: device.publicBundle,
        device: { platform: 'web', formFactor: 'desktop' },
      });

      setSession(data);
      setSecondsLeft(120);
      setStatus('waiting');
    } catch (err) {
      setError(err.message);
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    startSession();
  }, [startSession]);

  /* ── countdown ── */
  useEffect(() => {
    if (status !== 'waiting' && status !== 'scanned') return undefined;
    if (secondsLeft <= 0) {
      setStatus('expired');
      return undefined;
    }
    const t = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [secondsLeft, status]);

  const claim = useCallback(async () => {
    if (claimed.current || !session) return;
    claimed.current = true;
    setStatus('linking');

    try {
      const { data } = await api.post('/devices/link/claim', {
        code: session.code,
        claimToken: session.claimToken,
      });

      if (!data.ready) {
        claimed.current = false;
        return;
      }

      const identity = await e2ee.openLinkPayload({
        payload: data.payload,
        ephemeralPrivateKey: ephemeral.current.privateKey,
        ephemeralPublicKey: await C.exportPublicKey(ephemeral.current.publicKey),
      });

      await finishDeviceLink({
        session: data,
        identity,
        devicePrivate: devicePrivate.current,
      });

      feedback('linked');
      setStatus('done');
      setTimeout(() => router.replace('/chats'), 900);
    } catch (err) {
      claimed.current = false;
      setError(err.message);
      setStatus('error');
      feedback('error');
    }
  }, [session, finishDeviceLink, router]);

  /* ── live updates, with polling as a safety net ── */
  useEffect(() => {
    if (!session?.code || status === 'done') return undefined;

    const socket = connectLinkSocket(session.code);
    socketRef.current = socket;

    socket.on('link:scanned', ({ by }) => {
      setScannedBy(by);
      setStatus('scanned');
      feedback('select');
    });
    socket.on('link:approved', () => claim());
    socket.on('link:rejected', () => {
      setStatus('error');
      setError('The request was declined on your phone.');
      feedback('error');
    });

    const poll = setInterval(async () => {
      if (claimed.current) return;
      try {
        const { data } = await api.get('/devices/link/' + session.code + '/status');
        if (data.status === 'approved') claim();
        else if (data.status === 'scanned') setStatus((s) => (s === 'waiting' ? 'scanned' : s));
        else if (data.status === 'expired') setStatus('expired');
      } catch {
        /* the socket is the primary channel; ignore poll hiccups */
      }
    }, 2500);

    return () => {
      clearInterval(poll);
      socket.disconnect();
    };
  }, [session, status, claim]);

  /* ────────────────────────── screens ────────────────────────── */

  if (status === 'done') {
    return (
      <AuthCard className="text-center">
        <motion.div
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', damping: 12, stiffness: 240 }}
          className="mx-auto mb-5 grid h-20 w-20 place-items-center rounded-full bg-wa-500/15 text-wa-500"
        >
          <Check size={40} strokeWidth={3} />
        </motion.div>
        <h2 className="font-display text-[23px] tracking-tight">Device linked</h2>
        <p className="mt-2 text-[14px] text-ink-muted">Opening your chats…</p>
      </AuthCard>
    );
  }

  return (
    <AuthCard>
      <AuthHeading
        title="Link this screen"
        subtitle="Scan the code with the phone you're already signed in on."
      />

      {/* ── QR panel ── */}
      <div className="relative mx-auto w-full max-w-[268px]">
        <div
          className={cn(
            'relative aspect-square rounded-[26px] border-2 bg-white p-4 transition-colors duration-300',
            status === 'scanned'
              ? 'border-brand'
              : status === 'expired' || status === 'error'
                ? 'border-danger/40'
                : 'border-line'
          )}
        >
          {session?.qrDataUrl && status !== 'expired' && status !== 'error' && (
            <img
              src={session.qrDataUrl}
              alt="Device link QR code"
              className={cn(
                'h-full w-full transition-all duration-300',
                (status === 'scanned' || status === 'linking') && 'scale-95 opacity-25 blur-[2px]'
              )}
            />
          )}

          {status === 'loading' && (
            <div className="absolute inset-0 grid place-items-center rounded-[22px] bg-white">
              <div className="h-10 w-10 animate-spin rounded-full border-[3px] border-line border-t-brand" />
            </div>
          )}

          {/* Scanning laser — a small delight while you wait */}
          {status === 'waiting' && (
            <motion.div
              initial={{ top: '12%' }}
              animate={{ top: ['12%', '86%', '12%'] }}
              transition={{ duration: 3.4, repeat: Infinity, ease: 'easeInOut' }}
              className="pointer-events-none absolute inset-x-6 h-[2px] rounded-full bg-gradient-to-r from-transparent via-brand to-transparent"
            />
          )}

          <AnimatePresence>
            {(status === 'scanned' || status === 'linking') && (
              <motion.div
                initial={{ opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 grid place-items-center"
              >
                <div className="text-center">
                  <div className="relative mx-auto mb-3 grid h-16 w-16 place-items-center">
                    <span className="absolute inset-0 animate-pulse-ring rounded-full bg-brand/40" />
                    <span className="relative grid h-16 w-16 place-items-center rounded-full bg-brand text-white">
                      {status === 'linking' ? (
                        <motion.div
                          animate={{ rotate: 360 }}
                          transition={{ duration: 1.2, repeat: Infinity, ease: 'linear' }}
                        >
                          <ShieldCheck size={28} strokeWidth={2.2} />
                        </motion.div>
                      ) : (
                        <Smartphone size={28} strokeWidth={2.2} />
                      )}
                    </span>
                  </div>
                  <p className="text-[14px] font-semibold text-ink">
                    {status === 'linking' ? 'Transferring keys…' : 'Confirm on your phone'}
                  </p>
                  {scannedBy?.name && status === 'scanned' && (
                    <p className="mt-0.5 text-[12.5px] text-ink-muted">Scanned by {scannedBy.name}</p>
                  )}
                </div>
              </motion.div>
            )}

            {(status === 'expired' || status === 'error') && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="absolute inset-0 grid place-items-center rounded-[22px] bg-white px-6 text-center"
              >
                <div>
                  <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full bg-danger/12 text-danger">
                    <X size={26} strokeWidth={2.4} />
                  </div>
                  <p className="text-[14px] font-semibold text-ink">
                    {status === 'expired' ? 'This code expired' : 'Something went wrong'}
                  </p>
                  {error && <p className="mt-1 text-[12.5px] text-ink-muted">{error}</p>}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Countdown ring under the QR */}
        {(status === 'waiting' || status === 'scanned') && (
          <div className="mt-3 flex items-center justify-center gap-2 text-[12.5px] text-ink-faint">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-brand" />
            </span>
            Code expires in {Math.floor(secondsLeft / 60)}:
            {String(secondsLeft % 60).padStart(2, '0')}
          </div>
        )}
      </div>

      {/* ── manual code fallback ── */}
      {session?.code && status === 'waiting' && (
        <div className="mt-5 text-center">
          <p className="text-[12.5px] text-ink-muted">Can&apos;t scan? Enter this code</p>
          <p className="mt-1.5 font-mono text-[22px] font-semibold tracking-[0.28em] text-ink">
            {session.code}
          </p>
          <p className="mt-1.5 text-[11.5px] text-ink-faint">
            Safety number: <span className="font-mono">{session.fingerprint}</span>
          </p>
        </div>
      )}

      {/* ── instructions ── */}
      {status === 'waiting' && (
        <ol className="mt-6 space-y-2.5">
          {STEPS.map((step, i) => (
            <li key={step} className="flex items-center gap-3 text-[13.5px] text-ink-soft">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand/[0.18] text-[11.5px] font-bold text-brand-strong">
                {i + 1}
              </span>
              {step}
            </li>
          ))}
        </ol>
      )}

      {(status === 'expired' || status === 'error') && (
        <Button size="block" className="mt-5" icon={RotateCw} onClick={startSession}>
          Get a new code
        </Button>
      )}

      <div className="mt-6 flex items-center justify-between text-[13.5px]">
        <Link
          href="/welcome"
          className="inline-flex items-center gap-1 text-ink-muted transition-colors hover:text-ink"
        >
          <ArrowLeft size={14} />
          Back
        </Link>
        <Link href="/login" className="font-medium text-brand-strong">
          Use my password instead
        </Link>
      </div>
    </AuthCard>
  );
}
