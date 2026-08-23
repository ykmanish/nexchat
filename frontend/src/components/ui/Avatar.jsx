'use client';

import { useState } from 'react';
import { cn, initials, colorFor, readableOn } from '@/lib/utils';
import { mediaUrl } from '@/lib/api';

const SIZES = {
  xs: 'h-7 w-7 text-[10px]',
  sm: 'h-10 w-10 text-[13px]',
  md: 'h-12 w-12 text-[15px]',
  lg: 'h-[52px] w-[52px] text-[17px]',
  xl: 'h-20 w-20 text-[24px]',
  '2xl': 'h-28 w-28 text-[34px]',
  '3xl': 'h-[140px] w-[140px] text-[46px]',
};

const DOT = {
  xs: 'h-2.5 w-2.5',
  sm: 'h-3 w-3',
  md: 'h-3 w-3',
  lg: 'h-3.5 w-3.5',
  xl: 'h-4 w-4',
  '2xl': 'h-5 w-5',
  '3xl': 'h-6 w-6',
};

export function Avatar({
  src,
  name = '',
  color,
  size = 'md',
  online = false,
  ring = false,
  className,
  onClick,
}) {
  const [broken, setBroken] = useState(false);
  const bg = color || colorFor(name);
  const url = mediaUrl(src);
  const showImage = url && !broken;

  return (
    <div
      className={cn('relative shrink-0', onClick && 'cursor-pointer press', className)}
      onClick={onClick}
    >
      <div
        className={cn(
          'grid place-items-center overflow-hidden rounded-full font-medium leading-none',
          'select-none',
          SIZES[size],
          ring && 'ring-2 ring-brand ring-offset-2 ring-offset-app'
        )}
        style={showImage ? undefined : { background: bg, color: readableOn(bg) }}
      >
        {showImage ? (
          <img
            src={url}
            alt={name}
            draggable={false}
            onError={() => setBroken(true)}
            className="h-full w-full object-cover"
          />
        ) : (
          <span>{initials(name)}</span>
        )}
      </div>

      {online && (
        <span
          className={cn(
            'absolute bottom-0 right-0 rounded-full bg-wa-500 ring-2 ring-surface',
            DOT[size]
          )}
        />
      )}
    </div>
  );
}

/** Overlapping cluster used for group previews. */
export function AvatarStack({ people = [], size = 'sm', max = 3 }) {
  const shown = people.slice(0, max);
  const overlap = size === 'xs' ? '-ml-2.5' : '-ml-3.5';

  return (
    <div className="flex items-center">
      {shown.map((p, i) => (
        <div key={p._id || i} className={cn(i > 0 && overlap, 'rounded-full ring-2 ring-surface')}>
          <Avatar src={p.avatar} name={p.name} color={p.avatarColor} size={size} />
        </div>
      ))}
      {people.length > max && (
        <div
          className={cn(
            overlap,
            SIZES[size],
            'grid place-items-center rounded-full bg-surface-3 text-[11px] font-medium text-ink-muted ring-2 ring-surface'
          )}
        >
          +{people.length - max}
        </div>
      )}
    </div>
  );
}
