'use client';

import { motion } from 'framer-motion';
import { Phone, PhoneMissed, PhoneOff, Video } from 'lucide-react';
import { useAuth } from '@/store/auth';
import { bubbleTime, duration, cn } from '@/lib/utils';

const SYSTEM_TEXT = {
  'group.created': (a) => a + ' created this group',
  'community.created': (a) => a + ' created this community',
  'group.renamed': (a, t, meta) => a + ' changed the name to "' + (meta?.name || '') + '"',
  'members.added': (a, t) => a + ' added ' + t,
  'member.removed': (a, t) => a + ' removed ' + t,
  'member.left': (a) => a + ' left',
  'member.joined': (a) => a + ' joined',
  'member.promoted': (a, t) => t + ' is now an admin',
  'member.demoted': (a, t) => t + ' is no longer an admin',
};

export function SystemMessage({ message }) {
  const user = useAuth((s) => s.user);

  if (message.type === 'call') return <CallRecord message={message} currentUserId={user?._id} />;

  const actor = message.system?.actor?.name || 'Someone';
  const targets = (message.system?.targets || []).map((t) => t.name).join(', ');
  const build = SYSTEM_TEXT[message.system?.action];
  const text = build ? build(actor, targets, message.system?.meta) : 'Group updated';

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.94 }}
      animate={{ opacity: 1, scale: 1 }}
      className="my-2 flex justify-center px-4"
    >
      <span className="rounded-full bg-surface px-3 py-1.5 text-center text-[11.5px] leading-snug text-ink-muted shadow-bubble">
        {text}
      </span>
    </motion.div>
  );
}

function CallRecord({ message, currentUserId }) {
  const isMine = String(message.sender?._id || message.sender) === String(currentUserId);
  const { mode, status, duration: secs } = message.call || {};

  const missed = status === 'missed' || status === 'declined';
  const Icon = missed ? (mode === 'video' ? PhoneOff : PhoneMissed) : mode === 'video' ? Video : Phone;

  const label = missed
    ? (isMine ? 'No answer' : 'Missed ' + (mode === 'video' ? 'video' : 'voice') + ' call')
    : (isMine ? 'Outgoing' : 'Incoming') + ' ' + (mode === 'video' ? 'video' : 'voice') + ' call';

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn('my-1.5 flex px-1', isMine ? 'justify-end' : 'justify-start')}
    >
      <div
        className={cn(
          'flex items-center gap-2.5 rounded-2xl px-3 py-2 shadow-bubble',
          isMine ? 'bubble-out' : 'bubble-in'
        )}
      >
        <span
          className={cn(
            'grid h-8 w-8 place-items-center rounded-full',
            missed ? 'bg-danger/15 text-danger' : 'bg-black/[.08]'
          )}
        >
          <Icon size={15} strokeWidth={2.2} />
        </span>
        <span>
          <span className="block text-[13.5px] font-medium leading-tight">{label}</span>
          <span className="mt-0.5 block text-[11px] opacity-60">
            {bubbleTime(message.createdAt)}
            {secs > 0 && ' · ' + duration(secs)}
          </span>
        </span>
      </div>
    </motion.div>
  );
}
