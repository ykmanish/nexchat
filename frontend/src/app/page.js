'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/store/auth';
import { Logo } from '@/components/brand/Logo';

export default function RootPage() {
  const status = useAuth((s) => s.status);
  const router = useRouter();

  useEffect(() => {
    if (status === 'loading') return;
    router.replace(status === 'guest' ? '/welcome' : '/feed');
  }, [status, router]);

  return (
    <div className="app-shell bg-app grid place-items-center">
      <div className="flex flex-col items-center gap-5">
        <Logo size={68} animated />
        <div className="h-1 w-24 overflow-hidden rounded-full bg-line">
          <div className="h-full w-1/2 animate-[shimmer_1.2s_infinite] rounded-full bg-brand" />
        </div>
      </div>
    </div>
  );
}
