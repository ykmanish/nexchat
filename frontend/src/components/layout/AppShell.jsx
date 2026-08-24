'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/store/auth';
import { useChat } from '@/store/chat';
import { Logo } from '@/components/brand/Logo';
import { UnlockScreen } from '@/components/auth/UnlockScreen';
import { AppLockScreen } from '@/components/auth/AppLockScreen';
import { appLock } from '@/lib/applock';
import * as devicesync from '@/lib/devicesync';
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
    if (status !== 'guest') return;

    /* A shared link — a call code especially — is usually opened by someone who
       is not signed in yet. Dropping them on /welcome and forgetting where they
       were headed makes the link look broken, so it travels with them. */
    const isDefault = pathname === '/' || pathname === '/chats';
    router.replace(isDefault ? '/welcome' : '/welcome?next=' + encodeURIComponent(pathname));
  }, [status, router, pathname]);

  useEffect(() => {
    if (status === 'authed' && !loaded) {
      loadConversations().catch(() => {});
      useChat.getState().loadStories().catch(() => {});
    }
  }, [status, loaded, loadConversations]);

  /**
   * Pull in what the account's other devices have decrypted, then contribute
   * what this one has.
   *
   * This is what stops a laptop and a phone showing different history: a device
   * cannot decrypt messages sent before it was linked, so the only way it can
   * ever show them is if another device hands over the plaintext — sealed under
   * a key derived from the account identity, which both already hold and the
   * server does not.
   *
   * Run on open, and again when the tab comes back after being away, because
   * that is exactly when the other device has probably been the one in use.
   * Failures are deliberately silent: sync is a convenience layered on top of a
   * chat that already works without it.
   */
  useEffect(() => {
    if (status !== 'authed' || locked) return undefined;

    const run = () => {
      devicesync
        .sync()
        .then((result) => {
          if (result?.pulled?.pulled) {
            // Newly-restored history is on disk but not in the store yet.
            loadConversations().catch(() => {});
          }
        })
        .catch(() => {});
    };

    run();

    const onVisible = () => {
      if (document.visibilityState === 'visible') run();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [status, locked, loadConversations]);

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
