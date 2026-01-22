// models/medicalRecord.ts
import mongoose, { Document, Schema, Model } from 'mongoose';

// ==================== INTERFACES ====================

export interface TreatmentStep {
  stepNumber: number;
  title: string;
  description: string;
  medication?: string;
  dosage?: string;
  duration?: string;
  instructions?: string;
  status: 'pending' | 'in-progress' | 'completed' | 'approved' | 'rejected' | 'scheduled' | 'waiting_for_patient_approval' | 'patient_suggested';  
  completedAt?: Date;
  createdAt?: Date;
  approvedAt?: Date;
  startedAt?: Date;
  condition_description?: string; // Added field for condition reports
  patientMessage?: string;
  patient_feedback?: string;
  doctorNotes?: string;
  approval_requested?: boolean;
  approval_requested_at?: Date;
  rejectionReason?: string;
  rejectedAt?: Date;
  requires_followup?: boolean;  // NEW: Yêu cầu tái khám
  followup_reason?: string;     // NEW: Lý do tái khám

  needsReExamination?: boolean;           // Cần tái khám
  isReExaminationVisit?: boolean;         // Đây là bước tái khám
  reExaminationScheduled?: boolean;       // Đã lên lịch tái khám
  reExaminationDate?: Date;              // Ngày tái khám
  reExaminationTime?: string;            // Giờ tái khám (ví dụ: "09:00")
  reExaminationAppointmentId?: mongoose.Types.ObjectId; // ID appointment
  reExaminationNotes?: string;           // Ghi chú tái khám
  arrivalConfirmed?: boolean;            // Đã xác nhận đến khám
  arrivalConfirmedAt?: Date;             // Thời gian xác nhận
  
  _id?: string;
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
  reason?: string;
  
  // Clinical Data
  vital_signs: VitalSigns;
  lab_results: LabResult[];
  prescriptions: Prescription[];
  
  // Treatment Plan System
  treatment_plan: TreatmentStep[];
  current_step: number;
  consultation_status: 'scheduled' | 'in-progress' | 'completed' | 'cancelled';
  
  // Medical Status
  status: 'pending' | 'active' | 'resolved' | 'follow_up' | 'chronic';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  severity: 'mild' | 'moderate' | 'severe' | 'critical';
  
  // Additional Information
  notes?: string;
  follow_up_instructions?: string;
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
  hasPendingFeedback: boolean;  // NEW: Kiểm tra feedback đang chờ
  
  // Instance Methods
  addTreatmentStep(stepData: Omit<TreatmentStep, 'stepNumber' | 'status'>): Promise<this>;
  approveStep(stepNumber: number, doctorNotes?: string): Promise<this>;
  completeStep(stepNumber: number, patientMessage?: string): Promise<this>;
  submitPatientFeedback(stepNumber: number, feedback: string): Promise<this>;  // NEW
  doctorDecision(stepNumber: number, decision: 'approve' | 'approve_and_add_step' | 'approve_and_complete', 
                doctorNotes?: string, newStepData?: Omit<TreatmentStep, 'stepNumber' | 'status'>): Promise<this>;  // NEW
  updateStepStatus(stepNumber: number, status: TreatmentStep['status']): Promise<this>;
  addLabResult(testName: string, result: string, normalRange: string, unit: string, notes?: string): Promise<this>;
  addPrescription(prescriptionData: Omit<Prescription, '_id'>): Promise<this>;
  updateVitalSigns(vitalSigns: Partial<VitalSigns>): Promise<this>;
  completeConsultation(): Promise<this>;
  getCurrentStep(): TreatmentStep | null;
  getStep(stepNumber: number): TreatmentStep | null;
  hasStep(stepNumber: number): boolean;
  getCompletedStepsCount(): number;
  getPendingStepsCount(): number;
  isCompletable(): boolean;
  canComplete(): boolean;
  getCompletionStatus(): {
    total: number;
    approved: number;
    completed: number;
    in_progress: number;
    pending: number;
    can_finalize: boolean;
    consultation_status: string;
  };
  getStepsWithFeedback(): TreatmentStep[];  // NEW
  hasPendingDoctorDecision(): boolean;  // NEW
}

