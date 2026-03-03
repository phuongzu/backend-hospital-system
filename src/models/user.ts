import mongoose, { Document, Schema } from 'mongoose';

export interface IUser extends Document {
  name: string;
  email: string;
  password: string;
  role: 'patient' | 'doctor' | 'admin';
  phoneNumber?: string;
  isActive: boolean;
  refreshToken?: string;
  lastLogin?: Date;
  createdAt: Date;
  updatedAt: Date;
  dateOfBirth?: string;
  gender?: string;
  address?: string;
  avatar?: string;
  status?: 'working' | 'busy' | 'not working';
  dayOff?: string[];
  loginAttempts?: number;
  isLocked?: boolean;
  lockedAt?: Date;
  lockedBy?: Schema.Types.ObjectId;
  
  updateDoctorStatus?: (hasAppointment: boolean, todayIsDayOff: boolean) => Promise<void>;
}

const userSchema = new Schema<IUser>(
  {
    name: { type: String, required: true, trim: true },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: { type: String, required: true },
    role: {
      type: String,
      enum: ['patient', 'doctor', 'admin'],
      default: 'patient',
    },
    phoneNumber: { type: String, trim: true },
    isActive: { type: Boolean, default: true },
    refreshToken: { type: String },
    lastLogin: { type: Date },
    dateOfBirth: { type: String, trim: true },
    gender: { type: String, trim: true },
    address: { type: String, trim: true },
    avatar: { type: String, default: '' },
    status: {
      type: String,
      enum: ['working', 'busy', 'not working'],
      default: function(this: IUser) {
        return this.role === 'doctor' ? 'working' : undefined;
      }
    },
    dayOff: [{ type: String }],
        loginAttempts: { 
      type: Number, 
      default: 0
    },
    isLocked: {
      type: Boolean,
      default: false
    },
    lockedAt: {
      type: Date
    },
    lockedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User'
    }
  },
  {
    timestamps: true,
  }
);

// Helper to update status for doctors
userSchema.methods.updateDoctorStatus = async function(hasAppointment: boolean, todayIsDayOff: boolean) {
  if (this.role !== 'doctor') return;
  if (todayIsDayOff) {
    this.status = 'not working';
  } else if (hasAppointment) {
    this.status = 'busy';
  } else {
    this.status = 'working';
  }
  await this.save();
};

userSchema.index({ role: 1 });

export default mongoose.model<IUser>('User', userSchema);