'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { MailCheck, RotateCw, ShieldCheck } from 'lucide-react';
import { AuthCard, AuthHeading } from '@/components/auth/AuthShell';
import { CodeInput, Input } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/store/auth';
import { toast } from '@/store/ui';
import { api } from '@/lib/api';
import { feedback } from '@/lib/sound';

function VerifyInner() {
  const router = useRouter();
  const params = useSearchParams();
  const verifyEmail = useAuth((s) => s.verifyEmail);

  const email = params.get('email') || '';

  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [needPassword, setNeedPassword] = useState(false);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(45);
  const [phase, setPhase] = useState('code'); // code | keys

  const submittedFor = useRef(null);

  // The signup screen leaves the password here so we can derive the account
  // keys without asking for it a second time.
  const pending = useMemo(() => {
    if (typeof window === 'undefined') return null;
    try {
      return JSON.parse(sessionStorage.getItem('nexchat.pending') || 'null');
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    if (!email) router.replace('/signup');
    if (pending?.password) setPassword(pending.password);
    else setNeedPassword(true);
  }, [email, pending, router]);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  async function submit(finalCode = code) {
    if (finalCode.length !== 6) return;
    if (!password) {
      setNeedPassword(true);
      setError('Enter the password you chose so we can build your keys.');
      return;
    }
    if (submittedFor.current === finalCode) return;
    submittedFor.current = finalCode;

    setLoading(true);
    setError(null);
    setPhase('keys');

    try {
      await verifyEmail({ email, code: finalCode, password });
      sessionStorage.removeItem('nexchat.pending');
      feedback('success');
      toast.success('Welcome to Chax');
      router.replace('/chats');
    } catch (err) {
      submittedFor.current = null;
      setPhase('code');
      setError(err.message);
      setCode('');
      feedback('error');
    } finally {
      setLoading(false);
    }
  }

  async function resend() {
    try {
      await api.post('/auth/resend-code', { email, purpose: 'verify-email' });
      setCooldown(45);
      setCode('');
      setError(null);
      toast.success('New code sent');
    } catch (err) {
      toast.error(err.message);
    }
  }

  if (phase === 'keys' && loading) {
    return (
      <AuthCard className="text-center">
        <motion.div
          initial={{ scale: 0.7, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-3xl bg-brand/15 text-brand-strong"
        >
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 1.8, repeat: Infinity, ease: 'linear' }}
          >
            <ShieldCheck size={30} strokeWidth={2} />
          </motion.div>
        </motion.div>
        <h2 className="font-display text-[21px] tracking-tight">Building your keys</h2>
        <p className="mx-auto mt-2 max-w-[280px] text-[14px] leading-relaxed text-ink-muted">
          Generating your identity and 60 one-time keys. This happens entirely on this
          device and takes a moment.
        </p>
        <div className="mt-6 h-1 overflow-hidden rounded-full bg-line">
          <motion.div
            initial={{ x: '-100%' }}
            animate={{ x: '100%' }}
            transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
            className="h-full w-1/2 rounded-full bg-brand"
          />
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard>
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', damping: 14, stiffness: 220 }}
        className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-brand/15 text-brand-strong"
      >
        <MailCheck size={26} strokeWidth={2} />
      </motion.div>

      <AuthHeading
        title="Check your inbox"
        subtitle={
          <>
            We sent a 6-digit code to <span className="font-medium text-ink">{email}</span>
          </>
        }
      />

      <div className="space-y-4">
        <CodeInput
          value={code}
          onChange={(v) => {
            setCode(v);
            setError(null);
          }}
          onComplete={submit}
          error={!!error}
        />

        {error && (
          <motion.p
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center text-[13px] font-medium text-danger"
          >
            {error}
          </motion.p>
        )}

        {needPassword && (
          <Input
            label="Your password"
            type="password"
            placeholder="The password you just chose"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            hint="Needed to encrypt the keys we're about to generate."
            autoComplete="new-password"
          />
        )}

        <Button
          size="block"
          onClick={() => submit()}
          loading={loading}
          disabled={code.length !== 6}
          sound="select"
        >
          Verify and continue
        </Button>

        <div className="text-center">
          {cooldown > 0 ? (
            <p className="text-[13px] text-ink-faint">
              Didn&apos;t get it? Request a new code in {cooldown}s
            </p>
          ) : (
            <button
              type="button"
              onClick={resend}
              className="inline-flex items-center gap-1.5 text-[13.5px] font-medium text-brand-strong transition-colors hover:text-brand-strong"
            >
              <RotateCw size={14} />
              Send a new code
            </button>
          )}
        </div>
      </div>

      <p className="mt-5 text-center text-[13px] text-ink-muted">
        Wrong address?{' '}
        <Link href="/signup" className="font-medium text-brand-strong">
          Start over
        </Link>
      </p>
    </AuthCard>
  );
}

export default function VerifyPage() {
  return (
    <Suspense fallback={null}>
      <VerifyInner />
    </Suspense>
  );
}
