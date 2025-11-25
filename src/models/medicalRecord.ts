import mongoose, { Document, Schema, Model } from 'mongoose';

export interface TreatmentStep {
  stepNumber: number;
  title: string;
  description: string;
  medication?: string;
  dosage?: string;
  duration?: string;
  instructions?: string;
  status: 'pending' | 'in-progress' | 'completed' | 'approved';
  completedAt?: Date;
  patientMessage?: string;
  doctorNotes?: string;
}

export interface VitalSigns {
  blood_pressure?: string;
  heart_rate?: number;
  temperature?: number;
  weight?: number;
  height?: number;
  oxygen_saturation?: number;
  respiratory_rate?: number;
  blood_sugar?: number;
}

export interface LabResult {
  test_name: string;
  result: string;
  normal_range: string;
  unit: string;
  date: Date;
  notes?: string;
}

export interface Prescription {
  medication: string;
  dosage: string;
  frequency: string;
  duration: string;
  instructions?: string;
  quantity: number;
  refills: number;
}

export interface IMedicalRecord extends Document {
  // Core Information
  user_id: mongoose.Types.ObjectId;
  doctor_id: mongoose.Types.ObjectId;
  appointment_id: mongoose.Types.ObjectId;
  
  // Medical Information
  diagnosis: string;
  treatment: string;
  symptoms: string[];
  medical_history?: string[];
  allergies?: string[];
  current_medications?: string[];
  
  // Clinical Data
  vital_signs: VitalSigns;
  lab_results: LabResult[];
  prescriptions: Prescription[];
  
  // Treatment Plan System
  treatment_plan: TreatmentStep[];
  current_step: number;
  consultation_status: 'in-progress' | 'completed' | 'cancelled';
  
  // Medical Status
  status: 'active' | 'resolved' | 'follow_up' | 'chronic';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  severity: 'mild' | 'moderate' | 'severe' | 'critical';
  
  // Additional Information
  notes?: string;
  follow_up_date?: Date;
  next_appointment?: Date;
  referral?: string;
  
  // Timestamps
  created_at: Date;
  updated_at: Date;
  
  // Virtuals
  age: number;
  bmi: number;
  recordType: string;
  progress: number;
  isFollowUpRequired: boolean;
}

export interface IMedicalRecordModel extends Model<IMedicalRecord> {
  // Core Query Methods
  findByPatient(userId: string): Promise<IMedicalRecord[]>;
  findByDoctor(doctorId: string): Promise<IMedicalRecord[]>;
  findByStatus(status: string): Promise<IMedicalRecord[]>;
  findByPriority(priority: string): Promise<IMedicalRecord[]>;
  findRecentRecords(limit?: number): Promise<IMedicalRecord[]>;
  
  // New Methods for Treatment System
  findActiveByDoctor(doctorId: string): Promise<IMedicalRecord | null>;
  findByAppointment(appointmentId: string): Promise<IMedicalRecord | null>;
  findWithTreatmentPlan(doctorId: string): Promise<IMedicalRecord[]>;
  getPatientMedicalHistory(userId: string): Promise<IMedicalRecord[]>;
}

