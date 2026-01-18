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
appointmentSchema.pre('save', async function(next) {
  const appointment = this;
  
  // Kiểm tra trùng lịch trước khi save
  if (appointment.isNew) {
    const startOfDay = new Date(appointment.appointment_date);
    startOfDay.setHours(0, 0, 0, 0);
    
    const endOfDay = new Date(appointment.appointment_date);
    endOfDay.setHours(23, 59, 59, 999);

    const existing = await mongoose.model('Appointment').findOne({
      doctor_id: appointment.doctor_id,
      appointment_date: { $gte: startOfDay, $lte: endOfDay },
      time_slot: appointment.time_slot,
      status: { $in: ['pending', 'confirmed', 'in_progress'] },
      _id: { $ne: appointment._id }
    });

    if (existing) {
      const error = new Error(`Doctor already has an appointment at ${appointment.time_slot} on ${appointment.appointment_date.toLocaleDateString()}`);
      error.name = 'DuplicateAppointmentError';
      return next(error);
    }
  }
  
  next();
});

export default mongoose.model<IAppointment>('Appointment', appointmentSchema);
