'use client';

/**
 * On-device scam detection.
 *
 * UPI and OTP fraud costs people real money in India, and it arrives in chat.
 * This reads the decrypted text on the device, scores it, and says what it found.
 * Nothing is uploaded and no model is fetched — partly because that is the only
 * honest way to do it in an end-to-end encrypted app, and partly because a
 * server-side scanner would be a far more attractive target than the messages it
 * was meant to protect.
 *
 * ── The hard part is not detection, it is silence ──
 *
 * Legitimate messages contain OTPs constantly. "Your OTP is 428193" arrives from
 * a bank several times a week, and a guard that warned on every one of them
 * would be switched off inside a day — at which point it protects nobody. So the
 * distinction this makes is between *carrying* a code and *asking for* one:
 *
 *   "Your OTP is 428193"          → carries a code. Silent.
 *   "Send me the OTP you got"     → asks for one. Warn.
 *   forwarding the first message  → warn at the forward, not on receipt.
 *
 * The same logic governs everything else here. A signal only fires when it is
 * something a person would not send you innocently.
 *
 * ── Hinglish is not an afterthought ──
 *
 * Real scam messages in India are written in romanised Hindi as often as English
 * ("OTP bhejo", "paisa turant bhejo", "account band ho jayega"). Patterns that
 * only matched English would miss most of what actually circulates.
 */

/* ─────────────────────── who is worth impersonating ─────────────────────── */

/**
 * Brands scammers pose as, with the domains that are actually theirs.
 *
 * A starting set rather than an authority. The check it powers is deliberately
 * one-directional: a brand name appearing in a domain that is *not* on its list
 * is suspicious, but absence from this list is not a clean bill of health.
 */
const BRANDS = [
  { name: 'paytm', domains: ['paytm.com', 'paytmbank.com', 'paytmmall.com'] },
  { name: 'phonepe', domains: ['phonepe.com'] },
  { name: 'gpay', domains: ['pay.google.com', 'google.com'] },
  { name: 'googlepay', domains: ['pay.google.com', 'google.com'] },
  { name: 'bhim', domains: ['npci.org.in', 'bhimupi.org.in'] },
  { name: 'upi', domains: ['npci.org.in', 'bhimupi.org.in'] },
  { name: 'sbi', domains: ['onlinesbi.sbi', 'sbi.co.in', 'onlinesbi.com'] },
  { name: 'hdfc', domains: ['hdfcbank.com'] },
  { name: 'icici', domains: ['icicibank.com'] },
  { name: 'axis', domains: ['axisbank.com'] },
  { name: 'kotak', domains: ['kotak.com'] },
  { name: 'airtel', domains: ['airtel.in'] },
  { name: 'jio', domains: ['jio.com', 'jiofiber.com'] },
  { name: 'amazon', domains: ['amazon.in', 'amazon.com'] },
  { name: 'flipkart', domains: ['flipkart.com'] },
  { name: 'irctc', domains: ['irctc.co.in', 'indianrail.gov.in'] },
  { name: 'epfo', domains: ['epfindia.gov.in'] },
  { name: 'aadhaar', domains: ['uidai.gov.in'] },
  { name: 'uidai', domains: ['uidai.gov.in'] },
  { name: 'incometax', domains: ['incometax.gov.in'] },
  { name: 'nsdl', domains: ['nsdl.co.in'] },
];

/** Remote-access tools, which appear in almost every screen-sharing scam. */
const REMOTE_TOOLS =
  /\b(anydesk|teamviewer|quicksupport|screen\s?share|remote\s?desktop|airdroid|vysor)\b/i;

/* ────────────────────────────── the patterns ────────────────────────────── */

/**
 * Being asked to hand over a secret. The distinction from a message that merely
 * contains one is the whole design, so these all require a *request* verb.
 */
/* "code" alone is far too ordinary — "what is the code for the door" is not a
   scam. So a bare `code` only counts when something qualifies it as a one-time
   one; otp, pin and cvv are unambiguous and stand on their own. */
const SECRET_WORD = 'otp|o\\.t\\.p|one[\\s-]?time[\\s-]?password|pin|cvv';
const QUALIFIED_CODE =
  '(?:otp|verification|login|bank|sms|security|one[\\s-]?time)[\\s-]?(?:code|passcode|password)';
const RECEIVED_CODE = 'code[^.!?]{0,20}(?:you\\s+(?:got|received)|received|came|aaya|aayi|mila)';

