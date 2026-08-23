'use client';

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Delete, LogOut } from 'lucide-react';
import { Avatar } from '@/components/ui/Avatar';
import { appLock } from '@/lib/applock';
import { useAuth } from '@/store/auth';
import { cn } from '@/lib/utils';
import { feedback } from '@/lib/sound';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'];
const MAX_PIN = 8;

/** Full-screen PIN gate. Nothing behind it is rendered while it is up. */
export function AppLockScreen({ onUnlocked }) {
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);

  const [pin, setPin] = useState('');
  const [shake, setShake] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const checking = useRef(false);

  useEffect(() => {
    appLock.failedAttempts().then(setAttempts);
  }, []);

  /* Physical keyboards should work too. */
  useEffect(() => {
    const onKey = (e) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') press('del');
      else if (e.key === 'Enter' && pin.length >= 4) submit(pin);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  async function submit(value) {
    if (checking.current) return;
    checking.current = true;

    const ok = await appLock.verify(value);
    if (ok) {
      feedback('success');
      await appLock.markBackgrounded();
      onUnlocked();
    } else {
      feedback('error');
      setShake(true);
      setPin('');
      setAttempts(await appLock.failedAttempts());
      setTimeout(() => setShake(false), 420);
    }
    checking.current = false;
  }

  function press(key) {
    if (key === 'del') {
      feedback('tap');
      setPin((p) => p.slice(0, -1));
      return;
    }
    if (!key) return;

    feedback('tap');
    setPin((p) => {
      const next = (p + key).slice(0, MAX_PIN);
      // Four digits is the common case — try it without waiting for Enter.
      if (next.length === 4) setTimeout(() => submit(next), 90);
      return next;
    });
  }

  return (
    /* One centred column rather than a top block and a bottom block pushed
       apart — `justify-between` stretched the gaps on tall windows and was
       what made this look scattered. Sized to fit a short phone screen
       without scrolling. */
    <div className="app-shell grid place-items-center overflow-hidden bg-app px-6 py-6">
      <div className="flex w-full max-w-[248px] flex-col items-center">
        {user && (
          <Avatar src={user.avatar} name={user.name} color={user.avatarColor} size="lg" />
        )}

        <h1 className="mt-3.5 text-center font-display text-[18px] tracking-tight">
          {user ? user.name.split(' ')[0] + ', enter your PIN' : 'Enter your PIN'}
        </h1>
        <p className="mt-1 text-center text-[12.5px] text-ink-muted">
          {attempts > 0
            ? attempts + (attempts === 1 ? ' failed attempt' : ' failed attempts')
            : 'NexChat is locked'}
        </p>

        {/* dots */}
        <motion.div
          animate={shake ? { x: [0, -9, 9, -6, 6, 0] } : { x: 0 }}
          transition={{ duration: 0.4 }}
          className="mt-5 flex h-3 items-center gap-3"
        >
          {Array.from({ length: Math.max(4, pin.length) }).map((_, i) => (
            <span
              key={i}
              className={cn(
                'h-2.5 w-2.5 rounded-full transition-colors duration-150',
                i < pin.length ? 'bg-brand' : 'bg-surface-3'
              )}
            />
          ))}
        </motion.div>

        {/* keypad */}
        <div className="mt-5 grid w-full grid-cols-3 gap-2.5">
          {/* Keyed by index throughout: the blank spacer sits at index 9, so a
              `key={i}` spacer and a `key={key}` digit both stringify to "9"
              and collide. */}
          {KEYS.map((key, i) =>
            key === '' ? (
              <span key={'key-' + i} />
            ) : (
              <motion.button
                key={'key-' + i}
                type="button"
                whileTap={{ scale: 0.92 }}
                onClick={() => press(key)}
                aria-label={key === 'del' ? 'Delete' : key}
                className={cn(
                  'grid h-[52px] place-items-center rounded-xl text-[21px] font-medium transition-colors',
                  key === 'del'
                    ? 'text-ink-muted hover:bg-surface-2'
                    : 'bg-surface-2 hover:bg-surface-3'
                )}
              >
                {key === 'del' ? <Delete size={20} /> : key}
              </motion.button>
            )
          )}
        </div>

        <button
          type="button"
          onClick={() => logout()}
          className="mt-5 inline-flex items-center gap-1.5 text-[13px] text-ink-muted transition-colors hover:text-danger"
        >
          <LogOut size={14} />
          Sign out instead
        </button>
      </div>
    </div>
  );
}
