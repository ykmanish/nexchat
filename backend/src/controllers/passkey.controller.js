import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { UAParser } from 'ua-parser-js';
import { Passkey, WebAuthnChallenge, User } from '../models/index.js';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { randomToken } from '../utils/ids.js';
import { logger } from '../utils/logger.js';

/**
 * Passkey sign-in for the account.
 *
 * Unlike the app lock, which verifies WebAuthn in the browser because there is
 * no server in that loop, everything here is checked against a challenge this
 * server issued and stored. The challenge is single-use and short-lived; a
 * client allowed to choose or replay its own challenge would make the whole
 * exercise decorative.
 *
 * What a passkey does *not* do by itself is decrypt history. The identity key is
 * wrapped under the account password, so a brand-new device needs that password
 * once — unless the authenticator supports the PRF extension, in which case
 * enrolment also stores a copy of the identity wrapped under a secret only that
 * authenticator can reproduce, and the password is never needed again.
 */

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const TICKET_TTL_MS = 5 * 60 * 1000;
const RP_NAME = env.appName || 'Chax';

/**
 * A fixed salt for the PRF evaluation. It only has to be stable and distinct
 * from any other use of the same authenticator — it is not a secret, and the
 * derived output never leaves the browser.
 */
export const PRF_SALT = Buffer.from('chax:identity-wrap:v1').toString('base64url');

/**
 * The Relying Party id is the registrable domain, and it has to match what the
 * browser computed or verification fails. Derived from the configured client
 * URL rather than from the request, because an attacker controls Host.
 */
