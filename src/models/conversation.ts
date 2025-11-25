import mongoose from 'mongoose';

const conversationSchema = new mongoose.Schema({
  participant_ids: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }],
  medical_record_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'MedicalRecord'
  },
  appointment_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Appointment'
  },
  last_message: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Message'
  },
  last_message_at: {
    type: Date,
    default: Date.now
  },
  unread_count: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

// Tạo compound index để đảm bảo unique conversation cho mỗi cặp participant + medical_record
conversationSchema.index(
  { 
    participant_ids: 1,
    medical_record_id: 1 
  }, 
  { 
    unique: true,
    partialFilterExpression: { medical_record_id: { $exists: true } }
  }
);

// Index cho conversations không có medical_record_id
conversationSchema.index(
  { participant_ids: 1 },
  { 
    unique: true,
    partialFilterExpression: { medical_record_id: { $exists: false } }
  }
);

export default mongoose.model('Conversation', conversationSchema);
