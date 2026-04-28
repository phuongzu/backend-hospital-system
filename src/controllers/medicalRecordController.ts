import MedicalRecord from '../models/medicalRecord';
import Notification from '../models/notification';
import { AuthRequest } from '../middlewares/authmiddleware';
import Appointment from '../models/appointment';
import mongoose, { Types } from 'mongoose';
import { Response } from 'express';


// Type definitions for medical record operations
interface PopulatedUser {
  _id: Types.ObjectId;
  name: string;
  email: string;
  phoneNumber?: string;
  avatar?: string;
}

interface PopulatedSpecialty {
  _id: Types.ObjectId;
  name: string;
}

interface PopulatedDoctor extends PopulatedUser {
  specialty_id?: PopulatedSpecialty;
}

// Type cho kết quả .lean() — giải quyết toàn bộ lỗi TS18046 và TS2339
// _id: Types.ObjectId  → không còn 'unknown' (FIX dòng 1177, 1204, 1230)
// doctor_id, user_id là object → .name, .specialty_id hoạt động (FIX dòng 908–913)
// appointment_end_time khai báo tường minh → không cần 'as any' (FIX dòng 898)
interface LeanAppointment {
  _id: Types.ObjectId;
  appointment_date: Date;
  time_slot: string;
  status: string;
  reason?: string;
  notes?: string;
  is_re_examination?: boolean;
  re_examination_step_id?: Types.ObjectId;
  created_at?: Date;
  updated_at?: Date;
  appointment_end_time?: string;
  doctor_id?: PopulatedDoctor;
  user_id?: PopulatedUser;
  specialty_id?: PopulatedSpecialty;
  [key: string]: any;
}

// Type cho appointment item trong stepAppointments result
// Đảm bảo _id: Types.ObjectId (FIX so sánh dòng 1230)
interface StepAppointmentItem {
  _id: Types.ObjectId;
  appointment_date: Date;
  time_slot: string;
  status: string;
  reason?: string;
  notes?: string;
}

interface StepAppointmentResult {
  stepNumber: number | null;
  stepTitle: string;
  stepStatus: string;
  isPhysicalVisit?: boolean;
  requiresFollowup?: boolean;
  followupReason?: string;
  reExaminationDate?: Date;
  appointment: StepAppointmentItem | null;
}

// ============================================================

