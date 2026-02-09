// src/models/Message.ts
import mongoose, { Schema, Document } from 'mongoose';

export interface IReaction {
  user_id: mongoose.Types.ObjectId;
  emoji: string;
  createdAt: Date;
}

export interface IMessage extends Document {
  sender_id: mongoose.Types.ObjectId;
  receiver_id: mongoose.Types.ObjectId;
  message?: string;
  message_type: 'text' | 'image' | 'file';
  edited: boolean;
  edited_at?: Date;

  media_url?: string;   
  media_name?: string;   
  media_size?: number;   
  media_mime?: string;     

  medical_record_id?: mongoose.Types.ObjectId;
  appointment_id?: mongoose.Types.ObjectId;
  conversation_id: mongoose.Types.ObjectId;
  timestamp: Date;
  read: boolean;
  read_at?: Date;
  createdAt: Date;
  updatedAt: Date;

  deleted: boolean;
  deleted_at?: Date;
  deleted_by?: mongoose.Types.ObjectId;
  
  // ✅ THÊM PHẦN NÀY CHO REACTION
  reactions: IReaction[];
  reactions_count: number;
}

const reactionSchema = new Schema({
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  emoji: {
    type: String,
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

const messageSchema = new mongoose.Schema({
  sender_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  receiver_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  message: {
    type: String,
    default: ''
  },
  message_type: {
    type: String,
    enum: ['text', 'image', 'file'],
    default: 'text'
  },

  media_url: { type: String },
  media_name: { type: String },
  media_size: { type: Number },
  media_mime: { type: String },

  medical_record_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'MedicalRecord'
  },
  appointment_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Appointment'
  },
  conversation_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Conversation',
    required: true
  },
  timestamp: {
    type: Date,
    default: Date.now
  },
  read: {
    type: Boolean,
    default: false
  },
  read_at: {
    type: Date
  },
  edited: {
    type: Boolean,
    default: false
  },
  edited_at: {
    type: Date
  },
  deleted: {
    type: Boolean,
    default: false
  },
  deleted_at: {
    type: Date
  },
  deleted_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  
  // ✅ THÊM PHẦN NÀY CHO REACTION
  reactions: [reactionSchema],
  reactions_count: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

// Index để optimize query reaction
messageSchema.index({ 'reactions.user_id': 1 });
messageSchema.index({ conversation_id: 1, 'reactions.createdAt': -1 });

const Message = mongoose.models.Message || mongoose.model<IMessage>('Message', messageSchema);

export default Message;