const ASKS_FOR_SECRET = [
  new RegExp(
    '\\b(send|share|forward|give|tell|provide|bhejo|bhej|batao|de\\s?do|dedo)\\b[^.!?]{0,40}\\b(' +
      SECRET_WORD + '|' + QUALIFIED_CODE + ')\\b',
    'i'
  ),
  new RegExp(
    '\\b(' + SECRET_WORD + '|' + QUALIFIED_CODE +
      ')\\b[^.!?]{0,30}\\b(kya\\s?hai|bhejo|bhej\\s?do|batao|share\\s?karo|send\\s?karo)\\b',
    'i'
  ),
  new RegExp(
    "\\bwhat(?:'s| is)\\s+(?:the\\s+)?(" + SECRET_WORD + '|' + QUALIFIED_CODE + ')\\b',
    'i'
  ),
  new RegExp(
    '\\bread\\s+(?:me\\s+)?(?:the\\s+)?(' + SECRET_WORD + '|' + QUALIFIED_CODE + ')\\b',
    'i'
  ),
  // "send me the code you received" — qualified by provenance, not by name.
  new RegExp(
    '\\b(send|share|forward|bhejo|batao)\\b[^.!?]{0,20}\\b' + RECEIVED_CODE,
    'i'
  ),
];

/**
 * Urgency about an account, the standard opener for a phishing link.
 *
 * `[\s\S]` rather than `[^.!?]` throughout: a real scam text is three short
 * sentences ("Aapka account band ho jayega. KYC update karo turant."), and
 * stopping at the first full stop missed almost all of them. Precision comes
 * from requiring two specific tokens to co-occur, not from staying inside one
 * sentence.
 */
const KYC_URGENCY = [
  /\bkyc\b[\s\S]{0,60}\b(update|expire[sd]?|pending|complete|verify|band|block)\b/i,
  /\b(update|complete|verify)\b[\s\S]{0,30}\bkyc\b/i,
  /\baccount\b[\s\S]{0,40}\b(block(ed|ing)?|suspend(ed)?|deactivat(e|ed)|band\s?ho)\b/i,
  /\b(band|block)\s?ho\s?(jayega|jaega|jayegi)\b/i,
  /\b(pan|aadhaar|aadhar)\b[\s\S]{0,40}\b(link|update|verify|expire)\b/i,
  /\bwithin\s+\d+\s*(hours?|hrs?|minutes?|days?)\b[\s\S]{0,60}\b(account|kyc|block|suspend)\b/i,
];

/**
 * Being *asked* for money, which is not the same as money being mentioned.
 *
 * An earlier version matched any rupee amount and flagged "I paid the
 * electricity bill, ₹2400" — the kind of false positive that gets a guard
 * switched off. Every pattern here needs a request, and Hindi puts the verb last
 * ("paisa turant bhejo") so both word orders are covered.
 */
const MONEY_REQUEST = [
  /\b(send|transfer|pay|deposit|bhejo|bhej\s?do|transfer\s?karo)\b[\s\S]{0,40}(₹|rs\.?|inr|rupees?|paise?|paisa)\b/i,
  // Verb-last, as Hindi and Hinglish are written.
  /\b(paisa|paise|money|amount|fund|rupees?)\b[\s\S]{0,25}\b(bhejo|bhej\s?do|bhej|send\s?karo|transfer\s?karo|de\s?do|dedo)\b/i,
  /\b(urgent|emergency|turant|jaldi)\b[\s\S]{0,50}\b(money|paisa|paise|fund|amount|transfer|bhejo)\b/i,
  /\brefund\b[\s\S]{0,50}\b(upi|otp|pin|link|process)\b/i,
];

/**
 * "Scan this QR to receive money" — its own signal, because it is not a vague
 * request but a specific falsehood. Scanning a UPI QR code *sends* money; it can
 * never receive any. Anyone claiming otherwise is either confused or robbing you,
 * and explaining that mechanic is the single most useful thing this guard can
 * tell someone.
 */
const QR_RECEIVE_LIE = [
  /\bscan\b[\s\S]{0,30}\b(qr|code)\b[\s\S]{0,50}\b(receive|get|claim|refund|credit|cashback|prize)\b/i,
  /\b(receive|get|claim|refund|credit|cashback)\b[\s\S]{0,40}\bscan\b[\s\S]{0,20}\b(qr|code)\b/i,
];

