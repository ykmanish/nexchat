import path from 'node:path';
import fs from 'node:fs/promises';
import sharp from 'sharp';
import { User, Conversation } from '../models/index.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { uploadRoot } from '../middleware/upload.js';
import { getIO } from '../sockets/io.js';
import { forgetTypingPreference } from '../services/push.js';

const isContact = (me, otherId) =>
  (me.contacts || []).some((c) => String(c) === String(otherId));


/**
 * Tells everyone who shares a chat with this user that their profile changed.
 *
 * A single room broadcast cannot be used: what each person is allowed to see
 * depends on whether *they* have this user as a contact, so one payload would
 * either leak a contacts-only avatar to strangers or hide it from real
 * contacts. One indexed reverse lookup gives us the contact set, and the two
 * groups then get their own correctly-filtered copy.
 */
async function broadcastProfile(user) {
  const io = getIO();
  if (!io) return;

  const [convs, contacts] = await Promise.all([
    Conversation.find({ memberIds: user._id }).select('memberIds').lean(),
    User.find({ contacts: user._id }).select('_id').lean(),
  ]);

  const contactIds = new Set(contacts.map((c) => String(c._id)));
  const audience = new Set();
  convs.forEach((c) => (c.memberIds || []).forEach((m) => audience.add(String(m))));
  audience.delete(String(user._id));

  const forContacts = user.publicProfile(true);
  const forStrangers = user.publicProfile(false);

  audience.forEach((id) => {
    io.to('user:' + id).emit('user:updated', {
      user: contactIds.has(id) ? forContacts : forStrangers,
    });
  });
}

export const searchUsers = asyncHandler(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json({ success: true, users: [] });

  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rx = new RegExp(escaped, 'i');

  const users = await User.find({
    _id: { $ne: req.user._id, $nin: req.user.blocked || [] },
    emailVerified: true,
    $or: [{ name: rx }, { username: rx }, { email: q.toLowerCase() }],
  }).limit(25);

  res.json({
    success: true,
    users: users.map((u) => u.publicProfile(isContact(req.user, u._id))),
  });
});

export const getUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw ApiError.notFound('User not found', 'NO_USER');
  res.json({ success: true, user: user.publicProfile(isContact(req.user, user._id)) });
});

export const updateProfile = asyncHandler(async (req, res) => {
  const { name, about, username, avatarColor } = req.body;

  if (username !== undefined && username !== req.user.username) {
    const taken = await User.exists({ username, _id: { $ne: req.user._id } });
    if (taken) throw ApiError.conflict('That username is taken', 'USERNAME_TAKEN');
    req.user.username = username;
  }
  if (name !== undefined) req.user.name = name;
  if (about !== undefined) req.user.about = about;
  if (avatarColor !== undefined) req.user.avatarColor = avatarColor;

  await req.user.save();

  await broadcastProfile(req.user);

  res.json({ success: true, user: req.user.toJSON() });
});

export const updateSettings = asyncHandler(async (req, res) => {
  Object.entries(req.body).forEach(([k, v]) => {
    if (k === 'notifications' && v && typeof v === 'object') {
      Object.assign(req.user.settings.notifications, v);
    } else if (k in req.user.settings) {
      req.user.settings[k] = v;
    }
  });
  await req.user.save();

  // The push path caches this one for a minute to survive a typing burst, so a
  // flip has to invalidate it or the switch looks like it did nothing.
  forgetTypingPreference(req.user._id);

  res.json({ success: true, settings: req.user.settings });
});

export const updatePrivacy = asyncHandler(async (req, res) => {
  Object.entries(req.body).forEach(([k, v]) => {
    if (k in req.user.privacy) req.user.privacy[k] = v;
  });
  await req.user.save();

  // Push the newly-filtered profile out, so turning something off takes effect
  // on other people's screens immediately rather than on their next reload.
  await broadcastProfile(req.user);

  res.json({ success: true, privacy: req.user.privacy });
});

export const uploadAvatarImage = asyncHandler(async (req, res) => {
  if (!req.file) throw ApiError.badRequest('No image received', 'NO_FILE');

  const outName = 'av_' + Date.now().toString(36) + '.webp';
  const outPath = path.join(uploadRoot, 'avatars', outName);

  await sharp(req.file.path)
    .rotate()
    .resize(512, 512, { fit: 'cover', position: 'attention' })
    .webp({ quality: 88 })
    .toFile(outPath);

  await fs.unlink(req.file.path).catch(() => {});

  // Drop the previous avatar so uploads don't pile up on disk.
  if (req.user.avatar?.startsWith('/uploads/avatars/')) {
    fs.unlink(path.join(uploadRoot, 'avatars', path.basename(req.user.avatar))).catch(() => {});
  }

  req.user.avatar = '/uploads/avatars/' + outName;
  await req.user.save();

  await broadcastProfile(req.user);

  res.json({ success: true, avatar: req.user.avatar, user: req.user.toJSON() });
});

export const removeAvatar = asyncHandler(async (req, res) => {
  if (req.user.avatar?.startsWith('/uploads/avatars/')) {
    fs.unlink(path.join(uploadRoot, 'avatars', path.basename(req.user.avatar))).catch(() => {});
  }
  req.user.avatar = null;
  await req.user.save();

  await broadcastProfile(req.user);

  res.json({ success: true, user: req.user.toJSON() });
});

/* ────────────────────────────── contacts ────────────────────────────── */

