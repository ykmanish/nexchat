'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Mail, User, Lock, ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { AuthCard, AuthHeading } from '@/components/auth/AuthShell';
import { Input } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/store/auth';
import { toast } from '@/store/ui';
import { cn } from '@/lib/utils';

/** Rough strength meter — length plus variety, nothing clever. */
function strengthOf(password) {
  if (!password) return { score: 0, label: '', tone: '' };
  let score = 0;
  if (password.length >= 8) score += 1;
  if (password.length >= 12) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;

  const labels = ['Too short', 'Weak', 'Okay', 'Good', 'Strong', 'Excellent'];
  const tones = [
    'bg-surface-3',
    'bg-danger',
    'bg-warn',
    'bg-brand',
    'bg-wa-500',
    'bg-wa-500',
  ];
  return { score, label: labels[score], tone: tones[score] };
}

export default function SignupPage() {
  const router = useRouter();
  const register = useAuth((s) => s.register);

  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);

  const strength = strengthOf(form.password);
  const set = (key) => (e) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
    setErrors((x) => ({ ...x, [key]: null }));
  };

  function validate() {
    const next = {};
    if (!form.name.trim()) next.name = 'What should we call you?';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) next.email = 'Enter a valid email address';
    if (form.password.length < 8) next.password = 'Use at least 8 characters';
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function onSubmit(e) {
    e.preventDefault();
    if (!validate()) return;

    setLoading(true);
    try {
      await register(form);
      // The password never goes to the verify screen over the URL — it stays
      // in sessionStorage just long enough to derive the account keys.
      sessionStorage.setItem('nexchat.pending', JSON.stringify(form));
      router.push('/verify?email=' + encodeURIComponent(form.email));
    } catch (err) {
      if (err.code === 'EMAIL_TAKEN') setErrors({ email: err.message });
      else toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthCard>
      <AuthHeading
        title="Create your account"
        subtitle="We'll email you a 6-digit code to confirm it's really you."
      />

      <form onSubmit={onSubmit} className="space-y-3.5">
        <Input
          label="Name"
          icon={User}
          placeholder="Ada Lovelace"
          value={form.name}
          onChange={set('name')}
          error={errors.name}
          autoComplete="name"
          autoFocus
        />

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
        />

        <div>
          <Input
            label="Password"
            icon={Lock}
            type="password"
            placeholder="At least 8 characters"
            value={form.password}
            onChange={set('password')}
            error={errors.password}
            autoComplete="new-password"
          />

          <AnimatePresence>
            {form.password && !errors.password && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="flex items-center gap-2.5 px-1 pt-2">
                  <div className="flex flex-1 gap-1">
                    {[0, 1, 2, 3, 4].map((i) => (
                      <div
                        key={i}
                        className={cn(
                          'h-1 flex-1 rounded-full transition-colors duration-300',
                          i < strength.score ? strength.tone : 'bg-line'
                        )}
                      />
                    ))}
                  </div>
                  <span className="w-[62px] shrink-0 text-right text-[11.5px] font-medium text-ink-muted">
                    {strength.label}
                  </span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="flex items-start gap-2 rounded-xl bg-brand-tint px-3.5 py-2.5">
          <Check size={13} className="mt-[3px] shrink-0 text-brand-strong" strokeWidth={3} />
          <p className="text-[12.5px] leading-relaxed text-ink-muted">
            Your password also unlocks your encryption keys. We never see it — lose it and
            your history goes with it.
          </p>
        </div>

        <Button type="submit" size="block" loading={loading} iconRight={ArrowRight} sound="select">
          Send verification code
        </Button>
      </form>

      <div className="mt-6 flex items-center justify-between text-[13.5px]">
        <Link
          href="/welcome"
          className="inline-flex items-center gap-1 text-ink-muted transition-colors hover:text-ink"
        >
          <ArrowLeft size={14} />
          Back
        </Link>
        <Link href="/login" className="font-medium text-brand-strong">
          Sign in instead
        </Link>
      </div>
    </AuthCard>
  );
}
