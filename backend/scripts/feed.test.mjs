/**
 * Locks down the feed: what appears in a timeline, who is allowed to see it,
 * and the handful of actions that are pressed twice by accident every day.
 *
 * The cases worth having a test for are the ones that are quiet when they
 * break. A double-tapped heart must not count twice. A followers-only post must
 * not reach a stranger through Explore. Deleting a comment that has replies
 * must not take the replies with it. And an infinite scroll must never hand
 * back a row it has already shown, which is exactly what skip/limit does on a
 * list that is growing at the top.
 *
 * Boots the API in-process against the in-memory Mongo, so there is no server
 * to start and the run cannot touch a real database.
 *
 * Run: node scripts/feed.test.mjs   (from backend/)
 */
process.env.USE_MEMORY_DB = 'true';
process.env.NODE_ENV = 'test';
process.env.PORT = '0';
/* The repo's .env may hold real SMTP credentials and this run signs several
   people up. Blank the mailer before it is read, so codes go to the console
   rather than somebody's outbox. */
process.env.SMTP_HOST = '';
process.env.SMTP_USER = '';
process.env.SMTP_PASS = '';

import http from 'node:http';

/* ── capture verification codes before anything can print them ── */

const codes = new Map();
const { logger } = await import('../src/utils/logger.js');
logger.info = (message) => {
  const m = /code for (\S+) → (\d{6})/.exec(String(message));
  if (m) codes.set(m[1], m[2]);
};
logger.socket = () => {};

const { connectDB, disconnectDB } = await import('../src/config/db.js');
const { createApp } = await import('../src/app.js');

await connectDB();

const server = http.createServer(createApp());
await new Promise((resolve) => server.listen(0, resolve));
const API = 'http://127.0.0.1:' + server.address().port + '/api';

/* ── crypto, only as much as verify-email demands ── */

const subtle = globalThis.crypto.subtle;
const CURVE = { name: 'ECDH', namedCurve: 'P-256' };
const SIGN_CURVE = { name: 'ECDSA', namedCurve: 'P-256' };
const toB64 = (b) => Buffer.from(b instanceof Uint8Array ? b : new Uint8Array(b)).toString('base64');
const rand = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));
const expPub = async (k) => toB64(await subtle.exportKey('raw', k));

async function keyBundle() {
  const identity = await subtle.generateKey(CURVE, true, ['deriveBits']);
  const signing = await subtle.generateKey(SIGN_CURVE, true, ['sign', 'verify']);
  const preKey = await subtle.generateKey(CURVE, true, ['deriveBits']);
  const prePub = await expPub(preKey.publicKey);

  const signature = toB64(
    await subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      signing.privateKey,
      new Uint8Array(Buffer.from(prePub, 'base64'))
    )
  );

  const account = {
    identityPublicKey: await expPub(identity.publicKey),
    signingPublicKey: await expPub(signing.publicKey),
    encryptedIdentity: {
      ciphertext: toB64(rand(96)),
      iv: toB64(rand(12)),
      salt: toB64(rand(16)),
      iterations: 250000,
    },
  };

  const device = {
    registrationId: Math.floor(Math.random() * 16000) + 1,
    identityPublicKey: await expPub(identity.publicKey),
    signingPublicKey: await expPub(signing.publicKey),
    signedPreKey: { keyId: 1, publicKey: prePub, signature },
  };

  return { account, device };
}

/* ── talking to the API ── */

async function call(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(method + ' ' + path + ' → ' + res.status + ' ' + (data.message || ''));
  }
  return data;
}

let seq = 0;
async function signUp(name) {
  seq += 1;
  const email = 'feed' + seq + '.' + Date.now().toString(36) + '@example.com';
  await call('/auth/register', {
    method: 'POST',
    body: { email, name, password: 'correct horse battery' },
  });

  const code = codes.get(email);
  if (!code) throw new Error('no verification code captured for ' + email);

  const data = await call('/auth/verify-email', {
    method: 'POST',
    body: { email, code, keys: await keyBundle(), device: { platform: 'web' } },
  });

  return { name, email, id: String(data.user._id), token: data.accessToken };
}

