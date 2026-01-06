import mongoose, { Schema, Document, Model } from 'mongoose';
import User from '../models/user';

export interface INotification extends Document {
  user_id: mongoose.Types.ObjectId;
  title: string;
  message: string;
  type: NotificationType;
  category: NotificationCategory;
  priority: NotificationPriority;
  data?: Record<string, any>;
  related_record?: mongoose.Types.ObjectId;
  related_record_type?: RelatedRecordType;
  channels: NotificationChannel[];
  read: boolean;
  read_at?: Date;
  delivered: boolean;
  delivered_at?: Date;
  clicked: boolean;
  clicked_at?: Date;
  expiry_date?: Date;
  action_url?: string;
  action_label?: string;
  metadata?: Record<string, any>;
  created_at: Date;
  updated_at: Date;
}

export type NotificationType = 
  | 'system'           // Thông báo hệ thống
  | 'appointment'      // Lịch hẹn
  | 'treatment'        // Điều trị
  | 'treatment_update'  
  | 'medication'       // Thuốc
  | 'reminder'         // Nhắc nhở
  | 'emergency'        // Khẩn cấp
  | 'approval'         // Phê duyệt
  | 'approval_request'      // 👈 thêm
  | 'approval_response' 
  | 'message'          // Tin nhắn
  | 'medical_record'   // Hồ sơ y tế
  | 'consultation'     // Tư vấn
  | 'security';        // Bảo mật

export type NotificationCategory = 
  | 'info'     // Thông tin
  | 'warning'  // Cảnh báo
  | 'success'  // Thành công
  | 'error'    // Lỗi
  | 'urgent';  // Khẩn cấp

export type NotificationPriority = 
  | 'low'      // Thấp
  | 'medium'   // Trung bình
  | 'high'     // Cao
  | 'urgent';  // Khẩn cấp

export type NotificationChannel = 
  | 'in_app'   // Trong ứng dụng
  | 'email'    // Email
  | 'sms'      // SMS
  | 'push'     // Push notification
  | 'whatsapp'; // WhatsApp

export type RelatedRecordType = 
  | 'appointment'
  | 'medical_record'
  | 'consultation'
  | 'message'
  | 'prescription'
  | 'lab_result'
  | 'user';

const notificationSchema = new Schema<INotification>({
  user_id: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200
  },
  message: {
    type: String,
    required: true,
    trim: true,
    maxlength: 1000
  },
  type: {
    type: String,
    enum: [
      'system',
      'appointment',
      'treatment',
      'medication',
    'reminder',
    'emergency',
    'approval',
    'approval_request',     // 👈 thêm
    'approval_response',    // 👈 thêm
    'message',
    'medical_record',
    'consultation',
    'security'
  ],
  default: 'system',
  index: true
},

  category: {
    type: String,
    enum: ['info', 'warning', 'success', 'error', 'urgent'],
    default: 'info'
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium'
  },
  data: {
    type: Schema.Types.Mixed,
    default: {}
  },
  related_record: {
    type: Schema.Types.ObjectId,
    refPath: 'related_record_type',
    index: true
  },
  related_record_type: {
    type: String,
    enum: ['appointment', 'medical_record', 'consultation', 'message', 
           'prescription', 'lab_result', 'user', null],
    default: null
  },
  channels: [{
    type: String,
    enum: ['in_app', 'email', 'sms', 'push', 'whatsapp'],
    default: ['in_app']
  }],
  read: {
    type: Boolean,
    default: false,
    index: true
  },
  read_at: {
    type: Date
  },
  delivered: {
    type: Boolean,
    default: false,
    index: true
  },
  delivered_at: {
    type: Date
  },
  clicked: {
    type: Boolean,
    default: false
  },
  clicked_at: {
    type: Date
  },
  expiry_date: {
    type: Date,
    index: true
  },
  action_url: {
    type: String,
    trim: true
  },
  action_label: {
    type: String,
    trim: true,
    maxlength: 50
  },
  metadata: {
    type: Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: {
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  },
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for performance
notificationSchema.index({ user_id: 1, created_at: -1 });
notificationSchema.index({ user_id: 1, read: 1, created_at: -1 });
notificationSchema.index({ type: 1, created_at: -1 });
notificationSchema.index({ priority: 1, created_at: -1 });
notificationSchema.index({ expiry_date: 1 }, { expireAfterSeconds: 0 });

// Virtual populate
notificationSchema.virtual('user', {
  ref: 'User',
  localField: 'user_id',
  foreignField: '_id',
  justOne: true
});

// Pre-save middleware
notificationSchema.pre('save', function(next) {
  if (this.isNew) {
    this.delivered = true;
    this.delivered_at = new Date();
  }
  next();
});

// Static methods
notificationSchema.statics.getUnreadCount = async function(userId: string) {
  return this.countDocuments({ 
    user_id: userId, 
    read: false,
    expiry_date: { $gt: new Date() } || { $exists: false }
  });
};

notificationSchema.statics.markAllAsRead = async function(userId: string) {
  return this.updateMany(
    { 
      user_id: userId, 
      read: false 
    },
    { 
      $set: { 
        read: true, 
        read_at: new Date() 
      } 
    }
  );
};

notificationSchema.statics.cleanupExpired = async function() {
  return this.deleteMany({
    expiry_date: { $lt: new Date() }
  });
};

// Instance methods
notificationSchema.methods.markAsRead = function() {
  this.read = true;
  this.read_at = new Date();
  return this.save();
};

notificationSchema.methods.markAsClicked = function() {
  this.clicked = true;
  this.clicked_at = new Date();
  return this.save();
};

notificationSchema.methods.toNotificationResponse = function() {
  const obj = this.toObject();
  
  return {
    id: obj._id,
    title: obj.title,
    message: obj.message,
    type: obj.type,
    category: obj.category,
    priority: obj.priority,
    data: obj.data,
    related_record: obj.related_record,
    related_record_type: obj.related_record_type,
    channels: obj.channels,
    read: obj.read,
    read_at: obj.read_at,
    delivered: obj.delivered,
    delivered_at: obj.delivered_at,
    clicked: obj.clicked,
    action_url: obj.action_url,
    action_label: obj.action_label,
    created_at: obj.created_at,
    is_expired: obj.expiry_date ? new Date() > obj.expiry_date : false,
    metadata: obj.metadata
  };
};

const Notification = mongoose.model<INotification>('Notification', notificationSchema);

export default Notification;
