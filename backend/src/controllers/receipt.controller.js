import crypto from 'node:crypto';
import { DeletionReceipt, Device, Message } from '../models/index.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireMembership } from '../services/messaging.js';
import { canonical } from '../services/attestation.js';
import { getIO } from '../sockets/io.js';

/**
 * Deletion receipts: a device confirming, under signature, that it deleted a
 * message it had been given.
 *
 * The server's job here is narrow and worth being precise about. It does not
 * make the claim — it cannot, having no private key for anyone's device — it
 * only checks that the signature matches the public key already registered for
 * that device, and refuses anything that does not verify. A stored receipt is
 * therefore always one a device really signed, which is what makes the ledger
 * worth reading.
 */

const P256 = { name: 'ECDSA', namedCurve: 'P-256' };

/** Exactly the statement the client signs. Order fixed by canonical(). */
const statementOf = ({ messageId, conversationId, deviceId, deletedAt, prevHash }) => ({
  messageId,
  conversationId,
  deviceId,
  deletedAt,
  prevHash: prevHash ?? null,
});

async function verifyDeviceSignature({ publicKey, signature, statement }) {
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      Buffer.from(publicKey, 'base64'),
      P256,
      true,
      ['verify']
    );
    return crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      Buffer.from(signature, 'base64'),
      Buffer.from(canonical(statement), 'utf8')
    );
  } catch {
    return false;
  }
}

/* ──────────────────────────── submitting one ──────────────────────────── */

export const submitReceipt = asyncHandler(async (req, res) => {
  const { deletedAt, prevHash = null, signature, publicKey } = req.body;

  const message = await Message.findById(req.params.id).select('conversation deletedForEveryone');
  if (!message) throw ApiError.notFound('Message not found', 'NO_MESSAGE');

  // A receipt only means something for a deletion that was actually ordered.
  if (!message.deletedForEveryone) {
    throw ApiError.badRequest('That message was not deleted for everyone', 'NOT_DELETED');
  }

  const conv = await requireMembership(message.conversation, req.user._id);
  const deviceId = req.deviceId;

  /* The public key must be the one this server already knows for this device.
     Accepting a key supplied in the request would let anyone sign a receipt for
     anyone's device with a key of their own choosing. */
  const device = await Device.findOne({ deviceId, user: req.user._id }).select('signingPublicKey');
  if (!device) throw ApiError.unauthorized('Unknown device', 'NO_DEVICE');
  if (device.signingPublicKey !== publicKey) {
    throw ApiError.badRequest('That key is not registered for this device', 'KEY_MISMATCH');
  }

  /* Idempotence is checked before anything else, and specifically before the
     chain check below. A retry legitimately carries the prevHash it was first
     signed with, which by then is no longer the tip — so ordering these the
     other way round makes every retry look like a chain gap. */
  const already = await DeletionReceipt.findOne({ message: message._id, deviceId });
  if (already) {
    return res.json({ success: true, receipt: already.publicView(), duplicate: true });
  }

  const statement = statementOf({
    messageId: String(message._id),
    conversationId: String(conv._id),
    deviceId,
    deletedAt,
    prevHash,
  });

  const ok = await verifyDeviceSignature({ publicKey, signature, statement });
  if (!ok) throw ApiError.badRequest('That receipt did not verify', 'BAD_SIGNATURE');

  /* Chain continuity. The client says which receipt this follows; if that does
     not match what the server last stored for this device in this conversation,
     the chain has a gap and the receipt is refused rather than accepted into a
     ledger that would then be silently wrong. */
  const previous = await DeletionReceipt.findOne({
    conversation: conv._id,
    deviceId,
  }).sort({ createdAt: -1 });

  const expectedPrev = previous?.hash ?? null;
  if ((prevHash ?? null) !== expectedPrev) {
    throw ApiError.conflict('Receipt chain is out of step — fetch the latest and retry', 'CHAIN_GAP', {
      expectedPrev,
    });
  }

  const hash = Buffer.from(
    await crypto.subtle.digest(
      'SHA-256',
      Buffer.from(canonical({ ...statement, signature }), 'utf8')
    )
  ).toString('base64');

  let receipt;
  try {
    receipt = await DeletionReceipt.create({
      message: message._id,
      conversation: conv._id,
      user: req.user._id,
      deviceId,
      deletedAt,
      prevHash: prevHash ?? null,
      hash,
      signature,
      publicKey,
    });
  } catch (err) {
    // A retry of a receipt already stored is success, not a conflict.
    if (err.code === 11000) {
      const existing = await DeletionReceipt.findOne({ message: message._id, deviceId });
      return res.json({ success: true, receipt: existing.publicView(), duplicate: true });
    }
    throw err;
  }

  // Whoever ordered the deletion is the one waiting to hear it happened.
  getIO()?.to('conversation:' + conv._id).emit('message:deletion-confirmed', {
    conversationId: String(conv._id),
    messageId: String(message._id),
    deviceId,
    userId: String(req.user._id),
    deletedAt,
  });

  res.status(201).json({ success: true, receipt: receipt.publicView() });
});