const medicalRecordSchema = new Schema<IMedicalRecord, IMedicalRecordModel>(
  {
    // Core Information
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Patient ID is required'],
      index: true
    },
    doctor_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Doctor ID is required'],
      index: true
    },
    appointment_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Appointment',
      required: [true, 'Appointment ID is required'],
      index: true
    },
    
    // Medical Information
    diagnosis: {
      type: String,
      required: [true, 'Diagnosis is required'],
      trim: true,
      minlength: [3, 'Diagnosis must be at least 3 characters'],
      maxlength: [500, 'Diagnosis cannot exceed 500 characters']
    },
    treatment: {
      type: String,
      trim: true,
      minlength: [3, 'Treatment must be at least 3 characters'],
      maxlength: [1000, 'Treatment cannot exceed 1000 characters']
    },
    symptoms: [{
      type: String,
      trim: true,
      minlength: [2, 'Symptom must be at least 2 characters']
    }],
    medical_history: [{
      type: String,
      trim: true
    }],
    allergies: [{
      type: String,
      trim: true
    }],
    current_medications: [{
      type: String,
      trim: true
    }],
    
    // Clinical Data
    vital_signs: {
      blood_pressure: {
        type: String,
        match: [/^\d{2,3}\/\d{2,3}$/, 'Blood pressure format: systolic/diastolic (e.g., 120/80)']
      },
      heart_rate: {
        type: Number,
        min: [30, 'Heart rate cannot be below 30'],
        max: [200, 'Heart rate cannot exceed 200']
      },
      temperature: {
        type: Number,
        min: [30, 'Temperature cannot be below 30°C'],
        max: [45, 'Temperature cannot exceed 45°C']
      },
      weight: {
        type: Number,
        min: [0.5, 'Weight cannot be below 0.5 kg'],
        max: [500, 'Weight cannot exceed 500 kg']
      },
      height: {
        type: Number,
        min: [30, 'Height cannot be below 30 cm'],
        max: [250, 'Height cannot exceed 250 cm']
      },
      oxygen_saturation: {
        type: Number,
        min: [70, 'Oxygen saturation cannot be below 70%'],
        max: [100, 'Oxygen saturation cannot exceed 100%']
      },
      respiratory_rate: {
        type: Number,
        min: [8, 'Respiratory rate cannot be below 8'],
        max: [60, 'Respiratory rate cannot exceed 60']
      },
      blood_sugar: {
        type: Number,
        min: [20, 'Blood sugar cannot be below 20 mg/dL'],
        max: [500, 'Blood sugar cannot exceed 500 mg/dL']
      }
    },
    
    lab_results: [{
      test_name: {
        type: String,
        required: true,
        trim: true
      },
      result: {
        type: String,
        required: true,
        trim: true
      },
      normal_range: {
        type: String,
        trim: true
      },
      unit: {
        type: String,
        trim: true
      },
      date: {
        type: Date,
        default: Date.now
      },
      notes: {
        type: String,
        trim: true
      }
    }],
    
    prescriptions: [{
      medication: {
        type: String,
        required: true,
        trim: true
      },
      dosage: {
        type: String,
        required: true,
        trim: true
      },
      frequency: {
        type: String,
        required: true,
        trim: true
      },
      duration: {
        type: String,
        required: true,
        trim: true
      },
      instructions: {
        type: String,
        trim: true
      },
      quantity: {
        type: Number,
        required: true,
        min: [1, 'Quantity must be at least 1']
      },
      refills: {
        type: Number,
        default: 0,
        min: [0, 'Refills cannot be negative']
      }
    }],
    
    // Treatment Plan System
    treatment_plan: [{
      stepNumber: {
        type: Number,
        required: true
      },
      title: {
        type: String,
        required: true,
        trim: true,
        minlength: [3, 'Step title must be at least 3 characters']
      },
      description: {
        type: String,
        required: true,
        trim: true,
        minlength: [10, 'Step description must be at least 10 characters']
      },
      medication: {
        type: String,
        trim: true
      },
      dosage: {
        type: String,
        trim: true
      },
      duration: {
        type: String,
        trim: true
      },
      instructions: {
        type: String,
        trim: true
      },
      status: {
        type: String,
        enum: ['pending', 'in-progress', 'completed', 'approved'],
        default: 'pending'
      },
      completedAt: {
        type: Date
      },
      patientMessage: {
        type: String,
        trim: true,
        maxlength: [500, 'Patient message cannot exceed 500 characters']
      },
      doctorNotes: {
        type: String,
        trim: true,
        maxlength: [500, 'Doctor notes cannot exceed 500 characters']
      }
    }],
    
    current_step: {
      type: Number,
      default: 1,
      min: [1, 'Current step must be at least 1']
    },
    
    consultation_status: {
      type: String,
      enum: ['in-progress', 'completed', 'cancelled'],
      default: 'in-progress',
      index: true
    },
    
    // Medical Status
    status: {
      type: String,
      enum: {
        values: ['active', 'resolved', 'follow_up', 'chronic'],
        message: 'Status must be active, resolved, follow_up, or chronic'
      },
      default: 'active',
      index: true
    },
    
    priority: {
      type: String,
      enum: {
        values: ['low', 'medium', 'high', 'urgent'],
        message: 'Priority must be low, medium, high, or urgent'
      },
      default: 'medium',
      index: true
    },
    
    severity: {
      type: String,
      enum: {
        values: ['mild', 'moderate', 'severe', 'critical'],
        message: 'Severity must be mild, moderate, severe, or critical'
      },
      default: 'mild',
      index: true
    },
    
    // Additional Information
    notes: {
      type: String,
      trim: true,
      maxlength: [2000, 'Notes cannot exceed 2000 characters']
    },
    
    follow_up_date: {
      type: Date,
      validate: {
        validator: function(this: IMedicalRecord, value: Date) {
          return !value || value > new Date();
        },
        message: 'Follow-up date must be in the future'
      }
    },
    
    next_appointment: {
      type: Date,
      validate: {
        validator: function(this: IMedicalRecord, value: Date) {
          return !value || value > new Date();
        },
        message: 'Next appointment must be in the future'
      }
    },
    
    referral: {
      type: String,
      trim: true
    },
    
    // Timestamps
    created_at: {
      type: Date,
      default: Date.now,
      index: true
    },
    
    updated_at: {
      type: Date,
      default: Date.now
    }
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// ==================== VIRTUAL PROPERTIES ====================

