'use client';

import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { ChevronLeft } from 'lucide-react';
import { IconButton } from '@/components/ui/Button';

/** Shared chrome for every settings sub-page. */
export function SettingsShell({ title, subtitle, children, action }) {
  const router = useRouter();

  return (
    <div className="flex h-full min-h-0 flex-col bg-app">
      <header className="safe-top shrink-0 border-b border-line glass">
        <div className="flex items-center gap-2 px-2 py-2.5">
          <IconButton icon={ChevronLeft} label="Back" onClick={() => router.push('/settings')} />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[17px] font-semibold tracking-tight">{title}</h1>
            {subtitle && (
              <p className="truncate text-[12px] text-ink-muted">{subtitle}</p>
            )}
          </div>
          {action}
        </div>
      </header>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        className="scroll-soft min-h-0 flex-1 overflow-y-auto px-4 pb-10 pt-4"
      >
        <div className="mx-auto max-w-[560px]">{children}</div>
      </motion.div>
    </div>
  );
}

export function SettingsGroup({ title, footer, children }) {
  return (
    <div className="mb-5">
      {title && (
        <h2 className="mb-2 px-4 text-[12px] font-semibold uppercase tracking-wide text-ink-faint">
          {title}
        </h2>
      )}
      <div className="overflow-hidden rounded-3xl bg-surface shadow-card">{children}</div>
      {footer && (
        <p className="mt-2 px-4 text-[12.5px] leading-relaxed text-ink-faint">{footer}</p>
      )}
    </div>
  );
}

export function SettingsRow({ children, className = '' }) {
  return <div className={'px-5 py-3.5 ' + className}>{children}</div>;
}

export const Divider = () => <div className="divider mx-5" />;
