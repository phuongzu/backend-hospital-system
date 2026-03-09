  import mongoose, { Schema, Document, Model } from 'mongoose';

  // ==================== INTERFACES ====================

  export interface IChatMessage {
    role: 'user' | 'assistant';
    content: string;
    timestamp: Date;
    category?: string;
    language?: string;
    confidence?: number;
    suggestedActions?: string[];
    emergencyAlert?: boolean;
    relatedSpecialties?: string[];
    followUpQuestions?: string[];
    requiresMoreInfo?: boolean;
    patientContextUsed?: boolean;
    appointmentRecommendation?: {
      shouldBook: boolean;
      urgencyLevel: 'low' | 'medium' | 'high';
      suggestedSpecialty?: string;
      suggestedSpecialtyId?: string;
      recommendedTimeframe?: string;
      reason?: string;
      symptoms?: string[];
      hasExistingAppointment?: boolean;
      contraindications?: string[];
    };
  }

  export interface IChatSession extends Document {
    user_id: mongoose.Types.ObjectId;
    session_id: string;
    title: string;
    messages: IChatMessage[];
    category: string;
    is_active: boolean;
    last_activity: Date;
    created_at: Date;
    updated_at: Date;
    appointments_booked: mongoose.Types.ObjectId[];
    consent_given: boolean;
    consent_timestamp?: Date;
    session_source: 'app' | 'web' | 'api';
    isExpired: boolean;
    messageCount: number;
    duration: number;
    addMessage(message: Omit<IChatMessage, 'timestamp'>): Promise<IChatSession>;
    closeSession(): Promise<IChatSession>;
    getSummary(): object;
  }

  export interface IChatSessionModel extends Model<IChatSession> {
    findOrCreateActiveSession(userId: mongoose.Types.ObjectId, source?: string): Promise<IChatSession>;
    getUserChatHistory(userId: mongoose.Types.ObjectId, limit?: number): Promise<IChatSession[]>;
    cleanupExpiredSessions(): Promise<number>;
    getCategoryStats(userId: mongoose.Types.ObjectId): Promise<Array<{ _id: string; count: number; lastUsed: Date }>>;
  }

  // ==================== MESSAGE SCHEMA ====================

  const ChatMessageSchema = new Schema<IChatMessage>({
    role: { type: String, enum: ['user', 'assistant'], required: true },
    content: { type: String, required: true, trim: true, maxlength: 10000 },
    timestamp: { type: Date, default: Date.now },
    category: { type: String, trim: true, default: 'general' },
    language: { type: String, default: 'vi' },

    confidence: { type: Number, min: 0, max: 1, default: 0.7 },
    suggestedActions: [{ type: String, trim: true }],
    emergencyAlert: { type: Boolean, default: false },
    relatedSpecialties: [{ type: String, trim: true }],
    followUpQuestions: [{ type: String, trim: true }],
    requiresMoreInfo: { type: Boolean, default: false },
    patientContextUsed: { type: Boolean, default: false },
    appointmentRecommendation: {
      shouldBook: Boolean,
      urgencyLevel: { type: String, enum: ['low', 'medium', 'high'] },
      suggestedSpecialty: String,
      suggestedSpecialtyId: String,
      recommendedTimeframe: String,
      reason: String,
      symptoms: [String],
      hasExistingAppointment: Boolean,
      contraindications: [String],
    },
  }, { _id: true });

  // ==================== SESSION SCHEMA ====================

  const ChatSessionSchema = new Schema<IChatSession, IChatSessionModel>({
    user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    session_id: { type: String, required: true, unique: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 100, default: 'Medical Consultation' },
    messages: {
      type: [ChatMessageSchema],
      default: [],
      validate: {
        validator: (msgs: IChatMessage[]) => msgs.length <= 200,
        message: 'Session cannot exceed 200 messages',
      },
    },
    category: { type: String, trim: true, index: true, default: 'general' },
    is_active: { type: Boolean, default: true, index: true },
    last_activity: { type: Date, default: Date.now, index: true },
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now },
    appointments_booked: [{ type: Schema.Types.ObjectId, ref: 'Appointment' }],
    consent_given: { type: Boolean, default: false },
    consent_timestamp: { type: Date },
    session_source: { type: String, enum: ['app', 'web', 'api'], default: 'app' },
  }, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  });

  // ==================== INDEXES ====================

  ChatSessionSchema.index({ user_id: 1, last_activity: -1 });
  ChatSessionSchema.index({ user_id: 1, is_active: 1 });
  ChatSessionSchema.index({ session_id: 1 });
  ChatSessionSchema.index({ last_activity: 1 });
  ChatSessionSchema.index({ category: 1 });
  ChatSessionSchema.index(
    { title: 'text', 'messages.content': 'text' },
    {
      default_language: 'none',
      language_override: '_dummy_lang',
      weights: { title: 10, 'messages.content': 1 },
    }
  );

  // ==================== VIRTUALS ====================

  ChatSessionSchema.virtual('isExpired').get(function () {
    return this.last_activity < new Date(Date.now() - 24 * 60 * 60 * 1000);
  });

  ChatSessionSchema.virtual('messageCount').get(function () {
    return this.messages.length;
  });

  ChatSessionSchema.virtual('duration').get(function () {
    return Math.round((this.updated_at.getTime() - this.created_at.getTime()) / 60000);
  });

  // ==================== PRE-SAVE ====================

  ChatSessionSchema.pre('save', function (next) {
    this.updated_at = new Date();
    if (this.isModified('messages') && this.messages.length > 0 && this.title === 'Medical Consultation') {
      const firstUser = this.messages.find(m => m.role === 'user');
      if (firstUser) {
        this.title = firstUser.content.length > 50
          ? firstUser.content.substring(0, 47) + '...'
          : firstUser.content;
      }
    }
    next();
  });

  // ==================== STATIC METHODS ====================

  ChatSessionSchema.statics.findOrCreateActiveSession = async function (
    userId: mongoose.Types.ObjectId,
    source = 'app'
  ) {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    let session = await this.findOne({
      user_id: userId,
      is_active: true,
      last_activity: { $gte: cutoff },
    }).sort({ last_activity: -1 });

    if (!session) {
      const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      session = await this.create({
        user_id: userId,
        session_id: sessionId,
        title: 'New Medical Consultation',
        messages: [],
        is_active: true,
        last_activity: new Date(),
        session_source: source,
      });
    }
    return session;
  };

  ChatSessionSchema.statics.getUserChatHistory = async function (
    userId: mongoose.Types.ObjectId,
    limit = 10
  ) {
    return this.find({ user_id: userId })
      .select('session_id title category messages created_at updated_at last_activity is_active appointments_booked')
      .sort({ last_activity: -1 })
      .limit(limit);
  };

  ChatSessionSchema.statics.cleanupExpiredSessions = async function () {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const result = await this.updateMany(
      { is_active: true, last_activity: { $lt: cutoff } },
      { $set: { is_active: false } }
    );
    return result.modifiedCount;
  };

  ChatSessionSchema.statics.getCategoryStats = async function (userId: mongoose.Types.ObjectId) {
    return this.aggregate([
      { $match: { user_id: userId } },
      { $unwind: '$messages' },
      { $match: { 'messages.role': 'assistant' } },
      { $group: { _id: '$messages.category', count: { $sum: 1 }, lastUsed: { $max: '$messages.timestamp' } } },
      { $sort: { count: -1 } },
    ]);
  };

  // ==================== INSTANCE METHODS ====================

  ChatSessionSchema.methods.addMessage = function (message: Omit<IChatMessage, 'timestamp'>) {
    this.messages.push({ ...message, timestamp: new Date() });
    this.last_activity = new Date();
    if (message.role === 'assistant' && message.category) this.category = message.category;
    return this.save();
  };

  ChatSessionSchema.methods.closeSession = function () {
    this.is_active = false;
    this.last_activity = new Date();
    return this.save();
  };

  ChatSessionSchema.methods.getSummary = function () {
    return {
      session_id: this.session_id,
      title: this.title,
      category: this.category,
      message_count: this.messages.length,
      duration_minutes: this.duration,
      created_at: this.created_at,
      last_activity: this.last_activity,
      is_active: this.is_active,
      is_expired: this.isExpired,
      appointments_booked: this.appointments_booked?.length || 0,
      consent_given: this.consent_given,
    };
  };
  export async function searchSessionsByContent(
    userId: mongoose.Types.ObjectId,
    query: string,
    limit = 20
  ) {
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'iu');

    return mongoose.model('ChatSession').find({
      user_id: userId,
      $or: [
        { title: { $regex: regex } },
        { 'messages.content': { $regex: regex } },
      ],
    })
      .select('session_id title messages created_at last_activity')
      .sort({ last_activity: -1 })
      .limit(limit)
      .lean();
  }

  export default mongoose.model<IChatSession, IChatSessionModel>('ChatSession', ChatSessionSchema);