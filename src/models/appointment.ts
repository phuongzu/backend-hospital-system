import mongoose, { Document } from 'mongoose';

export interface IAppointment extends Document {
  user_id: mongoose.Types.ObjectId;
  doctor_id: mongoose.Types.ObjectId;
  specialty_id: mongoose.Types.ObjectId;
  appointment_date: Date;
  time_slot: string;
  status: 'pending' | 'scheduled' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled';
  reason?: string;
  notes?: string;
  created_at: Date;
  updated_at?: Date | null;
  is_re_examination: boolean;
  re_examination_step_id: mongoose.Types.ObjectId;
  re_examination_type?: 'followup' | 'physical' | 'lab';
  
  // Metadata for tracking
  metadata?: {
    consultation_id?: string;
    step_number?: number;
    step_title?: string;
    arrival_confirmed_at?: Date;
    physical_exam_completed_at?: Date;
    lab_test_completed_at?: Date;
    diagnosis_made_at?: Date;
    treatment_plan_created_at?: Date;
    treatment_plan_updated_at?: Date;
    doctor_notes_updated_at?: Date;
    patient_notes_updated_at?: Date;
    completed_by?: String;
    updated_by?: String;
    completed_at?: Date;
    previous_date?: Date;
    previous_time?: string;
    rescheduled_at?: Date;
  };
}

const appointmentSchema = new mongoose.Schema<IAppointment>({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  doctor_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Doctor', required: true },
  specialty_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Specialty' },
  appointment_date: { type: Date, required: true },
  time_slot: { type: String, required: true },
  status: { type: String, enum: ['pending', 'confirmed', 'completed', 'cancelled','scheduled'], default: 'pending' },
  reason: String,
  re_examination_step_id: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'MedicalRecord.treatment_plan._id',
    sparse: true
  },
  is_re_examination: { 
    type: Boolean, 
    default: false 
  },
  notes: String,
  created_at: { type: Date, default: Date.now },
});
appointmentSchema.pre('save', async function(next) {
  const appointment = this;
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