/* ── harness ── */

const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push(['PASS', name]);
  } catch (err) {
    results.push(['FAIL', name, err.message]);
  }
};
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

const post = (author, body) => call('/posts', { method: 'POST', body, token: author.token });
const feedOf = (person, query = '') =>
  call('/posts/feed' + query, { token: person.token }).then((d) => d.posts);
const ids = (posts) => posts.map((p) => p._id);

/* ── cases ── */

const [author, reader, stranger] = await Promise.all([
  signUp('Ada'),
  signUp('Grace'),
  signUp('Alan'),
]);

await check('follow puts an author in the reader timeline', async () => {
  await call('/follows/' + author.id, { method: 'POST', token: reader.token });
  const { post: created } = await post(author, { text: 'first post #hello', audience: 'public' });

  const seen = await feedOf(reader);
  assert(ids(seen).includes(created._id), 'follower does not see the post');
  assert(created.hashtags.includes('hello'), 'hashtag was not extracted: ' + created.hashtags);
});

await check('a stranger who follows nobody gets the discover fallback', async () => {
  const { discover, posts } = await call('/posts/feed', { token: stranger.token });
  assert(discover === true, 'expected discover:true for an account following nobody');
  assert(posts.length > 0, 'discover fallback returned nothing');
});

await check('posting does not empty a feed that was in discover mode', async () => {
  /* The regression this locks down: discover used to fire only when the feed
     query returned nothing, so a new account's first post made the result set
     non-empty and the feed collapsed to that single post. */
  const newcomer = await signUp('Mae');

  const before = await call('/posts/feed', { token: newcomer.token });
  assert(before.discover === true, 'a fresh account was not put into discover');
  assert(before.posts.length >= 1, 'discover showed nothing at all');

  await post(newcomer, { text: 'my very first post', audience: 'public' });

  const after = await call('/posts/feed', { token: newcomer.token });
  assert(after.discover === true, 'discover switched off merely because they posted');
  assert(
    after.posts.length >= before.posts.length,
    'posting shrank the feed from ' + before.posts.length + ' to ' + after.posts.length
  );
  assert(
    after.posts.some((p) => p.author._id !== newcomer.id),
    'the feed now contains nothing but their own post'
  );
});

await check('following someone leaves discover mode', async () => {
  const newcomer = await signUp('Katsuko');

  const before = await call('/posts/feed', { token: newcomer.token });
  assert(before.discover === true, 'expected discover before following anyone');

  await call('/follows/' + author.id, { method: 'POST', token: newcomer.token });

  const after = await call('/posts/feed', { token: newcomer.token });
  assert(after.discover === false, 'still in discover after following somebody');
  assert(
    after.posts.every((p) => p.author._id === author.id || p.author._id === newcomer.id),
    'a real timeline is showing posts from people who are not followed'
  );
});

await check('followers-only stays out of a stranger reach', async () => {
  const { post: restricted } = await post(author, {
    text: 'just for followers',
    audience: 'followers',
  });

  const strangerFeed = await feedOf(stranger);
  assert(!ids(strangerFeed).includes(restricted._id), 'a non-follower saw a followers-only post');

  const explore = await call('/posts/explore', { token: stranger.token });
  assert(
    !ids(explore.posts).includes(restricted._id),
    'a followers-only post surfaced in Explore'
  );

  const readerFeed = await feedOf(reader);
  assert(ids(readerFeed).includes(restricted._id), 'an actual follower could not see it');
});

await check('a followers-only post is absent from a stranger profile view', async () => {
  const { posts } = await call('/posts/user/' + author.id, { token: stranger.token });
  assert(
    posts.every((p) => p.audience === 'public'),
    'restricted posts leaked through the profile grid'
  );
});