/**
 * Everyone this account can start a chat with.
 *
 * `contacts` is the list the user built by hand. On its own it was not enough:
 * a contact is one-directional, so somebody who added *you* — and who can
 * therefore already message you — did not appear anywhere in New chat, and the
 * only way to reply to them was to find the thread they had already started.
 * That reads as a missing person rather than a design decision.
 *
 * So two more groups come back alongside it, both derived rather than stored:
 *
 *   `addedYou`  people whose contact list contains this account
 *   `messaged`  people this account already shares a direct chat with
 *
 * Neither is treated as a contact — they are shown separately and each carries a
 * "save" affordance — but both are reachable, which is the whole point. Nothing
 * new is persisted to get this: one indexed reverse lookup on `contacts` and one
 * on the conversations the user is already a member of.
 */
export const listContacts = asyncHandler(async (req, res) => {
  const me = await req.user.populate('contacts');

  const blocked = new Set((req.user.blocked || []).map(String));
  const savedIds = new Set(me.contacts.map((c) => String(c._id)));

  const contacts = me.contacts
    .filter((c) => !blocked.has(String(c._id)) && !c.disabledAt)
    .map((c) => c.publicProfile(true))
    .sort(byName);

  const [inbound, directs] = await Promise.all([
    User.find({
      contacts: req.user._id,
      emailVerified: true,
      disabledAt: null,
      _id: { $nin: [...savedIds, ...blocked, req.user._id] },
    }).limit(200),
    Conversation.find({ type: 'direct', memberIds: req.user._id })
      .select('memberIds')
      .lean(),
  ]);

  const addedYouIds = new Set(inbound.map((u) => String(u._id)));

  /* Whoever is on the other side of a direct chat. Excluding the people already
     covered above keeps each person in exactly one group, so nobody is offered
     twice under two different headings. */
  const peerIds = new Set();
  directs.forEach((c) =>
    (c.memberIds || []).forEach((id) => {
      const key = String(id);
      if (key === String(req.user._id)) return;
      if (savedIds.has(key) || blocked.has(key) || addedYouIds.has(key)) return;
      peerIds.add(key);
    })
  );

  const peers = peerIds.size
    ? await User.find({ _id: { $in: [...peerIds] }, disabledAt: null }).limit(200)
    : [];

  res.json({
    success: true,
    contacts,
    // `false` for the viewer-is-contact flag: these people have not been saved,
    // so a "contacts only" avatar or last-seen must stay hidden until they are.
    addedYou: inbound.map((u) => u.publicProfile(false)).sort(byName),
    messaged: peers.map((u) => u.publicProfile(false)).sort(byName),
  });
});

const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''));

export const addContact = asyncHandler(async (req, res) => {
  const { email, username, userId } = req.body;

  const query = userId
    ? { _id: userId }
    : email
      ? { email: String(email).toLowerCase() }
      : { username: String(username).toLowerCase() };

  const target = await User.findOne(query);
  if (!target) throw ApiError.notFound('No one found with those details', 'NO_USER');
  if (String(target._id) === String(req.user._id)) {
    throw ApiError.badRequest('You cannot add yourself', 'SELF');
  }
  if (!target.emailVerified) throw ApiError.notFound('No one found with those details', 'NO_USER');

  const already = isContact(req.user, target._id);
  if (!already) {
    req.user.contacts.push(target._id);
    await req.user.save();
    announceContacts(req.user._id, target._id);
  }

  res.status(already ? 200 : 201).json({
    success: true,
    contact: target.publicProfile(true),
    already,
  });
});

export const removeContact = asyncHandler(async (req, res) => {
  const before = req.user.contacts.length;
  req.user.contacts = req.user.contacts.filter((c) => String(c) !== String(req.params.id));
  if (req.user.contacts.length !== before) {
    await req.user.save();
    announceContacts(req.user._id, req.params.id);
  }
  res.json({ success: true });
});

/**
 * Tells both sides that a contact list changed.
 *
 * The person doing the adding needs it for their *other* devices — a contact
 * saved on a phone should be there on the laptop without a reload. The person
 * being added needs it because they now appear in each other's New chat list,
 * and finding out only on the next refresh is exactly the gap that made added
 * contacts look like they had not saved.
 */
function announceContacts(actorId, otherId) {
  const io = getIO();
  if (!io) return;
  io.to('user:' + actorId).emit('contacts:changed', { userId: String(otherId) });
  io.to('user:' + otherId).emit('contacts:changed', { userId: String(actorId) });
}

/* ────────────────────────────── blocking ────────────────────────────── */

export const blockUser = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (String(id) === String(req.user._id)) throw ApiError.badRequest('You cannot block yourself', 'SELF');

  if (!req.user.blocked.some((b) => String(b) === String(id))) {
    req.user.blocked.push(id);
    req.user.contacts = req.user.contacts.filter((c) => String(c) !== String(id));
    await req.user.save();
  }

  res.json({ success: true, blocked: true });
});

export const unblockUser = asyncHandler(async (req, res) => {
  req.user.blocked = req.user.blocked.filter((b) => String(b) !== String(req.params.id));
  await req.user.save();
  res.json({ success: true, blocked: false });
});

export const listBlocked = asyncHandler(async (req, res) => {
  const me = await req.user.populate('blocked', 'name username avatar avatarColor');
  res.json({ success: true, blocked: me.blocked });
});

export const deleteAccount = asyncHandler(async (req, res) => {
  req.user.disabledAt = new Date();
  req.user.name = 'Deleted account';
  req.user.avatar = null;
  req.user.about = '';
  req.user.username = undefined;
  await req.user.save();
  res.json({ success: true, message: 'Account deactivated' });
});