function relyingParty() {
  const origins = env.clientUrl
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const hosts = origins
    .map((o) => {
      try {
        return new URL(o).hostname;
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  return { id: hosts[0] || 'localhost', origins };
}

/** Origins an assertion may come from. In dev the client's port moves around. */
function expectedOrigins(req) {
  const { origins } = relyingParty();
  if (env.isProd) return origins;
  const incoming = req.headers.origin;
  return incoming ? [...new Set([...origins, incoming])] : origins;
}

function expectedRpId(req) {
  const { id } = relyingParty();
  if (env.isProd) return id;
  try {
    return req.headers.origin ? new URL(req.headers.origin).hostname : id;
  } catch {
    return id;
  }
}

const issueChallenge = ({ challenge, purpose, user = null, ttl = CHALLENGE_TTL_MS }) =>
  WebAuthnChallenge.create({
    challenge,
    purpose,
    user,
    expiresAt: new Date(Date.now() + ttl),
  });

/** Reads a challenge and burns it in one step, so it cannot serve twice. */
async function consumeChallenge(challenge, purpose) {
  if (!challenge) throw ApiError.badRequest('Missing challenge', 'NO_CHALLENGE');

  const row = await WebAuthnChallenge.findOneAndUpdate(
    { challenge, purpose, consumedAt: null, expiresAt: { $gt: new Date() } },
    { consumedAt: new Date() },
    { new: true }
  );
  if (!row) throw ApiError.badRequest('That request expired — try again', 'CHALLENGE_EXPIRED');
  return row;
}

/** Pulls the challenge back out of the client data, so it can be looked up. */
function decodeChallenge(clientDataJSON) {
  try {
    const json = JSON.parse(Buffer.from(clientDataJSON, 'base64url').toString('utf8'));
    return json.challenge || null;
  } catch {
    return null;
  }
}

const describeBrowser = (req) => {
  const ua = new UAParser(req.headers['user-agent'] || '');
  return [ua.getBrowser().name, ua.getOS().name].filter(Boolean).join(' on ') || null;
};

/* ───────────────────────────── registration ───────────────────────────── */

export const registerOptions = asyncHandler(async (req, res) => {
  const existing = await Passkey.find({ user: req.user._id, revokedAt: null }).lean();

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: expectedRpId(req),
    userName: req.user.email,
    userDisplayName: req.user.name,
    // A stable handle makes a re-enrolment replace the old credential in the
    // user's passkey manager instead of stacking up beside it.
    userID: new TextEncoder().encode(String(req.user._id)),
    attestationType: 'none',
    excludeCredentials: existing.map((c) => ({
      id: c.credentialId,
      transports: c.transports?.length ? c.transports : undefined,
    })),
    authenticatorSelection: {
      residentKey: 'required', // discoverable, so sign-in needs no email first
      userVerification: 'required',
    },
    // Asks whether this authenticator can derive a stable secret for us. When it
    // can, the client wraps the identity key with it and the account password
    // stops being needed on a new device.
    extensions: { prf: {} },
  });

  await issueChallenge({ challenge: options.challenge, purpose: 'register', user: req.user._id });

  res.json({ success: true, options, prfSalt: PRF_SALT });
});

export const registerVerify = asyncHandler(async (req, res) => {
  const { credential, name, identityWrapper } = req.body;

  const row = await consumeChallenge(
    decodeChallenge(credential?.response?.clientDataJSON),
    'register'
  );
  if (String(row.user) !== String(req.user._id)) {
    throw ApiError.forbidden('That request was not for this account', 'WRONG_USER');
  }

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: credential,
      expectedChallenge: row.challenge,
      expectedOrigin: expectedOrigins(req),
      expectedRPID: expectedRpId(req),
      requireUserVerification: true,
    });
  } catch (err) {
    throw ApiError.badRequest(err.message || 'That passkey could not be verified', 'BAD_PASSKEY');
  }

  if (!verification.verified || !verification.registrationInfo) {
    throw ApiError.badRequest('That passkey could not be verified', 'BAD_PASSKEY');
  }

  const info = verification.registrationInfo;
  const cred = info.credential;

  const passkey = await Passkey.create({
    user: req.user._id,
    credentialId: cred.id,
    publicKey: Buffer.from(cred.publicKey).toString('base64url'),
    counter: cred.counter,
    transports: cred.transports || [],
    deviceType: info.credentialDeviceType,
    backedUp: info.credentialBackedUp,
    name: (name || '').trim().slice(0, 60) || 'Passkey',
    addedFrom: describeBrowser(req),
    // Opaque here. The server holds the sealed identity but never the PRF secret
    // that opens it, which is the only reason keeping it here is acceptable.
    identityWrapper: identityWrapper || undefined,
  });

  logger.info('Passkey added for ' + req.user.email);
  res.status(201).json({ success: true, passkey: passkey.summary() });
});

/* ──────────────────────────── authentication ──────────────────────────── */

export const loginOptions = asyncHandler(async (req, res) => {
  // No allowCredentials: the credential is discoverable, so the browser offers
  // whatever it holds for this domain and the response tells us who it is. This
  // endpoint therefore leaks nothing about which accounts exist.
  const options = await generateAuthenticationOptions({
    rpID: expectedRpId(req),
    userVerification: 'required',
    extensions: { prf: { eval: { first: PRF_SALT } } },
  });

  await issueChallenge({ challenge: options.challenge, purpose: 'login' });
  res.json({ success: true, options, prfSalt: PRF_SALT });
});

/**
 * Verifies the assertion and hands back a short-lived ticket.
 *
 * An assertion is single-use, so it cannot carry the two round trips a login
 * needs — the client has to unlock its identity and mint device keys *between*
 * proving who it is and being given a session. The ticket is what bridges that
 * gap, and it is stored and burned exactly like a challenge.
 */
