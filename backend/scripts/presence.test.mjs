/**
 * Proves that "this device is watching the screen" expires.
 *
 * The bug it locks down is the silent one behind "notifications sometimes do
 * not arrive". Attentiveness used to be a set a device was removed from only
 * when it *said* it had gone away — so a phone that was force-quit, lost
 * signal, or had its tab frozen by the OS never said anything, stayed marked as
 * watching, and every message skipped its push until the socket finally timed
 * out. Nothing was logged and nothing failed; the notification simply never
 * came.
 *
 * Run: node scripts/presence.test.mjs   (from backend/)
 */
process.env.NODE_ENV = 'test';
/* A short window so the expiry can be observed in a test rather than in
   forty-five seconds of real time. */
process.env.PRESENCE_ATTENTIVE_TTL_MS = '300';

const { presence } = await import('../src/services/presence.js');

/* The real add() writes presence to Mongo, which this test has no need of —
   only the in-memory bookkeeping is under test. */
const USER = 'u1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

/* Stand in for a connected socket without touching the database. */
const connect = (deviceId) => {
  presence.setForeground(deviceId, true);
  // add() is async and hits Mongo; the maps it writes are all this needs.
  const online = presence.devicesOf(USER);
  return online;
};

await check('a device is only attentive once it says so', async () => {
  presence.setForeground('d-quiet', false);
  assert(!presence.isForeground('d-quiet'), 'a backgrounded device counted as attentive');
});

await check('reporting visible marks it attentive', async () => {
  presence.setForeground('d1', true);
  assert(presence.isForeground('d1'), 'a device that reported visible was not attentive');
});

await check('attentiveness expires when the reports stop', async () => {
  presence.setForeground('d2', true);
  assert(presence.isForeground('d2'), 'not attentive immediately after reporting');

  // The device vanishes — force-quit, lost signal, frozen tab. It says nothing.
  await sleep(450);

  assert(
    !presence.isForeground('d2'),
    'a silent device was still counted as watching the screen — it would be skipped for push'
  );
});

await check('a heartbeat keeps it attentive', async () => {
  presence.setForeground('d3', true);
  for (let i = 0; i < 4; i += 1) {
    await sleep(120);
    presence.setForeground('d3', true); // the client's periodic restatement
  }
  assert(presence.isForeground('d3'), 'a device beating regularly was demoted anyway');
});

await check('going background is immediate, not on a timer', async () => {
  presence.setForeground('d4', true);
  presence.setForeground('d4', false);
  assert(!presence.isForeground('d4'), 'a device that said it went away was still attentive');
});

await check('an unknown device is a push target, not a skipped one', async () => {
  assert(
    !presence.isForeground('never-seen'),
    'a device that has never reported was assumed to be watching — the safe default is the other way'
  );
});

const failed = results.filter(([s]) => s === 'FAIL');
console.log('');
for (const [status, name, message] of results) {
  console.log((status === 'PASS' ? '  ok   ' : '  FAIL ') + name + (message ? '\n         ' + message : ''));
}
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' presence checks passed\n');
process.exit(failed.length ? 1 : 0);
