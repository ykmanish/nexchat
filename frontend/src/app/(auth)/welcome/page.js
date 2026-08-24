'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { ArrowRight, QrCode, ShieldCheck, MonitorSmartphone, MessageCircle } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { AuthCard, AuthHeading } from '@/components/auth/AuthShell';

/* Repeated compactly on phones, where the brand panel is hidden. */
const POINTS = [
  { icon: ShieldCheck, label: 'Encrypted end to end' },
  { icon: MonitorSmartphone, label: 'Works on every screen you own' },
  { icon: MessageCircle, label: 'Replies, reactions, voice notes, calls' },
];

export default function WelcomePage() {
  /**
   * Read after mount rather than with useSearchParams.
   *
   * That hook makes the route render on demand unless it is wrapped in a
   * Suspense boundary, and a boundary whose fallback is empty renders nothing on
   * the server and content on the client — which is a hydration mismatch. Doing
   * it in an effect means both first renders agree and the links fill in a beat
   * later, which is invisible and costs nothing.
   */
  const [next, setNext] = useState(null);

  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get('next');
    // Relative only: an absolute URL here would make this an open redirect.
    if (value && value.startsWith('/') && !value.startsWith('//')) setNext(value);
  }, []);

  /** Carries the intended destination through sign-up or sign-in. */
  const withNext = (path) => (next ? path + '?next=' + encodeURIComponent(next) : path);

  return (
    <AuthCard>
      <AuthHeading
        title="Welcome to Chax"
        subtitle="Create an account, or bring your chats to this screen."
      />

      <ul className="mb-6 space-y-2 lg:hidden">
        {POINTS.map((p, i) => (
          <motion.li
            key={p.label}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.06 + i * 0.06, duration: 0.35 }}
            className="flex items-center gap-3 text-[14px] text-ink-soft"
          >
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-tint text-brand-strong">
              <p.icon size={16} strokeWidth={1.9} />
            </span>
            {p.label}
          </motion.li>
        ))}
      </ul>

      <div className="space-y-3">
        <Link href={withNext('/signup')} className="block">
          <Button size="block" iconRight={ArrowRight} sound="select">
            Create an account
          </Button>
        </Link>

        <Link href={withNext('/login')} className="block">
          <Button size="block" variant="secondary" sound="tap">
            I already have an account
          </Button>
        </Link>
      </div>

      <div className="my-5 flex items-center gap-3">
        <div className="h-px flex-1 bg-line" />
        <span className="text-[11.5px] font-medium uppercase tracking-wider text-ink-faint">or</span>
        <div className="h-px flex-1 bg-line" />
      </div>

      <Link href="/link" className="block">
        <Button size="block" variant="subtle" icon={QrCode} sound="tap">
          Link this screen to my phone
        </Button>
      </Link>

      <p className="mt-6 text-center text-[12.5px] leading-relaxed text-ink-faint lg:text-left">
        By continuing you agree to keep your password safe — it is the only thing that can
        unlock your message history.
      </p>
    </AuthCard>
  );
}
