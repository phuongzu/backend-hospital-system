import mongoose, { Schema, Document } from 'mongoose';

export interface IDrugCategory extends Document {
  name: string;
  description?: string;
  created_at: Date;
  updated_at: Date;
}

const DrugCategorySchema: Schema = new Schema({
  name: { type: String, required: true, unique: true, trim: true },
  description: { type: String, trim: true }
}, { 
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } 
});

export default mongoose.model<IDrugCategory>('DrugCategory', DrugCategorySchema);