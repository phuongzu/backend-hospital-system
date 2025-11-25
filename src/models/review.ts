import mongoose, { Document } from 'mongoose';

export interface IReview extends Document {
  user_id: mongoose.Types.ObjectId;
  doctor_id: mongoose.Types.ObjectId;
  appointment_id: mongoose.Types.ObjectId;
  rating: number;
  comment?: string;
  created_at: Date;
}

const reviewSchema = new mongoose.Schema<IReview>({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  doctor_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Doctor' },
  appointment_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Appointment' },
  rating: { type: Number, min: 1, max: 5, required: true },
  comment: String,
  created_at: { type: Date, default: Date.now },
});

export default mongoose.model<IReview>('Review', reviewSchema);
