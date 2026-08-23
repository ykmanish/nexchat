'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/store/auth';
import { useChat } from '@/store/chat';
import { Logo } from '@/components/brand/Logo';
import { UnlockScreen } from '@/components/auth/UnlockScreen';
import { AppLockScreen } from '@/components/auth/AppLockScreen';
import { appLock } from '@/lib/applock';
import { registerServiceWorker } from '@/lib/push';
import { BottomNav } from './BottomNav';
import { DesktopRail } from './DesktopRail';
import { SheetHost } from '@/components/modals/SheetHost';
import { CallOverlay } from '@/components/chat/CallOverlay';
import { Lightbox } from '@/components/chat/Lightbox';

/**
 * One shell for both layouts. Below `lg` it is a single stacked column with a
 * bottom tab bar; at `lg` and up a rail sits beside the content.
 */
export function AppShell({ children }) {
  const status = useAuth((s) => s.status);
  const router = useRouter();
  const pathname = usePathname();

  const loadConversations = useChat((s) => s.loadConversations);
  const loaded = useChat((s) => s.loaded);

  // `checking` avoids a flash of the app before we know whether it is locked.
  const [locked, setLocked] = useState(null);

  const releaseLock = useCallback(() => setLocked(false), []);

  useEffect(() => {
    if (status !== 'authed') return undefined;

    let cancelled = false;
    appLock.shouldLock().then((should) => !cancelled && setLocked(should));

    // Re-lock when the tab has been away longer than the chosen window.
    const onVisibility = async () => {
      if (document.visibilityState === 'hidden') {
        await appLock.markBackgrounded();
      } else if (await appLock.shouldLock()) {
        setLocked(true);
      }
    };

    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [status]);

  // Register the worker up front so a later "enable" is one permission prompt.
  useEffect(() => {
    if (status === 'authed') registerServiceWorker();
  }, [status]);

  useEffect(() => {
    if (status === 'guest') router.replace('/welcome');
  }, [status, router]);

  useEffect(() => {
    if (status === 'authed' && !loaded) {
      loadConversations().catch(() => {});
      useChat.getState().loadStories().catch(() => {});
    }
  }, [status, loaded, loadConversations]);

  if (status === 'loading') {
    return (
      <div className="app-shell grid place-items-center bg-app">
        <Logo size={60} animated />
      </div>
    );
  }

  if (status === 'locked') return <UnlockScreen />;
  if (status !== 'authed') return null;

  if (locked === null) {
    return (
      <div className="app-shell grid place-items-center bg-app">
        <Logo size={60} />
      </div>
    );
  }
  if (locked) return <AppLockScreen onUnlocked={releaseLock} />;

  // A thread open on mobile hides the tab bar so the composer sits flush.
  const inThread = /^\/chats\/[^/]+$/.test(pathname);

  return (
    <div className="app-shell flex bg-app">
      <Suspense fallback={<div className="hidden w-[68px] shrink-0 bg-surface-2 lg:block" />}>
        <DesktopRail />
      </Suspense>

      <div className="relative flex h-full min-w-0 flex-1 flex-col overflow-hidden">
        <div className="min-h-0 w-full flex-1 overflow-hidden">{children}</div>
        {!inThread && <BottomNav />}
      </div>

      <SheetHost />
      <CallOverlay />
      <Lightbox />
    </div>
  );
}
