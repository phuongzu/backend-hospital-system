// src/models/Message.ts
import mongoose, { Schema, Document } from 'mongoose';

export interface IMessage extends Document {
  sender_id: mongoose.Types.ObjectId;
  receiver_id: mongoose.Types.ObjectId;
  message?: string;
  message_type: 'text' | 'image' | 'file';

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
}

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
  }
}, {
  timestamps: true
});

const Message = mongoose.models.Message || mongoose.model<IMessage>('Message', messageSchema);

export default Message;