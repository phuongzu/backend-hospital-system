import mongoose, { Document } from 'mongoose';

export interface IAppointment extends Document {
  user_id: mongoose.Types.ObjectId;
  doctor_id: mongoose.Types.ObjectId;
  specialty_id: mongoose.Types.ObjectId;
  appointment_date: Date;
  time_slot: string;
  status: 'pending' | 'confirmed' | 'completed' | 'cancelled';
  reason?: string;
  notes?: string;
  created_at: Date;
}

const appointmentSchema = new mongoose.Schema<IAppointment>({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  doctor_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Doctor', required: true },
  specialty_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Specialty' },
  appointment_date: { type: Date, required: true },
  time_slot: { type: String, required: true },
  status: { type: String, enum: ['pending', 'confirmed', 'completed', 'cancelled'], default: 'pending' },
  reason: String,
  notes: String,
  created_at: { type: Date, default: Date.now },
});

export default mongoose.model<IAppointment>('Appointment', appointmentSchema);
