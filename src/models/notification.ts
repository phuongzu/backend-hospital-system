import mongoose, { Schema, Document, Model } from 'mongoose';

// ==================== TYPES ====================

export type NotificationType =
  | 'system'
  | 'appointment'
  | 'treatment'
  | 'treatment_update'
  | 'medication'
  | 'reminder'
  | 'emergency'
  | 'approval'
  | 'approval_request'
  | 'approval_response'
  | 'message'
  | 'medical_record'
  | 'consultation'
  | 'security';

export type NotificationCategory = 'info' | 'warning' | 'success' | 'error' | 'urgent';

export type NotificationPriority = 'low' | 'medium' | 'high' | 'urgent';

export type NotificationChannel = 'in_app' | 'email' | 'sms' | 'push' | 'whatsapp';

export type RelatedRecordType =
  | 'appointment'
  | 'medical_record'
  | 'consultation'
  | 'message'
  | 'prescription'
  | 'lab_result'
  | 'user';

// ==================== INTERFACES ====================

export interface INotificationResponse {
  id: unknown;
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
  action_url?: string;
  action_label?: string;
  created_at: Date;
  is_expired: boolean;
  metadata?: Record<string, any>;
}

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

  // Instance methods
  markAsRead(): Promise<this>;
  markAsClicked(): Promise<this>;
  toNotificationResponse(): INotificationResponse;
}

export interface INotificationModel extends Model<INotification> {
  // Static methods
  getUnreadCount(userId: string): Promise<number>;
  markAllAsRead(userId: string): Promise<mongoose.UpdateWriteOpResult>;
  cleanupExpired(): Promise<mongoose.DeleteResult>;
}

// ==================== SCHEMA ====================

const notificationSchema = new Schema<INotification, INotificationModel>(
  {
    user_id: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 1000,
    },
    type: {
      type: String,
      enum: [
        'system',
        'appointment',
        'treatment',
        'treatment_update',
        'medication',
        'reminder',
        'emergency',
        'approval',
        'approval_request',
        'approval_response',
        'message',
        'medical_record',
        'consultation',
        'security',
      ],
      default: 'system',
      index: true,
    },
    category: {
      type: String,
      enum: ['info', 'warning', 'success', 'error', 'urgent'],
      default: 'info',
    },
    priority: {
      type: String,
      enum: ['low', 'medium', 'high', 'urgent'],
      default: 'medium',
    },
    data: {
      type: Schema.Types.Mixed,
      default: {},
    },
    related_record: {
      type: Schema.Types.ObjectId,
      refPath: 'related_record_type',
      index: true,
    },
    related_record_type: {
      type: String,
      enum: ['appointment', 'medical_record', 'consultation', 'message',
             'prescription', 'lab_result', 'user', null],
      default: null,
    },
    channels: [
      {
        type: String,
        enum: ['in_app', 'email', 'sms', 'push', 'whatsapp'],
        default: ['in_app'],
      },
    ],
    read: {
      type: Boolean,
      default: false,
      index: true,
    },
    read_at: { type: Date },
    delivered: {
      type: Boolean,
      default: false,
      index: true,
    },
    delivered_at: { type: Date },
    clicked: {
      type: Boolean,
      default: false,
    },
    clicked_at: { type: Date },
    expiry_date: {
      type: Date,
      index: true,
    },
    action_url: { type: String, trim: true },
    action_label: { type: String, trim: true, maxlength: 50 },
    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ==================== INDEXES ====================

notificationSchema.index({ user_id: 1, created_at: -1 });
notificationSchema.index({ user_id: 1, read: 1, created_at: -1 });
notificationSchema.index({ type: 1, created_at: -1 });
notificationSchema.index({ priority: 1, created_at: -1 });

// ==================== VIRTUALS ====================

notificationSchema.virtual('user', {
  ref: 'User',
  localField: 'user_id',
  foreignField: '_id',
  justOne: true,
});

// ==================== MIDDLEWARE ====================

notificationSchema.pre('save', function (next) {
  if (this.isNew) {
    this.delivered = true;
    this.delivered_at = new Date();
  }
  next();
});

// ==================== STATIC METHODS ====================

notificationSchema.statics.getUnreadCount = async function (userId: string) {
  return this.countDocuments({
    user_id: userId,
    read: false,
    expiry_date: { $gt: new Date() },
  });
};

notificationSchema.statics.markAllAsRead = async function (userId: string) {
  return this.updateMany(
    { user_id: userId, read: false },
    { $set: { read: true, read_at: new Date() } }
  );
};

notificationSchema.statics.cleanupExpired = async function () {
  return this.deleteMany({ expiry_date: { $lt: new Date() } });
};

// ==================== INSTANCE METHODS ====================

notificationSchema.methods.markAsRead = function () {
  this.read = true;
  this.read_at = new Date();
  return this.save();
};

notificationSchema.methods.markAsClicked = function () {
  this.clicked = true;
  this.clicked_at = new Date();
  return this.save();
};

notificationSchema.methods.toNotificationResponse = function (): INotificationResponse {
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
    metadata: obj.metadata,
  };
};

// ==================== EXPORT ====================

const Notification = mongoose.model<INotification, INotificationModel>(
  'Notification',
  notificationSchema
);

export default Notification;