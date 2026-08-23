import { User, Device, PreKey } from '../models/index.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const LOW_WATER_MARK = 15;

/** Every active device that should receive a copy of each message key. */
async function bundlesFor(userId) {
  const [user, devices] = await Promise.all([
    User.findById(userId).select('identityPublicKey signingPublicKey securityCode name'),
    Device.find({ user: userId, revokedAt: null }),
  ]);
  if (!user) throw ApiError.notFound('User not found', 'NO_USER');

  const bundles = [];
  for (const device of devices) {
    // Burn a one-time prekey if any are left; sessions still work without one,
    // they just lose forward secrecy on the very first message.
    const preKey = await PreKey.findOneAndDelete({
      deviceId: device.deviceId,
      consumedAt: null,
    }).sort({ keyId: 1 });

    bundles.push({
      ...device.toBundle(),
      oneTimePreKey: preKey ? { keyId: preKey.keyId, publicKey: preKey.publicKey } : null,
    });
  }

  return {
    userId: String(user._id),
    identityPublicKey: user.identityPublicKey,
    signingPublicKey: user.signingPublicKey,
    securityCode: user.securityCode,
    devices: bundles,
  };
}

export const getBundle = asyncHandler(async (req, res) => {
  const bundle = await bundlesFor(req.params.userId);
  res.json({ success: true, bundle });
});

/** Batch fetch — one round-trip when opening a group with many members. */
export const getBundles = asyncHandler(async (req, res) => {
  const ids = String(req.query.userIds || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 200);

  if (!ids.length) throw ApiError.badRequest('Pass userIds', 'NO_IDS');

  const bundles = await Promise.all(ids.map((id) => bundlesFor(id).catch(() => null)));
  res.json({ success: true, bundles: bundles.filter(Boolean) });
});

/** Lightweight device roster — used to decide who to fan a message out to. */
export const getDeviceRoster = asyncHandler(async (req, res) => {
  const ids = String(req.query.userIds || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 500);

  const devices = await Device.find({ user: { $in: ids }, revokedAt: null })
    .select('user deviceId identityPublicKey')
    .lean();

  const roster = {};
  for (const d of devices) {
    const key = String(d.user);
    if (!roster[key]) roster[key] = [];
    roster[key].push({ deviceId: d.deviceId, identityPublicKey: d.identityPublicKey });
  }

  res.json({ success: true, roster });
});

export const uploadPreKeys = asyncHandler(async (req, res) => {
  const { oneTimePreKeys = [], signedPreKey } = req.body;

  if (signedPreKey) {
    await Device.updateOne(
      { deviceId: req.deviceId, user: req.user._id },
      { signedPreKey: { ...signedPreKey, createdAt: new Date() } }
    );
  }

  if (oneTimePreKeys.length) {
    await PreKey.insertMany(
      oneTimePreKeys.slice(0, 200).map((k) => ({
        user: req.user._id,
        deviceId: req.deviceId,
        keyId: k.keyId,
        publicKey: k.publicKey,
      })),
      { ordered: false }
    ).catch(() => {});
  }

  const remaining = await PreKey.countDocuments({ deviceId: req.deviceId, consumedAt: null });
  res.json({ success: true, remaining });
});

export const preKeyCount = asyncHandler(async (req, res) => {
  const remaining = await PreKey.countDocuments({ deviceId: req.deviceId, consumedAt: null });
  res.json({ success: true, remaining, needsRefill: remaining < LOW_WATER_MARK });
});

/** Rotates the account identity — e.g. after a suspected compromise. */
export const rotateIdentity = asyncHandler(async (req, res) => {
  const { identityPublicKey, signingPublicKey, encryptedIdentity } = req.body;

  req.user.identityPublicKey = identityPublicKey;
  req.user.signingPublicKey = signingPublicKey;
  req.user.encryptedIdentity = encryptedIdentity;
  await req.user.save();

  res.json({ success: true, message: 'Identity rotated' });
});
