import mongoose, { Schema, Document } from 'mongoose';

export interface IDoctorRegistrationRequest extends Document {
  name: string;
  email: string;
  phoneNumber: string;
  specialty_id: mongoose.Types.ObjectId;
  license_number: string;
  years_of_experience: number;
  consultation_fee: number;
  status: 'pending' | 'approved' | 'rejected';
  submitted_at: Date;
  reviewed_by?: mongoose.Types.ObjectId;
  reviewed_at?: Date;
  admin_notes?: string;
}

const DoctorRegistrationRequestSchema: Schema = new Schema({
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    trim: true
  },
  phoneNumber: {
    type: String,
    required: [true, 'Phone number is required'],
    trim: true
  },
  specialty_id: {
    type: Schema.Types.ObjectId,
    ref: 'Specialty',
    required: [true, 'Specialty is required']
  },
  license_number: {
    type: String,
    required: [true, 'License number is required'],
    unique: true,
    trim: true
  },
  years_of_experience: {
    type: Number,
    required: [true, 'Years of experience is required'],
    min: 0
  },
  consultation_fee: {
    type: Number,
    required: [true, 'Consultation fee is required'],
    min: 0
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
  reviewed_by: {
    type: Schema.Types.ObjectId,
    ref: 'User'
  },
  reviewed_at: {
    type: Date
  },
  admin_notes: {
    type: String,
    trim: true
  }
}, {
  timestamps: true
});

// Index for better query performance
DoctorRegistrationRequestSchema.index({ status: 1, submitted_at: -1 });

export default mongoose.models.DoctorRegistrationRequest
  ? mongoose.model<IDoctorRegistrationRequest>('DoctorRegistrationRequest')
  : mongoose.model<IDoctorRegistrationRequest>('DoctorRegistrationRequest', DoctorRegistrationRequestSchema);