'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Avatar } from '@/components/ui/Avatar';
import { api } from '@/lib/api';
import { FollowButton } from './FollowButton';

/**
 * Account results for a search.
 *
 * Its own request rather than part of the post search: the two have different
 * shapes, different page sizes and different empty states, and folding them
 * into one endpoint would mean neither could be cached independently.
 */
export function PeopleResults({ query, limit = 6 }) {
  const router = useRouter();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!query || query.length < 2) {
      setUsers([]);
      return undefined;
    }

    let cancelled = false;
    setLoading(true);

    api
      .get('/follows/search', { params: { q: query } })
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
  }, [query]);

  if (loading && !users.length) {
    return (
      <div className="space-y-2 px-4 py-4 sm:px-0">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="skeleton h-10 w-10 rounded-full" />
            <div className="flex-1 space-y-2">
              <div className="skeleton h-3 w-32 rounded-full" />
              <div className="skeleton h-2.5 w-20 rounded-full" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (!users.length) return null;

  return (
    <section className="px-2 pt-3 sm:px-0">
      <h2 className="px-2 pb-1 text-[12px] font-semibold uppercase tracking-wide text-ink-faint">
        People
      </h2>
      <ul>
        {users.slice(0, limit).map((person) => (
          <li
            key={person._id}
            className="flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-surface-2"
          >
            <button
              type="button"
              onClick={() => router.push('/u/' + person._id)}
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
                <span className="block truncate text-[12.5px] text-ink-faint">
                  {person.username ? '@' + person.username : person.about}
                </span>
              </span>
            </button>
            <FollowButton userId={person._id} isFollowing={person.isFollowing} size="xs" />
          </li>
        ))}
      </ul>
    </section>
  );
}
