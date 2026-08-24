'use client';

/**
 * @-mentions.
 *
 * Two things travel, and it matters which is which. The visible `@name` is part
 * of the message text and therefore inside the encrypted body, where it belongs.
 * The *ids* go out separately in the clear, because routing a notification to
 * the right person is something the server has to be able to do — it cannot read
 * the text to work out who was named. That does tell the server who was
 * mentioned in a group, and it is the price of the feature working at all.
 *
 * Labels prefer the username, which is unique, and fall back to the display
 * name. Resolution therefore stays unambiguous for anyone who has set one, and
 * degrades to longest-match for anyone who has not.
 */

export const EVERYONE = '__everyone__';

/** How many people a group can have before @everyone becomes admins-only. */
export const EVERYONE_FREE_LIMIT = 8;

const label = (user) => user?.username || user?.name || 'someone';

/* ──────────────────────────── while typing ──────────────────────────── */

/**
 * The mention being typed at the caret, or null.
 *
 * Anchored to a word boundary so an email address does not open the menu, and
 * it stops at whitespace so the menu closes once the name is finished.
 */
export function activeToken(text, caret) {
  const before = text.slice(0, caret);
  const match = /(?:^|\s)@([\p{L}\p{N}_.]*)$/u.exec(before);
  if (!match) return null;

  return {
    query: match[1],
    // Where the '@' sits, so replacing the token does not eat the space before it.
    start: caret - match[1].length - 1,
    end: caret,
  };
}

/**
 * People worth offering for a query. Groups also get an @everyone row, but only
 * where it is allowed — offering it and then having the server quietly drop it
 * would be worse than not offering it.
 */
export function candidates(conversation, query, { meId, limit = 6 } = {}) {
  if (!conversation || conversation.type === 'direct') return [];

  const needle = query.trim().toLowerCase();
  const people = (conversation.participants || [])
    .filter((p) => !p.leftAt && p.user && String(p.user._id) !== String(meId))
    .map((p) => ({
      id: String(p.user._id),
      name: p.user.name,
      username: p.user.username,
      avatar: p.user.avatar,
      avatarColor: p.user.avatarColor,
      label: label(p.user),
      role: p.role,
    }));

  const matched = needle
    ? people.filter(
        (p) =>
          p.label.toLowerCase().startsWith(needle) ||
          p.name.toLowerCase().includes(needle) ||
          p.name.toLowerCase().split(/\s+/).some((word) => word.startsWith(needle))
      )
    : people;

  const canAddressAll =
    (conversation.memberCount || people.length + 1) <= EVERYONE_FREE_LIMIT ||
    conversation.isAdmin;

  const all =
    canAddressAll && (!needle || 'everyone'.startsWith(needle))
      ? [{ id: EVERYONE, label: 'everyone', name: 'Everyone', everyone: true }]
      : [];

  return [...all, ...matched].slice(0, limit);
}

/** Replaces the token at the caret with a finished mention. */
export function insert(text, token, candidate) {
  const inserted = '@' + candidate.label + ' ';
  const next = text.slice(0, token.start) + inserted + text.slice(token.end);
  return { text: next, caret: token.start + inserted.length };
}

/* ──────────────────────────── before sending ──────────────────────────── */

/**
 * Works out who the finished text actually names.
 *
 * Scanning the text rather than trusting what was clicked is deliberate: people
 * pick a name from the menu and then delete it, and a mention that has been
 * backspaced away should not still ring someone's phone.
 */
export function collect(text, conversation, { meId } = {}) {
  if (!text || !conversation || conversation.type === 'direct') {
    return { mentions: [], mentionsEveryone: false, labels: [] };
  }

  const people = (conversation.participants || [])
    .filter((p) => !p.leftAt && p.user && String(p.user._id) !== String(meId))
    .map((p) => ({ id: String(p.user._id), label: label(p.user), name: p.user.name }));

  const found = [];
  // Longest first, so "@anna.lee" is not consumed as "@anna".
  for (const person of [...people].sort((a, b) => b.label.length - a.label.length)) {
    if (mentionsLabel(text, person.label)) found.push(person);
  }

  return {
    mentions: found.map((p) => p.id),
    mentionsEveryone: mentionsLabel(text, 'everyone') || mentionsLabel(text, 'all'),
    /** Kept in the encrypted payload so rendering needs no roster lookup. */
    labels: found.map((p) => ({ id: p.id, label: p.label, name: p.name })),
  };
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** True when `@label` appears as a whole token. */
function mentionsLabel(text, value) {
  return new RegExp('(?:^|\\s)@' + escape(value) + '(?![\\p{L}\\p{N}_.])', 'iu').test(text);
}

/* ──────────────────────────── when rendering ──────────────────────────── */

/**
 * Splits text into plain and mention runs for the bubble.
 *
 * Driven by the labels carried in the payload rather than by a live roster,
 * so an old message still highlights correctly after someone changes their
 * username or leaves the group.
 */
export function segments(text, labels = [], { meId } = {}) {
  if (!text) return [];

  const known = [
    ...labels.map((l) => ({ ...l, everyone: false })),
    { id: EVERYONE, label: 'everyone', everyone: true },
    { id: EVERYONE, label: 'all', everyone: true },
  ].sort((a, b) => b.label.length - a.label.length);

  if (!known.length) return [{ type: 'text', value: text }];

  const pattern = new RegExp(
    '@(' + known.map((k) => escape(k.label)).join('|') + ')(?![\\p{L}\\p{N}_.])',
    'giu'
  );

  const out = [];
  let last = 0;
  let match = pattern.exec(text);

  while (match) {
    if (match.index > last) out.push({ type: 'text', value: text.slice(last, match.index) });

    const hit = known.find((k) => k.label.toLowerCase() === match[1].toLowerCase());
    out.push({
      type: 'mention',
      value: '@' + match[1],
      id: hit?.id || null,
      everyone: !!hit?.everyone,
      isMe: !!meId && String(hit?.id) === String(meId),
    });

    last = match.index + match[0].length;
    match = pattern.exec(text);
  }

  if (last < text.length) out.push({ type: 'text', value: text.slice(last) });
  return out;
}
