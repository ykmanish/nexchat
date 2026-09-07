import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { AssistantReminder, Conversation, Message, User } from '../models/index.js';
import { ApiError } from '../utils/ApiError.js';
import { getIO } from '../sockets/io.js';
import { emitToMembers, hydrate, SENDER_FIELDS } from './messaging.js';

export const BOT_EMAIL = 'chax-assistant@system.local';
export const BOT_USERNAME = 'chax';
export const BOT_NAME = 'Chax';

const BOT_COLOR = '#B9FF5A';
const POPULATE_USER = 'name username avatar avatarColor about presence lastSeen identityPublicKey securityCode privacy';

export async function getAssistantUser() {
  let bot = await User.findOne({ email: BOT_EMAIL });
  if (bot) return bot;

  bot = await User.create({
    email: BOT_EMAIL,
    emailVerified: true,
    password: crypto.randomBytes(32).toString('hex'),
    name: BOT_NAME,
    username: BOT_USERNAME,
    avatarColor: BOT_COLOR,
    about: 'Chax assistant for reminders and chat help',
    presence: 'online',
    privacy: { lastSeen: 'everyone', avatar: 'everyone', about: 'everyone' },
  });
  return bot;
}

export async function createAssistantDirect(userId) {
  const bot = await getAssistantUser();
  if (String(userId) === String(bot._id)) {
    throw ApiError.badRequest('You are already talking to Chax', 'SELF_CHAT');
  }

  let conv = await Conversation.findOne({
    type: 'direct',
    memberIds: { $all: [userId, bot._id], $size: 2 },
  })
    .populate('participants.user', POPULATE_USER)
    .populate('lastMessage');

  if (!conv) {
    conv = await Conversation.create({
      type: 'direct',
      createdBy: userId,
      participants: [
        { user: userId, role: 'member' },
        { user: bot._id, role: 'member' },
      ],
      memberIds: [userId, bot._id],
    });
    conv = await conv.populate('participants.user', POPULATE_USER);
  }

  return conv;
}

export async function ensureAssistantInConversation(conversationId, actorId) {
  if (!mongoose.isValidObjectId(conversationId)) {
    throw ApiError.badRequest('Bad conversation id', 'BAD_ID');
  }

  const [bot, conv] = await Promise.all([
    getAssistantUser(),
    Conversation.findOne({ _id: conversationId, memberIds: actorId }),
  ]);

  if (!conv) throw ApiError.notFound('Conversation not found', 'NO_CONVERSATION');
  const already = conv.participants.some((p) => String(p.user._id || p.user) === String(bot._id) && !p.leftAt);
  if (!already) {
    conv.participants.push({ user: bot._id, role: 'member', addedBy: actorId });
    conv.syncMemberIds();
    await conv.save();
  }

  const populated = await Conversation.findById(conv._id)
    .populate('participants.user', POPULATE_USER)
    .populate('lastMessage');

  getIO()?.to('conversation:' + conv._id).emit('conversation:updated', {
    conversationId: String(conv._id),
    patch: { memberCount: populated.memberIds.length },
  });

  return { conversation: populated, bot, added: !already };
}

export async function handleAssistantRequest({ user, conversationId, text }) {
  if (!env.assistant.enabled) throw ApiError.badRequest('Chax assistant is disabled', 'ASSISTANT_OFF');
  if (!env.assistant.groqApiKey) {
    throw ApiError.badRequest('Set GROQ_API_KEY on the server first', 'NO_GROQ_KEY');
  }

  const { conversation, bot } = await ensureAssistantInConversation(conversationId, user._id);
  const clean = cleanPrompt(text);
  const reminder = parseReminder(clean);

  let reply;
  if (reminder) {
    await AssistantReminder.create({
      conversation: conversation._id,
      createdBy: user._id,
      text: reminder.text,
      dueAt: reminder.dueAt,
    });
    reply = 'Done. I will remind this chat ' + formatWhen(reminder.dueAt) + ': ' + reminder.text;
  } else {
    reply = await askGroq({
      userName: user.name,
      prompt: clean,
      context: conversation.type === 'direct' ? 'direct chat' : conversation.type + ' chat',
    });
  }

  const message = await postAssistantMessage(conversation._id, bot._id, reply);
  return { message, conversation };
}

