import { serialize } from './conversation.controller.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import {
  createAssistantDirect,
  ensureAssistantInConversation,
  handleAssistantRequest,
  hydrateAssistantMessage,
} from '../services/assistant.js';

export const assistantDirect = asyncHandler(async (req, res) => {
  const conversation = await createAssistantDirect(req.user._id);
  res.status(201).json({
    success: true,
    conversation: serialize(conversation, req.user._id, req.user),
  });
});

export const inviteAssistant = asyncHandler(async (req, res) => {
  const { conversation, added } = await ensureAssistantInConversation(req.params.id, req.user._id);
  res.json({
    success: true,
    added,
    conversation: serialize(conversation, req.user._id, req.user),
  });
});

export const handleAssistant = asyncHandler(async (req, res) => {
  const { message } = await handleAssistantRequest({
    user: req.user,
    conversationId: req.body.conversationId,
    text: req.body.text,
  });
  res.json({
    success: true,
    message: hydrateAssistantMessage(message, req.user._id),
  });
});
