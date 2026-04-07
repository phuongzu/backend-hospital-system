import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IConversation extends Document {
  participant_ids: Types.ObjectId[];
  medical_record_id?: Types.ObjectId | null;
  appointment_id?: Types.ObjectId | null;
  last_message?: Types.ObjectId | null;
  last_message_at: Date;
  unread_count: number;
  createdAt: Date;
  updatedAt: Date;
}

const conversationSchema = new Schema<IConversation>(
  {
    participant_ids: {
      type: [{ type: Schema.Types.ObjectId, ref: 'User' }],
      required: true,
      validate: {
        validator: function (v: Types.ObjectId[]) {
          return Array.isArray(v) && v.length === 2;
        },
        message: 'Conversation must have exactly 2 participants'
      }
    },

    medical_record_id: {
      type: Schema.Types.ObjectId,
      ref: 'MedicalRecord',
      default: null
    },

    appointment_id: {
      type: Schema.Types.ObjectId,
      ref: 'Appointment',
      default: null
    },

    last_message: {
      type: Schema.Types.ObjectId,
      ref: 'Message',
      default: null
    },

    last_message_at: {
      type: Date,
      default: Date.now
    },

    unread_count: {
      type: Number,
      default: 0,
      min: 0
    }
  },
  {
    timestamps: true
  }
);

/* ===========================
   INDEXES
=========================== */

// 🔐 Unique conversation index (cặp participant + medical_record)
// Sử dụng participant_ids.0 và participant_ids.1 để tránh multikey index (vốn index từng phần tử)
// Điều này cho phép một user tham gia nhiều conversation khác nhau.
conversationSchema.index(
  { 'participant_ids.0': 1, 'participant_ids.1': 1, medical_record_id: 1 },
  {
    unique: true,
    name: 'unique_conversation_index'
  }
);

// ⚡ Query nhanh
conversationSchema.index({ participant_ids: 1 });
conversationSchema.index({ last_message_at: -1 });

/* ===========================
   PRE SAVE HOOK
=========================== */

// ✅ Sort participant_ids để tránh duplicate conversation
conversationSchema.pre('save', function (next) {
  if (this.isModified('participant_ids')) {
    this.participant_ids = this.participant_ids
      .map(id => id.toString())
      .sort()
      .map(id => new mongoose.Types.ObjectId(id));
  }
  next();
});

/* ===========================
   EXPORT MODEL (SAFE)
=========================== */

const Conversation =
  mongoose.models.Conversation ||
  mongoose.model<IConversation>('Conversation', conversationSchema);

export default Conversation;