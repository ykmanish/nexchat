/**
 * Tests the on-device scam guard.
 *
 * The suite is deliberately lopsided: far more cases assert *silence* than
 * assert a warning. That is the actual design risk. A guard that flags the OTP
 * your bank just sent you gets switched off within a day, and a switched-off
 * guard protects nobody — so every ordinary message that trips it is a worse bug
 * than a scam it misses.
 *
 * Run: node scripts/scamguard.test.mjs   (from frontend/)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/* No imports in the module under test, so a plain copy loads in Node. */
const shim = path.join(os.tmpdir(), 'scamguard.undertest.mjs');
fs.writeFileSync(shim, fs.readFileSync(path.resolve('src/lib/scamguard.js'), 'utf8'));
const guard = await import('file://' + shim.replace(/\\/g, '/'));

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

const level = (text, ctx = {}) => guard.assess(text, ctx).level;
const codesFor = (text, ctx = {}) => guard.assess(text, ctx).reasons.map((r) => r.code);

/* ─────────────────── silence: the cases that must not warn ─────────────────── */

const MUST_BE_SILENT = [
  // The single most important one. Banks send these constantly.
  'Your OTP is 428193. Do not share it with anyone.',
  '428193 is your verification code for Chax.',
  'Use OTP 774512 to log in. Valid for 10 minutes.',
  // Ordinary uses of words the patterns care about.
  'what is the code for the door?',
  'I forgot the wifi password, can you tell me?',
  'The pin on the map is wrong, it is two streets over.',
  'My PIN code is 380015',
  // Ordinary money talk between people who know each other.
  'can you send me 500 for the movie tickets',
  'I paid the electricity bill, ₹2400',
  'split the dinner bill? came to ₹1800 for four of us',
  // Ordinary links, including a real brand.
  'order shipped, track it at https://amazon.in/orders/123',
  'here is the paytm link https://paytm.com/offers',
  'https://github.com/ykmanish/nexchat have a look',
  // Everyday chat.
  'running late, be there in 20',
  'did you watch the match last night',
  '',
  'ok',
];

check('ordinary messages stay silent', () => {
  const noisy = MUST_BE_SILENT.filter((t) => level(t) !== 'none');
  assert(
    noisy.length === 0,
    'false positives on:\n        ' +
      noisy.map((t) => JSON.stringify(t) + ' -> ' + level(t)).join('\n        ')
  );
});

check('a received OTP is silent even from a first contact', () => {
  // Banks and services are always a first contact. Warning here would make the
  // guard fire on almost every genuine OTP anyone ever receives.
  assert(
    level('Your OTP is 428193. Do not share.', { firstContact: true }) === 'none',
    'warned on a genuine OTP from an unknown sender'
  );
});

check('money talk with a saved contact stays quiet', () => {
  assert(
    level('send me ₹5000 please, urgent', { isContact: true }) !== 'high',
    'shouted at a saved contact asking for money'
  );
});

/* ───────────────────── detection: the cases that must warn ───────────────────── */

const MUST_WARN_HIGH = [
  'Send me the OTP you received just now',
  'share the otp fast',
  'OTP bhejo jaldi, main verify kar raha hoon',
  'what is the OTP?',
  'Your KYC has expired. Account will be blocked in 24 hours. Update at http://paytm-kyc.xyz',
  'Aapka account band ho jayega. KYC update karo turant.',
  'Congratulations! You have won ₹10,00,000 in the lucky draw. Claim your prize now.',
  'Install AnyDesk and share your screen so I can process the refund',
  'This is cyber crime department. Pay the fine or legal action will be taken.',
  'Scan this QR code to receive your refund of ₹4500',
];

check('known scam patterns are flagged high', () => {
  const missed = MUST_WARN_HIGH.filter((t) => level(t) !== 'high');
  assert(
    missed.length === 0,
    'missed:\n        ' + missed.map((t) => JSON.stringify(t) + ' -> ' + level(t)).join('\n        ')
  );
});

check('asking for a secret is the strongest single signal', () => {
  assert(codesFor('please share your otp').includes('asks-for-otp'), 'asks-for-otp not raised');
  assert(level('please share your otp') === 'high', 'a bare OTP request should be high');
});

check('Hinglish is handled, not just English', () => {
  const hinglish = [
    'otp bhej do',
    'paisa turant bhejo',
    'account band ho jayega kyc karo',
  ];
  const silent = hinglish.filter((t) => level(t) === 'none');
  assert(silent.length === 0, 'silent on Hinglish: ' + JSON.stringify(silent));
});

