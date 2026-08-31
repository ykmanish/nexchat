'use client';

import { useState } from 'react';
import { Check, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useFeed } from '@/store/feed';

/**
 * Follow / Following, for one account.
 *
 * State comes from the store rather than a prop, so the same person's button is
 * identical everywhere it appears — on their post, on their profile, and in the
 * suggestions rail — and pressing one of them moves all of them.
 */
export function FollowButton({ userId, isFollowing, size = 'xs', showIcon = false, className }) {
  const toggleFollow = useFeed((s) => s.toggleFollow);
  const [busy, setBusy] = useState(false);

  const following = !!isFollowing;

  return (
    <Button
      size={size}
      variant={following ? 'secondary' : 'primary'}
      loading={busy}
      icon={showIcon ? (following ? Check : UserPlus) : undefined}
      className={className}
      onClick={async (e) => {
        e.stopPropagation();
        setBusy(true);
        try {
          await toggleFollow(userId);
        } finally {
          setBusy(false);
        }
      }}
    >
      {following ? 'Following' : 'Follow'}
    </Button>
  );
}
