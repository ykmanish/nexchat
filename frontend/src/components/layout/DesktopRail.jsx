'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import {
  Home,
  Compass,
  MessageCircle,
  CircleDashed,
  Phone,
  Settings,
  Archive,
  Star,
  Bookmark,
  Moon,
  Sun,
} from 'lucide-react';
import { useTheme } from 'next-themes';
import { cn } from '@/lib/utils';
import { feedback } from '@/lib/sound';
import { Logo } from '@/components/brand/Logo';
import { Avatar } from '@/components/ui/Avatar';
import { useAuth } from '@/store/auth';
import { useChat } from '@/store/chat';

const PRIMARY = [
  { href: '/feed', icon: Home, label: 'Feed' },
  { href: '/explore', icon: Compass, label: 'Explore' },
  { href: '/chats', icon: MessageCircle, label: 'Chats' },
  { href: '/status', icon: CircleDashed, label: 'Updates' },
  { href: '/calls', icon: Phone, label: 'Calls' },
];

const SECONDARY = [
  { href: '/feed/saved', icon: Bookmark, label: 'Saved' },
  { href: '/chats?archived=1', icon: Archive, label: 'Archived' },
  { href: '/settings/starred', icon: Star, label: 'Starred' },
];

/** The narrow icon rail that only exists on wide screens. */
export function DesktopRail() {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const user = useAuth((s) => s.user);
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  const unread = useChat((s) =>
    s.conversations.reduce((n, c) => n + (c.archived ? 0 : c.unreadCount || 0), 0)
  );

  useEffect(() => setMounted(true), []);

  /* Same reasoning as the mobile tab bar: a rail switch should be local work,
     not a fetch. */
  useEffect(() => {
    [...PRIMARY, ...SECONDARY].forEach((item) => router.prefetch(item.href));
  }, [router]);

  const archivedOpen = pathname.startsWith('/chats') && search.get('archived') === '1';

  return (
    <aside className="hidden w-[68px] shrink-0 flex-col items-center border-r border-line bg-app py-3 lg:flex">
      <button
        type="button"
        onClick={() => router.push('/feed')}
        className="mb-5 transition-transform hover:scale-105 active:scale-95"
        aria-label="Chax"
      >
        <Logo size={34} />
      </button>

      <nav className="flex flex-1 flex-col items-center gap-1">
        {PRIMARY.map((item) => (
          <RailButton
            key={item.href}
            {...item}
            badge={item.href === '/chats' ? unread : 0}
            active={
              item.href === '/feed'
                ? pathname === '/feed' || /^\/feed\/[^/]+$/.test(pathname)
                : pathname.startsWith(item.href) && !archivedOpen
            }
            onClick={() => router.push(item.href)}
          />
        ))}

        <div className="my-2 h-px w-7 bg-line" />

        {SECONDARY.map((item) => (
          <RailButton
            key={item.href}
            {...item}
            active={
              item.label === 'Archived'
                ? archivedOpen
                : item.label === 'Saved'
                  ? pathname === '/feed/saved'
                  : pathname.startsWith('/settings/starred')
            }
            onClick={() => router.push(item.href)}
          />
        ))}
      </nav>

      <div className="flex flex-col items-center gap-1">
        {mounted && (
          <RailButton
            icon={resolvedTheme === 'dark' ? Sun : Moon}
            label={resolvedTheme === 'dark' ? 'Light mode' : 'Dark mode'}
            onClick={() => {
              feedback('select');
              setTheme(resolvedTheme === 'dark' ? 'light' : 'dark');
            }}
          />
        )}

        <RailButton
          icon={Settings}
          label="Settings"
          active={pathname === '/settings' || pathname.startsWith('/settings/')}
          onClick={() => router.push('/settings')}
        />

        <button
          type="button"
          onClick={() => router.push('/settings/profile')}
          className="mt-1.5 transition-transform hover:scale-105 active:scale-95"
          aria-label="Your profile"
        >
          <Avatar src={user?.avatar} name={user?.name} color={user?.avatarColor} size="sm" />
        </button>
      </div>
    </aside>
  );
}

function RailButton({ icon: Icon, label, active, badge = 0, onClick }) {
  return (
    <div className="group relative">
      <motion.button
        type="button"
        whileTap={{ scale: 0.9 }}
        onClick={() => {
          feedback('select');
          onClick();
        }}
        className={cn(
          'relative grid h-11 w-11 place-items-center rounded-full transition-colors duration-200',
          active
            ? 'bg-brand-tint text-brand-strong'
            : 'text-ink-muted hover:bg-surface-3 hover:text-ink'
        )}
        aria-label={label}
      >
        <Icon size={21} strokeWidth={active ? 2.2 : 1.85} />
        {badge > 0 && (
          <span className="absolute -right-0.5 -top-0.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-brand px-1 text-[10px] font-semibold text-brand-ink ring-2 ring-app">
            {badge > 99 ? '99+' : badge}
          </span>
        )}
      </motion.button>

      <span className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 -translate-y-1/2 whitespace-nowrap rounded-md bg-ink px-2 py-1 text-[12px] font-medium text-app opacity-0 shadow-pop transition-opacity duration-150 group-hover:opacity-100">
        {label}
      </span>
    </div>
  );
}
