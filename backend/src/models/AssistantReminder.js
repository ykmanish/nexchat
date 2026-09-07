import mongoose from 'mongoose';

const assistantReminderSchema = new mongoose.Schema(
  {
    conversation: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    text: { type: String, required: true, maxlength: 1200 },
    action: {
      type: {
        kind: { type: String, enum: ['send-message'], default: null },
        to: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
        message: { type: String, default: null, maxlength: 1200 },
      },
      default: null,
    },
    dueAt: { type: Date, required: true, index: true },
    status: { type: String, enum: ['pending', 'sent', 'cancelled', 'failed'], default: 'pending', index: true },
    sentAt: { type: Date, default: null },
    failure: { type: String, default: null },
  },
  { timestamps: true }
);

assistantReminderSchema.index({ status: 1, dueAt: 1 });

export const AssistantReminder = mongoose.model('AssistantReminder', assistantReminderSchema);
