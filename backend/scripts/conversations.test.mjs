/**
 * Tests what a conversation looks like to the client, and what should not
 * reach it at all.
 *
 * Two faults lived here, and between them they produced a chat list with rows
 * that could not be explained, could not be removed, and crashed the app:
 *
 *   - **Hard-deleted accounts left conversations behind.** `populate` yields
 *     `null` for a reference to a document that no longer exists, so a direct
 *     chat whose peer had been deleted came back with no peer — rendered as
 *     "Unknown" with a gold avatar, impossible to get rid of, and fatal the
 *     moment its menu was opened, because every member list in the client maps
 *     over `participants` and reads `p.user._id`. A null participant is not a
 *     member of the chat, so it is dropped here rather than guarded five times
 *     over in the UI.
 *
 *   - **Deleting a direct chat did nothing durable.** It set `clearedAt`, which
 *     only hides the sidebar preview, and deliberately did not set `leftAt` —
 *     correctly, since there is no group to leave. Nothing else recorded the
 *     deletion, so the row was still there on the next load. `deletedAt` records
 *     it, and is cleared by an incoming message or by reopening the chat.
 *
 * Run: node scripts/conversations.test.mjs   (from backend/)
 */
process.env.NODE_ENV = 'test';

const { serialize } = await import('../src/controllers/conversation.controller.js');

const results = [];
const check = (name, fn) => {
  try {
    fn();
    results.push(['PASS', name]);
  } catch (err) {
    results.push(['FAIL', name, err.message]);
  }
};
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

const ME = '000000000000000000000001';
const THEM = '000000000000000000000002';

const person = (id, name) => ({ _id: id, name, avatar: null, avatarColor: '#21C063', privacy: {} });

/** A direct conversation, as it comes back from Mongo after populate. */
const direct = ({ peerUser = person(THEM, 'Cara Peer'), mine = {} } = {}) => ({
  _id: 'c1',
  type: 'direct',
  lastMessageAt: new Date('2026-08-31T10:00:00Z'),
  seq: 4,
  participants: [
    { user: person(ME, 'Ana Caller'), role: 'member', ...mine },
    { user: peerUser, role: 'member' },
  ],
});

/* ── the peer that is no longer there ── */

check('a deleted peer leaves no peer, rather than an "Unknown" one', () => {
  // What populate actually gives for a reference to a deleted document.
  const out = serialize(direct({ peerUser: null }), ME);

  assert(out.peer === null, 'a peer was invented: ' + JSON.stringify(out.peer));
  /* The list drops direct conversations with no peer, and this null is the flag
     it reads. If serialize ever starts substituting a placeholder person here,
     the phantom rows come straight back. */
  assert(out.type === 'direct', 'the type changed');
});

check('a null participant is not counted or listed as a member', () => {
  const out = serialize(direct({ peerUser: null }), ME);

  assert(
    out.participants.length === 1,
    'listed ' + out.participants.length + ' members; the deleted one is still there'
  );
  assert(
    out.participants.every((p) => p.user && p.user._id),
    'a participant came back with no user — this is the shape that crashed the client'
  );
  assert(out.memberCount === 1, 'memberCount counted the deleted account: ' + out.memberCount);
});

check('every member list is safe to map over', () => {
  /* The five client components that render members all do `p.user._id`. This is
     the property they rely on, stated once. */
  const out = serialize(direct({ peerUser: null }), ME);
  const ids = out.participants.map((p) => String(p.user._id)); // must not throw
  assert(ids.length === 1, 'expected one id, got ' + ids.length);
});

check('a live peer is untouched', () => {
  const out = serialize(direct(), ME);

  assert(out.peer?.name === 'Cara Peer', 'the peer was lost: ' + JSON.stringify(out.peer));
  assert(out.name === 'Cara Peer', 'the name is ' + out.name);
  assert(out.participants.length === 2, 'dropped a live member');
  assert(out.memberCount === 2, 'memberCount is ' + out.memberCount);
});

/* ── deleting a chat ── */

check('a chat nobody has deleted is not marked deleted', () => {
  const out = serialize(direct(), ME);
  assert(out.deletedForMe === false, 'a fresh chat claims to be deleted');
});

check('deleting is recorded per person, not for the chat', () => {
  const mineDeleted = serialize(direct({ mine: { deletedAt: new Date() } }), ME);
  assert(mineDeleted.deletedForMe === true, 'my deletion was not recorded');

  /* The other person's copy is untouched — which is the whole point of holding
     this on the participant rather than on the conversation. */
  const theirView = serialize(direct({ mine: { deletedAt: new Date() } }), THEM);
  assert(
    theirView.deletedForMe === false,
    'deleting my copy of the chat deleted it for the other person too'
  );
});

check('deleting does not depend on comparing dates', () => {
  /* The reason `deletedAt` exists rather than reusing `clearedAt`: a
     conversation is created with `lastMessageAt` already set to now, so
     "cleared at or after the last message" is true for a chat that has just
     been opened and never used — and reopening a deleted chat would have stayed
     hidden while you sat in it. `deletedAt` says the thing directly. */
  const justCleared = serialize(
    direct({ mine: { clearedAt: new Date('2026-08-31T23:00:00Z') } }),
    ME
  );
  assert(
    justCleared.deletedForMe === false,
    'clearing the messages was mistaken for deleting the chat'
  );

  // Clearing still hides the preview, which is its own separate job.
  assert(justCleared.lastMessage === null, 'a cleared chat still shows its last line');
});

/* ── report ── */

const failed = results.filter(([r]) => r === 'FAIL');
results.forEach(([r, name, msg]) =>
  console.log(r === 'PASS' ? '  ok  ' + name : '  FAIL  ' + name + ' — ' + msg)
);
console.log(
  '\n' + (results.length - failed.length) + '/' + results.length + ' conversation checks passed'
);
process.exit(failed.length ? 1 : 0);