export const loginVerify = asyncHandler(async (req, res) => {
  const { credential } = req.body;

  const row = await consumeChallenge(
    decodeChallenge(credential?.response?.clientDataJSON),
    'login'
  );

  const passkey = await Passkey.findOne({ credentialId: credential?.id, revokedAt: null });
  if (!passkey) throw ApiError.unauthorized('That passkey is not registered', 'NO_PASSKEY');

  const user = await User.findById(passkey.user);
  if (!user || user.disabledAt) throw ApiError.forbidden('Account unavailable', 'NO_USER');

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: credential,
      expectedChallenge: row.challenge,
      expectedOrigin: expectedOrigins(req),
      expectedRPID: expectedRpId(req),
      requireUserVerification: true,
      credential: {
        id: passkey.credentialId,
        publicKey: Buffer.from(passkey.publicKey, 'base64url'),
        counter: passkey.counter,
        transports: passkey.transports?.length ? passkey.transports : undefined,
      },
    });
  } catch (err) {
    throw ApiError.unauthorized(err.message || 'That passkey could not be verified', 'BAD_PASSKEY');
  }

  if (!verification.verified) {
    throw ApiError.unauthorized('That passkey could not be verified', 'BAD_PASSKEY');
  }

  // A counter that fails to advance is the signature of a cloned authenticator.
  // Platform passkeys legitimately stay at zero, so this only bites when the
  // authenticator was counting in the first place.
  const { newCounter } = verification.authenticationInfo;
  if (passkey.counter > 0 && newCounter <= passkey.counter) {
    logger.warn('Passkey counter did not advance for ' + user.email);
    throw ApiError.unauthorized('That passkey was rejected', 'BAD_COUNTER');
  }

  passkey.counter = newCounter;
  passkey.lastUsedAt = new Date();
  await passkey.save();

  const ticket = randomToken(32);
  await issueChallenge({
    challenge: ticket,
    purpose: 'ticket',
    user: user._id,
    ttl: TICKET_TTL_MS,
  });

  res.json({
    success: true,
    stage: 'unlock',
    ticket,
    // Enough to greet the user by name on the unlock step, nothing more.
    account: { name: user.name, email: user.email, avatar: user.avatar, avatarColor: user.avatarColor },
    encryptedIdentity: user.encryptedIdentity,
    /** Present only when this passkey can open the identity without a password. */
    identityWrapper: passkey.identityWrapper?.ciphertext ? passkey.identityWrapper : null,
  });
});

/** Trades a ticket for the user it was issued to. Single use. */
export const redeemTicket = async (ticket) => {
  const row = await consumeChallenge(ticket, 'ticket');
  const user = await User.findById(row.user);
  if (!user || user.disabledAt) throw ApiError.forbidden('Account unavailable', 'NO_USER');
  return user;
};

/* ────────────────────────────── management ────────────────────────────── */

export const listPasskeys = asyncHandler(async (req, res) => {
  const passkeys = await Passkey.find({ user: req.user._id, revokedAt: null }).sort({
    createdAt: -1,
  });
  res.json({ success: true, passkeys: passkeys.map((p) => p.summary()) });
});

export const renamePasskey = asyncHandler(async (req, res) => {
  const passkey = await Passkey.findOne({
    _id: req.params.id,
    user: req.user._id,
    revokedAt: null,
  });
  if (!passkey) throw ApiError.notFound('Passkey not found', 'NO_PASSKEY');

  passkey.name = String(req.body.name || '').trim().slice(0, 60) || passkey.name;
  await passkey.save();
  res.json({ success: true, passkey: passkey.summary() });
});

export const deletePasskey = asyncHandler(async (req, res) => {
  const passkey = await Passkey.findOne({ _id: req.params.id, user: req.user._id });
  if (!passkey) throw ApiError.notFound('Passkey not found', 'NO_PASSKEY');

  // Revoked rather than deleted: the credential id stays claimed, so a removed
  // passkey cannot be quietly re-registered and start working again.
  passkey.revokedAt = new Date();
  passkey.identityWrapper = { ciphertext: null, iv: null, salt: null };
  await passkey.save();

  const remaining = await Passkey.countDocuments({ user: req.user._id, revokedAt: null });
  res.json({ success: true, remaining });
});
