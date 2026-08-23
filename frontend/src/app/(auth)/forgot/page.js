'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Mail, Lock, ArrowLeft, AlertTriangle } from 'lucide-react';
import { AuthCard, AuthHeading } from '@/components/auth/AuthShell';
import { Input, CodeInput } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { api } from '@/lib/api';
import { toast } from '@/store/ui';
import { feedback } from '@/lib/sound';
import { wrapIdentity, unwrapIdentity } from '@/lib/crypto';

export default function ForgotPage() {
  const router = useRouter();
  const [step, setStep] = useState('email'); // email | code | done
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [oldPassword, setOldPassword] = useState('');
  const [keepHistory, setKeepHistory] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function requestCode(e) {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('Enter a valid email address');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await api.post('/auth/forgot-password', { email });
      setStep('code');
      toast.success('If that address has an account, a code is on its way.');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function reset(e) {
    e.preventDefault();
    if (code.length !== 6) return setError('Enter the 6-digit code');
    if (password.length < 8) return setError('Use at least 8 characters');

    setLoading(true);
    setError(null);

    try {
      let encryptedIdentity;

      // If they still remember the old password we can re-wrap the same keys,
      // which keeps their whole history readable.
      if (keepHistory && oldPassword) {
        const { data } = await api.get('/auth/identity', { params: { email } });
        const unwrapped = await unwrapIdentity(data.encryptedIdentity, oldPassword);
        encryptedIdentity = await wrapIdentity(
          {
            identityPrivateKey: unwrapped.keys.identityPrivateKey,
            signingPrivateKey: unwrapped.keys.signingPrivateKey,
          },
          password
        );
      }

      await api.post('/auth/reset-password', { email, code, password, encryptedIdentity });
      feedback('success');
      setStep('done');
    } catch (err) {
      setError(err.message);
      feedback('error');
    } finally {
      setLoading(false);
    }
  }

  if (step === 'done') {
    return (
      <AuthCard className="text-center">
        <motion.div
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', damping: 13, stiffness: 220 }}
          className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-3xl bg-wa-500/15 text-wa-500"
        >
          <Lock size={28} strokeWidth={2} />
        </motion.div>
        <h2 className="font-display text-[22px] tracking-tight">Password updated</h2>
        <p className="mx-auto mt-2 max-w-[290px] text-[14px] leading-relaxed text-ink-muted">
          {keepHistory && oldPassword
            ? 'Your keys were re-wrapped, so your history is intact.'
            : 'Older messages stay encrypted under your previous key and cannot be recovered.'}
        </p>
        <Button size="block" className="mt-6" onClick={() => router.replace('/login')}>
          Sign in
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard>
      <AuthHeading
        title={step === 'email' ? 'Reset your password' : 'Choose a new password'}
        subtitle={
          step === 'email'
            ? "Enter your email and we'll send you a reset code."
            : 'Enter the code we emailed you, then pick a new password.'
        }
      />

      <AnimatePresence mode="wait">
        {step === 'email' ? (
          <motion.form
            key="email"
            onSubmit={requestCode}
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 12 }}
            className="space-y-4"
          >
            <Input
              label="Email"
              icon={Mail}
              type="email"
              inputMode="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setError(null);
              }}
              error={error}
              autoFocus
            />
            <Button type="submit" size="block" loading={loading}>
              Send reset code
            </Button>
          </motion.form>
        ) : (
          <motion.form
            key="code"
            onSubmit={reset}
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -12 }}
            className="space-y-4"
          >
            <CodeInput value={code} onChange={setCode} error={!!error} />

            <Input
              label="New password"
              icon={Lock}
              type="password"
              placeholder="At least 8 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
            />

            <div className="rounded-2xl border border-warn/25 bg-warn/8 p-4">
              <div className="flex items-start gap-2.5">
                <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warn" />
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold leading-snug">
                    Your history is encrypted with your old password
                  </p>
                  <p className="mt-1 text-[12.5px] leading-relaxed text-ink-muted">
                    If you still remember it, enter it below and we&apos;ll move your keys
                    across. Otherwise past messages stay locked.
                  </p>

                  <button
                    type="button"
                    onClick={() => setKeepHistory((v) => !v)}
                    className="mt-2.5 text-[12.5px] font-semibold text-brand-strong"
                  >
                    {keepHistory ? 'Skip this' : 'I remember my old password'}
                  </button>

                  <AnimatePresence>
                    {keepHistory && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="overflow-hidden pt-3"
                      >
                        <Input
                          type="password"
                          placeholder="Old password"
                          value={oldPassword}
                          onChange={(e) => setOldPassword(e.target.value)}
                        />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </div>

            {error && <p className="text-center text-[13px] font-medium text-danger">{error}</p>}

            <Button type="submit" size="block" loading={loading} disabled={code.length !== 6}>
              Reset password
            </Button>
          </motion.form>
        )}
      </AnimatePresence>

      <div className="mt-5 text-center">
        <Link
          href="/login"
          className="inline-flex items-center gap-1 text-[13.5px] text-ink-muted transition-colors hover:text-ink"
        >
          <ArrowLeft size={14} />
          Back to sign in
        </Link>
      </div>
    </AuthCard>
  );
}
