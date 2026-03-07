import mongoose, { Document, Schema, Model } from 'mongoose';

export interface ISpecialty extends Document {
  name: string;
  description?: string;
  icon?: string;
  color?: string;
  isActive: boolean;
  doctorCount: number;
  category: string;
  keywords: string[];
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
      maxlength: [50, 'Specialty name cannot exceed 50 characters'],
    },
    description: {
      type: String,
      trim: true,
      maxlength: [500, 'Description cannot exceed 500 characters'],
    },
    icon: {
      type: String,
      trim: true,
      default: '🏥',
    },
    color: {
      type: String,
      trim: true,
      default: '#3B82F6',
      match: [/^#[0-9A-F]{6}$/i, 'Color must be a valid hex color'],
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    doctorCount: {
      type: Number,
      default: 0,
      min: [0, 'Doctor count cannot be negative'],
    },

    // ✅ FIX #4: category là field thực (không phải virtual)
    category: {
      type: String,
      trim: true,
      default: 'Other',
      index: true,
      enum: ['Surgery', 'Medicine', 'Diagnostic', 'Emergency', 'Pediatric', 'Other'],
    },

    // ✅ FIX #4: keywords là field thực để SpecialtyManager query được
    keywords: [
      {
        type: String,
        trim: true,
        lowercase: true,
      },
    ],
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ✅ Virtual status (giữ nguyên virtual vì không cần lưu DB)
specialtySchema.virtual('status').get(function () {
  return this.isActive ? 'active' : 'inactive';
});

// Indexes
specialtySchema.index({ name: 1 }, { unique: true });
specialtySchema.index({ isActive: 1, doctorCount: -1 });
specialtySchema.index({ category: 1, isActive: 1 });
specialtySchema.index({ keywords: 1 });
specialtySchema.index({ createdAt: -1 });

// ✅ Pre-save: tự động sinh keywords từ name + description nếu chưa có
specialtySchema.pre('save', function (next) {
  // Chuẩn hóa tên
  if (this.isModified('name')) {
    this.name =
      this.name.charAt(0).toUpperCase() + this.name.slice(1);
  }

  // Tự động sinh keywords nếu chưa có hoặc rỗng
  if (
    this.isModified('name') ||
    this.isModified('description') ||
    !this.keywords ||
    this.keywords.length === 0
  ) {
    const baseKeywords = new Set<string>();

    // Từ tên chuyên khoa
    this.name
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 2)
      .forEach((w) => baseKeywords.add(w));

    // Từ description
    if (this.description) {
      this.description
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 3)
        .forEach((w) => baseKeywords.add(w));
    }

    // Từ category
    if (this.category) {
      baseKeywords.add(this.category.toLowerCase());
    }

    // Thêm full name
    baseKeywords.add(this.name.toLowerCase());

    this.keywords = [...baseKeywords];
  }

  // Tự động detect category từ tên nếu chưa được set
  if (this.isModified('name') && this.category === 'Other') {
    const categoryMap: Record<string, string[]> = {
      Surgery: ['surgery', 'phẫu thuật', 'ngoại khoa'],
      Medicine: [
        'cardiology', 'neurology', 'endocrinology', 'gastroenterology',
        'tim', 'thần kinh', 'nội tiết', 'tiêu hóa', 'nội khoa',
      ],
      Diagnostic: ['radiology', 'pathology', 'laboratory', 'chẩn đoán', 'xét nghiệm'],
      Emergency: ['emergency', 'trauma', 'critical', 'cấp cứu', 'hồi sức'],
      Pediatric: ['pediatric', 'nhi', 'trẻ em'],
    };

    const lowerName = this.name.toLowerCase();
    for (const [cat, terms] of Object.entries(categoryMap)) {
      if (terms.some((t) => lowerName.includes(t))) {
        this.category = cat;
        break;
      }
    }
  }

  next();
});

// Static methods
specialtySchema.statics.findActiveSpecialties = function () {
  return this.find({ isActive: true }).sort({ name: 1 });
};

specialtySchema.statics.findByName = function (name: string) {
  return this.findOne({
    name: { $regex: new RegExp(name, 'i') },
    isActive: true,
  });
};

specialtySchema.statics.updateDoctorCount = async function (
  specialtyId: string
) {
  const Doctor = mongoose.model('Doctor');
  const count = await Doctor.countDocuments({
    specialty_id: specialtyId,
    isAvailable: true,
  });
  await this.findByIdAndUpdate(specialtyId, { doctorCount: count });
};

export default mongoose.model<ISpecialty, ISpecialtyModel>(
  'Specialty',
  specialtySchema
);