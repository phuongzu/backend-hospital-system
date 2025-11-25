import mongoose, { Document, Schema, Model } from 'mongoose';

export interface ISpecialty extends Document {
  name: string;
  description?: string;
  icon?: string;
  color?: string;
  isActive: boolean;
  doctorCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ISpecialtyModel extends Model<ISpecialty> {
  findActiveSpecialties(): Promise<ISpecialty[]>;
  findByName(name: string): Promise<ISpecialty | null>;
  updateDoctorCount(specialtyId: string): Promise<void>;
}

const specialtySchema = new Schema<ISpecialty, ISpecialtyModel>(
  {
    name: { 
      type: String, 
      required: [true, 'Specialty name is required'],
      unique: true,
      trim: true,
      minlength: [2, 'Specialty name must be at least 2 characters'],
      maxlength: [50, 'Specialty name cannot exceed 50 characters']
    },
    description: { 
      type: String, 
      trim: true,
      maxlength: [500, 'Description cannot exceed 500 characters']
    },
    icon: { 
      type: String, 
      trim: true,
      default: '🏥'
    },
    color: { 
      type: String, 
      trim: true,
      default: '#3B82F6',
      match: [/^#[0-9A-F]{6}$/i, 'Color must be a valid hex color']
    },
    isActive: { 
      type: Boolean, 
      default: true,
      index: true
    },
    doctorCount: { 
      type: Number, 
      default: 0,
      min: [0, 'Doctor count cannot be negative']
    }
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// Virtual for specialty status
specialtySchema.virtual('status').get(function() {
  return this.isActive ? 'active' : 'inactive';
});

// Virtual for specialty category
specialtySchema.virtual('category').get(function() {
  const categories: { [key: string]: string[] } = {
    'Surgery': ['Cardiovascular Surgery', 'Orthopedic Surgery', 'Neurosurgery', 'General Surgery'],
    'Medicine': ['Cardiology', 'Neurology', 'Endocrinology', 'Gastroenterology'],
    'Diagnostic': ['Radiology', 'Pathology', 'Laboratory Medicine'],
    'Emergency': ['Emergency Medicine', 'Trauma Surgery', 'Critical Care'],
    'Pediatric': ['Pediatric Surgery', 'Pediatric Medicine', 'Neonatology']
  };
  
  for (const [category, specialties] of Object.entries(categories)) {
    if (specialties.some(spec => this.name.includes(spec) || spec.includes(this.name))) {
      return category;
    }
  }
  return 'Other';
});

// Indexes for better query performance
specialtySchema.index({ name: 1 }, { unique: true });
specialtySchema.index({ isActive: 1, doctorCount: -1 });
specialtySchema.index({ createdAt: -1 });

// Pre-save middleware to capitalize first letter
specialtySchema.pre('save', function(next) {
  if (this.isModified('name')) {
    this.name = this.name.charAt(0).toUpperCase() + this.name.slice(1).toLowerCase();
  }
  next();
});

// Static method to find active specialties
specialtySchema.statics.findActiveSpecialties = function() {
  return this.find({ isActive: true }).sort({ name: 1 });
};

// Static method to find specialty by name
specialtySchema.statics.findByName = function(name: string) {
  return this.findOne({ 
    name: { $regex: new RegExp(name, 'i') },
    isActive: true 
  });
};

// Static method to update doctor count
specialtySchema.statics.updateDoctorCount = async function(specialtyId: string) {
  const Doctor = mongoose.model('Doctor');
  const count = await Doctor.countDocuments({ specialty_id: specialtyId, isAvailable: true });
  
  await this.findByIdAndUpdate(specialtyId, { doctorCount: count });
};

export default mongoose.model<ISpecialty, ISpecialtyModel>('Specialty', specialtySchema);
