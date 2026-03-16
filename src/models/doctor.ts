import mongoose, { Document, Schema, Model } from 'mongoose';

export interface IDoctor extends Document {
  user_id: mongoose.Types.ObjectId;
  specialty_id: mongoose.Types.ObjectId;
  license_number: string;
  years_of_experience: number;
  available_hours: {
    monday?: { start: string; end: string; isAvailable: boolean };
    tuesday?: { start: string; end: string; isAvailable: boolean };
    wednesday?: { start: string; end: string; isAvailable: boolean };
    thursday?: { start: string; end: string; isAvailable: boolean };
    friday?: { start: string; end: string; isAvailable: boolean };
    saturday?: { start: string; end: string; isAvailable: boolean };
    sunday?: { start: string; end: string; isAvailable: boolean };
  };
  isAvailable: boolean;
  status: 'working' | 'not working' | 'busy';
  consultation_fee: number;
  languages: string[];
  education: string[];
  certifications: string[];
  qualifications: string[];
  achievements: string[];
  avatar?: string;
  createdAt: Date;
  updatedAt: Date;
  experienceLevel: string;
  fullSchedule: object;
}

export interface IDoctorModel extends Model<IDoctor> {
  findBySpecialty(specialtyId: string): Promise<IDoctor[]>;
  findAvailableDoctors(): Promise<IDoctor[]>;
  findByExperience(minYears: number, maxYears?: number): Promise<IDoctor[]>;
}

const doctorSchema = new Schema<IDoctor, IDoctorModel>(
  {
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User ID is required'],
      unique: true,
      index: true,
    },
    specialty_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Specialty',
      required: [true, 'Specialty is required'],
      index: true,
    },
    license_number: {
      type: String,
      required: [true, 'License number is required'],
      unique: true,
      trim: true,
      uppercase: true,
    },
    years_of_experience: {
      type: Number,
      min: [0, 'Experience cannot be negative'],
      max: [50, 'Experience cannot exceed 50 years'],
      default: 0,
    },
    available_hours: {
      monday: {
        start: { type: String, default: '09:00' },
        end: { type: String, default: '17:00' },
        isAvailable: { type: Boolean, default: true },
      },
      tuesday: {
        start: { type: String, default: '09:00' },
        end: { type: String, default: '17:00' },
        isAvailable: { type: Boolean, default: true },
      },
      wednesday: {
        start: { type: String, default: '09:00' },
        end: { type: String, default: '17:00' },
        isAvailable: { type: Boolean, default: true },
      },
      thursday: {
        start: { type: String, default: '09:00' },
        end: { type: String, default: '17:00' },
        isAvailable: { type: Boolean, default: true },
      },
      friday: {
        start: { type: String, default: '09:00' },
        end: { type: String, default: '17:00' },
        isAvailable: { type: Boolean, default: true },
      },
      saturday: {
        start: { type: String, default: '09:00' },
        end: { type: String, default: '13:00' },
        isAvailable: { type: Boolean, default: false },
      },
      sunday: {
        start: { type: String, default: '09:00' },
        end: { type: String, default: '13:00' },
        isAvailable: { type: Boolean, default: false },
      },
    },
    isAvailable: {
      type: Boolean,
      default: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['working', 'not working', 'busy'],
      default: 'working',
      index: true,
    },
    consultation_fee: {
      type: Number,
      min: [0, 'Consultation fee cannot be negative'],
      default: 0,
    },
    languages: [
      {
        type: String,
        trim: true,
        enum: [
          'English', 'Spanish', 'French', 'German', 'Chinese',
          'Japanese', 'Korean', 'Arabic', 'Hindi', 'Vietnamese', 'Other',
        ],
      },
    ],
    education: [{ type: String, trim: true }],
    certifications: [{ type: String, trim: true }],

    // ✅ FIX #6: Thêm qualifications field
    qualifications: [{ type: String, trim: true }],

    // ✅ FIX #6: Thêm achievements field
    achievements: [{ type: String, trim: true }],

    avatar: {
      type: String,
      trim: true,
      default: '',
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Virtuals
doctorSchema.virtual('experienceLevel').get(function () {
  if (this.years_of_experience < 2) return 'Junior';
  if (this.years_of_experience < 5) return 'Intermediate';
  if (this.years_of_experience < 10) return 'Senior';
  return 'Expert';
});

doctorSchema.virtual('fullSchedule').get(function () {
  return Object.keys(this.available_hours).map((day) => ({
    day,
    ...this.available_hours[day as keyof typeof this.available_hours],
  }));
});

// Indexes
doctorSchema.index({ specialty_id: 1, isAvailable: 1 });
doctorSchema.index({ years_of_experience: 1 });
doctorSchema.index({ consultation_fee: 1 });
doctorSchema.index({ createdAt: -1 });
doctorSchema.index({ specialty_id: 1, isAvailable: 1, years_of_experience: 1 });
doctorSchema.index({ isAvailable: 1, consultation_fee: 1 });

// Pre-save validation
doctorSchema.pre('save', function (next) {
  const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;

  for (const day of Object.values(this.available_hours)) {
    if (day && day.isAvailable) {
      if (!timeRegex.test(day.start) || !timeRegex.test(day.end)) {
        return next(new Error('Invalid time format. Use HH:MM format.'));
      }
      const startTime = new Date(`2000-01-01T${day.start}:00`);
      const endTime = new Date(`2000-01-01T${day.end}:00`);
      if (startTime >= endTime) {
        return next(new Error('Start time must be before end time.'));
      }
    }
  }

  next();
});

// Static methods
doctorSchema.statics.findBySpecialty = function (specialtyId: string) {
  return this.find({ specialty_id: specialtyId, isAvailable: true })
    .populate('user_id', 'name email phoneNumber avatar')
    .populate('specialty_id', 'name description icon color');
};

doctorSchema.statics.findAvailableDoctors = function () {
  return this.find({ isAvailable: true })
    .populate('user_id', 'name email phoneNumber avatar')
    .populate('specialty_id', 'name description icon color');
};

doctorSchema.statics.findByExperience = function (
  minYears: number,
  maxYears?: number
) {
  const query: any = { years_of_experience: { $gte: minYears } };
  if (maxYears) query.years_of_experience.$lte = maxYears;
  return this.find(query)
    .populate('user_id', 'name email phoneNumber avatar')
    .populate('specialty_id', 'name description icon color');
};

// Instance method
doctorSchema.methods.isAvailableAt = function (
  day: string,
  time: string
): boolean {
  const daySchedule =
    this.available_hours[day as keyof typeof this.available_hours];
  if (!daySchedule || !daySchedule.isAvailable) return false;
  const requestTime = new Date(`2000-01-01T${time}:00`);
  const startTime = new Date(`2000-01-01T${daySchedule.start}:00`);
  const endTime = new Date(`2000-01-01T${daySchedule.end}:00`);
  return requestTime >= startTime && requestTime <= endTime;
};

export default mongoose.model<IDoctor, IDoctorModel>('Doctor', doctorSchema);