await check('liking twice counts once', async () => {
  const { post: target } = await post(author, { text: 'like me', audience: 'public' });

  await call('/posts/' + target._id + '/like', { method: 'POST', token: reader.token });
  await call('/posts/' + target._id + '/like', { method: 'POST', token: reader.token });

  const { post: after } = await call('/posts/' + target._id, { token: reader.token });
  assert(after.likeCount === 1, 'double like produced likeCount=' + after.likeCount);
  assert(after.liked === true, 'the liker is not marked as having liked it');

  await call('/posts/' + target._id + '/like', { method: 'DELETE', token: reader.token });
  const { post: unliked } = await call('/posts/' + target._id, { token: reader.token });
  assert(unliked.likeCount === 0, 'unlike left likeCount=' + unliked.likeCount);
  assert(unliked.liked === false, 'still marked as liked after unlike');

  // Unliking again must not take the counter negative.
  await call('/posts/' + target._id + '/like', { method: 'DELETE', token: reader.token });
  const { post: twice } = await call('/posts/' + target._id, { token: reader.token });
  assert(twice.likeCount === 0, 'a second unlike moved the count to ' + twice.likeCount);
});

await check('saving is private and idempotent', async () => {
  const { post: target } = await post(author, { text: 'save me', audience: 'public' });

  await call('/posts/' + target._id + '/save', { method: 'POST', token: reader.token });
  await call('/posts/' + target._id + '/save', { method: 'POST', token: reader.token });

  const mine = await call('/posts/saved', { token: reader.token });
  assert(ids(mine.posts).filter((id) => id === target._id).length === 1, 'saved twice');

  const theirs = await call('/posts/saved', { token: stranger.token });
  assert(!ids(theirs.posts).includes(target._id), 'somebody else can read my saves');

  await call('/posts/' + target._id + '/save', { method: 'DELETE', token: reader.token });
  const after = await call('/posts/saved', { token: reader.token });
  assert(!ids(after.posts).includes(target._id), 'unsave left the post in the list');
});

await check('the like counter matches the likers list', async () => {
  const { post: target } = await post(author, { text: 'who liked this', audience: 'public' });
  await call('/posts/' + target._id + '/like', { method: 'POST', token: reader.token });
  await call('/posts/' + target._id + '/like', { method: 'POST', token: stranger.token });

  const { users } = await call('/posts/' + target._id + '/likes', { token: author.token });
  assert(users.length === 2, 'expected 2 likers, got ' + users.length);

  const { post: after } = await call('/posts/' + target._id, { token: author.token });
  assert(after.likeCount === 2, 'counter says ' + after.likeCount + ' but 2 people liked it');
});

await check('comments thread one level deep and keep their counts', async () => {
  const { post: target } = await post(author, { text: 'discuss', audience: 'public' });
  const url = '/posts/' + target._id + '/comments';

  const { comment: top } = await call(url, {
    method: 'POST',
    body: { text: 'top level' },
    token: reader.token,
  });
  const { comment: reply } = await call(url, {
    method: 'POST',
    body: { text: 'a reply', parent: top._id },
    token: stranger.token,
  });
  // A reply to a reply attaches to their shared root, not to the reply.
  const { comment: deep } = await call(url, {
    method: 'POST',
    body: { text: 'reply to the reply', parent: reply._id },
    token: author.token,
  });
  assert(deep.parent === top._id, 'nesting went deeper than one level');

  const { comments } = await call(url, { token: reader.token });
  const root = comments.find((c) => c._id === top._id);
  assert(root, 'the top-level comment is missing from the list');
  assert(root.replyCount === 2, 'replyCount is ' + root.replyCount + ', expected 2');
  assert(root.replies.length === 2, 'expected 2 preview replies, got ' + root.replies.length);

  const { post: after } = await call('/posts/' + target._id, { token: reader.token });
  assert(after.commentCount === 3, 'commentCount is ' + after.commentCount + ', expected 3');
});

