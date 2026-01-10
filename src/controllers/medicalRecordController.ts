import MedicalRecord from '../models/medicalRecord';
import Notification from '../models/notification';
import {AuthRequest} from '../middlewares/authmiddleware';

// Get medical records for the logged-in user (patient or doctor)
export const getMyRecords = async (req: AuthRequest, res: any) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    const records = await MedicalRecord.find({
      $or: [
        { user_id: req.user._id },
        { doctor_id: req.user._id }
      ]
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

// Start treatment: initialize processes
export const startTreatment = async (req: AuthRequest, res: any) => {
  const { id } = req.params;
  try {
    const record = await MedicalRecord.findById(id);
    if (!record) return res.status(404).json({ error: 'Record not found' });

    // Example: initialize processes if not already started
    if (!record.processes || record.processes.length === 0) {
      record.processes = [
        { id: '1', name: 'Step 1', description: 'Do step 1', status: 'pending' },
        { id: '2', name: 'Step 2', description: 'Do step 2', status: 'pending' },
        // Add more steps as needed
      ];
      await record.save();
    }
    res.json({ processes: record.processes });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
};

// Patient marks process as completed
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

    // Send notification to doctor
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

// Doctor confirms process with notes
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

    // Optionally notify patient
    await Notification.create({
      user: record.patient_id,
      message: `Doctor confirmed process: ${process.name}`,
      type: 'process',
      record: record._id,
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
};

export const requestStepApproval = async (req: AuthRequest, res: any): Promise<void> => {
  try {
    // FIX: Changed recordId to id to match route parameter /:id/...
    const { id, stepNumber } = req.params;
    const { message, patientName } = req.body;

    if (!req.user) {
      res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
      return;
    }

    // Validate input
    if (!message) {
      res.status(400).json({
        success: false,
        message: 'Message is required'
      });
      return;
    }

    // Find medical record
    const medicalRecord = await MedicalRecord.findById(id)
      .populate('doctor_id', 'name email')
      .populate('user_id', 'name email');

    if (!medicalRecord) {
      res.status(404).json({
        success: false,
        message: 'Medical record not found'
      });
      return;
    }

    // Check if user has permission to access this record
    if (medicalRecord.user_id._id.toString() !== req.user._id.toString()) {
      res.status(403).json({
        success: false,
        message: 'Access denied to this medical record'
      });
      return;
    }

    // Find the specific treatment step
    const treatmentStep = medicalRecord.treatment_plan.find(
      step => step.stepNumber === parseInt(stepNumber)
    );

    if (!treatmentStep) {
      res.status(404).json({
        success: false,
        message: 'Treatment step not found'
      });
      return;
    }

    // Verify step is completed and ready for approval
    if (treatmentStep.status !== 'completed') {
      res.status(400).json({
        success: false,
        message: 'Step must be completed before requesting approval'
      });
      return;
    }

    // Create notification for doctor
    const notification = new Notification({
      user_id: medicalRecord.doctor_id._id,
      title: 'Approval Request for Treatment Step',
      message: `${patientName || medicalRecord.user_id.name} has completed step ${stepNumber}: ${treatmentStep.title} and is requesting approval. Message: ${message}`,
      type: 'approval_request',
      related_record: medicalRecord._id,
      metadata: {
        stepNumber: parseInt(stepNumber),
        stepTitle: treatmentStep.title,
        patientName: patientName || medicalRecord.user_id.name,
        patientMessage: message,
        recordId: medicalRecord._id
      },
      priority: 'high'
    });

    await notification.save();

    // Update step to indicate approval request
    treatmentStep.approval_requested = true;
    treatmentStep.approval_requested_at = new Date();
    treatmentStep.patient_message = message;

    await medicalRecord.save();

    console.log(`📬 Approval request sent to doctor ${medicalRecord.doctor_id.name} for step ${stepNumber}`);

    res.status(200).json({
      success: true,
      message: 'Approval request sent to doctor successfully',
      data: {
        step: treatmentStep,
        notification: {
          id: notification._id,
          title: notification.title,
          message: notification.message
        },
        record: medicalRecord // Return updated record
      }
    });

  } catch (error) {
    console.error('❌ Error requesting step approval:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get approval requests for doctor
export const getApprovalRequests = async (req: AuthRequest, res: any): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
      return;
    }

    // Find all medical records where this doctor is assigned and there are pending approval requests
    const medicalRecords = await MedicalRecord.find({
      'doctor_id': req.user._id,
      'consultation_status': 'in-progress'
    })
    .populate('user_id', 'name email phoneNumber avatar')
    .populate('doctor_id', 'name email')
    .select('user_id doctor_id diagnosis treatment_plan consultation_status created_at updated_at');

    // Filter records that have steps with approval requested
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
            patient_message: step.patient_message,
            completedAt: step.completedAt
          },
          created_at: record.created_at,
          updated_at: record.updated_at
        }))
    );

    res.status(200).json({
      success: true,
      data: approvalRequests,
      count: approvalRequests.length
    });

  } catch (error) {
    console.error('❌ Error fetching approval requests:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export const activateTreatmentStep = async (req: AuthRequest, res: any): Promise<void> => {
  try {
    // FIX: Changed recordId to id to match route parameter /:id/...
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

    // Check permission - only patient can activate their own steps
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
      // If already in progress, just return success so frontend stays in sync
      if (step.status === 'in-progress') {
         res.status(200).json({
            success: true,
            message: 'Step is already in progress',
            data: { step, record: medicalRecord }
         });
         return;
      }
      res.status(400).json({ success: false, message: 'Step is not pending' });
      return;
    }

    // Activate step
    step.status = 'in-progress';
    medicalRecord.current_step = parseInt(stepNumber);
    await medicalRecord.save();

    res.status(200).json({
      success: true,
      message: 'Step activated successfully',
      data: { step, record: medicalRecord }
    });
  } catch (error) {
    console.error('❌ Error activating treatment step:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const completeTreatmentStep = async (req: AuthRequest, res: any): Promise<void> => {
  try {
    // Params: id (record ID), stepNumber
    const { id, stepNumber } = req.params;
    const { patientMessage } = req.body;

    console.log('🔍 [BACKEND] Complete step request:', { id, stepNumber });

    if (!req.user) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }

    const medicalRecord = await MedicalRecord.findById(id);
    
    if (!medicalRecord) {
      res.status(404).json({ success: false, message: 'Medical record not found' });
      return;
    }

    // Check permission
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
        // If already completed, handle gracefully
        if (step.status === 'completed' || step.status === 'approved') {
             res.status(200).json({
                success: true,
                message: 'Step already completed',
                data: { step, record: medicalRecord }
            });
            return;
        }
      console.log(`❌ [BACKEND] Invalid Status: ${step.status} for step ${stepNumber}`);
      res.status(400).json({ success: false, message: 'Step is not in progress' });
      return;
    }

    // Complete step
    step.status = 'completed';
    step.completedAt = new Date();
    step.patient_message = patientMessage || "I have completed this step";
    // Auto-trigger approval request flag here if you want seamless flow, 
    // OR keep it separate as per your UI flow (which seems to have a specific modal for request)
    step.approval_requested = true; 
    step.approval_requested_at = new Date();
    
    await medicalRecord.save();

    // Notify doctor
    try {
      await Notification.create({
        user_id: medicalRecord.doctor_id,
        title: 'Treatment Step Completed',
        message: `Patient has completed step ${stepNumber}: ${step.title}`,
        type: 'treatment_update',
        related_record: medicalRecord._id,
        priority: 'medium'
      });
    } catch (notifError) {
      console.error('⚠️ [BACKEND] Failed to create notification:', notifError);
    }

    res.status(200).json({
      success: true,
      message: 'Step completed successfully',
      data: {
        step,
        record: medicalRecord
      }
    });

  } catch (error: any) {
    console.error('❌ [BACKEND] Error completing treatment step:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error',
      error: error.message 
    });
  }
};

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

    // Check permission - only assigned doctor can change status
    if (medicalRecord.doctor_id.toString() !== req.user._id.toString()) {
      res.status(403).json({ success: false, message: 'Access denied' });
      return;
    }

    // Find step by ID (mongoose subdocument id) or match logic if needed
    const step = medicalRecord.treatment_plan.id(processId);
    if (!step) {
      res.status(404).json({ success: false, message: 'Treatment step not found' });
      return;
    }

    if (action === 'approve') {
      step.status = 'approved';
      step.approval_requested = false;
      step.approvedAt = new Date();

      // Notify patient
      await Notification.create({
        user_id: medicalRecord.user_id,
        title: 'Treatment Step Approved',
        message: `Your treatment step ${step.stepNumber}: ${step.title} has been approved by the doctor.`,
        type: 'treatment_update',
        related_record: medicalRecord._id,
        priority: 'medium'
      });

      res.status(200).json({
        success: true,
        message: 'Treatment step approved successfully',
        data: { step }
      });
    } else if (action === 'reject') {
      step.status = 'rejected';
      step.approval_requested = false;
      step.rejectedAt = new Date();

      // Notify patient
      await Notification.create({
        user_id: medicalRecord.user_id,
        title: 'Treatment Step Rejected',
        message: `Your treatment step ${step.stepNumber}: ${step.title} has been rejected by the doctor.`,
        type: 'treatment_update',
        related_record: medicalRecord._id,
        priority: 'medium'
      });

      res.status(200).json({
        success: true,
        message: 'Treatment step rejected successfully',
        data: { step }
      });
    } else {
      res.status(400).json({ success: false, message: 'Invalid action' });
    }

    await medicalRecord.save();
  } catch (error) {
    console.error('❌ Error changing treatment plan status:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ========== HOÀN THÀNH STEP VỚI MESSAGE ==========
export const completeTreatmentStepWithMessage = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { consultationId, stepNumber } = req.params;
    const { patientMessage, conditionDescription } = req.body;
    const stepNum = parseInt(stepNumber);

    console.log('=== COMPLETE TREATMENT STEP WITH MESSAGE ===');
    console.log('Request body:', { consultationId, stepNumber, patientMessage, conditionDescription });

    const medicalRecord = await MedicalRecord.findById(consultationId);
    if (!medicalRecord) {
      res.status(404).json({ 
        success: false, 
        message: 'Medical record not found' 
      });
      return;
    }

    const step = medicalRecord.treatment_plan.find(s => s.stepNumber === stepNum);
    if (!step) {
      res.status(404).json({ 
        success: false, 
        message: 'Step not found' 
      });
      return;
    }

    // VALIDATION: Chỉ cho phép complete step đang 'in-progress'
    if (step.status !== 'in-progress') {
      res.status(400).json({ 
        success: false, 
        message: `Cannot complete step. Current status: ${step.status}. Step must be in progress.` 
      });
      return;
    }

    // Cập nhật trạng thái: completed (chờ approval), KHÔNG PHẢI approved
    step.status = 'completed';
    step.completedAt = new Date();
    step.approval_requested = true;
    
    if (patientMessage) {
      step.patient_message = patientMessage;
    }

    // Lưu mô tả tình trạng vào trường mới
    step.condition_description = conditionDescription || '';

    await medicalRecord.save();

    // ========== GỬI THÔNG BÁO CHO BÁC SĨ ==========
    try {
      // Tìm thông tin bác sĩ
      const doctor = await Doctor.findById(medicalRecord.doctor_id)
        .populate('user_id', 'name email');
      
      const patient = await User.findById(medicalRecord.user_id);

      if (doctor?.user_id?._id && patient) {
        await notificationService.sendNotification({
          user_id: doctor.user_id._id.toString(),
          template_key: 'patient_completed_step_with_message',
          variables: {
            patient_name: patient.name,
            step_number: stepNum.toString(),
            step_title: step.title
          },
          type: 'treatment',
          category: 'info',
          priority: 'medium',
          related_record: consultationId,
          related_record_type: 'medical_record',
          data: {
            step: {
              stepNumber: step.stepNumber,
              title: step.title,
              patientMessage: step.patient_message,
              conditionDescription: step.condition_description,
              completedAt: step.completedAt
            },
            consultation_id: consultationId,
            patient: {
              name: patient.name,
              email: patient.email,
              phone: patient.phoneNumber
            }
          },
          channels: ['in_app', 'email'],
          action_url: `/doctor/consultations/${consultationId}/steps/${stepNum}/review`,
          action_label: 'Review Patient Progress'
        });

        // Gửi email cho bác sĩ
        if (doctor.user_id.email) {
          await emailService.sendStepCompletionNotificationEmail(
            doctor.user_id.email,
            doctor.user_id.name,
            patient.name,
            step.title,
            stepNum,
            conditionDescription || step.patient_message,
            consultationId
          );
        }

        console.log('✅ Step completion notification sent to doctor');
      }
    } catch (notifError) {
      console.error('❌ Error sending notification to doctor:', notifError);
    }

    console.log('✅ Step marked as completed with message, waiting for doctor review');

    res.status(200).json({ 
      success: true, 
      data: medicalRecord,
      message: 'Step completed successfully. Doctor has been notified to review your progress.'
    });
  } catch (error) {
    console.error('Error completing step with message:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error completing step' 
    });
  }
};
