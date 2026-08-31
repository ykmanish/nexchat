'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { Sheet } from '@/components/ui/Sheet';
import { Avatar } from '@/components/ui/Avatar';
import { api } from '@/lib/api';
import { FollowButton } from './FollowButton';

/** Followers, or the accounts somebody follows. One sheet, two directions. */
export function FollowersSheet({ open, onClose, userId, mode = 'followers' }) {
  const router = useRouter();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !userId) return;

    let cancelled = false;
    setLoading(true);
    setUsers([]);

    api
      .get('/follows/' + userId + '/' + mode)
      .then(({ data }) => {
        if (!cancelled) setUsers(data.users || []);
      })
      .catch(() => {
        if (!cancelled) setUsers([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, userId, mode]);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={mode === 'followers' ? 'Followers' : 'Following'}
      size="sm"
    >
      <div className="px-2 pb-3">
        {loading && (
          <div className="grid place-items-center py-12 text-ink-faint">
            <Loader2 size={20} className="animate-spin" />
          </div>
        )}

        {!loading && !users.length && (
          <p className="px-5 py-10 text-center text-[13.5px] text-ink-muted">
            {mode === 'followers' ? 'Nobody is following yet.' : 'Not following anyone yet.'}
          </p>
        )}

        {users.map((person) => (
          <div
            key={person._id}
            className="flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-surface-2"
          >
            <button
              type="button"
              onClick={() => {
                onClose();
                router.push('/u/' + person._id);
              }}
              className="flex min-w-0 flex-1 items-center gap-3 text-left"
            >
              <Avatar
                src={person.avatar}
                name={person.name}
                color={person.avatarColor}
                size="sm"
                online={person.presence === 'online'}
              />
              <span className="min-w-0">
                <span className="block truncate text-[14.5px] font-semibold">{person.name}</span>
                {person.username && (
                  <span className="block truncate text-[12.5px] text-ink-faint">
                    @{person.username}
                  </span>
                )}
              </span>
            </button>

            {!person.isMe && (
              <FollowButton userId={person._id} isFollowing={person.isFollowing} size="xs" />
            )}
          </div>
        ))}
      </div>
    </Sheet>
  );
}
