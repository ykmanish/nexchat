'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Lock, LogOut } from 'lucide-react';
import { useAuth } from '@/store/auth';
import { toast } from '@/store/ui';
import { Input } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { Avatar } from '@/components/ui/Avatar';
import { Logo } from '@/components/brand/Logo';
import { feedback } from '@/lib/sound';

/**
 * Shown when the account is signed in but this browser has no local keys —
 * a fresh profile, cleared storage, or a different browser on the same machine.
 */
export function UnlockScreen() {
  const user = useAuth((s) => s.user);
  const unlock = useAuth((s) => s.unlock);
  const logout = useAuth((s) => s.logout);

  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    if (!password) return;

    setLoading(true);
    setError(null);
    try {
      await unlock(password);
      feedback('success');
    } catch (err) {
      setError(err.message);
      feedback('error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="app-shell bg-app grid place-items-center px-5">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-[380px] rounded-[28px] border border-white/60 bg-surface p-7 shadow-card dark:border-white/[.06]"
      >
        <div className="mb-6 text-center">
          <div className="relative mx-auto mb-4 w-fit">
            <Avatar src={user?.avatar} name={user?.name} color={user?.avatarColor} size="xl" />
            <span className="absolute -bottom-1 -right-1 grid h-8 w-8 place-items-center rounded-full bg-brand text-brand-ink ring-4 ring-surface">
              <Lock size={15} strokeWidth={2.4} />
            </span>
          </div>

          <h1 className="font-display text-[23px] tracking-tight">
            Welcome back, {user?.name?.split(' ')[0]}
          </h1>
          <p className="mx-auto mt-2 max-w-[290px] text-[14px] leading-relaxed text-ink-muted">
            This browser doesn&apos;t have your keys yet. Enter your password to unlock
            your messages here.
          </p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <Input
            type="password"
            icon={Lock}
            placeholder="Your password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setError(null);
            }}
            error={error}
            autoFocus
            autoComplete="current-password"
          />

          <Button type="submit" size="block" loading={loading} disabled={!password}>
            Unlock
          </Button>
        </form>

        <button
          type="button"
          onClick={() => logout()}
          className="mx-auto mt-5 flex items-center gap-1.5 text-[13.5px] text-ink-muted transition-colors hover:text-ink"
        >
          <LogOut size={14} />
          Sign in as someone else
        </button>
      </motion.div>
    </div>
  );
}