/* ───────────────────────────── reading them ───────────────────────────── */

/**
 * Who has confirmed, and who has not.
 *
 * The outstanding list is the useful half: a deletion confirmed by two of four
 * devices is a different fact from one confirmed by all four, and a UI that only
 * showed confirmations would imply completeness it has not established.
 */
export const listForMessage = asyncHandler(async (req, res) => {
  const message = await Message.findById(req.params.id).select('conversation deletedForEveryone');
  if (!message) throw ApiError.notFound('Message not found', 'NO_MESSAGE');

  const conv = await requireMembership(message.conversation, req.user._id);

  const [receipts, devices] = await Promise.all([
    DeletionReceipt.find({ message: message._id })
      .populate('user', 'name avatar avatarColor')
      .sort({ createdAt: 1 }),
    Device.find({ user: { $in: conv.memberIds }, revokedAt: null }).select('deviceId user name').lean(),
  ]);

  const confirmed = new Set(receipts.map((r) => r.deviceId));

  res.json({
    success: true,
    messageId: String(message._id),
    deletedForEveryone: message.deletedForEveryone,
    receipts: receipts.map((r) => ({
      ...r.publicView(),
      by: r.user ? { name: r.user.name, avatar: r.user.avatar, avatarColor: r.user.avatarColor } : null,
    })),
    // Excludes the deleter's own devices: nobody needs a receipt from the
    // device that issued the order.
    outstanding: devices
      .filter((d) => !confirmed.has(d.deviceId) && String(d.user) !== String(req.user._id))
      .map((d) => ({ deviceId: d.deviceId, name: d.name })),
  });
});

/** The chain for one device in one conversation, for spotting gaps. */
export const listChain = asyncHandler(async (req, res) => {
  const conv = await requireMembership(req.params.conversationId, req.user._id);

  const receipts = await DeletionReceipt.find({
    conversation: conv._id,
    deviceId: req.params.deviceId,
  }).sort({ createdAt: 1 });

  /* Replayed here so a caller does not have to trust the stored order. A break
     means a receipt is missing from the middle of the chain. */
  let expected = null;
  let intact = true;
  let brokeAt = null;

  receipts.forEach((r, i) => {
    if (intact && r.prevHash !== expected) {
      intact = false;
      brokeAt = i;
    }
    expected = r.hash;
  });

  res.json({
    success: true,
    deviceId: req.params.deviceId,
    count: receipts.length,
    chainIntact: intact,
    brokeAtIndex: brokeAt,
    tip: expected,
    receipts: receipts.map((r) => r.publicView()),
  });
});

/** The tip a client needs before signing its next receipt. */
export const chainTip = asyncHandler(async (req, res) => {
  const conv = await requireMembership(req.params.conversationId, req.user._id);

  const last = await DeletionReceipt.findOne({
    conversation: conv._id,
    deviceId: req.deviceId,
  }).sort({ createdAt: -1 });

  res.json({ success: true, tip: last?.hash ?? null });
});
