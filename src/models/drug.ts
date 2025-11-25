import mongoose, { Schema, Document } from 'mongoose';


export interface IDrugSpecialtyIndication {
  specialty_name: string;
  indication: string;
  notes?: string;
  is_contraindicated: boolean;
}

export interface IDrug extends Document {
  name: string;
  generic_name: string;
  brand?: string; // Updated from brand_name to match frontend
  description?: string;
  price: number;
  currency: string;
  stock_quantity: number;
  form: string;
  strength: string;
  unit: string; // New field
  manufacturer?: string;
  category_id: mongoose.Types.ObjectId; // New field
  expiry_date?: Date; // New field
  
  specialty_data: IDrugSpecialtyIndication[];
  
  created_at: Date;
  updated_at: Date;
}

const DrugSchema: Schema = new Schema({
  name: { type: String, required: true, trim: true },
  generic_name: { type: String, required: true, trim: true },
  brand: { type: String, trim: true }, // Aligned with frontend 'brand'
  description: { type: String },
  
  // Pricing and Inventory
  price: { type: Number, default: 0, min: 0 },
  currency: { type: String, default: 'USD', uppercase: true },
  stock_quantity: { type: Number, default: 0, min: 0 },
  
  // Physical properties
  form: { type: String, required: true }, // e.g., Tablet, Syrup
  strength: { type: String, required: true }, // e.g., 500mg
  unit: { type: String, required: true, default: 'tablet' }, // e.g., tablet, bottle, strip
  manufacturer: { type: String },
  expiry_date: { type: Date },

  // Classification
  category_id: { 
    type: Schema.Types.ObjectId, 
    ref: 'DrugCategory',
    required: false // Optional initially to prevent breaking existing data
  },

  // Specialty Indications
  specialty_data: [{
    specialty_name: { 
      type: String, 
    },
    indication: { type: String },
    notes: { type: String },
    is_contraindicated: { type: Boolean, default: false }
  }],

  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now }
});

// Middleware to update the 'updated_at' field on save
DrugSchema.pre('save', function(next: any) {
  this.updated_at = new Date();
  next();
});

export default mongoose.model<IDrug>('Drug', DrugSchema);