await check('deleting a comment with replies keeps the thread standing', async () => {
  const { post: target } = await post(author, { text: 'thread', audience: 'public' });
  const url = '/posts/' + target._id + '/comments';

  const { comment: top } = await call(url, {
    method: 'POST',
    body: { text: 'will be deleted' },
    token: reader.token,
  });
  await call(url, { method: 'POST', body: { text: 'survivor', parent: top._id }, token: author.token });

  await call('/posts/comments/' + top._id, { method: 'DELETE', token: reader.token });

  const { comments } = await call(url, { token: reader.token });
  const tomb = comments.find((c) => c._id === top._id);
  assert(tomb, 'the root vanished and orphaned its reply');
  assert(tomb.deleted === true, 'the root is not marked deleted');
  assert(tomb.text === '', 'deleted comment still carries its text');
  assert(tomb.replies.length === 1, 'the reply was lost with its parent');
});

await check('a post author can clear a comment on their own post', async () => {
  const { post: target } = await post(author, { text: 'my space', audience: 'public' });
  const url = '/posts/' + target._id + '/comments';

  const { comment } = await call(url, {
    method: 'POST',
    body: { text: 'not mine to keep' },
    token: reader.token,
  });
  await call('/posts/comments/' + comment._id, { method: 'DELETE', token: author.token });

  const { comments } = await call(url, { token: author.token });
  assert(!comments.some((c) => c._id === comment._id), 'the author could not moderate their post');
});

await check('a stranger cannot delete somebody else comment', async () => {
  const { post: target } = await post(author, { text: 'hands off', audience: 'public' });
  const url = '/posts/' + target._id + '/comments';
  const { comment } = await call(url, {
    method: 'POST',
    body: { text: 'mine' },
    token: reader.token,
  });

  let blocked = false;
  try {
    await call('/posts/comments/' + comment._id, { method: 'DELETE', token: stranger.token });
  } catch {
    blocked = true;
  }
  assert(blocked, 'a third party deleted a comment that was not theirs');
});

await check('comments off is enforced by the server, not just hidden', async () => {
  const { post: closed } = await post(author, {
    text: 'no replies please',
    audience: 'public',
    commentsDisabled: true,
  });

  let refused = false;
  try {
    await call('/posts/' + closed._id + '/comments', {
      method: 'POST',
      body: { text: 'sneaking in' },
      token: reader.token,
    });
  } catch {
    refused = true;
  }
  assert(refused, 'a comment landed on a post with comments turned off');
});

await check('reposting boosts the original and can be undone', async () => {
  const { post: original } = await post(author, { text: 'worth sharing', audience: 'public' });

  const { post: boost } = await post(reader, { repostOf: original._id });
  assert(boost.repostOf?._id === original._id, 'the repost does not point at the original');

  const { post: afterBoost } = await call('/posts/' + original._id, { token: author.token });
  assert(afterBoost.repostCount === 1, 'repostCount is ' + afterBoost.repostCount);
  assert(afterBoost.reposted === false, 'the author is wrongly marked as having reposted');

  const { post: fromReader } = await call('/posts/' + original._id, { token: reader.token });
  assert(fromReader.reposted === true, 'the reposter is not marked as having reposted');

  // Boosting a boost must credit the original, not the wrapper.
  const { post: chained } = await post(stranger, { repostOf: boost._id });
  assert(chained.repostOf?._id === original._id, 'a repost chain formed');

  await call('/posts/' + original._id + '/repost', { method: 'DELETE', token: reader.token });
  const { post: afterUndo } = await call('/posts/' + original._id, { token: reader.token });
  assert(afterUndo.reposted === false, 'undo left the repost in place');
  assert(afterUndo.repostCount === 1, 'repostCount is ' + afterUndo.repostCount + ', expected 1');
});

await check('hidden counts hide from readers but not from the author', async () => {
  const { post: quiet } = await post(author, {
    text: 'counting is off',
    audience: 'public',
    hideCounts: true,
  });
  await call('/posts/' + quiet._id + '/like', { method: 'POST', token: reader.token });

  const { post: asReader } = await call('/posts/' + quiet._id, { token: reader.token });
  assert(asReader.likeCount === null, 'the like count leaked to a reader');
  assert(asReader.liked === true, 'the reader own like state was hidden too');

  const { post: asAuthor } = await call('/posts/' + quiet._id, { token: author.token });
  assert(asAuthor.likeCount === 1, 'the author cannot see their own count');
});