check('the QR lie is explained, not just flagged', () => {
  const r = guard.assess('Scan this QR code to receive your refund of 4500', {});
  const qr = r.reasons.find((x) => x.code === 'qr-receive-lie');
  assert(qr, 'the QR-receive claim was not flagged');
  // The mechanic is the useful part: scanning sends, it never receives.
  assert(/only ever sends|cannot receive/i.test(qr.detail), 'did not explain why it is a lie');
});

check('remote-access tools are called out', () => {
  const codes = codesFor('download teamviewer and give me the id');
  assert(codes.includes('remote-access'), 'did not flag a remote-access tool');
});

/* ─────────────────────────── context changes the reading ─────────────────────────── */

check('the same money request reads differently by relationship', () => {
  const text = 'urgent, please transfer ₹8000 now';

  const stranger = guard.assess(text, { firstContact: true });
  const friend = guard.assess(text, { isContact: true });

  assert(stranger.score > friend.score, 'a stranger asking for money should score higher');
  assert(stranger.level === 'high', 'first contact asking for money should be high');
  assert(
    stranger.reasons.some((r) => r.code === 'first-contact'),
    'the first-contact reason was not attached'
  );
});

check('reasons are ordered loudest first and explain themselves', () => {
  const r = guard.assess('Your KYC expired, send OTP to unblock at http://sbi-verify.top', {});
  assert(r.reasons.length >= 2, 'expected several reasons');
  for (let i = 1; i < r.reasons.length; i += 1) {
    assert(r.reasons[i - 1].weight >= r.reasons[i].weight, 'reasons are not sorted by weight');
  }
  for (const reason of r.reasons) {
    assert(reason.detail && reason.detail.length > 15, reason.code + ' has no readable detail');
  }
});

/* ──────────────────────────────── links ──────────────────────────────── */

check('an official brand domain is clean', () => {
  for (const url of ['https://paytm.com/x', 'https://www.amazon.in/y', 'https://onlinesbi.sbi/']) {
    const r = guard.inspectLink(url);
    assert(r && r.findings.length === 0, url + ' was flagged: ' + JSON.stringify(r?.findings));
  }
});

check('a brand name on somebody else\'s domain is flagged', () => {
  const r = guard.inspectLink('http://paytm-kyc.xyz/update');
  assert(r.findings.some((f) => f.code === 'brand-lookalike'), 'lookalike not caught');
  assert(r.findings[0].detail.includes('paytm-kyc.xyz'), 'the real host was not named');
});

check('punycode and mixed scripts are flagged', () => {
  assert(
    guard.inspectLink('https://xn--pytm-9wa.com/').findings.some((f) => f.code === 'punycode'),
    'punycode not caught'
  );
  // Cyrillic 'а' inside an otherwise Latin host.
  assert(
    guard.inspectLink('https://pаytm.com/').findings.some((f) => f.code === 'mixed-script'),
    'homoglyph host not caught'
  );
});

check('bare IPs and userinfo tricks are flagged', () => {
  assert(
    guard.inspectLink('http://192.168.4.9/pay').findings.some((f) => f.code === 'ip-host'),
    'IP host not caught'
  );
  assert(
    guard.inspectLink('https://paytm.com@evil.example/').findings.some((f) => f.code === 'userinfo'),
    'userinfo trick not caught'
  );
});

check('unparseable text is not mistaken for a link', () => {
  assert(guard.inspectLink('not a url at all') === null, 'accepted nonsense as a URL');
});

/* ─────────────────────── forwarding a one-time code ─────────────────────── */

check('a message carrying an OTP is caught at the forward', () => {
  const hit = guard.carriesSecret('Your OTP is 428193. Do not share.');
  assert(hit, 'did not notice an OTP in the body');
  assert(hit.code === '428193', 'wrong code extracted: ' + hit.code);
});

check('the warning does not reprint the code', () => {
  const hit = guard.carriesSecret('774512 is your verification code');
  assert(hit.masked && !hit.masked.includes('74512'), 'the mask leaks the code: ' + hit.masked);
  assert(hit.masked.length === hit.code.length, 'mask length should match');
});

check('ordinary messages carry no secret', () => {
  for (const t of ['see you at 5', 'my number is 9876543210', 'the bill was 4500']) {
    assert(guard.carriesSecret(t) === null, 'false positive on: ' + t);
  }
});

check('receiving is silent while forwarding warns — the whole point', () => {
  const text = 'Your OTP is 428193';
  assert(level(text) === 'none', 'warned on receiving a genuine OTP');
  assert(guard.carriesSecret(text) !== null, 'failed to warn at the forward');
});

/* ───────────────────────────── report ───────────────────────────── */

for (const [state, name, why] of results) {
  console.log(`${state}  ${name}${why ? '\n        ↳ ' + why : ''}`);
}
const failed = results.filter(([s]) => s === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} passed`);
fs.unlinkSync(shim);
process.exit(failed ? 1 : 0);
