'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { motion } from 'framer-motion';
import { Home, MessageCircle, CircleDashed, Phone, CircleUser } from 'lucide-react';
import { cn } from '@/lib/utils';
import { feedback } from '@/lib/sound';
import { useChat } from '@/store/chat';

const TABS = [
  { href: '/feed', icon: Home, label: 'Feed' },
  { href: '/chats', icon: MessageCircle, label: 'Chats' },
  { href: '/status', icon: CircleDashed, label: 'Updates' },
  { href: '/calls', icon: Phone, label: 'Calls' },
  { href: '/settings', icon: CircleUser, label: 'You' },
];

/** Mobile tab bar. The active tab gets a filled pill behind its icon. */
export function BottomNav() {
  const router = useRouter();
  const pathname = usePathname();

  const unread = useChat((s) =>
    s.conversations.reduce((n, c) => n + (c.archived ? 0 : c.unreadCount || 0), 0)
  );

  /* Pull every tab's payload down before it is asked for.
     Without this each switch begins with a round trip for the route's own
     bundle and RSC payload — a couple of hundred milliseconds of nothing
     happening after the tap, which is exactly the delay that makes a web app
     feel like a web app. Four small routes, fetched once, and from then on a
     tab switch is local work. */
  useEffect(() => {
    TABS.forEach((tab) => router.prefetch(tab.href));
  }, [router]);

  return (
    <nav className="safe-bottom relative z-30 shrink-0 border-t border-line bg-surface lg:hidden">
      <div className="grid grid-cols-5 px-0.5 pb-2.5 pt-2">
        {TABS.map((tab) => (
          <NavTab
            key={tab.href}
            {...tab}
            active={
              tab.href === '/feed'
                ? pathname.startsWith('/feed') || pathname.startsWith('/explore')
                : pathname.startsWith(tab.href)
            }
            badge={tab.href === '/chats' ? unread : 0}
            onClick={() => router.push(tab.href)}
          />
        ))}
      </div>
    </nav>
  );
}

function NavTab({ icon: Icon, label, active, badge = 0, onClick }) {
  return (
    <button
      type="button"
      onClick={() => {
        feedback('select');
        onClick();
      }}
      className="flex flex-col items-center gap-[3px] py-0.5"
    >
      {/* Fixed-size pill so the highlight is identical on every tab. */}
      <span className="relative grid h-8 w-full max-w-[58px] place-items-center">
        {active && (
          <motion.span
            layoutId="tab-pill"
            transition={{ type: 'spring', stiffness: 500, damping: 36 }}
            className="absolute inset-0 rounded-full bg-brand-tint"
          />
        )}
        <Icon
          size={22}
          strokeWidth={active ? 2.3 : 1.8}
          className={cn(
            'relative z-[1] transition-colors duration-200',
            active ? 'text-brand-strong' : 'text-ink-muted'
          )}
        />
        {badge > 0 && (
          <span className="absolute right-1.5 top-[-2px] z-[2] grid h-[16px] min-w-[16px] place-items-center rounded-full bg-brand px-[3px] text-[9.5px] font-bold leading-none text-brand-ink ring-2 ring-surface">
            {badge > 99 ? '99+' : badge}
          </span>
        )}
      </span>

      <span
        className={cn(
          'text-[11px] leading-none transition-colors duration-200',
          active ? 'font-semibold text-ink' : 'font-normal text-ink-muted'
        )}
      >
        {label}
      </span>
    </button>
  );
}