// Virtual for age calculation
medicalRecordSchema.virtual('age').get(function() {
  // This would need to be populated from User model with birth date
  // For now, return null - will be calculated when user data is populated
  return null;
});

// Virtual for BMI calculation
medicalRecordSchema.virtual('bmi').get(function() {
  if (this.vital_signs?.weight && this.vital_signs?.height) {
    const weightKg = this.vital_signs.weight;
    const heightM = this.vital_signs.height / 100;
    const bmi = weightKg / (heightM * heightM);
    return Math.round(bmi * 10) / 10; // Round to 1 decimal place
  }
  return null;
});

// Virtual for record type classification
medicalRecordSchema.virtual('recordType').get(function() {
  if (this.lab_results && this.lab_results.length > 0) return 'Lab Results';
  if (this.prescriptions && this.prescriptions.length > 0) return 'Prescription';
  if (this.vital_signs && Object.keys(this.vital_signs).length > 0) return 'Vital Signs';
  if (this.diagnosis) return 'Diagnosis';
  return 'General';
});

// Virtual for treatment progress calculation
medicalRecordSchema.virtual('progress').get(function() {
  if (this.treatment_plan.length === 0) return 0;
  
  const completedSteps = this.treatment_plan.filter(step => 
    step.status === 'completed' || step.status === 'approved'
  ).length;
  
  return Math.round((completedSteps / this.treatment_plan.length) * 100);
});

// Virtual for follow-up requirement
medicalRecordSchema.virtual('isFollowUpRequired').get(function() {
  return !!this.follow_up_date || this.status === 'follow_up';
});

// ==================== INDEXES ====================

// Core indexes
medicalRecordSchema.index({ user_id: 1, created_at: -1 });
medicalRecordSchema.index({ doctor_id: 1, created_at: -1 });
medicalRecordSchema.index({ status: 1, priority: 1 });
medicalRecordSchema.index({ consultation_status: 1 });
medicalRecordSchema.index({ follow_up_date: 1 });
medicalRecordSchema.index({ next_appointment: 1 });

// Compound indexes for common queries
medicalRecordSchema.index({ user_id: 1, status: 1, created_at: -1 });
medicalRecordSchema.index({ doctor_id: 1, status: 1, priority: 1 });
medicalRecordSchema.index({ doctor_id: 1, consultation_status: 1 });
medicalRecordSchema.index({ priority: 1, severity: 1 });

// Text search indexes
medicalRecordSchema.index({ diagnosis: 'text', symptoms: 'text', notes: 'text' });

// ==================== MIDDLEWARE ====================

// Pre-save middleware to update timestamps
medicalRecordSchema.pre('save', function(next) {
  this.updated_at = new Date();
  
  // Auto-update consultation status based on treatment plan
  if (this.treatment_plan.length > 0) {
    const allStepsCompleted = this.treatment_plan.every(step => 
      step.status === 'completed' || step.status === 'approved'
    );
    
    if (allStepsCompleted && this.consultation_status === 'in-progress') {
      this.consultation_status = 'completed';
      this.status = 'resolved';
    }
  }
  
  next();
});

// Pre-save middleware to validate vital signs
medicalRecordSchema.pre('save', function(next) {
  const vitals = this.vital_signs;
  
  if (vitals?.blood_pressure) {
    const [systolic, diastolic] = vitals.blood_pressure.split('/').map(Number);
    if (systolic < diastolic) {
      return next(new Error('Systolic pressure must be higher than diastolic pressure'));
    }
    if (systolic > 300 || diastolic > 200) {
      return next(new Error('Blood pressure values are outside reasonable range'));
    }
  }
  
  if (vitals?.weight && vitals?.height) {
    const bmi = vitals.weight / Math.pow(vitals.height / 100, 2);
    if (bmi > 100 || bmi < 10) {
      return next(new Error('BMI calculation seems incorrect. Please verify weight and height.'));
    }
  }
  
  next();
});

