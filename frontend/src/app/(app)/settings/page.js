'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import {
  ChevronRight,
  User,
  Lock,
  Bell,
  Palette,
  MonitorSmartphone,
  Star,
  HelpCircle,
  LogOut,
  Ban,
  Volume2,
  ShieldCheck,
  DatabaseBackup,
  ScanEye,
} from 'lucide-react';
import { useAuth } from '@/store/auth';
import { useUI, toast } from '@/store/ui';
import { Avatar } from '@/components/ui/Avatar';
import { ListButton } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Sheet';
import { EncryptedBadge } from '@/components/brand/Logo';
import { feedback } from '@/lib/sound';

export default function SettingsPage() {
  const router = useRouter();
  const user = useAuth((s) => s.user);
  const devices = useAuth((s) => s.devices);
  const logout = useAuth((s) => s.logout);

  const [confirmOut, setConfirmOut] = useState(false);
  const [busy, setBusy] = useState(false);

  const groups = [
    {
      items: [
        {
          icon: User,
          label: 'Profile',
          sublabel: 'Name, username, photo',
          href: '/settings/profile',
        },
        {
          icon: Lock,
          label: 'Privacy',
          sublabel: 'Last seen, read receipts, blocked',
          href: '/settings/privacy',
        },
        {
          icon: MonitorSmartphone,
          label: 'Linked devices',
          sublabel: (devices?.length || 1) + ' active',
          href: '/settings/devices',
        },
        {
          icon: DatabaseBackup,
          label: 'Chat backup',
          sublabel: 'Keep a copy you can read',
          href: '/settings/backup',
        },
        {
          icon: ScanEye,
          label: 'What the server knows',
          sublabel: 'Your metadata footprint, live',
          href: '/settings/transparency',
        },
      ],
    },
    {
      items: [
        {
          icon: Palette,
          label: 'Appearance',
          sublabel: 'Theme, wallpaper, text size',
          href: '/settings/appearance',
        },
        {
          icon: Bell,
          label: 'Notifications',
          sublabel: 'Sounds and alerts',
          href: '/settings/notifications',
        },
        {
          icon: Star,
          label: 'Starred messages',
          href: '/settings/starred',
        },
      ],
    },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col bg-app">
      <header className="safe-top shrink-0 px-5 pb-2 pt-4">
        <h1 className="font-display text-[27px] tracking-tight">Settings</h1>
      </header>

      <div className="scroll-soft min-h-0 flex-1 overflow-y-auto px-4 pb-8">
        {/* ── profile card ── */}
        <motion.button
          type="button"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          whileTap={{ scale: 0.99 }}
          onClick={() => {
            feedback('select');
            router.push('/settings/profile');
          }}
          className="mb-4 flex w-full items-center gap-4 rounded-3xl bg-surface p-4 text-left shadow-card"
        >
          <Avatar src={user?.avatar} name={user?.name} color={user?.avatarColor} size="xl" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[19px] font-semibold tracking-tight">{user?.name}</p>
            <p className="truncate text-[13.5px] text-ink-muted">
              {user?.about || 'Available'}
            </p>
            <p className="mt-1 truncate text-[12.5px] text-ink-faint">
              {user?.username ? '@' + user.username : user?.email}
            </p>
          </div>
          <ChevronRight size={19} className="shrink-0 text-ink-faint" />
        </motion.button>

        <div className="mb-4 flex justify-center">
          <EncryptedBadge label="Your keys live on this device only" />
        </div>

        {groups.map((group, gi) => (
          <div key={gi} className="mb-4 overflow-hidden rounded-3xl bg-surface shadow-card">
            {group.items.map((item, i) => (
              <div key={item.label}>
                {i > 0 && <div className="divider mx-5" />}
                <ListButton
                  icon={item.icon}
                  label={item.label}
                  sublabel={item.sublabel}
                  chevron
                  onClick={() => router.push(item.href)}
                />
              </div>
            ))}
          </div>
        ))}

        <div className="mb-4 overflow-hidden rounded-3xl bg-surface shadow-card">
          <ListButton
            icon={ShieldCheck}
            label="How encryption works"
            sublabel="What Chax can and cannot see"
            chevron
            onClick={() =>
              toast.info(
                'Keys are generated in your browser. The server only stores public keys and ciphertext.',
                { duration: 6000 }
              )
            }
          />
          <div className="divider mx-5" />
          <ListButton
            icon={HelpCircle}
            label="About Chax"
            sublabel="Version 1.0.0"
            chevron
            onClick={() => toast.info('Chax 1.0.0 — built with Next.js, Express and MongoDB.')}
          />
        </div>

        <div className="overflow-hidden rounded-3xl bg-surface shadow-card">
          <ListButton
            icon={LogOut}
            label="Sign out"
            sublabel="Removes your keys from this device"
            danger
            onClick={() => setConfirmOut(true)}
          />
        </div>

        <p className="mt-6 text-center text-[11.5px] leading-relaxed text-ink-faint">
          Signed in as {user?.email}
          <br />
          Security code {user?.securityCode}
        </p>
      </div>

      <ConfirmDialog
        open={confirmOut}
        onClose={() => setConfirmOut(false)}
        title="Sign out?"
        message="Your encryption keys are erased from this browser. You can restore them with your password."
        confirmLabel="Sign out"
        danger
        loading={busy}
        onConfirm={async () => {
          setBusy(true);
          await logout();
          router.replace('/welcome');
        }}
      />
    </div>
  );
}