export interface IMedicalRecordModel extends Model<IMedicalRecord> {
  // Core Query Methods
  findByPatient(userId: string): Promise<IMedicalRecord[]>;
  findByDoctor(doctorId: string): Promise<IMedicalRecord[]>;
  findByStatus(status: string): Promise<IMedicalRecord[]>;
  findByPriority(priority: string): Promise<IMedicalRecord[]>;
  findRecentRecords(limit?: number): Promise<IMedicalRecord[]>;
  
  // Treatment System Methods
  findActiveByDoctor(doctorId: string): Promise<IMedicalRecord | null>;
  findByAppointment(appointmentId: string): Promise<IMedicalRecord | null>;
  findWithTreatmentPlan(doctorId: string): Promise<IMedicalRecord[]>;
  getPatientMedicalHistory(userId: string): Promise<IMedicalRecord[]>;
  findByDoctorWithPendingFeedback(doctorId: string): Promise<IMedicalRecord[]>;  // NEW
}

// ==================== SCHEMA ====================

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
    reason: {
      type: String,
      trim: true
    },
    
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
      createdAt: {
        type: Date,
        default: Date.now
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
        enum: ['pending', 'in-progress', 'completed', 'approved', 'rejected', 'scheduled'],
        default: 'pending'
      },
        needsReExamination: {
        type: Boolean,
        default: false
      },
      isReExaminationVisit: {
        type: Boolean,
        default: false
      },
      completedAt: {
        type: Date
      },
      approvedAt: {
        type: Date
      },
      startedAt: {
        type: Date
      },
      patientMessage: {
        type: String,
        trim: true,
        maxlength: [500, 'Patient message cannot exceed 500 characters']
      },
      condition_description: {
        type: String,
        trim: true,
        maxlength: [1000, 'Condition description cannot exceed 1000 characters']
      },
      patient_feedback: {  // NEW
        type: String,
        trim: true,
        maxlength: [1000, 'Patient feedback cannot exceed 1000 characters']
      },
      doctorNotes: {
        type: String,
        trim: true,
        maxlength: [500, 'Doctor notes cannot exceed 500 characters']
      },
      approval_requested: {
        type: Boolean,
        default: false
      },
      approval_requested_at: {
        type: Date
      },
      rejectionReason: {
        type: String,
        trim: true
      },
      rejectedAt: {
        type: Date
      },
      requires_followup: {  // NEW
        type: Boolean,
        default: false
      },
      followup_reason: {  // NEW
        type: String,
        trim: true
      }
    }],
    
    current_step: {
      type: Number,
      default: 1,
      min: [1, 'Current step must be at least 1']
    },
    
    consultation_status: {
      type: String,
      enum: ['scheduled', 'in-progress', 'completed', 'cancelled'],
      default: 'in-progress',
      index: true
    },
    
    // Medical Status
    status: {
      type: String,
      enum: {
        values: ['pending', 'active', 'resolved', 'follow_up', 'chronic'],
        message: 'Status must be pending, active, resolved, follow_up, or chronic'
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
    
    follow_up_instructions: {
      type: String,
      trim: true
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
  return null;
});

// Virtual for BMI calculation
medicalRecordSchema.virtual('bmi').get(function() {
  if (this.vital_signs?.weight && this.vital_signs?.height) {
    const weightKg = this.vital_signs.weight;
    const heightM = this.vital_signs.height / 100;
    const bmi = weightKg / (heightM * heightM);
    return Math.round(bmi * 10) / 10;
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

// NEW: Check if there are steps with pending feedback
medicalRecordSchema.virtual('hasPendingFeedback').get(function() {
  return this.treatment_plan.some(step => 
    step.status === 'completed' && step.patient_feedback && !step.approval_requested
  );
});

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
  
  if (stepNumber === 1) {
    this.current_step = 1;
  }
  
  return this.save();
};

// Submit patient feedback
medicalRecordSchema.methods.submitPatientFeedback = function(stepNumber: number, feedback: string) {
  const step = this.treatment_plan.find((s: TreatmentStep) => s.stepNumber === stepNumber);
  
  if (!step) {
    throw new Error(`Step ${stepNumber} not found`);
  }
  
  if (step.status !== 'completed') {
    throw new Error('Step must be completed before submitting feedback');
  }
  
  step.patient_feedback = feedback;
  step.approval_requested = true;
  step.approval_requested_at = new Date();
  
  return this.save();
};

// Doctor decision on step
medicalRecordSchema.methods.doctorDecision = function(
  stepNumber: number,
  decision: 'approve' | 'approve_and_add_step' | 'approve_and_complete' | 'approve_needs_re_examination',
  doctorNotes?: string,
  newStepData?: Omit<TreatmentStep, 'stepNumber' | 'status'>
) {
  const step = this.treatment_plan.find((s: TreatmentStep) => s.stepNumber === stepNumber);
  
  if (!step) {
    throw new Error(`Step ${stepNumber} not found`);
  }
  
  if (step.status !== 'completed') {
    throw new Error('Step must be completed before doctor decision');
  }
  
  // Update current step
  step.status = 'approved';
  step.doctorNotes = doctorNotes;
  step.approvedAt = new Date();
  step.approval_requested = false;
  
  // Process decision
  if (decision === 'approve_needs_re_examination') {
    // Đánh dấu cần tái khám, KHÔNG tự tạo lịch
    step.needsReExamination = true;
    step.requires_followup = true;
    step.followup_reason = doctorNotes;
    
  } else if (decision === 'approve_and_add_step') {
    // Add new follow-up step
    const newStepNumber = this.treatment_plan.length + 1;
    const newStep: TreatmentStep = {
      stepNumber: newStepNumber,
      title: newStepData?.title || 'Follow-up Treatment',
      description: newStepData?.description || 'Additional treatment based on patient feedback',
      medication: newStepData?.medication,
      dosage: newStepData?.dosage,
      duration: newStepData?.duration,
      instructions: newStepData?.instructions,
      status: 'pending',
      requires_followup: true,
      followup_reason: doctorNotes
    };
    this.treatment_plan.push(newStep);
    
  } else if (decision === 'approve_and_complete') {
    // Approve all completed steps
    this.treatment_plan.forEach((s: TreatmentStep) => {
      if (s.status === 'completed') {
        s.status = 'approved';
        s.approvedAt = new Date();
      }
    });
    
    // Complete consultation
    this.consultation_status = 'completed';
    this.status = 'resolved';
    this.updated_at = new Date();
  }
  
  // Activate next step if exists
  const nextStep = this.treatment_plan.find((s: TreatmentStep) => s.stepNumber === stepNumber + 1);
  if (nextStep && nextStep.status === 'pending') {
    nextStep.status = 'in-progress';
    nextStep.startedAt = new Date();
    this.current_step = stepNumber + 1;
  }
  
  return this.save();
};
  

// Get steps with patient feedback
medicalRecordSchema.methods.getStepsWithFeedback = function(): TreatmentStep[] {
  return this.treatment_plan.filter((step: TreatmentStep) => 
    step.patient_feedback && step.approval_requested
  );
};

// Check if has pending doctor decisions
medicalRecordSchema.methods.hasPendingDoctorDecision = function(): boolean {
  return this.treatment_plan.some((step: TreatmentStep) => 
    step.status === 'completed' && step.patient_feedback && step.approval_requested
  );
};

// ==================== STATIC METHODS ====================

// Find records by doctor with pending feedback
medicalRecordSchema.statics.findByDoctorWithPendingFeedback = function(doctorId: string) {
  return this.find({ 
    doctor_id: doctorId,
    'treatment_plan.status': 'completed',
    'treatment_plan.patient_feedback': { $exists: true, $ne: '' },
    'treatment_plan.approval_requested': true
  })
    .populate('user_id', 'name email phoneNumber dateOfBirth gender')
    .populate('appointment_id', 'appointment_date appointment_time')
    .sort({ updated_at: -1 });
};

// Trong medicalRecordSchema.methods

// Schedule re-examination for a step
medicalRecordSchema.methods.scheduleReExamination = function(
  stepNumber: number,
  appointmentDate: Date,
  appointmentTime: string,
  notes?: string,
  appointmentId?: mongoose.Types.ObjectId
) {
  const step = this.treatment_plan.find((s: TreatmentStep) => s.stepNumber === stepNumber);
  
  if (!step) {
    throw new Error(`Step ${stepNumber} not found`);
  }
  
  // QUAN TRỌNG: Tìm appointmentId theo thứ tự ưu tiên
  let targetAppointmentId = null;
  
  // 1. Ưu tiên: appointmentId từ tham số (nếu có)
  if (appointmentId) {
    targetAppointmentId = appointmentId;
  }
  // 2. Sử dụng appointmentId đã có trong step
  else if (step.reExaminationAppointmentId) {
    targetAppointmentId = step.reExaminationAppointmentId;
  }
  
  // Cập nhật thông tin step
  step.reExaminationScheduled = true;
  step.reExaminationDate = appointmentDate;
  step.reExaminationTime = appointmentTime;
  step.reExaminationNotes = notes;
  step.needsReExamination = false;
  
  // Chỉ cập nhật appointmentId nếu có giá trị mới
  if (targetAppointmentId) {
    step.reExaminationAppointmentId = targetAppointmentId;
  }
  
  // Cập nhật trạng thái
  if (step.status === 'completed' || step.status === 'approved') {
    step.status = 'scheduled';
  }
  
  return this.save();
};


// Reschedule re-examination
medicalRecordSchema.methods.rescheduleReExamination = function(
  stepNumber: number,
  newDate: Date,
  newTime: string,
  notes?: string
) {
  const step = this.treatment_plan.find((s: TreatmentStep) => s.stepNumber === stepNumber);
  
  if (!step) {
    throw new Error(`Step ${stepNumber} not found`);
  }
  
  if (!step.reExaminationScheduled) {
    throw new Error('Re-examination not scheduled yet');
  }
  
  step.reExaminationDate = newDate;
  step.reExaminationTime = newTime;
  
  if (notes) {
    step.reExaminationNotes = notes;
  }
  
  return this.save();
};

// Cancel re-examination
medicalRecordSchema.methods.cancelReExamination = function(stepNumber: number) {
  const step = this.treatment_plan.find((s: TreatmentStep) => s.stepNumber === stepNumber);
  
  if (!step) {
    throw new Error(`Step ${stepNumber} not found`);
  }
  
  step.reExaminationScheduled = false;
  step.reExaminationDate = undefined;
  step.reExaminationTime = undefined;
  step.reExaminationNotes = undefined;
  step.arrivalConfirmed = false;
  step.arrivalConfirmedAt = undefined;
  
  // Giữ lại appointmentId để có thể tham chiếu nếu cần
  
  // Chuyển status về trạng thái trước đó
  if (step.status === 'scheduled') {
    step.status = step.needsReExamination ? 'approved' : 'completed';
  }
  
  return this.save();
};

// Confirm patient arrival for re-examination
medicalRecordSchema.methods.confirmReExaminationArrival = function(stepNumber: number) {
  const step = this.treatment_plan.find((s: TreatmentStep) => s.stepNumber === stepNumber);
  
  if (!step) {
    throw new Error(`Step ${stepNumber} not found`);
  }
  
  if (!step.reExaminationScheduled) {
    throw new Error('Re-examination not scheduled');
  }
  
  if (!step.reExaminationDate) {
    throw new Error('Re-examination date not set');
  }
  
  // Kiểm tra xem có phải ngày hẹn không
  const today = new Date();
  const appointmentDate = new Date(step.reExaminationDate);
  
  if (appointmentDate.toDateString() !== today.toDateString()) {
    throw new Error('Can only confirm arrival on scheduled date');
  }
  
  step.arrivalConfirmed = true;
  step.arrivalConfirmedAt = new Date();
  step.status = 'in-progress'; // Bắt đầu quá trình tái khám
  
  return this.save();
};

// Get all steps that need re-examination
medicalRecordSchema.methods.getStepsNeedingReExamination = function(): TreatmentStep[] {
  return this.treatment_plan.filter((step: TreatmentStep) => 
    step.needsReExamination && !step.reExaminationScheduled
  );
};

// Get all scheduled re-examinations
medicalRecordSchema.methods.getScheduledReExaminations = function(): TreatmentStep[] {
  return this.treatment_plan.filter((step: TreatmentStep) => 
    step.reExaminationScheduled && step.reExaminationDate
  );
};

// Check if has any upcoming re-examinations
medicalRecordSchema.virtual('hasUpcomingReExaminations').get(function() {
  return this.treatment_plan.some((step: TreatmentStep) => 
    step.reExaminationScheduled && 
    step.reExaminationDate && 
    step.reExaminationDate > new Date()
  );
});

// ==================== EXPORT ====================

export default mongoose.model<IMedicalRecord, IMedicalRecordModel>('MedicalRecord', medicalRecordSchema);