await check('paging never repeats a row, even while the feed grows', async () => {
  const poster = await signUp('Barbara');
  const follower = await signUp('Katherine');
  await call('/follows/' + poster.id, { method: 'POST', token: follower.token });

  // Sequential, so createdAt is strictly ordered and the cursor has real work.
  for (let i = 0; i < 9; i += 1) {
    await post(poster, { text: 'row ' + i, audience: 'public' });
  }

  const first = await call('/posts/feed?limit=4', { token: follower.token });
  assert(first.posts.length === 4, 'first page had ' + first.posts.length + ' rows');
  assert(first.nextCursor, 'no cursor came back with a full page');

  /* The whole point of a keyset cursor: something new arriving at the top
     between two requests must not shift the second page. */
  const { post: latecomer } = await post(poster, {
    text: 'arrived mid-scroll',
    audience: 'public',
  });

  const second = await call('/posts/feed?limit=4&cursor=' + encodeURIComponent(first.nextCursor), {
    token: follower.token,
  });
  const overlap = ids(second.posts).filter((id) => ids(first.posts).includes(id));
  assert(overlap.length === 0, 'page 2 repeated ' + overlap.length + ' row(s) from page 1');

  const third = await call('/posts/feed?limit=4&cursor=' + encodeURIComponent(second.nextCursor), {
    token: follower.token,
  });
  const all = [...ids(first.posts), ...ids(second.posts), ...ids(third.posts)];
  assert(new Set(all).size === all.length, 'a row appeared on two pages');
  /* Nine, not ten: the post that arrived mid-scroll belongs at the top of a
     refreshed feed, not spliced into a page the reader has already passed. */
  assert(all.length === 9, 'walked ' + all.length + ' rows, expected the 9 that existed');
  assert(
    !all.includes(latecomer._id),
    'a post created after page 1 was spliced into a later page'
  );
});

await check('a garbled cursor is ignored rather than fatal', async () => {
  const { posts } = await call('/posts/feed?cursor=not-a-real-cursor', { token: reader.token });
  assert(Array.isArray(posts), 'a bad cursor broke the feed');
});

await check('deleting a post takes it out of every list', async () => {
  const { post: doomed } = await post(author, { text: 'temporary', audience: 'public' });
  await call('/posts/' + doomed._id + '/save', { method: 'POST', token: reader.token });
  await call('/posts/' + doomed._id, { method: 'DELETE', token: author.token });

  const feed = await feedOf(reader);
  assert(!ids(feed).includes(doomed._id), 'a deleted post is still in the timeline');

  const saved = await call('/posts/saved', { token: reader.token });
  assert(!ids(saved.posts).includes(doomed._id), 'a deleted post is still in saved');

  let gone = false;
  try {
    await call('/posts/' + doomed._id, { token: reader.token });
  } catch {
    gone = true;
  }
  assert(gone, 'a deleted post is still readable by id');
});

await check('only the author can delete or edit a post', async () => {
  const { post: target } = await post(author, { text: 'mine alone', audience: 'public' });

  let refusedDelete = false;
  try {
    await call('/posts/' + target._id, { method: 'DELETE', token: stranger.token });
  } catch {
    refusedDelete = true;
  }
  assert(refusedDelete, 'somebody else deleted the post');

  let refusedEdit = false;
  try {
    await call('/posts/' + target._id, {
      method: 'PATCH',
      body: { text: 'rewritten by a stranger' },
      token: stranger.token,
    });
  } catch {
    refusedEdit = true;
  }
  assert(refusedEdit, 'somebody else edited the post');
});

