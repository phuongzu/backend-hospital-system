import mongoose, { Schema, Document } from 'mongoose';

export interface INotification extends Document {
  user_id: mongoose.Types.ObjectId;
  title: string;
  message: string;
  type: 'approval_request' | 'appointment' | 'medical_update' | 'system';
  related_record?: mongoose.Types.ObjectId;
  metadata?: any;
  is_read: boolean;
  priority: 'low' | 'medium' | 'high';
  created_at: Date;
  read_at?: Date;
}

const NotificationSchema = new Schema({
  user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true },
  message: { type: String, required: true },
  type: { 
    type: String, 
    enum: ['approval_request', 'appointment', 'medical_update', 'system'],
    required: true 
  },
  related_record: { type: Schema.Types.ObjectId, ref: 'MedicalRecord' },
  metadata: { type: Schema.Types.Mixed },
  is_read: { type: Boolean, default: false },
  priority: { 
    type: String, 
    enum: ['low', 'medium', 'high'],
    default: 'medium'
  },
  read_at: { type: Date }
}, {
  timestamps: { 
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  }
});

// Index for faster queries
NotificationSchema.index({ user_id: 1, is_read: 1, created_at: -1 });

export default mongoose.model<INotification>('Notification', NotificationSchema);