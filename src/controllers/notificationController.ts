import { Response } from 'express';
import MedicalRecord from '../models/medicalRecord';
import { AuthRequest } from '../middlewares/authmiddleware';
import Notification from '../models/notification';


// Mark notification as read
export const markNotificationAsRead = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { notificationId } = req.params;

    if (!req.user) {
      res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
      return;
    }

    const notification = await Notification.findOneAndUpdate(
      { 
        _id: notificationId, 
        user_id: req.user._id 
      },
      { 
        is_read: true,
        read_at: new Date()
      },
      { new: true }
    );

    if (!notification) {
      res.status(404).json({
        success: false,
        message: 'Notification not found'
      });
      return;
    }

    res.status(200).json({
      success: true,
      message: 'Notification marked as read',
      data: notification
    });

  } catch (error) {
    console.error('❌ Error marking notification as read:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get unread notifications count
export const getUnreadNotificationsCount = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
      return;
    }

    const count = await Notification.countDocuments({
      user_id: req.user._id,
      is_read: false
    });

    res.status(200).json({
      success: true,
      data: { count }
    });

  } catch (error) {
    console.error('❌ Error getting unread notifications count:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get all notifications for user
export const getUserNotifications = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
      return;
    }

    const { page = 1, limit = 20, type } = req.query;
    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);

    const filter: any = { user_id: req.user._id };
    if (type) {
      filter.type = type;
    }

    const notifications = await Notification.find(filter)
      .sort({ created_at: -1 })
      .skip(skip)
      .limit(parseInt(limit as string))
      .populate('related_record')
      .populate('user_id', 'name avatar');

    const total = await Notification.countDocuments(filter);

    res.status(200).json({
      success: true,
      data: notifications,
      pagination: {
        page: parseInt(page as string),
        limit: parseInt(limit as string),
        total,
        pages: Math.ceil(total / parseInt(limit as string))
      }
    });

  } catch (error) {
    console.error('❌ Error getting user notifications:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Complete treatment step (for patient)
export const completeTreatmentStep = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { recordId, stepNumber } = req.params;
    const { patientMessage } = req.body;

    if (!req.user) {
      res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
      return;
    }

    const medicalRecord = await MedicalRecord.findById(recordId);
    if (!medicalRecord) {
      res.status(404).json({
        success: false,
        message: 'Medical record not found'
      });
      return;
    }

    // Check if user has permission
    if (medicalRecord.user_id.toString() !== req.user._id.toString()) {
      res.status(403).json({
        success: false,
        message: 'Access denied to this medical record'
      });
      return;
    }

    const step = medicalRecord.treatment_plan.find(s => s.stepNumber === parseInt(stepNumber));
    if (!step) {
      res.status(404).json({
        success: false,
        message: 'Treatment step not found'
      });
      return;
    }

    if (step.status !== 'in-progress') {
      res.status(400).json({
        success: false,
        message: 'Step is not in progress'
      });
      return;
    }

    // Update step status
    step.status = 'completed';
    step.completedAt = new Date();
    step.patient_message = patientMessage;

    await medicalRecord.save();

    res.status(200).json({
      success: true,
      message: 'Step completed successfully',
      data: {
        step,
        record: {
          _id: medicalRecord._id,
          consultation_status: medicalRecord.consultation_status,
          current_step: medicalRecord.current_step
        }
      }
    });

  } catch (error) {
    console.error('❌ Error completing treatment step:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Approve treatment step (for doctor)
export const approveTreatmentStep = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { recordId, stepNumber } = req.params;
    const { doctorNotes } = req.body;

    if (!req.user) {
      res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
      return;
    }

    const medicalRecord = await MedicalRecord.findById(recordId);
    if (!medicalRecord) {
      res.status(404).json({
        success: false,
        message: 'Medical record not found'
      });
      return;
    }

    // Check if user is the assigned doctor
    if (medicalRecord.doctor_id.toString() !== req.user._id.toString()) {
      res.status(403).json({
        success: false,
        message: 'Access denied to this medical record'
      });
      return;
    }

    const step = medicalRecord.treatment_plan.find(s => s.stepNumber === parseInt(stepNumber));
    if (!step) {
      res.status(404).json({
        success: false,
        message: 'Treatment step not found'
      });
      return;
    }

    if (step.status !== 'completed') {
      res.status(400).json({
        success: false,
        message: 'Step is not completed'
      });
      return;
    }

    // Update step status and doctor notes
    step.status = 'approved';
    step.doctorNotes = doctorNotes;
    step.approved_at = new Date();
    step.approved_by = req.user._id;
    step.approval_requested = false;

    // Activate next step if exists
    const nextStep = medicalRecord.treatment_plan.find(s => s.stepNumber === parseInt(stepNumber) + 1);
    if (nextStep && nextStep.status === 'pending') {
      nextStep.status = 'in-progress';
      medicalRecord.current_step = parseInt(stepNumber) + 1;
    }

    // Check if all steps are completed
    const allStepsCompleted = medicalRecord.treatment_plan.every(s => 
      s.status === 'approved' || s.status === 'completed'
    );

    if (allStepsCompleted) {
      medicalRecord.consultation_status = 'completed';
      medicalRecord.status = 'resolved';
    }

    await medicalRecord.save();

    res.status(200).json({
      success: true,
      message: 'Step approved successfully',
      data: {
        step,
        record: {
          _id: medicalRecord._id,
          consultation_status: medicalRecord.consultation_status,
          current_step: medicalRecord.current_step,
          status: medicalRecord.status
        }
      }
    });

  } catch (error) {
    console.error('❌ Error approving treatment step:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Activate treatment step
export const activateTreatmentStep = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { recordId, stepNumber } = req.params;

    if (!req.user) {
      res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
      return;
    }

    const medicalRecord = await MedicalRecord.findById(recordId);
    if (!medicalRecord) {
      res.status(404).json({
        success: false,
        message: 'Medical record not found'
      });
      return;
    }

    // Check if user has permission (patient can activate their own steps)
    if (medicalRecord.user_id.toString() !== req.user._id.toString()) {
      res.status(403).json({
        success: false,
        message: 'Access denied to this medical record'
      });
      return;
    }

    const step = medicalRecord.treatment_plan.find(s => s.stepNumber === parseInt(stepNumber));
    if (!step) {
      res.status(404).json({
        success: false,
        message: 'Treatment step not found'
      });
      return;
    }

    if (step.status !== 'pending') {
      res.status(400).json({
        success: false,
        message: 'Step is not pending'
      });
      return;
    }

    // Update step status
    step.status = 'in-progress';
    medicalRecord.current_step = parseInt(stepNumber);

    await medicalRecord.save();

    res.status(200).json({
      success: true,
      message: 'Step activated successfully',
      data: {
        step,
        record: {
          _id: medicalRecord._id,
          current_step: medicalRecord.current_step
        }
      }
    });

  } catch (error) {
    console.error('❌ Error activating treatment step:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Add new treatment step (doctor only)
export const addTreatmentStep = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { recordId } = req.params;
    const stepData = req.body;

    if (!req.user) {
      res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
      return;
    }

    const medicalRecord = await MedicalRecord.findById(recordId);
    if (!medicalRecord) {
      res.status(404).json({
        success: false,
        message: 'Medical record not found'
      });
      return;
    }

    // Check if user is the assigned doctor
    if (medicalRecord.doctor_id.toString() !== req.user._id.toString()) {
      res.status(403).json({
        success: false,
        message: 'Only the assigned doctor can add treatment steps'
      });
      return;
    }

    // Add new step
    const newStepNumber = medicalRecord.treatment_plan.length + 1;
    const newStep = {
      stepNumber: newStepNumber,
      title: stepData.title || 'New Treatment Step',
      description: stepData.description || 'Please update this description',
      medication: stepData.medication,
      dosage: stepData.dosage,
      duration: stepData.duration,
      instructions: stepData.instructions,
      status: newStepNumber === 1 ? 'in-progress' : 'pending'
    };

    medicalRecord.treatment_plan.push(newStep);

    // Update current step if this is the first step
    if (newStepNumber === 1) {
      medicalRecord.current_step = 1;
    }

    await medicalRecord.save();

    res.status(201).json({
      success: true,
      message: 'Treatment step added successfully',
      data: {
        step: newStep,
        record: {
          _id: medicalRecord._id,
          current_step: medicalRecord.current_step
        }
      }
    });

  } catch (error) {
    console.error('❌ Error adding treatment step:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Complete consultation
export const completeConsultation = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { recordId } = req.params;

    if (!req.user) {
      res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
      return;
    }

    const medicalRecord = await MedicalRecord.findById(recordId);
    if (!medicalRecord) {
      res.status(404).json({
        success: false,
        message: 'Medical record not found'
      });
      return;
    }

    // Check if user is the assigned doctor
    if (medicalRecord.doctor_id.toString() !== req.user._id.toString()) {
      res.status(403).json({
        success: false,
        message: 'Only the assigned doctor can complete consultations'
      });
      return;
    }

    if (medicalRecord.consultation_status === 'completed') {
      res.status(400).json({
        success: false,
        message: 'Consultation is already completed'
      });
      return;
    }

    // Update consultation status
    medicalRecord.consultation_status = 'completed';
    medicalRecord.status = 'resolved';
    medicalRecord.updated_at = new Date();

    await medicalRecord.save();

    res.status(200).json({
      success: true,
      message: 'Consultation completed successfully',
      data: {
        record: {
          _id: medicalRecord._id,
          consultation_status: medicalRecord.consultation_status,
          status: medicalRecord.status,
          updated_at: medicalRecord.updated_at
        }
      }
    });

  } catch (error) {
    console.error('❌ Error completing consultation:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};
