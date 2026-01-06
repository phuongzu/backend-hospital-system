import mongoose, { Schema, Document } from 'mongoose';

export interface INotificationDevice extends Document {
  user_id: mongoose.Types.ObjectId;
  device_token: string;
  device_type: DeviceType;
  platform: PlatformType;
  browser?: string;
  os_version?: string;
  app_version?: string;
  language: string;
  timezone: string;
  is_active: boolean;
  last_active: Date;
  push_enabled: boolean;
  created_at: Date;
  updated_at: Date;
}

export type DeviceType = 'ios' | 'android' | 'web' | 'desktop';
export type PlatformType = 'web' | 'mobile' | 'tablet' | 'desktop';

const notificationDeviceSchema = new Schema<INotificationDevice>({
  user_id: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  device_token: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  device_type: {
    type: String,
    enum: ['ios', 'android', 'web', 'desktop'],
    required: true
  },
  platform: {
    type: String,
    enum: ['web', 'mobile', 'tablet', 'desktop'],
    required: true
  },
  browser: {
    type: String,
    trim: true
  },
  os_version: {
    type: String,
    trim: true
  },
  app_version: {
    type: String,
    trim: true
  },
  language: {
    type: String,
    default: 'en',
    trim: true
  },
  timezone: {
    type: String,
    default: 'UTC',
    trim: true
  },
  is_active: {
    type: Boolean,
    default: true,
    index: true
  },
  last_active: {
    type: Date,
    default: Date.now
  },
  push_enabled: {
    type: Boolean,
    default: true
  },
  created_at: {
    type: Date,
    default: Date.now
  },
  updated_at: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: {
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  }
});

// Indexes
notificationDeviceSchema.index({ user_id: 1, is_active: 1 });
notificationDeviceSchema.index({ device_token: 1, is_active: 1 });
notificationDeviceSchema.index({ updated_at: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 }); // 90 days

// Pre-save middleware
notificationDeviceSchema.pre('save', function(next) {
  this.updated_at = new Date();
  next();
});

// Static methods
notificationDeviceSchema.statics.getActiveDevices = async function(userId: string) {
  return this.find({ 
    user_id: userId, 
    is_active: true,
    push_enabled: true
  });
};

notificationDeviceSchema.statics.deactivateDevice = async function(deviceToken: string) {
  return this.findOneAndUpdate(
    { device_token: deviceToken },
    { 
      $set: { 
        is_active: false,
        updated_at: new Date()
      } 
    }
  );
};

const NotificationDevice = mongoose.model<INotificationDevice>('NotificationDevice', notificationDeviceSchema);

export default NotificationDevice;