// Get medical records for current user
export const getMyRecords = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    const records = await MedicalRecord.find({
      $or: [{ user_id: req.user._id }, { doctor_id: req.user._id }],
    })
      .populate('doctor_id', 'name email avatar specialty_id')
      .populate('user_id', 'name email avatar phoneNumber dateOfBirth gender')
      .populate('appointment_id')
      .sort({ updated_at: -1 });

    res.status(200).json(records);
  } catch (error) {
    console.error('Error fetching my records:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Start treatment plan for medical record
export const startTreatment = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  try {
    const record = await MedicalRecord.findById(id);
    if (!record) return res.status(404).json({ error: 'Record not found' });

    if (!record.treatment_plan || record.treatment_plan.length === 0) {
      record.treatment_plan = [
        {
          stepNumber: 1,
          title: 'Initial Phase',
          description: 'Start prescribed medication and track symptoms',
          status: 'in-progress',
          createdAt: new Date(),
          isPhysicalVisit: false,
        } as any,
        {
          stepNumber: 2,
          title: 'Follow-up Check',
          description: 'Scheduled re-examination at the clinic',
          status: 'scheduled',
          createdAt: new Date(),
          isPhysicalVisit: true,
          reExaminationDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        } as any,
      ];
      await record.save();
    }
    res.json({ treatment_plan: record.treatment_plan });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
};

// Mark treatment process as completed
export const completeProcess = async (req: any, res: any) => {
  const { id, processId } = req.params;
  try {
    const record = await MedicalRecord.findById(id);
    if (!record) return res.status(404).json({ error: 'Record not found' });

    // @ts-ignore
    const process = record.processes.id(processId);
    if (!process) return res.status(404).json({ error: 'Process not found' });

    process.status = 'completed';
    await record.save();

    await Notification.create({
      user: record.doctor_id,
      message: `Patient completed process: ${process.name}`,
      type: 'process',
      record: record._id,
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
};

// Confirm treatment process with doctor notes
export const confirmProcess = async (req: any, res: any) => {
  const { id, processId } = req.params;
  const { notes } = req.body;
  try {
    const record = await MedicalRecord.findById(id);
    if (!record) return res.status(404).json({ error: 'Record not found' });

    // @ts-ignore
    const process = record.processes.id(processId);
    if (!process) return res.status(404).json({ error: 'Process not found' });

    process.status = 'confirmed';
    process.notes = notes;
    await record.save();

    await Notification.create({
      user: record.user_id,
      message: `Doctor confirmed process: ${process.name}`,
      type: 'process',
      record: record._id,
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
};

// Request treatment step approval from patient
export const requestStepApproval = async (req: AuthRequest, res: any): Promise<void> => {
  try {
    const { id, stepNumber } = req.params;
    const { message, patientName } = req.body;

    if (!req.user) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }

    if (!message) {
      res.status(400).json({ success: false, message: 'Message is required' });
      return;
    }

  // Use generic populate for TypeScript type safety
  const medicalRecord = await MedicalRecord.findById(id)
      .populate<{ doctor_id: PopulatedUser }>({ path: 'doctor_id', model: 'User', select: 'name email' })
      .populate<{ user_id: PopulatedUser }>({ path: 'user_id', model: 'User', select: 'name email' });

    if (!medicalRecord) {
      res.status(404).json({ success: false, message: 'Medical record not found' });
      return;
    }

  // Verify user is patient for this record
  if (medicalRecord.user_id._id.toString() !== req.user._id.toString()) {
      res.status(403).json({ success: false, message: 'Access denied to this medical record' });
      return;
    }

    const treatmentStep = medicalRecord.treatment_plan.find(
      step => step.stepNumber === parseInt(stepNumber)
    );

    if (!treatmentStep) {
      res.status(404).json({ success: false, message: 'Treatment step not found' });
      return;
    }

    if (treatmentStep.status !== 'completed') {
      res.status(400).json({ success: false, message: 'Step must be completed before requesting approval' });
      return;
    }

    const patientDisplayName = patientName || medicalRecord.user_id.name;

    const notification = new Notification({
      user_id: medicalRecord.doctor_id._id,
      title: 'Approval Request for Treatment Step',
      message: `${patientDisplayName} has completed step ${stepNumber}: ${treatmentStep.title} and is requesting approval. Message: ${message}`,
      type: 'approval_request',
      related_record: medicalRecord._id,
      metadata: {
        stepNumber: parseInt(stepNumber),
        stepTitle: treatmentStep.title,
        patientName: patientDisplayName,
        patientMessage: message,
        recordId: medicalRecord._id,
      },
      priority: 'high',
    });

    await notification.save();

    treatmentStep.approval_requested = true;
    treatmentStep.approval_requested_at = new Date();
    treatmentStep.patientMessage = message;

    await medicalRecord.save();

    console.log(`📬 Approval request sent to doctor ${medicalRecord.doctor_id.name} for step ${stepNumber}`);

    res.status(200).json({
      success: true,
      message: 'Approval request sent to doctor successfully',
      data: {
        step: treatmentStep,
        notification: { id: notification._id, title: notification.title, message: notification.message },
        record: medicalRecord,
      },
    });
  } catch (error) {
    console.error('❌ Error requesting step approval:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Get approval requests for treatment steps
export const getApprovalRequests = async (req: AuthRequest, res: any): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }

    const medicalRecords = await MedicalRecord.find({
      doctor_id: req.user._id,
      consultation_status: 'in-progress',
    })
      .populate('user_id', 'name email phoneNumber avatar')
      .populate('doctor_id', 'name email')
      .select('user_id doctor_id diagnosis treatment_plan consultation_status created_at updated_at');

    const approvalRequests = medicalRecords.flatMap(record =>
      record.treatment_plan
        .filter(step => step.approval_requested === true && step.status === 'completed')
        .map(step => ({
          recordId: record._id,
          patient: record.user_id,
          doctor: record.doctor_id,
          diagnosis: record.diagnosis,
          consultation_status: record.consultation_status,
          step: {
            stepNumber: step.stepNumber,
            title: step.title,
            description: step.description,
            status: step.status,
            medication: step.medication,
            dosage: step.dosage,
            duration: step.duration,
            instructions: step.instructions,
            approval_requested: step.approval_requested,
            approval_requested_at: step.approval_requested_at,
            patientMessage: step.patientMessage,
            completedAt: step.completedAt,
          },
          created_at: record.created_at,
          updated_at: record.updated_at,
        }))
    );

    res.status(200).json({ success: true, data: approvalRequests, count: approvalRequests.length });
  } catch (error) {
    console.error('❌ Error fetching approval requests:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Activate treatment step in patient plan
export const activateTreatmentStep = async (req: AuthRequest, res: any): Promise<void> => {
  try {
    const { id, stepNumber } = req.params;

    if (!req.user) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }

    const medicalRecord = await MedicalRecord.findById(id);
    if (!medicalRecord) {
      res.status(404).json({ success: false, message: 'Medical record not found' });
      return;
    }

    if (medicalRecord.user_id.toString() !== req.user._id.toString()) {
      res.status(403).json({ success: false, message: 'Access denied' });
      return;
    }

    const step = medicalRecord.treatment_plan.find(s => s.stepNumber === parseInt(stepNumber));
    if (!step) {
      res.status(404).json({ success: false, message: 'Treatment step not found' });
      return;
    }

    if (step.status !== 'pending') {
      if (step.status === 'in-progress') {
        res.status(200).json({ success: true, message: 'Step is already in progress', data: { step, record: medicalRecord } });
        return;
      }
      res.status(400).json({ success: false, message: 'Step is not pending' });
      return;
    }

    step.status = 'in-progress';
    medicalRecord.current_step = parseInt(stepNumber);
    await medicalRecord.save();

    res.status(200).json({ success: true, message: 'Step activated successfully', data: { step, record: medicalRecord } });
  } catch (error) {
    console.error('❌ Error activating treatment step:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Complete treatment step with outcomes
export const completeTreatmentStep = async (req: AuthRequest, res: any): Promise<void> => {
  try {
    const { id, stepNumber } = req.params;
    const { patientMessage } = req.body;

    if (!req.user) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }

    const medicalRecord = await MedicalRecord.findById(id);
    if (!medicalRecord) {
      res.status(404).json({ success: false, message: 'Medical record not found' });
      return;
    }

    if (medicalRecord.user_id.toString() !== req.user._id.toString()) {
      res.status(403).json({ success: false, message: 'Access denied' });
      return;
    }

    const stepNumberInt = parseInt(stepNumber);
    const step = medicalRecord.treatment_plan.find(s => s.stepNumber === stepNumberInt);

    if (!step) {
      res.status(404).json({ success: false, message: 'Treatment step not found' });
      return;
    }

    if (step.status !== 'in-progress') {
      if (step.status === 'completed' || step.status === 'approved') {
        res.status(200).json({ success: true, message: 'Step already completed', data: { step, record: medicalRecord } });
        return;
      }
      res.status(400).json({ success: false, message: 'Step is not in progress' });
      return;
    }

    step.status = 'completed';
    step.completedAt = new Date();
    step.patientMessage = patientMessage || 'I have completed this step';
    step.approval_requested = true;
    step.approval_requested_at = new Date();

    await medicalRecord.save();

    try {
      await Notification.create({
        user_id: medicalRecord.doctor_id,
        title: 'Treatment Step Completed',
        message: `Patient has completed step ${stepNumber}: ${step.title}`,
        type: 'treatment_update',
        related_record: medicalRecord._id,
        priority: 'medium',
      });
    } catch (notifError) {
      console.error('⚠️ Failed to create notification:', notifError);
    }

    res.status(200).json({ success: true, message: 'Step completed successfully', data: { step, record: medicalRecord } });
  } catch (error: any) {
    console.error('❌ Error completing treatment step:', error);
    res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
  }
};

// Change treatment plan status
export const changeTreatmentPlanStatus = async (req: AuthRequest, res: any): Promise<void> => {
  try {
    const { recordId, processId } = req.params;
    const { action } = req.body;

    if (!req.user) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }

    const medicalRecord = await MedicalRecord.findById(recordId);
    if (!medicalRecord) {
      res.status(404).json({ success: false, message: 'Medical record not found' });
      return;
    }

    if (medicalRecord.doctor_id.toString() !== req.user._id.toString()) {
      res.status(403).json({ success: false, message: 'Access denied' });
      return;
    }

    // FIX TS2339 dòng 466: .id() không tồn tại trên TreatmentStep[]
    // Mongoose .id() chỉ có trên Document, không expose trên plain array type
    // Fix chuẩn: .find() với so sánh _id string
    const step = medicalRecord.treatment_plan.find(
      s => s._id?.toString() === processId
    );
    if (!step) {
      res.status(404).json({ success: false, message: 'Treatment step not found' });
      return;
    }

    if (action === 'approve') {
      step.status = 'approved';
      step.approval_requested = false;
      step.approvedAt = new Date();

      await Notification.create({
        user_id: medicalRecord.user_id,
        title: 'Treatment Step Approved',
        message: `Your treatment step ${step.stepNumber}: ${step.title} has been approved by the doctor.`,
        type: 'treatment_update',
        related_record: medicalRecord._id,
        priority: 'medium',
      });

      await medicalRecord.save();
      res.status(200).json({ success: true, message: 'Treatment step approved successfully', data: { step } });
    } else if (action === 'reject') {
      step.status = 'rejected';
      step.approval_requested = false;
      step.rejectedAt = new Date();

      await Notification.create({
        user_id: medicalRecord.user_id,
        title: 'Treatment Step Rejected',
        message: `Your treatment step ${step.stepNumber}: ${step.title} has been rejected by the doctor.`,
        type: 'treatment_update',
        related_record: medicalRecord._id,
        priority: 'medium',
      });

      await medicalRecord.save();
      res.status(200).json({ success: true, message: 'Treatment step rejected successfully', data: { step } });
    } else {
      res.status(400).json({ success: false, message: 'Invalid action' });
    }
  } catch (error) {
    console.error('❌ Error changing treatment plan status:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Complete treatment step with patient message
export const completeTreatmentStepWithMessage = async (req: any, res: any): Promise<void> => {
  try {
    const { consultationId, stepNumber } = req.params;
    const { patientMessage, conditionDescription } = req.body;
    const stepNum = parseInt(stepNumber);

    const medicalRecord = await MedicalRecord.findById(consultationId);
    if (!medicalRecord) {
      res.status(404).json({ success: false, message: 'Medical record not found' });
      return;
    }

    const step = medicalRecord.treatment_plan.find(s => s.stepNumber === stepNum);
    if (!step) {
      res.status(404).json({ success: false, message: 'Step not found' });
      return;
    }

    if (step.status !== 'in-progress') {
      res.status(400).json({
        success: false,
        message: `Step is ${step.status}. Only 'in-progress' steps can be completed.`,
      });
      return;
    }

    step.status = 'completed';
    step.completedAt = new Date();
    step.approval_requested = true;
    step.approval_requested_at = new Date();
    step.patientMessage = patientMessage || 'Step completed';
    step.condition_description = conditionDescription || '';

    await medicalRecord.save({ validateModifiedOnly: true });

    res.status(200).json({
      success: true,
      data: medicalRecord,
      message: 'Step completed successfully. Doctor has been notified.',
    });
  } catch (error: any) {
    console.error('Error in completeTreatmentStepWithMessage:', error);
    res.status(500).json({ success: false, message: 'Failed to complete step: ' + error.message });
  }
};

// Get re-examination appointment details
export const getReExaminationAppointment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { recordId, stepNumber } = req.params;

    if (!req.user) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }

    if (!recordId || !stepNumber) {
      res.status(400).json({ success: false, message: 'Medical record ID and step number are required' });
      return;
    }

    if (!mongoose.Types.ObjectId.isValid(recordId)) {
      res.status(400).json({ success: false, message: 'Invalid medical record ID format' });
      return;
    }

    const stepNum = parseInt(stepNumber);
    if (isNaN(stepNum) || stepNum < 1) {
      res.status(400).json({ success: false, message: 'Invalid step number format' });
      return;
    }

    // populate generic → doctor_id, user_id là object với .name, ._id
    const medicalRecord = await MedicalRecord.findById(recordId)
      .populate<{ user_id: PopulatedUser }>({
        path: 'user_id',
        model: 'User',
        select: 'name email phoneNumber dateOfBirth gender avatar',
      })
      .populate<{ doctor_id: PopulatedDoctor }>({
        path: 'doctor_id',
        select: 'name email avatar specialty_id',
        populate: { path: 'specialty_id', select: 'name description' },
      })
      .populate('appointment_id', 'appointment_date time_slot reason notes');

    if (!medicalRecord) {
      res.status(404).json({ success: false, message: 'Medical record not found' });
      return;
    }

    // Sau populate generic — không cần 'as any'
    const isPatient = medicalRecord.user_id._id.toString() === req.user._id.toString();
    const isDoctor = medicalRecord.doctor_id._id.toString() === req.user._id.toString();

    if (!isPatient && !isDoctor) {
      res.status(403).json({ success: false, message: 'Access denied to this medical record' });
      return;
    }

    const treatmentStep = medicalRecord.treatment_plan.find(step => step.stepNumber === stepNum);
    if (!treatmentStep) {
      res.status(404).json({ success: false, message: `Treatment step ${stepNum} not found` });
      return;
    }

    // Reusable populate options cho Appointment queries
    const appointmentPopulate = [
      {
        path: 'doctor_id',
        select: 'name email specialty_id',
        populate: { path: 'specialty_id', select: 'name' },
      },
      { path: 'user_id', select: 'name email phoneNumber' },
    ];

    let appointment: LeanAppointment | null = null;
    let appointmentType = 'none';

    // Strategy 1: Direct link
    if (treatmentStep.reExaminationAppointmentId) {
      appointment = await Appointment.findById(treatmentStep.reExaminationAppointmentId)
        .populate(appointmentPopulate)
        .lean<LeanAppointment>();   // FIX TS2339 + TS2551: typed lean

      if (appointment) appointmentType = 'direct_link';
    }

    // Strategy 2: via step ID
    if (!appointment && treatmentStep._id) {
      appointment = await Appointment.findOne({
        re_examination_step_id: treatmentStep._id,
        is_re_examination: true,
      })
        .populate(appointmentPopulate)
        .lean<LeanAppointment>();

      if (appointment) appointmentType = 'step_id_link';
    }

    // Strategy 3: by date
    if (!appointment && treatmentStep.reExaminationDate) {
      const reExaminationDate = new Date(treatmentStep.reExaminationDate);
      const startOfDay = new Date(reExaminationDate);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(reExaminationDate);
      endOfDay.setHours(23, 59, 59, 999);

      appointment = await Appointment.findOne({
        user_id: medicalRecord.user_id._id,
        appointment_date: { $gte: startOfDay, $lte: endOfDay },
        status: { $in: ['scheduled', 'confirmed', 'completed'] },
      })
        .populate(appointmentPopulate)
        .lean<LeanAppointment>();

      if (appointment) appointmentType = 'date_match';
    }

    // Strategy 4: by reason/title
    if (!appointment && treatmentStep.title) {
      const searchTerms = [
        treatmentStep.title.toLowerCase(),
        're-examination', 'follow-up', 'tái khám', 'physical review', 'clinical review',
      ];

      appointment = await Appointment.findOne({
        user_id: medicalRecord.user_id._id,
        doctor_id: medicalRecord.doctor_id._id,
        $or: [
          { reason: { $regex: searchTerms.join('|'), $options: 'i' } },
          { notes: { $regex: searchTerms.join('|'), $options: 'i' } },
        ],
        status: { $in: ['scheduled', 'confirmed'] },
      })
        .populate(appointmentPopulate)
        .lean<LeanAppointment>();

      if (appointment) appointmentType = 'reason_match';
    }

    // Strategy 5: most recent
    if (!appointment) {
      const recent = await Appointment.find({
        user_id: medicalRecord.user_id._id,
        doctor_id: medicalRecord.doctor_id._id,
        status: { $in: ['scheduled', 'confirmed'] },
        appointment_date: { $gt: new Date() },
      })
        .populate(appointmentPopulate)
        .sort({ appointment_date: 1 })
        .limit(1)
        .lean<LeanAppointment[]>();

      if (recent.length > 0) {
        appointment = recent[0];
        appointmentType = 'most_recent';
      }
    }

    const responseData: any = {
      success: true,
      data: {
        recordId,
        stepNumber: stepNum,
        stepTitle: treatmentStep.title,
        stepStatus: treatmentStep.status,
        stepDescription: treatmentStep.description,
        isPhysicalVisit: treatmentStep.isPhysicalVisit || false,
        requiresFollowup: treatmentStep.requires_followup || false,
        followupReason: treatmentStep.followup_reason || '',
        reExaminationDate: treatmentStep.reExaminationDate,
        hasAppointment: !!appointment,
        appointmentType,
        appointment: null,
        stepMetadata: {
          hasStepId: !!treatmentStep._id,
          hasDirectLink: !!treatmentStep.reExaminationAppointmentId,
          isScheduled: treatmentStep.status === 'scheduled',
        },
      },
    };

    if (appointment) {
      // Sau .lean<LeanAppointment>() — tất cả fields có type tường minh, không cần 'as any'
      responseData.data.appointment = {
        _id: appointment._id,                                       // Types.ObjectId ✅
        appointment_date: appointment.appointment_date,
        time_slot: appointment.time_slot,
        appointment_end_time: appointment.appointment_end_time,     // string | undefined ✅ (FIX TS2551)
        status: appointment.status,
        reason: appointment.reason,
        notes: appointment.notes,
        is_re_examination: appointment.is_re_examination || false,
        re_examination_step_id: appointment.re_examination_step_id,
        created_at: appointment.created_at,
        updated_at: appointment.updated_at,
        doctor: {
          _id: appointment.doctor_id?._id,                          // Types.ObjectId ✅ (FIX TS2339)
          name: appointment.doctor_id?.name,                        // string ✅ (FIX TS2339)
          specialty: appointment.doctor_id?.specialty_id?.name || 'General', // ✅ (FIX TS2339)
        },
        patient: {
          _id: appointment.user_id?._id,                            // Types.ObjectId ✅
          name: appointment.user_id?.name,                          // string ✅ (FIX TS2339)
        },
        canCheckIn:
          appointment.status === 'scheduled' &&
          new Date(appointment.appointment_date).toDateString() === new Date().toDateString(),
      };
    }

    if (treatmentStep.isPhysicalVisit) {
      responseData.data.visitDetails = {
        arrivalConfirmed: treatmentStep.arrivalConfirmed || false,
        arrivalConfirmedAt: treatmentStep.arrivalConfirmedAt,
        completedAt: treatmentStep.completedAt,
        doctorNotes: treatmentStep.doctorNotes,
      };
    }

    if (process.env.NODE_ENV === 'development') {
      responseData.metadata = {
        searchStrategies: ['direct_link', 'step_id_link', 'date_match', 'reason_match', 'most_recent'],
        usedStrategy: appointmentType,
        treatmentStep: {
          _id: treatmentStep._id,
          stepNumber: treatmentStep.stepNumber,
          reExaminationAppointmentId: treatmentStep.reExaminationAppointmentId,
          reExaminationDate: treatmentStep.reExaminationDate,
        },
        permissions: { isPatient, isDoctor },
      };
    }

    res.status(200).json(responseData);
  } catch (error: any) {
    console.error('❌ Error fetching re-examination appointment:', error);

    const errorResponse: any = {
      success: false,
      message: 'Internal server error while fetching re-examination appointment',
    };

    if (process.env.NODE_ENV === 'development') {
      errorResponse.error = error.message;
      errorResponse.stack = error.stack;
    }

    if (error.name === 'CastError') {
      res.status(400).json({ ...errorResponse, message: 'Invalid ID format' });
      return;
    }
    if (error.name === 'ValidationError') {
      res.status(400).json({ ...errorResponse, message: 'Validation error', errors: error.errors });
      return;
    }

    res.status(500).json(errorResponse);
  }
};

// Get appointments for medical record
export const getMedicalRecordAppointments = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { recordId } = req.params;

    if (!req.user) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }

    if (!recordId) {
      res.status(400).json({ success: false, message: 'Medical record ID is required' });
      return;
    }

    const medicalRecord = await MedicalRecord.findById(recordId)
      .populate<{ user_id: PopulatedUser }>({ path: 'user_id', model: 'User', select: 'name email' })
      .populate<{ doctor_id: PopulatedUser }>({ path: 'doctor_id', model: 'User', select: 'name email' });

    if (!medicalRecord) {
      res.status(404).json({ success: false, message: 'Medical record not found' });
      return;
    }

    // FIX TS18046 dòng 1177: .lean<LeanAppointment[]>() → _id: Types.ObjectId (không còn unknown)
    const appointments = await Appointment.find({
      $or: [
        { _id: medicalRecord.appointment_id },
        { re_examination_step_id: { $in: medicalRecord.treatment_plan.map(step => step._id) } },
        {
          user_id: medicalRecord.user_id._id,
          doctor_id: medicalRecord.doctor_id._id,
          appointment_date: { $gte: medicalRecord.created_at },
        },
      ],
    })
      .populate<{ doctor_id: PopulatedUser }>({ path: 'doctor_id', select: 'name' })
      .populate<{ user_id: PopulatedUser }>({ path: 'user_id', select: 'name' })
      .sort({ appointment_date: 1 })
      .lean<LeanAppointment[]>();

    const classifiedAppointments = appointments.map(app => {
      let appointmentType = 'regular';

      // app._id là Types.ObjectId → .toString() ✅
      if (app._id.toString() === medicalRecord.appointment_id?.toString()) {
        appointmentType = 'initial_consultation';
      } else if (app.is_re_examination) {
        appointmentType = 're_examination';

        const relatedStep = medicalRecord.treatment_plan.find(
          step => step._id?.toString() === app.re_examination_step_id?.toString()
        );

        if (relatedStep) {
          return {
            ...app,
            appointmentType,
            relatedStep: {
              stepNumber: relatedStep.stepNumber,
              title: relatedStep.title,
              status: relatedStep.status,
            },
          };
        }
      }

      return { ...app, appointmentType };
    });

    res.status(200).json({
      success: true,
      data: {
        recordId,
        patient: medicalRecord.user_id,
        doctor: medicalRecord.doctor_id,
        totalAppointments: appointments.length,
        appointments: classifiedAppointments,
        treatmentPlanSummary: {
          totalSteps: medicalRecord.treatment_plan.length,
          scheduledSteps: medicalRecord.treatment_plan.filter(step => step.status === 'scheduled').length,
          stepsWithReExamination: medicalRecord.treatment_plan.filter(
            step => step.reExaminationScheduled || step.reExaminationDate
          ).length,
        },
      },
    });
  } catch (error) {
    console.error('Error fetching medical record appointments:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Get all re-examination appointments for user
export const getAllReExaminationAppointments = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { recordId } = req.params;

    if (!req.user) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }

    const medicalRecord = await MedicalRecord.findById(recordId)
      .populate<{ user_id: PopulatedUser }>({ path: 'user_id', model: 'User', select: 'name email phoneNumber' })
      .populate<{ doctor_id: PopulatedUser }>({ path: 'doctor_id', model: 'User', select: 'name email' });

    if (!medicalRecord) {
      res.status(404).json({ success: false, message: 'Medical record not found' });
      return;
    }

    // Sau populate generic → ._id có type tường minh, không cần 'as any'
    const isPatient = medicalRecord.user_id._id.toString() === req.user._id.toString();
    const isDoctor = medicalRecord.doctor_id._id.toString() === req.user._id.toString();

    if (!isPatient && !isDoctor) {
      res.status(403).json({ success: false, message: 'Access denied to this medical record' });
      return;
    }

    // FIX TS18046 dòng 1204, 1230: .lean<LeanAppointment[]>() → _id: Types.ObjectId
    const appointments = await Appointment.find({
      user_id: medicalRecord.user_id._id,
      doctor_id: medicalRecord.doctor_id._id,
      status: { $in: ['scheduled', 'confirmed', 'completed'] },
      reason: { $regex: /re-examination|follow-up|tái khám/i },
    })
      .populate<{ doctor_id: PopulatedUser }>({ path: 'doctor_id', select: 'name specialty_id' })
      .populate<{ user_id: PopulatedUser }>({ path: 'user_id', select: 'name email phoneNumber' })
      .sort({ appointment_date: 1 })
      .lean<LeanAppointment[]>();

    // StepAppointmentResult đảm bảo appointment._id là Types.ObjectId
    // FIX TS18046 dòng 1230: sa.appointment._id so sánh với app._id đều là Types.ObjectId
    const stepAppointments: StepAppointmentResult[] = medicalRecord.treatment_plan
      .filter(step => step.isPhysicalVisit || step.requires_followup || step.reExaminationDate)
      .map(step => {
        let matched: LeanAppointment | undefined;

        if (step.reExaminationAppointmentId) {
          matched = appointments.find(
            app => app._id.toString() === step.reExaminationAppointmentId?.toString()
          );
        }

        if (!matched && step.reExaminationDate) {
          const stepDate = new Date(step.reExaminationDate);
          matched = appointments.find(app => {
            const appDate = new Date(app.appointment_date);
            return appDate.toDateString() === stepDate.toDateString();
          });
        }

        if (!matched && step.title) {
          const titleLower = step.title.toLowerCase();
          matched = appointments.find(app => {
            const reasonLower = (app.reason || '').toLowerCase();
            return (
              reasonLower.includes(titleLower) ||
              (step.title.includes('Follow-up') && reasonLower.includes('follow'))
            );
          });
        }

        if (!matched) {
          matched = appointments.find(
            app =>
              !medicalRecord.treatment_plan.some(
                otherStep =>
                  otherStep.reExaminationAppointmentId?.toString() === app._id.toString()
              )
          );
        }

        return {
          stepNumber: step.stepNumber,
          stepTitle: step.title,
          stepStatus: step.status,
          isPhysicalVisit: step.isPhysicalVisit,
          requiresFollowup: step.requires_followup,
          followupReason: step.followup_reason,
          reExaminationDate: step.reExaminationDate,
          appointment: matched
            ? {
                _id: matched._id,              // Types.ObjectId ✅
                appointment_date: matched.appointment_date,
                time_slot: matched.time_slot,
                status: matched.status,
                reason: matched.reason,
                notes: matched.notes,
              }
            : null,
        };
      });

    const unmappedAppointments: StepAppointmentResult[] = appointments
      .filter(
        app =>
          !stepAppointments.some(
            sa =>
              sa.appointment &&
              sa.appointment._id.toString() === app._id.toString()  // ✅ cả hai đều Types.ObjectId
          )
      )
      .map(app => ({
        stepNumber: null,
        stepTitle: 'Additional Appointment',
        stepStatus: 'additional',
        isPhysicalVisit: true,
        requiresFollowup: false,
        followupReason: 'Additional medical follow-up',
        reExaminationDate: app.appointment_date,
        appointment: {
          _id: app._id,              // Types.ObjectId ✅
          appointment_date: app.appointment_date,
          time_slot: app.time_slot,
          status: app.status,
          reason: app.reason,
          notes: app.notes,
        },
      }));

    const allAppointments = [...stepAppointments, ...unmappedAppointments];

    res.status(200).json({
      success: true,
      data: {
        recordId,
        totalSteps: medicalRecord.treatment_plan.length,
        reExaminationSteps: allAppointments.length,
        stepAppointments: allAppointments,
        debug: {
          totalAppointmentsFound: appointments.length,
          treatmentStepsWithFollowup: medicalRecord.treatment_plan.filter(
            step => step.isPhysicalVisit || step.requires_followup
          ).length,
        },
      },
    });
  } catch (error) {
    console.error('❌ Error fetching all re-examination appointments:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};