/** A UPI handle. Not suspicious alone — plenty of legitimate ones circulate. */
const UPI_HANDLE =
  /\b[\w.\-]{2,}@(ybl|okaxis|okhdfcbank|okicici|oksbi|paytm|apl|ibl|axl|upi|yapl|jupiteraxis|fam)\b/i;

/** Prize and lottery bait. */
const PRIZE_BAIT = [
  /\b(you(?:'ve| have)?\s+won|congratulations|lucky\s?winner|jeet\s?gaye)\b[\s\S]{0,60}\b(prize|lottery|lucky\s?draw|draw|lakh|crore|cash|gift|reward|iphone)\b/i,
  /\b(lottery|lucky\s?draw)\b[\s\S]{0,40}\b(claim|winner|won|prize)\b/i,
];

/** Impersonating authority to create fear. */
const THREAT = [
  /\b(legal\s?action|police|court|arrest|fir|warrant)\b[\s\S]{0,60}\b(payment|pay|amount|settle|clear|fine)\b/i,
  /\b(fine|penalty|pay)\b[\s\S]{0,60}\b(legal\s?action|police|court|arrest|warrant)\b/i,
  /\b(cyber\s?crime|income\s?tax|customs|parcel)\b[\s\S]{0,60}\b(fine|penalty|clear|pay|seized?)\b/i,
];

/** A code that looks like an OTP, used for the forward warning. */
const CARRIES_OTP =
  /\b(otp|one[\s-]?time|verification|verify|code|passcode)\b[^.!?]{0,40}?\b(\d{4,8})\b|\b(\d{4,8})\b[^.!?]{0,25}\b(otp|is your|verification code)\b/i;

/* ───────────────────────────── link analysis ───────────────────────────── */

const URL_RE = /\bhttps?:\/\/[^\s<>"')]+|\bwww\.[^\s<>"')]+/gi;

/** Registrable-ish domain: the last two labels. Good enough to compare brands. */
const baseDomain = (host) => host.toLowerCase().split('.').slice(-2).join('.');

/**
 * Mixed-script hostnames are the homoglyph attack: one Cyrillic 'а' inside an
 * otherwise Latin word renders identically and resolves somewhere else entirely.
 */
function mixesScripts(host) {
  const latin = /[a-z]/i.test(host);
  const other = /[Ѐ-ӿͰ-ϿԀ-ԯⰀ-ⱟ]/.test(host);
  return latin && other;
}

export function inspectLink(raw) {
  let url;
  try {
    url = new URL(raw.startsWith('http') ? raw : 'https://' + raw);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase();
  const findings = [];

  /* The homoglyph check has to run on the raw text, not on url.hostname.
     new URL() applies IDNA and turns a Cyrillic 'а' into punycode, so by the
     time the hostname is parsed there is no Cyrillic left to find. */
  const rawHost = String(raw)
    .replace(/^[a-z]+:\/\//i, '')
    .split(/[/?#]/)[0]
    .toLowerCase();

  if (mixesScripts(rawHost)) {
    findings.push({
      code: 'mixed-script',
      weight: 4,
      detail: 'The address mixes alphabets, which is how a fake site looks identical to a real one.',
    });
  } else if (host.includes('xn--')) {
    // Only when it is not already reported as mixed script — same attack, and
    // the mixed-script wording explains it better.
    findings.push({
      code: 'punycode',
      weight: 3,
      detail: 'The address uses encoded characters that can imitate another site.',
    });
  }

  // A brand name in a domain that is not theirs.
  const base = baseDomain(host);
  for (const brand of BRANDS) {
    if (!host.includes(brand.name)) continue;
    const official = brand.domains.some((d) => host === d || host.endsWith('.' + d));
    if (!official) {
      findings.push({
        code: 'brand-lookalike',
        weight: 5,
        detail:
          'Mentions ' + brand.name + ' but the address is ' + base + ', not an official one.',
      });
      break;
    }
  }

  // Raw IP addresses, and credentials smuggled before an @.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    findings.push({ code: 'ip-host', weight: 3, detail: 'Links to a bare IP address rather than a name.' });
  }
  if (url.username) {
    findings.push({
      code: 'userinfo',
      weight: 4,
      detail: 'The address hides the real destination after an @ sign.',
    });
  }

  return { url: raw, host, findings };
}

/* ──────────────────────────────── scoring ──────────────────────────────── */

const match = (patterns, text) => patterns.some((re) => re.test(text));

/**
 * Assesses one message.
 *
 * `context` carries what the text alone cannot know: whether this is the first
 * time this person has messaged you, and whether they are a saved contact. Those
 * change the reading completely — "send me ₹5000" from your brother is a
 * Tuesday; from a stranger it is the most common scam there is.
 */
export function assess(text, context = {}) {
  const reasons = [];
  const body = String(text || '');
  if (!body.trim()) return { level: 'none', score: 0, reasons: [], links: [] };

  const { firstContact = false, isContact = false } = context;

  const add = (code, weight, detail) => reasons.push({ code, weight, detail });

  if (match(ASKS_FOR_SECRET, body)) {
    add(
      'asks-for-otp',
      6,
      'Asks you to share a code, OTP or PIN. No bank, company or government office ever does this.'
    );
  }

  if (match(KYC_URGENCY, body)) {
    /* Weighted to stand alone. No bank, telco or government office warns you
       about your KYC through a chat app, so this is not a signal that needs
       corroborating — it is the scam. */
    add(
      'kyc-urgency',
      6,
      'Threatens that an account will be blocked unless you act now. Real banks do not warn you this way.'
    );
  }

  if (match(MONEY_REQUEST, body)) {
    // From a stranger this is the whole scam; from a saved contact it is life.
    add(
      'money-request',
      firstContact ? 5 : isContact ? 1 : 3,
      firstContact
        ? 'Asks for money, and this is the first message you have had from them.'
        : 'Asks for money or a transfer.'
    );
  }

  /* Weighted to stand alone, on the same test as the two above: is there an
     innocent reason a person would send you this? For an unsolicited prize
     announcement or a threat of arrest over a payment, there is not. */
  if (match(PRIZE_BAIT, body)) {
    add(
      'prize-bait',
      6,
      'Claims you have won something. A prize you never entered for is not a prize.'
    );
  }

  if (match(THREAT, body)) {
    add(
      'threat',
      6,
      'Invokes police, courts or a fine to rush you into paying. Real agencies do not collect money over chat.'
    );
  }

  if (match(QR_RECEIVE_LIE, body)) {
    add(
      'qr-receive-lie',
      6,
      'Says you can scan a QR code to receive money. Scanning a UPI code only ever sends money — it cannot receive any.'
    );
  }

  if (REMOTE_TOOLS.test(body)) {
    /* Also weighted to stand alone. Being asked to install remote-access
       software is the single most damaging thing on this list, and warning a
       colleague doing genuine IT support once is a price worth paying. */
    add(
      'remote-access',
      6,
      'Mentions a screen-sharing or remote-access app. Installing one hands over your banking apps.'
    );
  }

  if (UPI_HANDLE.test(body) && (firstContact || match(MONEY_REQUEST, body))) {
    add('upi-handle', 2, 'Contains a UPI id to pay into.');
  }

  const links = (body.match(URL_RE) || []).map(inspectLink).filter(Boolean);
  for (const link of links) {
    for (const f of link.findings) add(f.code, f.weight, f.detail + ' (' + link.host + ')');
  }

  if (firstContact && reasons.length) {
    add('first-contact', 1, 'This is the first message you have received from this person.');
  }

  const score = reasons.reduce((n, r) => n + r.weight, 0);

  /* Two thresholds, not three grades of maybe. A warning people learn to
     dismiss is worse than none, so 'high' is reserved for combinations that are
     almost never innocent. */
  const level = score >= 6 ? 'high' : score >= 3 ? 'low' : 'none';

  return {
    level,
    score,
    // Loudest first — the reason shown is the one that matters most.
    reasons: reasons.sort((a, b) => b.weight - a.weight),
    links,
  };
}

/* ─────────────────────────── the forward check ─────────────────────────── */

/**
 * Whether forwarding this would leak a one-time code.
 *
 * Separate from `assess` because the risk runs the other way. Receiving "your
 * OTP is 428193" is normal and silent; passing it to someone who asked for it is
 * how the money leaves, and the moment to say so is at the forward.
 */
export function carriesSecret(text) {
  const body = String(text || '');
  const m = CARRIES_OTP.exec(body);
  if (!m) return null;

  const code = m[2] || m[3];
  return {
    code,
    // Never the full code — the warning should not be the thing that copies it.
    masked: code ? code.slice(0, 1) + '•'.repeat(Math.max(0, code.length - 1)) : null,
    reason:
      'This message contains what looks like a one-time code. Anyone who has it can get into your account.',
  };
}

export const BRAND_LIST = BRANDS.map((b) => b.name);
