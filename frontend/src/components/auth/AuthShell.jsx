'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { motion } from 'framer-motion';
import { ShieldCheck, MonitorSmartphone, MessageCircle } from 'lucide-react';
import { useAuth } from '@/store/auth';
import { Logo, Wordmark, LockIcon } from '@/components/brand/Logo';

const POINTS = [
  {
    icon: ShieldCheck,
    title: 'Encrypted end to end',
    body: 'Keys are made on your device and never leave it.',
  },
  {
    icon: MonitorSmartphone,
    title: 'Every screen you own',
    body: 'Scan once to bring your chats to a laptop or tablet.',
  },
  {
    icon: MessageCircle,
    title: 'Built for conversation',
    body: 'Replies, reactions, voice notes, calls, updates.',
  },
];

/**
 * Split layout: a fixed brand panel on the left, the changing form on the
 * right. Both columns own their own scroll, so the page itself never does.
 */
export function AuthShell({ children }) {
  const status = useAuth((s) => s.status);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status === 'authed' && !pathname.startsWith('/link')) router.replace('/chats');
  }, [status, router, pathname]);

  return (
    <div className="app-shell grid grid-cols-1 lg:grid-cols-[1.1fr_1fr] xl:grid-cols-[1.25fr_1fr]">
      {/* ── brand panel ── */}
      <aside className="relative hidden overflow-hidden bg-wa-800 text-white lg:flex lg:flex-col lg:justify-between lg:p-12 xl:p-16">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -left-24 -top-24 h-[420px] w-[420px] rounded-full bg-wa-500/25 blur-[120px]" />
          <div className="absolute -bottom-32 -right-16 h-[380px] w-[380px] rounded-full bg-wa-400/20 blur-[120px]" />
          <div className="absolute inset-0 opacity-[.07] [background-image:radial-gradient(#fff_1px,transparent_1px)] [background-size:22px_22px]" />
        </div>

        <div className="relative flex items-center gap-3">
          <Logo size={40} />
          <span className="font-display text-[22px] font-semibold tracking-tight">NexChat</span>
        </div>

        <div className="relative max-w-[440px]">
          <motion.h1
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            className="font-display text-[40px] leading-[1.08] tracking-tight xl:text-[46px]"
          >
            Say it privately.
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.08, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            className="mt-4 text-[16px] leading-relaxed text-white/70"
          >
            A messenger that keeps your conversations between you and the people in them.
          </motion.p>

          <ul className="mt-9 space-y-4">
            {POINTS.map((p, i) => (
              <motion.li
                key={p.title}
                initial={{ opacity: 0, x: -14 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.18 + i * 0.08, duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
                className="flex items-start gap-3.5"
              >
                <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/12 text-wa-200">
                  <p.icon size={18} strokeWidth={1.9} />
                </span>
                <span>
                  <span className="block text-[15px] font-medium leading-tight">{p.title}</span>
                  <span className="mt-0.5 block text-[13.5px] leading-snug text-white/60">
                    {p.body}
                  </span>
                </span>
              </motion.li>
            ))}
          </ul>
        </div>

        <p className="relative flex items-center gap-2 text-[12.5px] text-white/50">
          <LockIcon size={11} />
          Your keys never leave this device
        </p>
      </aside>

      {/* ── form column ── */}
      <main className="scroll-soft relative flex min-h-0 flex-col overflow-y-auto bg-app">
        <header className="safe-top flex shrink-0 justify-center px-6 pb-2 pt-7 lg:hidden">
          <Wordmark size="md" />
        </header>

        <div className="flex flex-1 items-center justify-center px-5 py-6 sm:px-8">
          <div className="w-full max-w-[420px]">{children}</div>
        </div>

        <footer className="safe-bottom flex shrink-0 items-center justify-center gap-1.5 px-6 pb-5 text-ink-faint lg:hidden">
          <LockIcon size={10} />
          <p className="text-[11.5px]">Your messages are encrypted on this device</p>
        </footer>
      </main>
    </div>
  );
}

/** The form panel. Borderless on desktop — the split already frames it. */
export function AuthCard({ children, className = '' }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      className={
        'rounded-2xl border border-line bg-surface p-6 shadow-card sm:p-7 lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none ' +
        className
      }
    >
      {children}
    </motion.div>
  );
}

export function AuthHeading({ title, subtitle }) {
  return (
    <div className="mb-6 text-center lg:text-left">
      <h1 className="font-display text-[25px] leading-tight tracking-tight sm:text-[28px]">
        {title}
      </h1>
      {subtitle && (
        <p className="mx-auto mt-2 max-w-[340px] text-[14.5px] leading-relaxed text-ink-muted lg:mx-0">
          {subtitle}
        </p>
      )}
    </div>
  );
}
