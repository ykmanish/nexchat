'use client';

/**
 * What a deleted message says instead of "This message was deleted".
 *
 * The flat version reads like a database row. Somebody deleting a message has
 * almost always just thought better of something, and the tone of the line the
 * other person is left staring at is doing real work — it is the difference
 * between an accusation and a shrug.
 *
 * The line is picked from the message id, not at random, so it is stable: the
 * same deletion says the same thing on every render, on every device, and after
 * a reload. A line that changed each time you scrolled past would be a joke
 * that stops being funny immediately.
 */
const LINES = [
  '👀 Someone had second thoughts.',
  '🫢 Message vanished.',
  '🌬️ Gone with the wind.',
  '🙈 Unsaid.',
  '✨ Poof.',
  '🕳️ This one got away.',
];

/** Deterministic pick — same id, same line, always. */
export function vanishedLine(messageId) {
  const id = String(messageId || '');
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return LINES[Math.abs(hash) % LINES.length];
}

/** The plain form, for places with no room for a joke — previews and lists. */
export const VANISHED_SHORT = 'Message vanished';