// Pre-save middleware to validate treatment steps
medicalRecordSchema.pre('save', function(next) {
  // Ensure step numbers are sequential and unique
  const stepNumbers = this.treatment_plan.map(step => step.stepNumber);
  const uniqueStepNumbers = [...new Set(stepNumbers)];
  
  if (stepNumbers.length !== uniqueStepNumbers.length) {
    return next(new Error('Treatment step numbers must be unique'));
  }
  
  // Check if step numbers are sequential
  const sortedSteps = [...stepNumbers].sort((a, b) => a - b);
  for (let i = 0; i < sortedSteps.length; i++) {
    if (sortedSteps[i] !== i + 1) {
      return next(new Error('Treatment step numbers must be sequential starting from 1'));
    }
  }
  
  next();
});

// ==================== STATIC METHODS ====================

// Find records by patient
medicalRecordSchema.statics.findByPatient = function(userId: string) {
  return this.find({ user_id: userId })
    .populate('doctor_id', 'name email specialty')
    .populate('appointment_id', 'appointment_date appointment_time reason')
    .sort({ created_at: -1 });
};

// Find records by doctor
medicalRecordSchema.statics.findByDoctor = function(doctorId: string) {
  return this.find({ doctor_id: doctorId })
    .populate('user_id', 'name email phoneNumber dateOfBirth gender bloodGroup allergies')
    .populate('appointment_id', 'appointment_date appointment_time')
    .sort({ created_at: -1 });
};

// Find records by status
medicalRecordSchema.statics.findByStatus = function(status: string) {
  return this.find({ status })
    .populate('user_id', 'name email phoneNumber')
    .populate('doctor_id', 'name email')
    .sort({ created_at: -1 });
};

// Find records by priority
medicalRecordSchema.statics.findByPriority = function(priority: string) {
  return this.find({ priority })
    .populate('user_id', 'name email phoneNumber')
    .populate('doctor_id', 'name email')
    .sort({ priority: -1, created_at: -1 });
};

// Find recent records
medicalRecordSchema.statics.findRecentRecords = function(limit: number = 10) {
  return this.find()
    .populate('user_id', 'name email phoneNumber')
    .populate('doctor_id', 'name email')
    .sort({ created_at: -1 })
    .limit(limit);
};

// Find active consultation by doctor
medicalRecordSchema.statics.findActiveByDoctor = function(doctorId: string) {
  return this.findOne({ 
    doctor_id: doctorId, 
    consultation_status: 'in-progress' 
  })
    .populate('user_id', 'name email phoneNumber dateOfBirth gender bloodGroup allergies')
    .populate('appointment_id')
    .sort({ updated_at: -1 });
};

// Find record by appointment
medicalRecordSchema.statics.findByAppointment = function(appointmentId: string) {
  return this.findOne({ appointment_id: appointmentId })
    .populate('user_id', 'name email phoneNumber dateOfBirth gender')
    .populate('doctor_id', 'name email specialty');
};

// Find records with treatment plans
medicalRecordSchema.statics.findWithTreatmentPlan = function(doctorId: string) {
  return this.find({ 
    doctor_id: doctorId,
    'treatment_plan.0': { $exists: true } // Has at least one treatment step
  })
    .populate('user_id', 'name email phoneNumber')
    .sort({ updated_at: -1 });
};

// Get patient medical history
medicalRecordSchema.statics.getPatientMedicalHistory = function(userId: string) {
  return this.find({ user_id: userId })
    .populate('doctor_id', 'name email specialty')
    .select('diagnosis symptoms treatment_plan prescriptions created_at status')
    .sort({ created_at: -1 });
};

// ==================== INSTANCE METHODS ====================

// Add treatment step
medicalRecordSchema.methods.addTreatmentStep = function(stepData: Omit<TreatmentStep, 'stepNumber' | 'status'>) {
  const stepNumber = this.treatment_plan.length + 1;
  const newStep: TreatmentStep = {
    stepNumber,
    ...stepData,
    status: stepNumber === 1 ? 'in-progress' : 'pending'
  };
  
  this.treatment_plan.push(newStep);
  
  // Update current step if this is the first step
  if (stepNumber === 1) {
    this.current_step = 1;
  }
  
  return this.save();
};

