// models/chatSession.ts
import mongoose, { Schema, Document } from 'mongoose';

export interface IChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  category?: string;  // Thay đổi từ enum sang string
  confidence?: number;
  suggestedActions?: string[];
  emergencyAlert?: boolean;
  relatedSpecialties?: string[];
  appointmentRecommendation?: {
    shouldBook: boolean;
    urgencyLevel: 'low' | 'medium' | 'high';
    suggestedSpecialty?: string;
    recommendedTimeframe?: string;
    reason?: string;
    symptoms?: string[];
  };
}

export interface IChatSession extends Document {
  user_id: mongoose.Types.ObjectId;
  session_id: string;
  title: string;
  messages: IChatMessage[];
  category: string;  // Thay đổi từ enum sang string
  is_active: boolean;
  last_activity: Date;
  created_at: Date;
  updated_at: Date;
  
  // Virtual methods
  isExpired: boolean;
  messageCount: number;
  duration: number;
}

const ChatMessageSchema = new Schema<IChatMessage>({
  role: { 
    type: String, 
    enum: ['user', 'assistant'], 
    required: true 
  },
  content: { 
    type: String, 
    required: true,
    trim: true,
    maxlength: 10000
  },
  timestamp: { 
    type: Date, 
    default: Date.now 
  },
  category: {
    type: String,  // Bỏ enum, cho phép lưu bất kỳ string nào
    trim: true,
    default: 'general'
  },
  confidence: {
    type: Number,
    min: 0,
    max: 1,
    default: 0.7
  },
  suggestedActions: [{
    type: String,
    trim: true
  }],
  emergencyAlert: {
    type: Boolean,
    default: false
  },
  relatedSpecialties: [{
    type: String,
    trim: true
  }],
  appointmentRecommendation: {
    shouldBook: { 
      type: Boolean, 
      required: false
    },
    urgencyLevel: { 
      type: String, 
      enum: ['low', 'medium', 'high'],  // Giữ enum cho urgencyLevel vì nó cố định
      required: false
    },
    suggestedSpecialty: String,
    recommendedTimeframe: String,
    reason: String,
    symptoms: [String]
  }
}, {
  _id: true
});

const ChatSessionSchema = new Schema<IChatSession>({
  user_id: { 
    type: Schema.Types.ObjectId, 
    ref: 'User',
    required: true,
    index: true 
  },
  session_id: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100,
    default: 'Medical Consultation'
  },
  messages: { 
    type: [ChatMessageSchema], 
    default: [],
    validate: {
      validator: function(messages: IChatMessage[]) {
        return messages.length <= 100;
      },
      message: 'Chat session cannot exceed 100 messages'
    }
  },
  category: {
    type: String,  // Bỏ enum, cho phép lưu bất kỳ string nào
    trim: true,
    index: true,   // Thêm index để tìm kiếm theo category nhanh hơn
    default: 'general'
  },
  is_active: {
    type: Boolean,
    default: true,
    index: true
  },
  last_activity: {
    type: Date,
    default: Date.now,
    index: true
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
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

// Indexes
ChatSessionSchema.index({ user_id: 1, last_activity: -1 });
ChatSessionSchema.index({ user_id: 1, is_active: 1 });
ChatSessionSchema.index({ session_id: 1 });
ChatSessionSchema.index({ last_activity: 1 });
ChatSessionSchema.index({ category: 1 }); // Index cho category

// Virtuals
ChatSessionSchema.virtual('isExpired').get(function() {
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return this.last_activity < twentyFourHoursAgo;
});

ChatSessionSchema.virtual('messageCount').get(function() {
  return this.messages.length;
});

ChatSessionSchema.virtual('duration').get(function() {
  return Math.round((this.updated_at.getTime() - this.created_at.getTime()) / (1000 * 60));
});

// Pre-save middleware
ChatSessionSchema.pre('save', function(next) {
  this.updated_at = new Date();
  
  if (this.isModified('messages') && this.messages.length > 0 && this.title === 'Medical Consultation') {
    const firstUserMessage = this.messages.find(msg => msg.role === 'user');
    if (firstUserMessage) {
      const truncatedContent = firstUserMessage.content.length > 50 
        ? firstUserMessage.content.substring(0, 47) + '...' 
        : firstUserMessage.content;
      this.title = truncatedContent;
    }
  }
  
  next();
});

// Static methods
ChatSessionSchema.statics.findOrCreateActiveSession = async function(userId: mongoose.Types.ObjectId) {
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  
  let activeSession = await this.findOne({
    user_id: userId,
    is_active: true,
    last_activity: { $gte: twentyFourHoursAgo }
  }).sort({ last_activity: -1 });

  if (!activeSession) {
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    activeSession = await this.create({
      user_id: userId,
      session_id: sessionId,
      title: 'New Medical Consultation',
      messages: [],
      is_active: true,
      last_activity: new Date()
    });
  }

  return activeSession;
};

ChatSessionSchema.statics.getUserChatHistory = async function(userId: mongoose.Types.ObjectId, limit: number = 10) {
  return await this.find({
    user_id: userId
  })
  .select('session_id title category messageCount duration created_at updated_at last_activity is_active')
  .sort({ last_activity: -1 })
  .limit(limit);
};

// Thêm method để thống kê theo category
ChatSessionSchema.statics.getCategoryStats = async function(userId: mongoose.Types.ObjectId) {
  return await this.aggregate([
    { $match: { user_id: userId } },
    { $unwind: '$messages' },
    { $match: { 'messages.role': 'assistant' } },
    { $group: {
        _id: '$messages.category',
        count: { $sum: 1 },
        lastUsed: { $max: '$messages.timestamp' }
      }
    },
    { $sort: { count: -1 } }
  ]);
};

ChatSessionSchema.statics.cleanupExpiredSessions = async function() {
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  
  const result = await this.updateMany(
    {
      is_active: true,
      last_activity: { $lt: twentyFourHoursAgo }
    },
    {
      $set: { is_active: false }
    }
  );
  
  return result.modifiedCount;
};

// Instance methods
ChatSessionSchema.methods.addMessage = function(message: Omit<IChatMessage, 'timestamp'>) {
  const newMessage: IChatMessage = {
    ...message,
    timestamp: new Date()
  };
  
  this.messages.push(newMessage);
  this.last_activity = new Date();
  
  if (message.role === 'assistant' && message.category) {
    this.category = message.category;
  }
  
  return this.save();
};

ChatSessionSchema.methods.closeSession = function() {
  this.is_active = false;
  this.last_activity = new Date();
  return this.save();
};

ChatSessionSchema.methods.getSummary = function() {
  return {
    session_id: this.session_id,
    title: this.title,
    category: this.category,
    message_count: this.messages.length,
    duration_minutes: this.duration,
    created_at: this.created_at,
    last_activity: this.last_activity,
    is_active: this.is_active,
    is_expired: this.isExpired
  };
};

export default mongoose.model<IChatSession>('ChatSession', ChatSessionSchema);