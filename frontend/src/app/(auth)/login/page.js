'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Mail, Lock, ArrowLeft, QrCode } from 'lucide-react';
import { AuthCard, AuthHeading } from '@/components/auth/AuthShell';
import { Input } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/store/auth';
import { toast } from '@/store/ui';
import { feedback } from '@/lib/sound';

export default function LoginPage() {
  const router = useRouter();
  const login = useAuth((s) => s.login);

  const [form, setForm] = useState({ email: '', password: '' });
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState('idle'); // idle | unlocking

  const set = (key) => (e) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
    setErrors((x) => ({ ...x, [key]: null }));
  };

  async function onSubmit(e) {
    e.preventDefault();

    const next = {};
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) next.email = 'Enter a valid email address';
    if (!form.password) next.password = 'Enter your password';
    setErrors(next);
    if (Object.keys(next).length) return;

    setLoading(true);
    setStage('unlocking');

    try {
      await login(form);
      feedback('success');
      router.replace('/chats');
    } catch (err) {
      setStage('idle');
      if (err.code === 'EMAIL_UNVERIFIED') {
        toast.info('Verify your email first — we sent a new code.');
        router.push('/verify?email=' + encodeURIComponent(form.email));
        return;
      }
      if (err.code === 'BAD_CREDENTIALS') {
        setErrors({ password: 'Wrong email or password' });
      } else {
        toast.error(err.message);
      }
      feedback('error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthCard>
      <AuthHeading title="Welcome back" subtitle="Sign in to pick up where you left off." />

      <form onSubmit={onSubmit} className="space-y-3.5">
        <Input
          label="Email"
          icon={Mail}
          type="email"
          inputMode="email"
          placeholder="you@example.com"
          value={form.email}
          onChange={set('email')}
          error={errors.email}
          autoComplete="email"
          autoFocus
        />

        <Input
          label="Password"
          icon={Lock}
          type="password"
          placeholder="Your password"
          value={form.password}
          onChange={set('password')}
          error={errors.password}
          autoComplete="current-password"
        />

        <div className="flex justify-end">
          <Link
            href="/forgot"
            className="text-[13px] font-medium text-brand-strong transition-colors hover:text-brand-strong"
          >
            Forgot password?
          </Link>
        </div>

        <Button type="submit" size="block" loading={loading} sound="select">
          {stage === 'unlocking' && loading ? 'Unlocking your keys…' : 'Sign in'}
        </Button>
      </form>

      <div className="my-5 flex items-center gap-3">
        <div className="h-px flex-1 bg-line" />
        <span className="text-[11.5px] font-medium uppercase tracking-wider text-ink-faint">
          or
        </span>
        <div className="h-px flex-1 bg-line" />
      </div>

      <Link href="/link" className="block">
        <Button size="block" variant="secondary" icon={QrCode} sound="tap">
          Scan a code from my phone
        </Button>
      </Link>


      <div className="mt-6 flex items-center justify-between text-[13.5px]">
        <Link
          href="/welcome"
          className="inline-flex items-center gap-1 text-ink-muted transition-colors hover:text-ink"
        >
          <ArrowLeft size={14} />
          Back
        </Link>
        <Link href="/signup" className="font-medium text-brand-strong">
          Create an account
        </Link>
      </div>
    </AuthCard>
  );
}
