import mongoose, { Schema, Document } from 'mongoose';

export interface IUserDevice extends Document {
  user_id: mongoose.Types.ObjectId;
  device_token: string;
  device_type: 'web' | 'ios' | 'android';
  platform: string;
  browser?: string;
  is_active: boolean;
  last_active: Date;
  created_at: Date;
}

const userDeviceSchema = new Schema<IUserDevice>({
  user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  device_token: { type: String, required: true },
  device_type: { 
    type: String, 
    enum: ['web', 'ios', 'android'],
    required: true 
  },
  platform: { type: String },
  browser: { type: String },
  is_active: { type: Boolean, default: true },
  last_active: { type: Date, default: Date.now },
  created_at: { type: Date, default: Date.now }
});

// Ensure one active token per device
userDeviceSchema.index({ user_id: 1, device_token: 1 }, { unique: true });
userDeviceSchema.index({ device_token: 1 });

export default mongoose.model<IUserDevice>('UserDevice', userDeviceSchema);