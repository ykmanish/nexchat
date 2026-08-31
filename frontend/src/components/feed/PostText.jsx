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

/**
 * What a link should read as: the host and enough path to be recognisable,
 * without the protocol or a tracking query nobody wants to look at.
 */
const MAX_LINK = 42;

function linkLabel(raw) {
  let label = raw.replace(/^https?:\/\//, '').replace(/^www\./, '');
  // A `?si=…` share token is noise; the href still carries it.
  const query = label.indexOf('?');
  if (query > 12) label = label.slice(0, query);
  return label.length > MAX_LINK ? label.slice(0, MAX_LINK - 1) + '…' : label;
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
        /* A URL is a label, not prose. Left at the surrounding size it set the
           height of the whole post — a bare YouTube link rendered as three
           lines of huge green text — so it steps down slightly and wraps on
           any character rather than pushing the card wide. */
        className={cn(base, 'break-all text-[0.9em]')}
      >
        {linkLabel(part.value)}
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
