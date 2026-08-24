/**
 * What the thread route shows while its payload is in flight.
 *
 * `/chats/[id]` is a dynamic segment, so opening a chat costs a round trip for
 * the route payload before any of this app's own code runs. Without a loading
 * boundary Next holds the previous screen for the whole of that trip, which on a
 * phone is the difference between "instant" and "did my tap register?" — the tab
 * bar had already reacted and nothing else had.
 *
 * Streamed immediately, so the frame after the tap already shows the shape of a
 * conversation. It deliberately mirrors the real layout — header bar, a column
 * of bubbles, a composer — because a spinner in the middle of nowhere reads as
 * an error, whereas a skeleton in the right places reads as arrival.
 */
export default function ThreadLoading() {
  return (
    <div className="chat-canvas wp-doodle flex h-full min-h-0 w-full flex-col">
      <header className="safe-top shrink-0 border-b border-line bg-[var(--header)]">
        <div className="flex h-14 items-center gap-3 px-3 sm:px-4">
          <div className="skeleton h-9 w-9 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="skeleton h-3.5 w-32 rounded-full" />
            <div className="skeleton h-2.5 w-20 rounded-full" />
          </div>
        </div>
      </header>

      <div className="relative z-[1] flex min-h-0 flex-1 flex-col justify-end gap-2.5 px-4 pb-3">
        {/* Alternating sides and varied widths, so it reads as a conversation
            rather than a loading bar. */}
        {[
          { mine: false, w: 'w-[62%]' },
          { mine: true, w: 'w-[44%]' },
          { mine: false, w: 'w-[52%]' },
          { mine: true, w: 'w-[68%]' },
          { mine: false, w: 'w-[38%]' },
        ].map((row, i) => (
          <div key={i} className={row.mine ? 'flex justify-end' : 'flex justify-start'}>
            <div className={'skeleton h-10 rounded-lg ' + row.w} />
          </div>
        ))}
      </div>

      <div className="safe-bottom shrink-0 border-t border-line bg-[var(--header)] px-3 py-2.5">
        <div className="skeleton h-10 w-full rounded-full" />
      </div>
    </div>
  );
}