// Approve treatment step
medicalRecordSchema.methods.approveStep = function(stepNumber: number, doctorNotes?: string) {
  const step = this.treatment_plan.find((s: TreatmentStep) => s.stepNumber === stepNumber);
  
  if (!step) {
    throw new Error(`Step ${stepNumber} not found`);
  }
  
  if (step.status !== 'completed') {
    throw new Error('Can only approve completed steps');
  }
  
  step.status = 'approved';
  step.doctorNotes = doctorNotes;
  
  // Activate next step if exists
  const nextStep = this.treatment_plan.find((s: TreatmentStep) => s.stepNumber === stepNumber + 1);
  if (nextStep && nextStep.status === 'pending') {
    nextStep.status = 'in-progress';
    this.current_step = stepNumber + 1;
  } else if (!nextStep) {
    // If this is the last step, complete the consultation
    this.consultation_status = 'completed';
    this.status = 'resolved';
  }
  
  return this.save();
};

// Complete treatment step (for patient)
medicalRecordSchema.methods.completeStep = function(stepNumber: number, patientMessage?: string) {
  const step = this.treatment_plan.find((s: TreatmentStep) => s.stepNumber === stepNumber);
  
  if (!step) {
    throw new Error(`Step ${stepNumber} not found`);
  }
  
  if (step.status !== 'in-progress') {
    throw new Error('Can only complete steps that are in progress');
  }
  
  step.status = 'completed';
  step.completedAt = new Date();
  step.patientMessage = patientMessage;
  
  return this.save();
};

// Update step status
medicalRecordSchema.methods.updateStepStatus = function(stepNumber: number, status: TreatmentStep['status']) {
  const step = this.treatment_plan.find((s: TreatmentStep) => s.stepNumber === stepNumber);
  
  if (!step) {
    throw new Error(`Step ${stepNumber} not found`);
  }
  
  step.status = status;
  
  if (status === 'completed') {
    step.completedAt = new Date();
  }
  
  return this.save();
};

// Add lab result
medicalRecordSchema.methods.addLabResult = function(
  testName: string, 
  result: string, 
  normalRange: string, 
  unit: string, 
  notes?: string
) {
  this.lab_results.push({
    test_name: testName,
    result,
    normal_range: normalRange,
    unit,
    notes,
    date: new Date()
  });
  
  return this.save();
};

// Add prescription
medicalRecordSchema.methods.addPrescription = function(prescriptionData: Omit<Prescription, '_id'>) {
  this.prescriptions.push(prescriptionData);
  return this.save();
};

// Update vital signs
medicalRecordSchema.methods.updateVitalSigns = function(vitalSigns: Partial<VitalSigns>) {
  this.vital_signs = { ...this.vital_signs, ...vitalSigns };
  return this.save();
};

// Complete consultation
medicalRecordSchema.methods.completeConsultation = function() {
  this.consultation_status = 'completed';
  this.status = 'resolved';
  this.updated_at = new Date();
  
  return this.save();
};

// Get current active step
medicalRecordSchema.methods.getCurrentStep = function(): TreatmentStep | null {
  return this.treatment_plan.find((step: TreatmentStep) => step.stepNumber === this.current_step) || null;
};

// Get step by number
medicalRecordSchema.methods.getStep = function(stepNumber: number): TreatmentStep | null {
  return this.treatment_plan.find((step: TreatmentStep) => step.stepNumber === stepNumber) || null;
};

// Check if step exists
medicalRecordSchema.methods.hasStep = function(stepNumber: number): boolean {
  return this.treatment_plan.some((step: TreatmentStep) => step.stepNumber === stepNumber);
};

// Get completed steps count
medicalRecordSchema.methods.getCompletedStepsCount = function(): number {
  return this.treatment_plan.filter((step: TreatmentStep) => 
    step.status === 'completed' || step.status === 'approved'
  ).length;
};

// Get pending steps count
medicalRecordSchema.methods.getPendingStepsCount = function(): number {
  return this.treatment_plan.filter((step: TreatmentStep) => 
    step.status === 'pending' || step.status === 'in-progress'
  ).length;
};

// Check if consultation is completable
medicalRecordSchema.methods.isCompletable = function(): boolean {
  return this.treatment_plan.length > 0 && 
         this.treatment_plan.every(step => 
           step.status === 'completed' || step.status === 'approved'
         );
};

export default mongoose.model<IMedicalRecord, IMedicalRecordModel>('MedicalRecord', medicalRecordSchema);