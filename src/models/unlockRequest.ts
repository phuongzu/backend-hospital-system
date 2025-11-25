import mongoose, { Document, Schema } from 'mongoose';

export interface IUnlockRequest extends Document {
  doctor_id: mongoose.Types.ObjectId;
  doctor_email: string;
  doctor_name: string;
  request_reason?: string;
  status: 'pending' | 'approved' | 'rejected';
  submitted_at: Date;
  reviewed_at?: Date;
  reviewed_by?: mongoose.Types.ObjectId;
  admin_notes?: string;
  estimated_unlock_time?: Date;
}

const unlockRequestSchema = new Schema<IUnlockRequest>({
  doctor_id: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  doctor_email: {
    type: String,
    required: true
  },
  doctor_name: {
    type: String,
    required: true
  },
  request_reason: {
    type: String,
    maxlength: 500
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending'
  },
  submitted_at: {
    type: Date,
    default: Date.now
  },
  reviewed_at: {
    type: Date
  },
  reviewed_by: {
    type: Schema.Types.ObjectId,
    ref: 'User'
  },
  admin_notes: {
    type: String,
    maxlength: 500
  },
  estimated_unlock_time: {
    type: Date
  }
}, {
  timestamps: true
});

unlockRequestSchema.index({ doctor_id: 1 });
unlockRequestSchema.index({ status: 1 });
unlockRequestSchema.index({ submitted_at: -1 });

export default mongoose.model<IUnlockRequest>('UnlockRequest', unlockRequestSchema);