await check('editing stamps editedAt and re-derives hashtags', async () => {
  const { post: target } = await post(author, { text: 'before #old', audience: 'public' });
  const { post: edited } = await call('/posts/' + target._id, {
    method: 'PATCH',
    body: { text: 'after #fresh' },
    token: author.token,
  });

  assert(edited.editedAt, 'an edit did not record editedAt');
  assert(edited.hashtags.includes('fresh'), 'the new hashtag was not picked up');
  assert(!edited.hashtags.includes('old'), 'the old hashtag survived the edit');
});

await check('only one post stays pinned', async () => {
  const { post: a } = await post(author, { text: 'pin a', audience: 'public' });
  const { post: b } = await post(author, { text: 'pin b', audience: 'public' });

  await call('/posts/' + a._id, { method: 'PATCH', body: { pinned: true }, token: author.token });
  await call('/posts/' + b._id, { method: 'PATCH', body: { pinned: true }, token: author.token });

  const { posts } = await call('/posts/user/' + author.id + '?limit=48', { token: author.token });
  const pinned = posts.filter((p) => p.pinned);
  assert(pinned.length === 1, pinned.length + ' posts are pinned at once');
  assert(pinned[0]._id === b._id, 'the wrong post is pinned');
});

await check('an empty post is refused', async () => {
  let refused = false;
  try {
    await post(author, { text: '   ' });
  } catch {
    refused = true;
  }
  assert(refused, 'a post with no text and no media was accepted');
});

await check('explore leaves your own posts out', async () => {
  const { posts } = await call('/posts/explore', { token: author.token });
  assert(
    posts.every((p) => p.author._id !== author.id),
    'Explore is showing me my own posts'
  );
});

await check('hashtag search finds a tagged post', async () => {
  await post(author, { text: 'tagged with #unmistakable', audience: 'public' });
  const { posts } = await call('/posts/explore?q=' + encodeURIComponent('#unmistakable'), {
    token: reader.token,
  });
  assert(posts.length > 0, 'hashtag search came back empty');
});

await check('trending counts the tags that were used', async () => {
  const { tags } = await call('/posts/trending', { token: reader.token });
  assert(Array.isArray(tags), 'trending did not return a list');
  assert(tags.some((t) => t.tag === 'unmistakable'), 'a used tag is missing from trending');
});

await check('follow state and counts survive a round trip', async () => {
  const { profile } = await call('/posts/user/' + author.id, { token: reader.token });
  assert(profile.isFollowing === true, 'the reader follow is not reflected on the profile');
  assert(profile.followerCount >= 1, 'followerCount is ' + profile.followerCount);
  assert(profile.postCount > 0, 'postCount is ' + profile.postCount);

  await call('/follows/' + author.id, { method: 'DELETE', token: reader.token });
  const { profile: after } = await call('/posts/user/' + author.id, { token: reader.token });
  assert(after.isFollowing === false, 'unfollow did not stick');

  await call('/follows/' + author.id, { method: 'POST', token: reader.token });
});

await check('following yourself is refused', async () => {
  let refused = false;
  try {
    await call('/follows/' + author.id, { method: 'POST', token: author.token });
  } catch {
    refused = true;
  }
  assert(refused, 'an account followed itself');
});

await check('suggestions never include yourself or people you already follow', async () => {
  const { users } = await call('/follows/suggestions', { token: reader.token });
  assert(!users.some((u) => u._id === reader.id), 'suggested myself');
  assert(!users.some((u) => u._id === author.id), 'suggested somebody I already follow');
  assert(users.every((u) => u.reason), 'a suggestion arrived without a reason');
});

/* ── report ── */

const failed = results.filter(([status]) => status === 'FAIL');
console.log('');
for (const [status, name, message] of results) {
  console.log(
    (status === 'PASS' ? '  ok   ' : '  FAIL ') + name + (message ? '\n         ' + message : '')
  );
}
console.log(
  '\n' + (results.length - failed.length) + '/' + results.length + ' feed checks passed\n'
);

await new Promise((resolve) => server.close(resolve));
await disconnectDB();
process.exit(failed.length ? 1 : 0);