export async function postAssistantMessage(conversationId, botId, text) {
  const conv = await Conversation.findById(conversationId);
  if (!conv) throw ApiError.notFound('Conversation not found', 'NO_CONVERSATION');

  conv.seq += 1;
  const active = conv.participants.filter((p) => !p.leftAt);
  const msg = await Message.create({
    conversation: conv._id,
    sender: botId,
    senderDeviceId: 'server',
    clientId: 'assistant_' + conv._id + '_' + conv.seq + '_' + Date.now(),
    seq: conv.seq,
    type: 'text',
    body: { plaintext: text, algorithm: 'assistant-plaintext' },
    keys: [],
    receipts: active.filter((p) => String(p.user) !== String(botId)).map((p) => ({ user: p.user })),
  });

  conv.lastMessage = msg._id;
  conv.lastMessageAt = msg.createdAt;
  conv.participants.forEach((p) => {
    if (p.leftAt || String(p.user) === String(botId)) return;
    p.unreadCount += 1;
    if (p.archived) p.archived = false;
    if (p.deletedAt) p.deletedAt = null;
  });
  await conv.save();

  const populated = await Message.findById(msg._id).populate('sender', SENDER_FIELDS);
  emitToMembers(conv, populated);
  const io = getIO();
  conv.participants
    .filter((p) => !p.leftAt)
    .forEach((p) =>
      io?.to('user:' + p.user).emit('conversation:bump', {
        conversationId: String(conv._id),
        lastMessageAt: conv.lastMessageAt,
        unreadCount: p.unreadCount,
        mentionCount: p.mentionCount,
        senderId: String(botId),
      })
    );

  return populated;
}

export function startAssistantScheduler() {
  if (!env.assistant.enabled) return;
  const tick = async () => {
    const due = await AssistantReminder.find({
      status: 'pending',
      dueAt: { $lte: new Date() },
    }).limit(20);

    const bot = due.length ? await getAssistantUser() : null;
    for (const reminder of due) {
      try {
        await postAssistantMessage(reminder.conversation, bot._id, 'Reminder: ' + reminder.text);
        reminder.status = 'sent';
        reminder.sentAt = new Date();
        reminder.failure = null;
      } catch (err) {
        reminder.status = 'failed';
        reminder.failure = err.message || 'Reminder failed';
      }
      await reminder.save();
    }
  };

  setInterval(() => tick().catch(() => {}), 30_000).unref();
  tick().catch(() => {});
}

async function askGroq({ userName, prompt, context }) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + env.assistant.groqApiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: env.assistant.groqModel,
      temperature: 0.4,
      max_tokens: 450,
      messages: [
        {
          role: 'system',
          content:
            'You are Chax, a concise chat assistant inside a private messaging app. Help with reminders, drafting, planning, and small coordination tasks. Be friendly and practical. If the user asks to notify or remind someone at a time, explain that you can set reminders in this chat when the request includes a clear time.',
        },
        {
          role: 'user',
          content: userName + ' in a ' + context + ' says: ' + prompt,
        },
      ],
    }),
  });

  if (!res.ok) throw ApiError.badRequest('Groq request failed', 'GROQ_FAILED');
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || 'I am here. What should I help with?';
}

function cleanPrompt(text) {
  return String(text || '').replace(/^@?chax[\s,:-]*/i, '').trim();
}

function parseReminder(text) {
  const match = text.match(/\bremind\s+(?:me|us|this chat)?\s*(?:to|that|about)?\s*(.+?)\s+(?:at|on)\s+(.+)$/i);
  if (!match) return null;

  const task = match[1].trim();
  const when = match[2].trim();
  const dueAt = parseWhen(when);
  if (!task || !dueAt || dueAt.getTime() <= Date.now()) return null;

  return { text: task, dueAt };
}

function parseWhen(value) {
  const direct = new Date(value);
  if (!Number.isNaN(direct.getTime())) return direct;

  const time = value.match(/^(today|tomorrow)?\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!time) return null;

  const d = new Date();
  if ((time[1] || '').toLowerCase() === 'tomorrow') d.setDate(d.getDate() + 1);
  let hour = Number(time[2]);
  const minute = Number(time[3] || 0);
  const meridiem = (time[4] || '').toLowerCase();
  if (meridiem === 'pm' && hour < 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;
  d.setHours(hour, minute, 0, 0);
  if (!time[1] && d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
  return d;
}

function formatWhen(date) {
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Kolkata',
  }).format(date);
}

export function hydrateAssistantMessage(message, userId) {
  return hydrate(message, userId);
}
