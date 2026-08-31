'use client';

/**
 * Messages that are worth more than their text.
 *
 * "Happy birthday" is not really a sentence, it is a gesture, and a messenger
 * that renders it as eleven grey pixels of Helvetica is throwing the gesture
 * away. A short animation costs nothing and puts some of it back.
 *
 * Two rules keep this from becoming a nuisance:
 *
 *   - It only fires on a message that is *mostly* the phrase. "Happy birthday!"
 *     gets confetti; a paragraph that mentions somebody's birthday in passing
 *     does not, because an animation over a wall of text is an interruption
 *     rather than a flourish.
 *   - It is a preference, and the preference is honoured on the receiving side.
 *     Whoever has to watch the animation is the one who gets to switch it off.
 */

export const EFFECTS = {
  confetti: { id: 'confetti', label: 'Confetti' },
  fireworks: { id: 'fireworks', label: 'Fireworks' },
  hearts: { id: 'hearts', label: 'Hearts' },
  stars: { id: 'stars', label: 'Stars' },
  snow: { id: 'snow', label: 'Snow' },
};

/* Order matters: the first match wins, so the more specific phrases sit above
   the looser ones. Each entry is matched against the message with punctuation
   and emoji stripped, lowercased. */
const TRIGGERS = [
  { effect: 'confetti', patterns: ['happy birthday', 'happy bday', 'hbd', 'many happy returns'] },
  {
    effect: 'fireworks',
    patterns: [
      'congratulations',
      'congrats',
      'well done',
      'happy new year',
      'you did it',
      'we did it',
    ],
  },
  {
    effect: 'hearts',
    patterns: ['i love you', 'love you', 'ily', 'miss you', 'i miss you', 'love u'],
  },
  { effect: 'stars', patterns: ['good night', 'goodnight', 'gn', 'sweet dreams', 'sleep well'] },
  { effect: 'snow', patterns: ['merry christmas', 'happy holidays', 'happy diwali', 'eid mubarak'] },
];

/* Emoji on their own are a gesture too — a lone 🎂 or a row of ❤️ is not text
   that happens to contain a symbol, it is the whole message. */
const EMOJI_TRIGGERS = [
  { effect: 'confetti', chars: ['🎂', '🎈', '🥳'] },
  { effect: 'fireworks', chars: ['🎊', '🎉', '🎆', '🎇'] },
  { effect: 'hearts', chars: ['❤️', '❤', '😍', '🥰', '💕', '💖', '😘'] },
  { effect: 'stars', chars: ['🌙', '🌛', '🌜', '⭐', '✨'] },
  { effect: 'snow', chars: ['❄️', '❄', '☃️', '⛄'] },
];

/** Longest phrase we will ever match, plus room for "!!!" and a name. */
const MAX_LENGTH = 64;

const normalise = (text) =>
  String(text || '')
    .toLowerCase()
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Component}]/gu, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * The effect a message should fire, or null.
 *
 * Deliberately not a regex over the raw string: "hbd" has to match as a word
 * and not inside "thbduh", and stripping punctuation first is what lets
 * "Happy Birthday!!! 🎂🎂" and "happy birthday" take the same path.
 */
export function effectFor(text) {
  const raw = String(text || '').trim();
  if (!raw || raw.length > MAX_LENGTH * 3) return null;

  const words = normalise(raw);

  if (words && words.length <= MAX_LENGTH) {
    for (const { effect, patterns } of TRIGGERS) {
      for (const phrase of patterns) {
        // Whole-phrase match on word boundaries.
        if (words === phrase) return effect;
        if (words.startsWith(phrase + ' ') || words.endsWith(' ' + phrase)) return effect;
        if (words.includes(' ' + phrase + ' ')) return effect;
      }
    }
  }

  /* Nothing but emoji — the message is the symbol. `words` being empty is the
     test, so "🎂" fires and "cake 🎂 was good" does not. */
  if (!words) {
    for (const { effect, chars } of EMOJI_TRIGGERS) {
      if (chars.some((c) => raw.includes(c))) return effect;
    }
  }

  return null;
}
