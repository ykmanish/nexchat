'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { parseCaption } from '@/lib/feedtext';
import { cn } from '@/lib/utils';

/**
 * A caption, with its hashtags, handles and links live.
 *
 * Clamped by character count rather than by CSS line-clamp. Line-clamp needs
 * layout before it knows whether the "more" control is required, so the control
 * either flickers in after paint or is always shown and sometimes does nothing.
 * Counting characters decides on the first render and is never wrong twice.
 */
export function PostText({ text, clamp = 240, size = 'md', className }) {
  const [expanded, setExpanded] = useState(false);

  const long = text && text.length > clamp + 40;
  const shown = long && !expanded ? text.slice(0, clamp).trimEnd() : text;
  const parts = useMemo(() => parseCaption(shown || ''), [shown]);

  if (!text) return null;

  return (
    <div
      className={cn(
        'selectable whitespace-pre-wrap break-words',
        size === 'lg' ? 'text-[19px] leading-[1.45]' : 'text-[14.5px] leading-[1.5]',
        className
      )}
    >
      {parts.map((part, i) => (
        <Segment key={i} part={part} />
      ))}

      {long && !expanded && (
        <>
          {'… '}
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="text-ink-faint transition-colors hover:text-ink-muted"
          >
            more
          </button>
        </>
      )}
    </div>
  );
}

function Segment({ part }) {
  const router = useRouter();

  if (part.type === 'text') return part.value;

  const base = 'text-brand-strong hover:underline underline-offset-2';

  if (part.type === 'link') {
    return (
      <a
        href={part.href}
        target="_blank"
        rel="noopener noreferrer nofollow"
        onClick={(e) => e.stopPropagation()}
        className={base}
      >
        {part.value.replace(/^https?:\/\//, '')}
      </a>
    );
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        router.push(
          part.type === 'tag' ? part.href : '/explore?q=' + encodeURIComponent(part.value)
        );
      }}
      className={cn(base, 'font-medium')}
    >
      {part.value}
    </button>
  );
}
