import mongoose, { Document } from 'mongoose';

export interface IPrescription extends Document {
  record_id: mongoose.Types.ObjectId;
  medicine_name: string;
  dosage: string;
  frequency: string;
  duration: string;
}

const prescriptionSchema = new mongoose.Schema<IPrescription>({
  record_id: { type: mongoose.Schema.Types.ObjectId, ref: 'MedicalRecord' },
  medicine_name: { type: String, required: true },
  dosage: String,
  frequency: String,
  duration: String,
});

export default mongoose.model<IPrescription>('Prescription', prescriptionSchema);
