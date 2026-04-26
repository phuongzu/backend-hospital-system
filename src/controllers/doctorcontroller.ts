import { Request, Response } from 'express';
import { Types } from 'mongoose';
import Doctor from '../models/doctor';
import User from '../models/user';
import Appointment from '../models/appointment';
import MedicalRecord from '../models/medicalRecord';
import Notification from '../models/notification';
import path from 'path';
import fs from 'fs';
import Drug from '../models/drug';
import { notificationService } from '../utils/notificationService';
import { emailService } from '../utils/emailService';
import { socketService } from '../utils/socketService';
import UserInformation from '../models/UserInfor';


export const getActiveConsultation = async (req: Request, res: Response) => {
  try {
    const { doctorId } = req.params;
    console.log('=== GET ACTIVE CONSULTATIONS ===');
    console.log('Doctor ID from params:', doctorId);
    const consultations = await MedicalRecord.find({
      doctor_id: doctorId,
      $or: [
        { consultation_status: 'in-progress' },
        { status: 'active' }
      ]
    })
      .populate('user_id', 'name email phoneNumber dateOfBirth gender')
      .populate('doctor_id', 'name')
      .populate('appointment_id')
      .sort({ updated_at: -1 });

    console.log(`Found ${consultations.length} active consultations`);

    // Log each consultation for debugging
    consultations.forEach((consult, index) => {
      console.log(`Consultation ${index + 1}:`, {
        id: consult._id,
        status: consult.status,
        consultation_status: consult.consultation_status,
        diagnosis: consult.diagnosis
      });
    });

    res.json({ success: true, data: consultations });
  } catch (error) {
    console.error('Error fetching active consultations:', error);
    res.status(500).json({ success: false, message: 'Error fetching active consultations' });
  }
};

// Create new consultation
export const createConsultation = async (req: Request, res: Response) => {
  try {
    const {
      appointment_id,
      patient_id,
      doctor_id,
      diagnosis,
      severity,
      notes,
      initialStep
    } = req.body;

    console.log('=== CREATE CONSULTATION ===');
    console.log('Request body:', req.body);

    // Create medical record with treatment plan
    const medicalRecord = new MedicalRecord({
      appointment_id,
      user_id: patient_id,
      doctor_id,
      diagnosis,
      severity,
      notes,
      treatment_plan: [{
        stepNumber: 1,
        title: initialStep.title,
        description: initialStep.description,
        medication: initialStep.medication,
        dosage: initialStep.dosage,
        duration: initialStep.duration,
        instructions: initialStep.instructions,
        status: 'in-progress'
      }],
      consultation_status: 'in-progress',
      status: 'active',
      priority: severity === 'critical' ? 'urgent' :
        severity === 'severe' ? 'high' :
          severity === 'moderate' ? 'medium' : 'low'
    });

    await medicalRecord.save();
    await medicalRecord.populate([
      { path: 'user_id', select: 'name email phoneNumber dateOfBirth gender' },
      { path: 'doctor_id', select: 'name' }
    ]);

    console.log('Medical record created:', medicalRecord);

    res.json({ success: true, data: medicalRecord });
  } catch (error) {
    console.error('Error creating consultation:', error);
    res.status(500).json({ success: false, message: 'Error creating consultation' });
  }
};


export const addTreatmentStep = async (req: Request, res: Response) => {
  try {
    const { consultationId } = req.params;
    const { title, description, medication, dosage, duration, instructions, prescriptions } = req.body;

    console.log('=== ADD TREATMENT STEP ===');
    console.log('Consultation ID:', consultationId);

    const medicalRecord = await MedicalRecord.findById(consultationId);
    if (!medicalRecord) {
      return res.status(404).json({
        success: false,
        message: 'Medical record not found'
      });
    }
    const newStep = {
      stepNumber: medicalRecord.treatment_plan.length + 1,
      title,
      description,
      medication,
      dosage,
      duration,
      instructions,
      status: 'pending'
    };

    medicalRecord.treatment_plan.push(newStep as any);
    await medicalRecord.save();
    if (prescriptions && Array.isArray(prescriptions) && prescriptions.length > 0) {
      console.log('Updating stock for prescriptions:', prescriptions);

      for (const item of prescriptions) {
        if (!item.medication) continue;

        const quantityToDeduct = calculateQuantity(item.dosage || '', item.duration || '');

        console.log(`Deducting ${quantityToDeduct} from ${item.medication}`);
        const updatedDrug = await Drug.findOneAndUpdate(
          { name: item.medication },
          { $inc: { stock_quantity: -quantityToDeduct } },
          { new: true }
        );

        if (!updatedDrug) {
          console.warn(`Warning: Drug '${item.medication}' not found in inventory.`);
        } else {
          console.log(`Updated stock for ${updatedDrug.name}. New stock: ${updatedDrug.stock_quantity}`);
        }
      }
    }

    res.json({ success: true, data: medicalRecord });
  } catch (error) {
    console.error('Error adding treatment step:', error);
    res.status(500).json({ success: false, message: 'Error adding treatment step' });
  }
};

export const updateTreatmentStep = async (req: Request, res: Response) => {
  try {
    const { consultationId, stepNumber } = req.params;
    const { title, description, medication, dosage, duration, instructions } = req.body;
    const stepNum = parseInt(stepNumber);

    console.log('=== UPDATE TREATMENT STEP ===');
    console.log('Consultation ID:', consultationId, 'Step:', stepNum);
    console.log('Update Data:', { title, description, medication });

    const medicalRecord = await MedicalRecord.findById(consultationId);
    if (!medicalRecord) {
      return res.status(404).json({ success: false, message: 'Medical record not found' });
    }

    const stepIndex = medicalRecord.treatment_plan.findIndex(s => s.stepNumber === stepNum);
    if (stepIndex === -1) {
      return res.status(404).json({ success: false, message: 'Step not found' });
    }

    // Update the step fields
    const step = medicalRecord.treatment_plan[stepIndex];
    step.title = title;
    step.description = description;
    step.medication = medication;
    step.dosage = dosage;
    step.duration = duration;
    step.instructions = instructions;

    const sev = medicalRecord.severity as string;
    if (sev === 'low') medicalRecord.severity = 'mild';
    else if (sev === 'medium') medicalRecord.severity = 'moderate';
    else if (sev === 'high') medicalRecord.severity = 'severe';
    else if (!['mild', 'moderate', 'severe', 'critical'].includes(sev)) {
      medicalRecord.severity = 'mild';
    }
    // Save
    await medicalRecord.save();

    res.json({
      success: true,
      message: 'Treatment step updated successfully',
      data: medicalRecord
    });
  } catch (error) {
    console.error('Error updating treatment step:', error);
    res.status(500).json({ success: false, message: 'Error updating treatment step' });
  }
};

export const approveTreatmentStep = async (req: Request, res: Response) => {
  try {
    const { consultationId, stepNumber } = req.params;
    const stepNum = parseInt(stepNumber);
    const { doctor_notes } = req.body;

    console.log('=== APPROVE TREATMENT STEP ===');
    console.log('Consultation ID:', consultationId);
    console.log('Step number:', stepNum);

    // Sửa: Chỉ populate đơn giản
    const medicalRecord = await MedicalRecord.findById(consultationId)
      .populate('user_id', 'name email')
      .populate('doctor_id', 'user_id name');

    if (!medicalRecord) {
      return res.status(404).json({ success: false, message: 'Medical record not found' });
    }

    let doctorUserInfo = null;
    if (medicalRecord.doctor_id) {
      const doctor = medicalRecord.doctor_id as any;
      if (doctor.user_id) {
        doctorUserInfo = await User.findById(doctor.user_id)
          .select('name email phoneNumber')
          .lean();
      }
    }

    const step = medicalRecord.treatment_plan.find((s: any) => s.stepNumber === stepNum);
    if (!step) {
      return res.status(404).json({ success: false, message: 'Step not found' });
    }

    if (step.status !== 'completed') {
      return res.status(400).json({
        success: false,
        message: 'Cannot approve step that is not completed by patient'
      });
    }
    await medicalRecord.approveStep(stepNum, doctor_notes);

    const isLastStep = stepNum === medicalRecord.treatment_plan.length;
    const allStepsApproved = medicalRecord.treatment_plan.every((s: any) =>
      s.status === 'approved'
    );

    // ================= NOTIFICATION LOGIC =================
    try {
      const patientUserId = (medicalRecord.user_id as any)._id;

      if (patientUserId && doctorUserInfo) {
        await notificationService.sendNotification({
          user_id: patientUserId.toString(),
          template_key: 'treatment_step_approved',
          variables: {
            step_number: stepNum.toString(),
            step_title: step.title,
            doctor_name: doctorUserInfo.name
          },
          type: 'treatment',
          category: 'success',
          priority: 'medium',
          related_record: consultationId,
          related_record_type: 'medical_record',
          data: {
            step: step,
            consultation_id: consultationId,
            doctor_notes: doctor_notes,
            is_consultation_completed: isLastStep && allStepsApproved
          },
          action_url: `/consultations/${consultationId}/steps/${stepNum}`,
          action_label: 'View Step Details'
        });

        // Send email to patient
        const patientUser = await User.findById(patientUserId);
        if (patientUser?.email) {
          await emailService.sendTreatmentStepApprovalEmail(
            patientUser.email,
            patientUser.name,
            step.title,
            stepNum,
            doctorUserInfo.name,
            doctor_notes,
            isLastStep && allStepsApproved
          );
        }
      }

      // If consultation is completed, send completion notification
      if (isLastStep && allStepsApproved) {
        await notificationService.sendNotification({
          user_id: patientUserId.toString(),
          template_key: 'consultation_completed',
          variables: {
            doctor_name: doctorUserInfo ? doctorUserInfo.name : 'Your doctor',
            diagnosis: medicalRecord.diagnosis || 'Completed'
          },
          type: 'consultation',
          category: 'success',
          priority: 'high',
          related_record: consultationId,
          related_record_type: 'medical_record',
          data: {
            consultation_id: consultationId,
            completed_at: new Date().toISOString()
          },
          action_url: `/consultations/${consultationId}/summary`,
          action_label: 'View Summary'
        });

        // Send consultation summary email
        const patientUser = await User.findById(patientUserId);
        if (patientUser?.email) {
          await emailService.sendConsultationSummaryEmail(
            patientUser.email,
            patientUser.name,
            {
              consultation_id: consultationId,
              doctor_name: doctorUserInfo ? doctorUserInfo.name : 'Your doctor',
              diagnosis: medicalRecord.diagnosis || 'Completed',
              summary: medicalRecord.notes || '',
              treatment_steps_completed: medicalRecord.treatment_plan.filter((s: any) => s.status === 'approved').length,
              total_treatment_steps: medicalRecord.treatment_plan.length,
              follow_up_instructions: medicalRecord.follow_up_instructions || '',
              next_appointment_date: medicalRecord.next_appointment,
              completed_date: new Date().toLocaleDateString()
            }
          );
        }
      }

      console.log('✅ Notifications sent successfully');
    } catch (notifError) {
      console.error('❌ Error sending notifications:', notifError);
    }
    // ================= END NOTIFICATION LOGIC =================

    res.json({
      success: true,
      data: medicalRecord,
      message: isLastStep && allStepsApproved
        ? 'Final step approved - Consultation completed!'
        : 'Step approved successfully'
    });
  } catch (error) {
    console.error('Error approving step:', error);
    res.status(500).json({ success: false, message: 'Error approving step' });
  }
};


// Complete consultation
export const completeConsultation = async (req: Request, res: Response) => {
  try {
    const { consultationId } = req.params;
    const { diagnosis, notes, follow_up_instructions, next_appointment } = req.body;

    console.log('=== COMPLETE CONSULTATION ===');
    console.log('Consultation ID:', consultationId);

    const medicalRecord = await MedicalRecord.findById(consultationId)
      .populate('user_id', 'name email')
      .populate({
        path: 'doctor_id',
        select: 'name',
        populate: {
          path: 'user_id',
          select: '_id name email',
          strictPopulate: false
        }
      });

    if (!medicalRecord) {
      return res.status(404).json({ success: false, message: 'Medical record not found' });
    }


    const allApproved = medicalRecord.treatment_plan.every((step: any) => step.status === 'approved');
    if (!allApproved) {
      return res.status(400).json({ success: false, message: 'All steps must be approved before completing the consultation.' });
    }

    medicalRecord.consultation_status = 'completed';
    medicalRecord.status = 'resolved';
    medicalRecord.updated_at = new Date();

    medicalRecord.next_appointment = undefined;

    if (diagnosis) medicalRecord.diagnosis = diagnosis;
    if (notes) medicalRecord.notes = notes;
    if (follow_up_instructions) medicalRecord.follow_up_instructions = follow_up_instructions;
    if (next_appointment) medicalRecord.next_appointment = next_appointment;

    await medicalRecord.save();

    // ================= NOTIFICATION LOGIC =================
    try {
      // Get patient and doctor info
      const patientUserId = medicalRecord.user_id._id;
      const doctorPopulated = medicalRecord.doctor_id as any;
      const doctorUser = doctorPopulated?.user_id;

      if (patientUserId && doctorUser) {
        await notificationService.sendNotification({
          user_id: patientUserId.toString(),
          title: 'Consultation Completed',
          message: `Dr. ${doctorPopulated?.name || 'Doctor'} has completed your consultation. ${medicalRecord.diagnosis ? `Diagnosis: ${medicalRecord.diagnosis}` : ''}`,
          type: 'consultation',
          category: 'success',
          priority: 'high',
          related_record: consultationId,
          related_record_type: 'medical_record',
          data: {
            diagnosis: diagnosis || medicalRecord.diagnosis,
            summary: notes || medicalRecord.notes,
            follow_up_instructions: follow_up_instructions || medicalRecord.follow_up_instructions,
            next_appointment: next_appointment || medicalRecord.next_appointment,
            completed_at: new Date().toISOString()
          },
          channels: ['in_app', 'email'],
          action_url: `/consultations/${consultationId}/summary`,
          action_label: 'View Summary'
        });

        // Send email to patient
        const patientUser = await User.findById(patientUserId);
        if (patientUser?.email) {
          await emailService.sendConsultationSummaryEmail(
            patientUser.email,
            patientUser.name,
            {
              consultation_id: consultationId,
              doctor_name: doctorPopulated?.name || 'Doctor',
              diagnosis: medicalRecord.diagnosis || 'Completed',
              summary: medicalRecord.notes || '',
              treatment_steps_completed: medicalRecord.treatment_plan.filter((s: any) =>
                s.status === 'approved' || s.status === 'completed'
              ).length,
              total_treatment_steps: medicalRecord.treatment_plan.length,
              follow_up_instructions: medicalRecord.follow_up_instructions || '',
              next_appointment_date: medicalRecord.next_appointment,
              completed_date: new Date().toLocaleDateString()
            }
          );
        }
      }

      // Also send notification to doctor about consultation completion
      if (doctorUser) {
        await notificationService.sendNotification({
          user_id: doctorUser._id.toString(),
          title: 'Consultation Recorded',
          message: `You have completed consultation with ${(medicalRecord.user_id as any).name}. Medical record has been updated.`, type: 'consultation',
          category: 'info',
          priority: 'medium',
          related_record: consultationId,
          related_record_type: 'medical_record',
          data: {
            patient_name: (medicalRecord.user_id as any).name,
            completion_date: new Date().toISOString(),
            diagnosis: medicalRecord.diagnosis
          }
        });
      }

      console.log('✅ Consultation completion notifications sent');
    } catch (notifError) {
      console.error('❌ Error sending notifications:', notifError);
    }
    // ================= END NOTIFICATION LOGIC =================

    const patientUser = await User.findById(medicalRecord.user_id._id);
    if (patientUser) {
      socketService.emitToUser(
        (patientUser._id as Types.ObjectId).toString(),
        'consultation_completed',
        {
          consultation_id: consultationId,
          doctor_name: (medicalRecord.doctor_id as any)?.name || 'Doctor',
          diagnosis: medicalRecord.diagnosis,
          completed_at: new Date(),
          timestamp: new Date()
        }
      );
    }

    // Update appointment status to completed
    try {
      const appointment = await Appointment.findById(medicalRecord.appointment_id);
      if (appointment && appointment.status !== 'completed') {
        appointment.status = 'completed';
        await appointment.save();

        console.log('✅ Appointment status updated to completed');
      }
    } catch (appointmentError) {
      console.error('❌ Error updating appointment status:', appointmentError);
    }

    res.json({
      success: true,
      data: medicalRecord,
      message: 'Consultation completed successfully with notifications sent'
    });
  } catch (error) {
    console.error('Error completing consultation:', error);
    res.status(500).json({ success: false, message: 'Error completing consultation' });
  }
};
// File upload setup
const uploadsDir = path.join(__dirname, '..', 'uploads', 'avatars');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  console.log('✅ Created uploads directory:', uploadsDir);
} else {
  console.log('✅ Uploads directory exists:', uploadsDir);
}

// Utility: consistent error response
const handleError = (res: Response, error: any, message = 'Internal server error') => {
  console.error(`${message}:`, error);
  res.status(500).json({ success: false, message });
};

// Define AuthRequest type
interface AuthRequest extends Request {
  user?: {
    _id: string;
    role: string;
  };
}

// Get all available doctors (user.status === 'working')
export const getAvailableDoctors = async (req: Request, res: Response) => {
  try {
    const doctors = await Doctor.find({})
      .populate('user_id', 'name email phoneNumber status')
      .populate('specialty_id', 'name description');

    const availableDoctors = doctors.filter((doc: any) => doc.user_id?.status === 'working');
    res.status(200).json({ success: true, data: availableDoctors });
  } catch (error) {
    handleError(res, error, 'Error fetching doctors');
  }
};

// Get available doctors by specialty
export const getDoctorsBySpecialty = async (req: Request, res: Response) => {
  try {
    const { specialtyId } = req.params;
    if (!specialtyId) {
      return res.status(400).json({ success: false, message: 'Specialty ID is required' });
    }
    const doctors = await Doctor.find({ specialty_id: specialtyId })
      .populate('user_id', 'name email phoneNumber status')
      .populate('specialty_id', 'name description');

    const availableDoctors = doctors.filter((doc: any) => doc.user_id?.status === 'working');
    res.status(200).json({ success: true, data: availableDoctors });
  } catch (error) {
    handleError(res, error, 'Error fetching doctors by specialty');
  }
};

// Search doctors from user accounts
export const getDoctorsFromUsers = async (req: Request, res: Response) => {
  try {
    const { search } = req.query;
    let query: any = { role: 'doctor', isActive: true };

    if (search) {
      query.name = { $regex: search, $options: 'i' };
    }

    const users = await User.find(query).select('name email phoneNumber status').sort({ name: 1 });
    const doctorsWithDetails = await Promise.all(
      users.map(async (user) => {
        const doctorDetails = await Doctor.findOne({ user_id: user._id }).populate('specialty_id', 'name description');
        return {
          ...user.toObject(),
          doctorDetails: doctorDetails || null
        };
      })
    );

    res.status(200).json({ success: true, data: doctorsWithDetails });
  } catch (error) {
    handleError(res, error, 'Error fetching doctors from users');
  }
};

// Change status of doctor (user.status)
export const changeDoctorStatus = async (req: Request, res: Response) => {
  try {
    const { doctorId } = req.params;
    const { status } = req.body;

    if (!doctorId || !status || !['working', 'busy', 'not working'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid doctor ID or status' });
    }

    const user = await User.findById(doctorId);
    if (!user || user.role !== 'doctor') {
      return res.status(404).json({ success: false, message: 'Doctor not found' });
    }

    user.status = status;
    await user.save();

    res.status(200).json({
      success: true,
      message: 'Doctor status updated',
      data: { doctorId, status }
    });
  } catch (error) {
    handleError(res, error, 'Error changing doctor status');
  }
};

// FIXED: Get appointments for a specific doctor
export const getDoctorAppointments = async (req: Request, res: Response) => {
  try {
    const { doctorId } = req.params;

    if (!doctorId) {
      return res.status(400).json({ success: false, message: 'Doctor ID is required' });
    }

    const doctor = await Doctor.findOne({ user_id: doctorId });
    if (!doctor) {
      return res.status(404).json({ success: false, message: 'Doctor not found' });
    }

    const doctorObjectId = doctor._id;
    let query: any = { doctor_id: doctorObjectId };

    if (req.query.date) {
      const date = new Date(req.query.date as string);
      if (isNaN(date.getTime())) {
        return res.status(400).json({ success: false, message: 'Invalid date format' });
      }
      const nextDay = new Date(date);
      nextDay.setDate(date.getDate() + 1);
      query.appointment_date = { $gte: date, $lt: nextDay };
    }

    const appointments = await Appointment.find(query)
      .populate('user_id', 'name email phoneNumber dateOfBirth gender')
      .populate('specialty_id', 'name')
      .sort({ appointment_date: 1, time_slot: 1 })
      .lean();

    // ── NEW: Enrich with clinical flags if requested ────────
    const includeClinical = req.query.includeClinical === 'true';

    if (includeClinical) {
      const enriched = await Promise.all(
        appointments.map(async (apt: any) => {
          // user_id is populated, so apt.user_id is an object with _id
          const userId = apt.user_id?._id ?? apt.user_id;
          if (!userId) return { ...apt, clinicalFlags: null };

          try {
            const userInfo = await UserInformation.findOne({ user_id: userId })
              .select('blood_type allergies chronic_diseases')
              .lean();

            return {
              ...apt,
              clinicalFlags: {
                hasAllergies: Array.isArray((userInfo as any)?.allergies) && (userInfo as any).allergies.length > 0,
                allergies: ((userInfo as any)?.allergies as string[]) ?? [],
                chronicDiseases: ((userInfo as any)?.chronic_diseases as string[]) ?? [],
                bloodType: (userInfo as any)?.blood_type ?? null,
              },
            };
          } catch {
            return { ...apt, clinicalFlags: null };
          }
        })
      );

      return res.status(200).json({
        success: true,
        data: enriched,
        debug: {
          doctorIdFromParams: doctorId,
          doctorObjectId,
          appointmentsCount: enriched.length,
          clinicalEnriched: true,
        },
      });
    }

    return res.status(200).json({
      success: true,
      data: appointments,
      debug: {
        doctorIdFromParams: doctorId,
        doctorObjectId,
        appointmentsCount: appointments.length,
      },
    });
  } catch (error) {
    console.error('Error fetching appointments:', error);
    handleError(res, error, 'Error fetching appointments');
  }
};

export const getDoctorPatients = async (req: Request, res: Response) => {
  try {
    const { doctorId } = req.params;
    const limit = parseInt(req.query.limit as string) || 10;

    if (!doctorId) {
      return res.status(400).json({ success: false, message: 'Doctor ID is required' });
    }

    // Get recent medical records for this doctor
    const recentRecords = await MedicalRecord.find({
      $or: [
        { doctor_id: doctorId }
      ]
    })
      .populate({
        path: 'user_id',
        select: 'name email phoneNumber dateOfBirth gender avatar'
      })
      .sort({ created_at: -1 })
      .limit(limit);

    const patients = recentRecords.map((record: any) => record.user_id).filter(Boolean);

    // Remove duplicates by _id
    const uniquePatients = patients.filter((patient: any, index: number, self: any[]) =>
      index === self.findIndex((p: any) =>
        p && patient && p._id.toString() === patient._id.toString()
      )
    );

    // Lấy thông tin từ UserInformation cho từng patient
    const patientsWithInfo = await Promise.all(
      uniquePatients.map(async (patient: any) => {
        const userInfo = await UserInformation.findOne({ user_id: patient._id })
          .select('blood_type allergies height weight chronic_diseases BMI emergency_contact')
          .lean();

        return {
          ...patient.toObject(),
          blood_type: userInfo?.blood_type || null,
          allergies: userInfo?.allergist || [],
          height: userInfo?.height || null,
          weight: userInfo?.weight || null,
          chronic_diseases: userInfo?.chronic_diseases || [],
          BMI: userInfo?.BMI || null,
          emergency_contact: userInfo?.emergency_contact || null
        };
      })
    );

    res.status(200).json({
      success: true,
      data: patientsWithInfo
    });
  } catch (error) {
    handleError(res, error, 'Error fetching recent patients');
  }
};


// Get notifications for a specific doctor
export const getDoctorNotifications = async (req: Request, res: Response) => {
  try {
    const { doctorId } = req.params;
    if (!doctorId) {
      return res.status(400).json({ success: false, message: 'Doctor ID is required' });
    }

    const notifications = await Notification.find({
      doctor_id: doctorId
    }).sort({ createdAt: -1 });

    res.status(200).json({ success: true, data: notifications });
  } catch (error) {
    handleError(res, error, 'Error fetching notifications');
  }
};

// FIXED: Get statistics for a specific doctor
export const getDoctorStats = async (req: Request, res: Response) => {
  try {
    const { doctorId } = req.params;
    console.log('=== GET DOCTOR STATS ===');
    console.log('Doctor ID from params:', doctorId);

    if (!doctorId) {
      return res.status(400).json({ success: false, message: 'Doctor ID is required' });
    }

    // First, find the doctor document by user_id
    const doctor = await Doctor.findOne({ user_id: doctorId });
    console.log('Found doctor for stats:', doctor);

    if (!doctor) {
      return res.status(404).json({ success: false, message: 'Doctor not found' });
    }

    const doctorObjectId = doctor._id;
    const stats = await Appointment.aggregate([
      {
        $match: {
          doctor_id: doctorObjectId
        }
      },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);

    console.log('Stats result:', stats);

    res.status(200).json({
      success: true,
      data: stats,
      debug: {
        doctorIdFromParams: doctorId,
        doctorObjectId: doctorObjectId,
        statsCount: stats.length
      }
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    handleError(res, error, 'Error fetching stats');
  }
};

// Update doctor availability (requires authentication)
export const updateDoctorAvailability = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user?._id) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const { isAvailable } = req.body;
    if (typeof isAvailable !== 'boolean') {
      return res.status(400).json({ success: false, message: 'isAvailable (boolean) is required' });
    }

    const doctor = await Doctor.findOneAndUpdate(
      { user_id: req.user._id },
      { isAvailable },
      { new: true }
    );

    if (!doctor) {
      return res.status(404).json({ success: false, message: 'Doctor not found' });
    }

    res.status(200).json({
      success: true,
      message: 'Availability updated successfully',
      data: doctor
    });
  } catch (error) {
    handleError(res, error, 'Error updating availability');
  }
};

// Get profile for a specific doctor
export const getDoctorProfile = async (req: Request, res: Response) => {
  try {
    const { doctorId } = req.params;
    console.log('=== GET DOCTOR PROFILE ===');
    console.log('Doctor ID from params:', doctorId);

    if (!doctorId) {
      return res.status(400).json({ success: false, message: 'Doctor ID is required' });
    }

    // Find doctor by user_id (this is what's stored in localStorage)
    const doctor = await Doctor.findOne({ user_id: doctorId })
      .populate('user_id', 'name email phoneNumber status')
      .populate('specialty_id', 'name description')
      .lean();

    console.log('Doctor found:', doctor);

    if (!doctor) {
      return res.status(404).json({ success: false, message: 'Doctor not found' });
    }

    res.status(200).json({
      success: true,
      data: doctor,
      debug: {
        searchMethod: 'user_id',
        user_id: doctorId
      }
    });
  } catch (error) {
    console.error('Error fetching doctor profile:', error);
    handleError(res, error, 'Error fetching doctor profile');
  }
};

// FIXED: Appointment actions
export const confirmAppointment = async (req: Request, res: Response) => {
  try {
    const { appointmentId } = req.params;
    const { doctorId } = req.body;

    console.log('=== CONFIRM APPOINTMENT ===');
    console.log('Appointment ID:', appointmentId);
    console.log('Doctor ID (user_id):', doctorId);

    // First, find the doctor document by user_id
    const doctor = await Doctor.findOne({ user_id: doctorId });
    if (!doctor) {
      return res.status(404).json({ success: false, message: 'Doctor not found' });
    }

    const doctorObjectId = doctor._id;
    const appointment = await Appointment.findOneAndUpdate(
      {
        _id: appointmentId,
        doctor_id: doctorObjectId
      },
      { status: 'confirmed' },
      { new: true }
    ).populate('user_id', 'name email phoneNumber dateOfBirth gender');

    console.log('Updated appointment:', appointment);

    if (!appointment) {
      return res.status(404).json({ success: false, message: 'Appointment not found' });
    }

    res.status(200).json({
      success: true,
      message: 'Appointment confirmed successfully',
      data: appointment
    });
  } catch (error) {
    console.error('Error confirming appointment:', error);
    handleError(res, error, 'Error confirming appointment');
  }
};

export const cancelAppointment = async (req: Request, res: Response) => {
  try {
    const { appointmentId } = req.params;
    const { doctorId } = req.body;

    // First, find the doctor document by user_id
    const doctor = await Doctor.findOne({ user_id: doctorId });
    if (!doctor) {
      return res.status(404).json({ success: false, message: 'Doctor not found' });
    }

    const doctorObjectId = doctor._id;
    const appointment = await Appointment.findOneAndUpdate(
      {
        _id: appointmentId,
        doctor_id: doctorObjectId
      },
      { status: 'cancelled' },
      { new: true }
    );

    if (!appointment) {
      return res.status(404).json({ success: false, message: 'Appointment not found' });
    }

    res.status(200).json({
      success: true,
      message: 'Appointment cancelled successfully',
      data: appointment
    });
  } catch (error) {
    console.error('Error cancelling appointment:', error);
    handleError(res, error, 'Error cancelling appointment');
  }
};

export const completeAppointment = async (req: Request, res: Response) => {
  try {
    const { appointmentId } = req.params;
    const { doctorId } = req.body;

    // First, find the doctor document by user_id
    const doctor = await Doctor.findOne({ user_id: doctorId });
    if (!doctor) {
      return res.status(404).json({ success: false, message: 'Doctor not found' });
    }

    const doctorObjectId = doctor._id;
    const appointment = await Appointment.findOneAndUpdate(
      {
        _id: appointmentId,
        doctor_id: doctorObjectId
      },
      { status: 'completed' },
      { new: true }
    );

    if (!appointment) {
      return res.status(404).json({ success: false, message: 'Appointment not found' });
    }

    res.status(200).json({
      success: true,
      message: 'Appointment completed successfully',
      data: appointment
    });
  } catch (error) {
    console.error('Error completing appointment:', error);
    handleError(res, error, 'Error completing appointment');
  }
};


export const uploadDoctorAvatar = async (req: Request, res: Response) => {
  try {
    console.log('=== AVATAR UPLOAD CONTROLLER ===');
    console.log('req.query:', req.query);
    console.log('req.file:', req.file);

    let doctorId = req.query.doctorId as string;

    console.log('DoctorId from query:', doctorId);

    if (!doctorId || doctorId === 'undefined') {
      console.error('❌ Doctor ID not found in query parameters');
      if (req.file) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(400).json({
        success: false,
        message: 'Doctor ID is required'
      });
    }

    doctorId = String(doctorId).trim();

    if (!req.file) {
      console.error('❌ No file uploaded');
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    console.log('✅ Processing avatar for doctor:', doctorId);
    console.log('✅ File saved as:', req.file.filename);
    console.log('✅ File path:', req.file.path);

    // Xóa file cũ của doctor này
    try {
      const files = fs.readdirSync(uploadsDir);
      console.log('All files in uploads directory:', files);

      const oldFiles = files.filter(file => {
        return file.startsWith(`doctor-${doctorId}-`) &&
          file !== req.file!.filename;
      });

      console.log('Old files to delete:', oldFiles);

      oldFiles.forEach(file => {
        const oldFilePath = path.join(uploadsDir, file);
        try {
          fs.unlinkSync(oldFilePath);
          console.log('✅ Deleted old avatar:', file);
        } catch (err) {
          console.error('❌ Error deleting old avatar:', err);
        }
      });
    } catch (err) {
      console.error('❌ Error reading uploads directory:', err);
    }
    const avatarFilename = req.file.filename;

    console.log('✅ Avatar filename for DB:', avatarFilename);

    // Update database - chỉ lưu tên file
    const doctor = await Doctor.findOneAndUpdate(
      { user_id: doctorId },
      { avatar: avatarFilename }, // CHỈ LƯU TÊN FILE
      { new: true }
    );

    if (!doctor) {
      console.error('❌ Doctor not found with user_id:', doctorId);
      fs.unlinkSync(req.file.path);
      return res.status(404).json({
        success: false,
        message: 'Doctor not found in database'
      });
    }

    console.log('✅ Doctor avatar updated successfully');

    res.status(200).json({
      success: true,
      message: 'Avatar uploaded successfully',
      data: {
        avatar: avatarFilename, // Trả về tên file
        doctor: {
          _id: doctor._id,
          user_id: doctor.user_id
        }
      }
    });

  } catch (error) {
    console.error('❌ Error uploading avatar:', error);
    if (req.file) {
      try {
        fs.unlinkSync(req.file.path);
        console.log('✅ Cleaned up file due to error');
      } catch (unlinkError) {
        console.error('❌ Error cleaning up file:', unlinkError);
      }
    }
    res.status(500).json({
      success: false,
      message: 'Error uploading avatar'
    });
  }
};

// Get doctor avatar
export const getDoctorAvatar = async (req: Request, res: Response) => {
  try {
    const { filename } = req.params;

    if (!filename) {
      return res.status(400).json({ success: false, message: 'Filename is required' });
    }

    const avatarPath = path.join(uploadsDir, filename);

    // Kiểm tra file có tồn tại không
    if (!fs.existsSync(avatarPath)) {
      return res.status(404).json({ success: false, message: 'Avatar not found' });
    }

    // Xác định loại file
    const ext = path.extname(filename).toLowerCase();
    let contentType = 'image/jpeg';

    switch (ext) {
      case '.png':
        contentType = 'image/png';
        break;
      case '.gif':
        contentType = 'image/gif';
        break;
      case '.webp':
        contentType = 'image/webp';
        break;
    }
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');

    res.sendFile(avatarPath);
  } catch (error) {
    console.error('Error serving avatar:', error);
    res.status(500).json({ success: false, message: 'Error serving avatar' });
  }
};

// Get all consultations for a doctor
export const getDoctorConsultations = async (req: Request, res: Response) => {
  try {
    const { doctorId } = req.params;
    console.log('=== GET DOCTOR CONSULTATIONS ===');
    console.log('Doctor ID from params:', doctorId);

    const consultations = await MedicalRecord.find({
      doctor_id: doctorId
    })
      .populate('user_id', 'name email phoneNumber dateOfBirth gender')
      .populate('doctor_id', 'name')
      .populate('appointment_id')
      .sort({ updated_at: -1 });

    console.log('Found consultations:', consultations.length);

    res.json({
      success: true,
      data: consultations
    });
  } catch (error) {
    console.error('Error fetching consultations:', error);
    res.status(500).json({ success: false, message: 'Error fetching consultations' });
  }
};

// Set active consultation
export const setActiveConsultation = async (req: Request, res: Response) => {
  try {
    const { consultationId } = req.params;
    const { doctorId } = req.body;

    console.log('=== SET ACTIVE CONSULTATION ===');
    console.log('Consultation ID:', consultationId);
    console.log('Doctor ID:', doctorId);

    // First, clear any existing active consultation for this doctor
    await MedicalRecord.updateMany(
      {
        doctor_id: doctorId,
        consultation_status: 'in-progress'
      },
      {
        $unset: { isActive: 1 } // Remove isActive field
      }
    );

    // Set the new consultation as active
    const consultation = await MedicalRecord.findOneAndUpdate(
      {
        _id: consultationId,
        doctor_id: doctorId,
        consultation_status: 'in-progress'
      },
      {
        isActive: true,
        updated_at: new Date()
      },
      { new: true }
    )
      .populate('user_id', 'name email phoneNumber dateOfBirth gender')
      .populate('appointment_id');

    if (!consultation) {
      return res.status(404).json({
        success: false,
        message: 'Consultation not found or not in progress'
      });
    }

    res.json({
      success: true,
      message: 'Consultation set as active',
      data: consultation
    });
  } catch (error) {
    console.error('Error setting active consultation:', error);
    res.status(500).json({ success: false, message: 'Error setting active consultation' });
  }
};

// Clear active consultation
export const clearActiveConsultation = async (req: Request, res: Response) => {
  try {
    const { doctorId } = req.params;

    console.log('=== CLEAR ACTIVE CONSULTATION ===');
    console.log('Doctor ID:', doctorId);

    const result = await MedicalRecord.updateMany(
      {
        doctor_id: doctorId,
        consultation_status: 'in-progress'
      },
      {
        $unset: { isActive: 1 } // Remove isActive field
      }
    );

    console.log('Cleared active consultations:', result.modifiedCount);

    res.json({
      success: true,
      message: 'Active consultation cleared',
      data: { clearedCount: result.modifiedCount }
    });
  } catch (error) {
    console.error('Error clearing active consultation:', error);
    res.status(500).json({ success: false, message: 'Error clearing active consultation' });
  }
};


// Update consultation status
export const updateConsultationStatus = async (req: Request, res: Response) => {
  try {
    const { consultationId } = req.params;
    const { status } = req.body;

    console.log('=== UPDATE CONSULTATION STATUS ===');
    console.log('Consultation ID:', consultationId);
    console.log('New status:', status);

    const validStatuses = ['active', 'resolved', 'follow_up', 'chronic'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status. Must be: active, resolved, follow_up, or chronic'
      });
    }

    const consultation = await MedicalRecord.findByIdAndUpdate(
      consultationId,
      {
        status: status,
        updated_at: new Date()
      },
      { new: true }
    )
      .populate('user_id', 'name email phoneNumber dateOfBirth gender')
      .populate('appointment_id');

    if (!consultation) {
      return res.status(404).json({ success: false, message: 'Consultation not found' });
    }

    res.json({
      success: true,
      message: 'Consultation status updated',
      data: consultation
    });
  } catch (error) {
    console.error('Error updating consultation status:', error);
    res.status(500).json({ success: false, message: 'Error updating consultation status' });
  }
};

// Get all patients with search and pagination
export const getAllPatients = async (req: Request, res: Response) => {
  try {
    const { doctorId } = req.params;
    const { search, page = 1, limit = 50 } = req.query;

    console.log('=== GET ALL PATIENTS ===');
    console.log('Doctor ID:', doctorId);

    if (!doctorId) {
      return res.status(400).json({ success: false, message: 'Doctor ID is required' });
    }

    let matchQuery: any = { doctor_id: doctorId };

    const medicalRecords = await MedicalRecord.find(matchQuery)
      .distinct('user_id')
      .lean();

    const patientIds = medicalRecords.map(id => id.toString());

    let userQuery: any = {
      _id: { $in: patientIds },
      role: 'patient'
    };

    if (search) {
      userQuery.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phoneNumber: { $regex: search, $options: 'i' } }
      ];
    }

    const users = await User.find(userQuery)
      .select('name email phoneNumber dateOfBirth gender')
      .skip((Number(page) - 1) * Number(limit))
      .limit(Number(limit))
      .lean();

    // Lấy thông tin từ UserInformation cho từng user
    const usersWithInfo = await Promise.all(
      users.map(async (user) => {
        const userInfo = await UserInformation.findOne({ user_id: user._id })
          .select('blood_type allergies height weight chronic_diseases BMI')
          .lean();

        return {
          ...user,
          blood_type: userInfo?.blood_type || null,
          allergies: userInfo?.allergist || [],
          height: userInfo?.height || null,
          weight: userInfo?.weight || null,
          chronic_diseases: userInfo?.chronic_diseases || [],
          BMI: userInfo?.BMI || null
        };
      })
    );

    // Lấy tổng số lượng
    const total = await User.countDocuments(userQuery);

    res.status(200).json({
      success: true,
      data: usersWithInfo,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit))
      }
    });
  } catch (error) {
    console.error('Error fetching all patients:', error);
    handleError(res, error, 'Error fetching patients');
  }
};



export const completeTreatmentStep = async (req: Request, res: Response) => {
  try {
    const { consultationId, stepNumber } = req.params;
    const { patientMessage } = req.body;
    const stepNum = parseInt(stepNumber);

    console.log('=== COMPLETE TREATMENT STEP (PATIENT) ===');

    const medicalRecord = await MedicalRecord.findById(consultationId);
    if (!medicalRecord) {
      return res.status(404).json({ success: false, message: 'Medical record not found' });
    }

    const step = medicalRecord.treatment_plan.find(s => s.stepNumber === stepNum);
    if (!step) {
      return res.status(404).json({ success: false, message: 'Step not found' });
    }

    // VALIDATION QUAN TRỌNG: Chỉ cho phép complete step đang 'in-progress'
    if (step.status !== 'in-progress') {
      return res.status(400).json({
        success: false,
        message: `Cannot complete step. Current status: ${step.status}. Step must be in progress.`
      });
    }

    step.status = 'completed';
    step.completedAt = new Date();
    step.approval_requested = true;

    if (patientMessage) {
      step.patientMessage = patientMessage;
    }

    await medicalRecord.save();

    console.log('✅ Step marked as completed, waiting for doctor approval');

    res.json({
      success: true,
      data: medicalRecord,
      message: 'Step completed successfully. Waiting for doctor approval.'
    });
  } catch (error) {
    console.error('Error completing step:', error);
    res.status(500).json({ success: false, message: 'Error completing step' });
  }
};


//Get Drug
export const getAllDrugs = async (req: Request, res: Response) => {
  try {
    const drugs = await Drug.find({})
      .populate('category_id', 'name',)
      .sort({ created_at: -1 });
    res.status(200).json({ success: true, data: drugs });
  } catch (error) {
    console.error('Error fetching drugs:', error);
    res.status(500).json({ success: false, message: 'Error fetching drugs' });
  }
};


export const updateConsultationDetails = async (req: Request, res: Response) => {
  try {
    const { consultationId } = req.params;
    const { diagnosis, severity, notes } = req.body;
    const { initialStep, Description, Prescriptions } = req.body;

    console.log('=== UPDATE CONSULTATION DETAILS ===');
    console.log('Consultation ID:', consultationId);

    const consultation = await MedicalRecord.findByIdAndUpdate(
      consultationId,
      {
        initialStep,
        Description,
        Prescriptions,
        diagnosis,
        severity,
        notes,
        updated_at: new Date()
      },
      { new: true }
    );

    if (!consultation) {
      return res.status(404).json({ success: false, message: 'Consultation not found' });
    }

    res.json({
      success: true,
      message: 'Consultation updated successfully',
      data: consultation
    });
  } catch (error) {
    console.error('Error updating consultation details:', error);
    res.status(500).json({ success: false, message: 'Error updating consultation details' });
  }
};

const calculateQuantity = (dosage: string, duration: string): number => {
  try {
    let dailyCount = 0;
    let amountPerDose = 0;
    let days = 0;

    const lowerDosage = dosage.toLowerCase();
    const lowerDuration = duration.toLowerCase();

    // 1. Determine Amount per dose (e.g., "1 tablet", "5ml")
    const amountMatch = lowerDosage.match(/(\d+)\s*(?:tablet|pill|ml|mg)/);
    if (amountMatch) {
      amountPerDose = parseInt(amountMatch[1], 10);
    } else if (lowerDosage.includes('tablet') || lowerDosage.includes('pill')) {
      // Default to 1 if number not explicitly found but unit exists (e.g., "Apply thinly" = 0, ignore)
      amountPerDose = 1;
    }

    // 2. Determine Frequency (Daily count)
    if (lowerDosage.includes('once') || lowerDosage.includes('1 time')) dailyCount = 1;
    else if (lowerDosage.includes('twice') || lowerDosage.includes('2 times')) dailyCount = 2;
    else if (lowerDosage.includes('thrice') || lowerDosage.includes('3 times')) dailyCount = 3;
    else if (lowerDosage.includes('daily')) dailyCount = 1; // Default "once daily"
    else dailyCount = 1; // Fallback

    // 3. Determine Duration in Days
    if (lowerDuration.includes('chronic') || lowerDuration.includes('ongoing')) {
      days = 30; // Default chronic to 1 month deduction
    } else if (lowerDuration.includes('month')) {
      const monthMatch = lowerDuration.match(/(\d+)\s*month/);
      const numMonths = monthMatch ? parseInt(monthMatch[1], 10) : 1;
      days = numMonths * 30;
    } else if (lowerDuration.includes('week')) {
      const weekMatch = lowerDuration.match(/(\d+)\s*week/);
      const numWeeks = weekMatch ? parseInt(weekMatch[1], 10) : 1;
      days = numWeeks * 7;
    } else {
      // Default days
      const dayMatch = lowerDuration.match(/(\d+)\s*day/);
      days = dayMatch ? parseInt(dayMatch[1], 10) : 0;
    }

    const total = amountPerDose * dailyCount * days;
    return total > 0 ? total : 0;

  } catch (error) {
    console.error("Error calculating quantity:", error);
    return 0;
  }
};


export const deleteTreatmentStep = async (req: Request, res: Response) => {
  try {
    const { consultationId, stepNumber } = req.params;
    const stepNum = parseInt(stepNumber);

    const medicalRecord = await MedicalRecord.findById(consultationId);
    if (!medicalRecord) return res.status(404).json({ success: false, message: 'Medical record not found' });

    const stepIndex = medicalRecord.treatment_plan.findIndex(s => s.stepNumber === stepNum);
    if (stepIndex === -1) return res.status(404).json({ success: false, message: 'Step not found' });

    const stepToRemove = medicalRecord.treatment_plan[stepIndex];

    // Helper to extract value from "Med: Value | Med: Value" string
    const getVal = (fullStr: string | undefined, medName: string) => {
      if (!fullStr) return '';
      const parts = fullStr.split(' | ');
      const match = parts.find(p => p.trim().toLowerCase().startsWith(medName.toLowerCase() + ':'));
      if (match) {
        return match.substring(match.indexOf(':') + 1).trim();
      }
      // If legacy format (single med without prefix), assume value
      if (!fullStr.includes(':')) return fullStr;
      return '';
    };

    // Restore stock logic
    if (stepToRemove.medication) {
      const medications = stepToRemove.medication.split(' + ');
      for (const medName of medications) {
        let dose = getVal(stepToRemove.dosage, medName);
        let dur = getVal(stepToRemove.duration, medName);

        // Fallback for simple/legacy steps
        if (!dose && medications.length === 1) dose = stepToRemove.dosage || '';
        if (!dur && medications.length === 1) dur = stepToRemove.duration || '';

        if (dose && dur) {
          const qty = calculateQuantity(dose, dur);
          if (qty > 0) {
            await Drug.findOneAndUpdate({ name: medName.trim() }, { $inc: { stock_quantity: qty } });
          }
        }
      }
    }

    // Remove the step
    medicalRecord.treatment_plan.splice(stepIndex, 1);

    // Re-index remaining steps
    medicalRecord.treatment_plan.forEach((step, index) => {
      step.stepNumber = index + 1;
    });

    // Adjust current step pointer if needed
    if (medicalRecord.current_step > medicalRecord.treatment_plan.length) {
      medicalRecord.current_step = Math.max(1, medicalRecord.treatment_plan.length);
    }

    await medicalRecord.save();
    res.json({ success: true, message: 'Step deleted', data: medicalRecord });

  } catch (error) {
    handleError(res, error, 'Error deleting step');
  }
};

export const startTreatmentStep = async (req: Request, res: Response) => {
  try {
    const { consultationId, stepNumber } = req.params;
    const stepNum = parseInt(stepNumber);

    const medicalRecord = await MedicalRecord.findById(consultationId);
    if (!medicalRecord) {
      return res.status(404).json({ success: false, message: 'Medical record not found' });
    }

    const step = medicalRecord.treatment_plan.find(s => s.stepNumber === stepNum);
    if (!step) {
      return res.status(404).json({ success: false, message: 'Step not found' });
    }

    // Validate: step phải ở trạng thái pending
    if (step.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: `Cannot start step. Current status: ${step.status}`
      });
    }

    // Update status
    step.status = 'in-progress';
    step.startedAt = new Date();

    await medicalRecord.save();

    res.json({
      success: true,
      data: medicalRecord,
      message: 'Step started successfully'
    });
  } catch (error) {
    console.error('Error starting step:', error);
    res.status(500).json({ success: false, message: 'Error starting step' });
  }
};

export const rejectTreatmentStep = async (req: Request, res: Response) => {
  try {
    const { consultationId, stepNumber } = req.params;
    const { reason } = req.body;
    const stepNum = parseInt(stepNumber);

    const medicalRecord = await MedicalRecord.findById(consultationId);
    if (!medicalRecord) {
      return res.status(404).json({ success: false, message: 'Medical record not found' });
    }

    const step = medicalRecord.treatment_plan.find(s => s.stepNumber === stepNum);
    if (!step) {
      return res.status(404).json({ success: false, message: 'Step not found' });
    }

    // Validate: step phải ở trạng thái completed
    if (step.status !== 'completed') {
      return res.status(400).json({
        success: false,
        message: `Cannot reject step. Current status: ${step.status}`
      });
    }

    // Reject step (chuyển về pending)
    step.status = 'pending';
    step.rejectionReason = reason;
    step.rejectedAt = new Date();
    step.approval_requested = false;

    await medicalRecord.save();

    // Gửi notification cho patient
    if (medicalRecord.user_id) {
      await notificationService.sendNotification({
        user_id: medicalRecord.user_id.toString(),
        template_key: 'treatment_step_rejected',
        variables: {
          step_number: stepNum.toString(),
          step_title: step.title,
          doctor_name: 'Doctor',
          reason: reason || 'Needs revision'
        },
        type: 'treatment',
        category: 'warning',
        priority: 'medium',
        related_record: consultationId,
        related_record_type: 'medical_record'
      });
    }

    res.json({
      success: true,
      data: medicalRecord,
      message: 'Step rejected. Patient notified to revise.'
    });
  } catch (error) {
    console.error('Error rejecting step:', error);
    res.status(500).json({ success: false, message: 'Error rejecting step' });
  }
};


export const doctorDecisionOnStep = async (req: Request, res: Response) => {
  try {
    const { consultationId, stepNumber } = req.params;
    const {
      decision,
      doctor_notes,
      new_step_title,
      new_step_description,
      new_step_medication,
      new_step_dosage,
      new_step_duration,
      new_step_instructions
    } = req.body;

    // Validate decision
    const validDecisions = ['approve', 'approve_and_add_step', 'approve_and_complete'];
    if (!validDecisions.includes(decision)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid decision. Must be: approve, approve_and_add_step, or approve_and_complete'
      });
    }

    const medicalRecord = await MedicalRecord.findById(consultationId)
      .populate('user_id', 'name email phoneNumber')
      .populate('doctor_id', 'name email');

    if (!medicalRecord) {
      return res.status(404).json({ success: false, message: 'Medical record not found' });
    }

    const step = medicalRecord.treatment_plan.find(s => s.stepNumber === parseInt(stepNumber));
    if (!step) {
      return res.status(404).json({ success: false, message: 'Step not found' });
    }

    let newStepData: any = undefined;
    if (decision === 'approve_and_add_step') {
      newStepData = {
        title: new_step_title || 'Follow-up Treatment',
        description: new_step_description || 'Additional treatment based on patient feedback',
        medication: new_step_medication,
        dosage: new_step_dosage,
        duration: new_step_duration,
        instructions: new_step_instructions
      };
    }

    await medicalRecord.doctorDecision(
      parseInt(stepNumber),
      decision as any,
      doctor_notes,
      newStepData
    );

    const patient = medicalRecord.user_id as any;
    if (patient) {
      let notificationMessage = '';
      let actionLabel = '';

      if (decision === 'approve') {
        notificationMessage = `Doctor has approved step ${stepNumber}.`;
        actionLabel = 'View Approved Step';
      } else if (decision === 'approve_and_add_step') {
        notificationMessage = `Doctor has approved step ${stepNumber} and added a new follow-up step.`;
        actionLabel = 'View Next Step';
      } else if (decision === 'approve_and_complete') {
        notificationMessage = `Doctor has approved all steps and completed your consultation.`;
        actionLabel = 'View Consultation Summary';
      }

      await notificationService.sendNotification({
        user_id: patient._id.toString(),
        template_key: 'doctor_decision_made',
        variables: {
          doctor_name: (medicalRecord.doctor_id as any)?.name || 'Doctor',
          decision: decision.replace(/_/g, ' '),
          step_number: stepNumber
        },
        type: 'consultation',
        category: 'success',
        priority: 'medium',
        related_record: consultationId,
        related_record_type: 'medical_record',
        data: {
          decision: decision,
          step_number: stepNumber,
          doctor_notes: doctor_notes,
          consultation_completed: decision === 'approve_and_complete'
        },
        action_url: `/consultations/${consultationId}`,
        action_label: actionLabel
      });

      // Gửi email cho bệnh nhân
      if (patient.email) {
        await emailService.sendDoctorDecisionEmail(
          patient.email,
          patient.name,
          (medicalRecord.doctor_id as any)?.name || 'Doctor',
          decision,
          stepNumber,
          doctor_notes,
          decision === 'approve_and_complete'
        );
      }
    }

    res.status(200).json({
      success: true,
      message: `Decision ${decision} processed successfully`,
      data: {
        record: medicalRecord,
        decision: decision,
        consultation_completed: decision === 'approve_and_complete'
      }
    });

  } catch (error) {
    console.error('Error processing doctor decision:', error);
    res.status(500).json({ success: false, message: 'Error processing decision' });
  }
};

export const reviewAndDecideStep = async (req: any, res: any): Promise<void> => {
  try {
    const { consultationId, stepNumber } = req.params;
    const {
      decision,
      doctorNotes,
      requireFollowUp,
      nextAppointmentDate,
      nextAppointmentTime,
      followUpInstructions,
      additionalStepTitle,
      additionalStepDescription,
      completeConsultation,
      medication,
      dosage,
      duration,
      instructions,
      prescriptions,
      isPhysicalVisit
    } = req.body;

    const stepNum = parseInt(stepNumber);

    console.log('=== REVIEW AND DECIDE STEP ===');
    console.log('Decision:', decision);
    console.log('RequireFollowUp:', requireFollowUp);
    console.log('Step Number:', stepNum);
    console.log('Has medications:', {
      medication: !!medication,
      dosage: !!dosage,
      duration: !!duration,
      instructions: !!instructions,
      prescriptionsCount: prescriptions?.length
    });
    if (!req.user || req.user.role !== 'doctor') {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }
    const doctor = await Doctor.findOne({ user_id: req.user._id });
    if (!doctor) {
      res.status(404).json({ success: false, message: 'Doctor profile not found' });
      return;
    }
    const medicalRecord = await MedicalRecord.findById(consultationId)
      .populate('user_id', 'name email phoneNumber');

    if (!medicalRecord) {
      res.status(404).json({ success: false, message: 'Medical record not found' });
      return;
    }
    if (medicalRecord.doctor_id.toString() !== doctor.user_id.toString()) {
      res.status(403).json({
        success: false,
        message: 'Forbidden: You can only review steps for your own patients'
      });
      return;
    }
    const step = medicalRecord.treatment_plan.find((s: any) => s.stepNumber === stepNum);
    if (!step) {
      res.status(404).json({ success: false, message: 'Step not found' });
      return;
    }

    if (step.status !== 'completed') {
      res.status(400).json({
        success: false,
        message: 'Can only review completed steps',
        currentStatus: step.status
      });
      return;
    }
    const patient = medicalRecord.user_id;
    const patientId = (patient as any)._id.toString();
    const doctorUser = await User.findById(doctor.user_id);
    const doctorName = doctorUser?.name || 'Doctor';

    const appointmentDate = nextAppointmentDate ? new Date(nextAppointmentDate) : null;
    const timeSlot = nextAppointmentTime || '09:00';
    const notes = followUpInstructions || `Re-examination: ${step.title}`;

    let appointment = null;
    let newStep = null;

    console.log('Processing decision:', decision);

    switch (decision) {
      case 'approve_with_followup':
        // 1. Approve current step
        step.status = 'approved';
        step.doctorNotes = doctorNotes;
        step.approvedAt = new Date();
        step.approval_requested = false;
        step.needsReExamination = requireFollowUp || false;

        console.log('✅ Step approved:', stepNum);

        // 2. Tạo step mới nếu cần follow-up
        if (requireFollowUp) {
          const nextStepNumber = medicalRecord.treatment_plan.length + 1;

          console.log('📦 Creating new step with medications:', {
            medication,
            dosage,
            duration,
            instructions,
            prescriptions
          });

          // Tạo step mới
          const newStepData: any = {
            stepNumber: nextStepNumber,
            title: additionalStepTitle || `Re-Examination: ${step.title}`,
            description: additionalStepDescription || `In-person clinical assessment following ${step.title}`,
            instructions: followUpInstructions || 'Please arrive 10 minutes early for check-in',
            isReExaminationVisit: (additionalStepTitle || '').toLowerCase().includes('re-ex'),
            isPhysicalVisit: isPhysicalVisit === true || (additionalStepTitle || '').toLowerCase().includes('physical') || (additionalStepTitle || '').toLowerCase().includes('follow-up') || (additionalStepTitle || '').toLowerCase().includes('re-ex'),
            needsReExamination: false,
            requires_followup: true,
            followup_reason: doctorNotes || 'Re-examination required',
            created_at: new Date()
          };

          // QUAN TRỌNG: Thêm thông tin thuốc nếu có
          if (medication) {
            newStepData.medication = medication;
          }

          if (dosage) {
            newStepData.dosage = dosage;
          }

          if (duration) {
            newStepData.duration = duration;
          }

          if (instructions) {
            newStepData.instructions = instructions;
          }
          if (appointmentDate) {
            newStepData.status = 'scheduled';
            newStepData.reExaminationScheduled = true;
            newStepData.reExaminationDate = appointmentDate;
            newStepData.reExaminationTime = timeSlot;
            newStepData.reExaminationNotes = notes;
            console.log('📅 New step is SCHEDULED (has appointment)');
          } else {
            newStepData.status = 'in-progress';
            newStepData.reExaminationScheduled = false;
            console.log('📝 New step is PENDING (regular treatment step)');
          }

          console.log('📝 New step data:', {
            stepNumber: newStepData.stepNumber,
            title: newStepData.title,
            status: newStepData.status,
            medication: newStepData.medication,
            hasAppointment: !!appointmentDate
          });

          // Thêm step vào treatment_plan
          medicalRecord.treatment_plan.push(newStepData);

          // Lưu medical record để step có _id
          await medicalRecord.save({ validateModifiedOnly: true });
          console.log('✅ Saved new step with ID');

          // Lấy step vừa tạo (có _id rồi)
          const savedStep = medicalRecord.treatment_plan.find(
            (s: any) => s.stepNumber === nextStepNumber
          );

          // Tạo appointment NẾU CÓ LỊCH HẸN
          if (appointmentDate && savedStep && savedStep._id) {
            try {
              // Kiểm tra slot trước
              const startOfDay = new Date(appointmentDate);
              startOfDay.setHours(0, 0, 0, 0);

              const endOfDay = new Date(appointmentDate);
              endOfDay.setHours(23, 59, 59, 999);

              const existingAppointment = await Appointment.findOne({
                doctor_id: doctor._id,
                appointment_date: { $gte: startOfDay, $lte: endOfDay },
                time_slot: timeSlot,
                status: { $in: ['pending', 'confirmed', 'scheduled'] }
              });

              if (existingAppointment) {
                // Nếu slot đã có người, vẫn giữ step nhưng không tạo appointment
                console.warn('⚠️ Slot already taken, step created without appointment');
              } else {
                appointment = new Appointment({
                  user_id: medicalRecord.user_id,
                  doctor_id: doctor._id,
                  specialty_id: doctor.specialty_id,
                  appointment_date: appointmentDate,
                  time_slot: timeSlot,
                  status: 'scheduled',
                  reason: `Re-examination: ${step.title}`,
                  notes: notes,
                  is_re_examination: true,
                  re_examination_step_id: savedStep._id,
                  metadata: {
                    consultation_id: consultationId,
                    approved_step_number: stepNum,
                    step_number: nextStepNumber,
                    step_title: savedStep.title,
                    created_by: 'doctor',
                    created_at: new Date()
                  }
                });

                await appointment.save();
                console.log('✅ Created appointment for scheduled step');

                savedStep.reExaminationAppointmentId = appointment._id as Types.ObjectId;
                await medicalRecord.save({ validateModifiedOnly: true });
              }
            } catch (err: any) {
              console.error('❌ Error creating appointment:', err);
            }
          }
          newStep = savedStep;
        }
        if (appointmentDate) {
          medicalRecord.next_appointment = appointmentDate;
        }
        try {
        } catch (err) {
          console.error('Notification error:', err);
        }
        break;

      case 'approve_and_complete':
        step.status = 'approved';
        step.doctorNotes = doctorNotes;
        step.approvedAt = new Date();
        step.approval_requested = false;

        const allStepsApproved = medicalRecord.treatment_plan.every((s: any) =>
          s.status === 'approved' || s.status === 'completed'
        );

        if (allStepsApproved || completeConsultation) {
          medicalRecord.consultation_status = 'completed';
          medicalRecord.status = 'resolved';
          medicalRecord.updated_at = new Date();
        }
        break;

      case 'reject':
        step.status = 'pending';
        step.rejectionReason = doctorNotes;
        step.rejectedAt = new Date();
        step.approval_requested = false;
        break;

      default:
        res.status(400).json({
          success: false,
          message: 'Invalid decision type',
          valid_decisions: ['approve_with_followup', 'approve_and_complete', 'reject']
        });
        return;
    }

    // Final save
    await medicalRecord.save({ validateModifiedOnly: true });

    console.log('✅ Final save completed');
    console.log('New step status:', newStep?.status);

    // Prepare response
    const responseData: any = {
      success: true,
      data: {
        medical_record: {
          _id: medicalRecord._id,
          consultation_status: medicalRecord.consultation_status,
          status: medicalRecord.status,
          next_appointment: medicalRecord.next_appointment,
          treatment_plan: medicalRecord.treatment_plan.map((s: any) => ({
            stepNumber: s.stepNumber,
            title: s.title,
            status: s.status,
            medication: s.medication,
            dosage: s.dosage,
            duration: s.duration,
            instructions: s.instructions,
            isReExaminationVisit: s.isReExaminationVisit,
            needsReExamination: s.needsReExamination,
            reExaminationScheduled: s.reExaminationScheduled,
            reExaminationDate: s.reExaminationDate,
            reExaminationAppointmentId: s.reExaminationAppointmentId
          }))
        },
        step: {
          stepNumber: stepNum,
          status: step.status,
          decision: decision,
          doctorNotes: step.doctorNotes
        },
        message: `Step ${stepNum} ${decision.replace(/_/g, ' ')} successfully`
      }
    };

    // Add new step info if created
    if (newStep) {
      responseData.data.new_step = {
        stepNumber: newStep.stepNumber,
        title: newStep.title,
        status: newStep.status,
        medication: newStep.medication,
        dosage: newStep.dosage,
        duration: newStep.duration,
        instructions: newStep.instructions,
        isReExaminationVisit: newStep.isReExaminationVisit,
        reExaminationScheduled: newStep.reExaminationScheduled
      };
    }

    // Add appointment info if exists
    if (appointment) {
      responseData.data.appointment = {
        _id: appointment._id,
        appointment_date: appointment.appointment_date,
        time_slot: appointment.time_slot,
        status: appointment.status,
        is_re_examination: appointment.is_re_examination,
        re_examination_step_id: appointment.re_examination_step_id
      };
    }

    console.log('=== REVIEW AND DECIDE STEP COMPLETED ===');
    res.status(200).json(responseData);

  } catch (error: any) {
    console.error('❌ Error in reviewAndDecideStep:', error);
    res.status(500).json({
      success: false,
      message: 'Error reviewing step: ' + error.message
    });
  }
};

export const scheduleReExamination = async (req: any, res: any): Promise<void> => {
  try {
    const { consultationId, stepNumber } = req.params;
    const { appointmentDateTime, notes, timeSlot, time } = req.body;
    const finalTimeSlot = timeSlot || time || '09:00';

    console.log('=== SCHEDULE RE-EXAMINATION ===');
    console.log('Consultation ID:', consultationId);
    console.log('Step Number:', stepNumber);
    console.log('Appointment DateTime:', appointmentDateTime);
    console.log('Time Slot:', finalTimeSlot);

    // Validate input
    if (!appointmentDateTime) {
      return res.status(400).json({
        success: false,
        message: 'appointmentDateTime is required'
      });
    }

    // Authentication check
    if (!req.user || req.user.role !== 'doctor') {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    // Get doctor info từ bảng Doctor
    const doctor = await Doctor.findOne({ user_id: req.user._id });
    if (!doctor) {
      return res.status(404).json({
        success: false,
        message: 'Doctor profile not found'
      });
    }

    console.log('Doctor found - Doctor ID:', doctor._id, 'User ID:', doctor.user_id);
    console.log('Current logged in User ID:', req.user._id);

    // Get medical record - không populate doctor_id phức tạp
    const medicalRecord = await MedicalRecord.findById(consultationId)
      .populate('user_id', 'name email phoneNumber');

    if (!medicalRecord) {
      return res.status(404).json({
        success: false,
        message: 'Medical record not found'
      });
    }

    console.log('Medical record doctor_id (User ID):', medicalRecord.doctor_id);
    if (medicalRecord.doctor_id.toString() !== doctor.user_id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You can only schedule re-examination for your own patients',
        medicalRecordDoctorId: medicalRecord.doctor_id.toString(),
        currentDoctorUserId: doctor.user_id.toString()
      });
    }

    // Find the step
    const stepNum = parseInt(stepNumber);
    const step = medicalRecord.treatment_plan.find(
      (s: any) => s.stepNumber === stepNum
    );

    if (!step) {
      return res.status(404).json({
        success: false,
        message: 'Step not found'
      });
    }

    // Check if step needs re-examination
    const isClinicStep = step.needsReExamination ||
      step.isReExaminationVisit ||
      step.reExaminationScheduled ||
      step.title?.toLowerCase()?.includes('re-ex');

    if (!isClinicStep) {
      return res.status(400).json({
        success: false,
        message: 'Step does not require re-examination or clinic visit'
      });
    }

    const appointmentDate = new Date(appointmentDateTime);
    let appointment = null;
    let isExistingAppointment = false;
    const doctorId = doctor._id as Types.ObjectId;

    console.log('🔍 Searching for existing appointment...');
    console.log('Step has appointmentId:', step.reExaminationAppointmentId);
    console.log('Step has _id:', step._id);

    // ========== IMPROVED SEARCH LOGIC ==========
    const searchCriteria = [];

    // 1. Tìm theo appointmentId trong step
    if (step.reExaminationAppointmentId) {
      searchCriteria.push({ _id: step.reExaminationAppointmentId });
      console.log('🔍 Search 1: By step.reExaminationAppointmentId');
    }

    // 2. Tìm theo step._id
    if (step._id) {
      searchCriteria.push({ re_examination_step_id: step._id });
      console.log('🔍 Search 2: By step._id');
    }

    // 3. Tìm theo metadata
    searchCriteria.push({
      'metadata.consultation_id': consultationId,
      'metadata.step_number': stepNum,
      is_re_examination: true
    });
    console.log('🔍 Search 3: By metadata');

    // 4. Tìm theo điều kiện chung
    searchCriteria.push({
      user_id: medicalRecord.user_id,
      doctor_id: doctor._id, // Sử dụng doctor._id (Doctor ID) để tìm appointment
      is_re_examination: true,
      'metadata.consultation_id': consultationId
    });
    console.log('🔍 Search 4: By general criteria');

    // Thực hiện tìm kiếm theo thứ tự ưu tiên
    for (const criteria of searchCriteria) {
      if (appointment) break; // Đã tìm thấy thì dừng

      try {
        appointment = await Appointment.findOne(criteria);
        if (appointment) {
          isExistingAppointment = true;
          console.log(`✅ Found existing appointment with criteria:`, Object.keys(criteria));
          console.log(`   Appointment ID: ${appointment._id}`);
          console.log(`   Appointment status: ${appointment.status}`);
          console.log(`   Appointment date: ${appointment.appointment_date}`);
          console.log(`   Appointment doctor_id: ${appointment.doctor_id}`);
          console.log(`   Current doctor._id: ${doctor._id}`);
          break;
        }
      } catch (err: any) {
        console.warn(`⚠️  Search failed for criteria:`, err.message);
      }
    }

    // ========== KIỂM TRA APPOINTMENT STATUS ==========
    if (appointment && appointment.status === 'confirmed') {
      return res.status(400).json({
        success: false,
        message: 'Cannot reschedule a confirmed appointment. Please cancel first or contact patient.',
        appointment_id: appointment._id,
        current_status: appointment.status,
        current_date: appointment.appointment_date,
        current_time: appointment.time_slot,
        allowed_actions: ['cancel', 'complete']
      });
    }
    if (appointment) {
      console.log('✅ Updating existing appointment:', appointment._id);
      console.log('Current appointment status:', appointment.status);

      const startOfDay = new Date(appointmentDate);
      startOfDay.setHours(0, 0, 0, 0);

      const endOfDay = new Date(appointmentDate);
      endOfDay.setHours(23, 59, 59, 999);

      const existingAppointment = await Appointment.findOne({
        doctor_id: doctor._id,
        appointment_date: { $gte: startOfDay, $lte: endOfDay },
        time_slot: finalTimeSlot,
        status: { $in: ['pending', 'confirmed', 'scheduled'] },
        _id: { $ne: appointment._id }
      });

      if (existingAppointment) {
        return res.status(409).json({
          success: false,
          message: `Doctor already has an appointment at ${finalTimeSlot} on ${appointmentDate.toLocaleDateString()}`,
          alternative_slots: await getAlternativeTimeSlots(doctorId.toString(), appointmentDate)
        });
      }

      // Update appointment
      const oldDate = appointment.appointment_date;
      const oldTime = appointment.time_slot;

      appointment.appointment_date = appointmentDate;
      appointment.time_slot = finalTimeSlot;
      appointment.notes = notes || `Re-examination: ${step.title}`;
      appointment.status = 'scheduled';
      appointment.updated_at = new Date();
      appointment.is_re_examination = true;
      appointment.specialty_id = doctor.specialty_id;

      // Update metadata
      if (!appointment.metadata) {
        appointment.metadata = {};
      }
      appointment.metadata.consultation_id = consultationId;
      appointment.metadata.step_number = stepNum;
      appointment.metadata.step_title = step.title;
      appointment.metadata.updated_by = 'doctor';
      appointment.metadata.completed_at = new Date();
      appointment.metadata.previous_date = oldDate;
      appointment.metadata.previous_time = oldTime;
      appointment.metadata.rescheduled_at = new Date();

      await appointment.save();
      console.log('✅ Appointment updated successfully');
      console.log(`   From: ${oldDate.toLocaleDateString()} ${oldTime}`);
      console.log(`   To: ${appointmentDate.toLocaleDateString()} ${finalTimeSlot}`);

    } else {
      // TẠO MỚI lịch hẹn
      console.log('🆕 Creating new appointment');

      // Check for time slot availability
      const startOfDay = new Date(appointmentDate);
      startOfDay.setHours(0, 0, 0, 0);

      const endOfDay = new Date(appointmentDate);
      endOfDay.setHours(23, 59, 59, 999);

      const existingAppointment = await Appointment.findOne({
        doctor_id: doctor._id,
        appointment_date: { $gte: startOfDay, $lte: endOfDay },
        time_slot: finalTimeSlot,
        status: { $in: ['pending', 'confirmed', 'scheduled'] }
      });

      if (existingAppointment) {
        return res.status(409).json({
          success: false,
          message: `Doctor already has an appointment at ${finalTimeSlot} on ${appointmentDate.toLocaleDateString()}`,
          alternative_slots: await getAlternativeTimeSlots(doctorId.toString(), appointmentDate)
        });
      }

      // Create new appointment
      appointment = new Appointment({
        user_id: medicalRecord.user_id,
        doctor_id: doctor._id,
        specialty_id: doctor.specialty_id,
        appointment_date: appointmentDate,
        time_slot: finalTimeSlot,
        status: 'pending',
        reason: `Re-examination: ${step.title}`,
        notes: notes || 'Physical assessment',
        is_re_examination: true,
        re_examination_step_id: step._id,
        metadata: {
          consultation_id: consultationId,
          step_number: stepNum,
          step_title: step.title,
          created_by: 'doctor',
          created_at: new Date()
        }
      });

      await appointment.save();
      console.log('✅ New appointment created:', appointment._id);
    }

    // ========== UPDATE STEP INFORMATION ==========
    console.log('📝 Updating step information...');

    // Cập nhật step với appointmentId
    step.reExaminationAppointmentId = appointment._id as Types.ObjectId;
    step.reExaminationScheduled = true;
    step.reExaminationDate = appointmentDate;
    step.reExaminationTime = finalTimeSlot;
    step.needsReExamination = false;
    step.isReExaminationVisit = true;
    step.reExaminationNotes = notes;

    // Cập nhật trạng thái step
    if (step.status !== 'scheduled') {
      step.status = 'scheduled';
      console.log(`📋 Step status changed to: scheduled`);
    }

    // Đánh dấu consultation có follow-up nếu cần
    if (!medicalRecord.next_appointment || medicalRecord.next_appointment < appointmentDate) {
      medicalRecord.next_appointment = appointmentDate;
      console.log('📅 Updated medical_record.next_appointment:', appointmentDate);
    }

    await medicalRecord.save({ validateModifiedOnly: true });
    console.log('✅ Medical record updated');

    // ========== SEND NOTIFICATION ==========
    try {
      const patient = await User.findById(medicalRecord.user_id);
      const doctorUser = await User.findById(doctor.user_id);
      if (patient) {
        const isUpdate = isExistingAppointment;

        // Nội dung notification khác nhau cho trường hợp reschedule
        let notificationTitle = 'Re-examination Scheduled';
        let notificationMessage = `Dr. ${doctorUser?.name || 'Doctor'} has scheduled a re-examination for ${appointmentDate.toLocaleDateString()} at ${timeSlot || '09:00'}.`;

        if (isUpdate) {
          // Lấy thông tin cũ từ metadata
          const oldDate = appointment.metadata?.previous_date
            ? new Date(appointment.metadata.previous_date).toLocaleDateString()
            : 'previous date';
          const oldTime = appointment.metadata?.previous_time || 'previous time';

          notificationTitle = 'Appointment Rescheduled';
          notificationMessage = `Dr. ${doctorUser?.name || 'Doctor'} has rescheduled your re-examination from ${oldDate} ${oldTime} to ${appointmentDate.toLocaleDateString()} at ${timeSlot || '09:00'}.`;
        }

        await notificationService.sendNotification({
          user_id: (patient._id as Types.ObjectId).toString(),
          title: notificationTitle,
          message: notificationMessage,
          template_key: 're_examination_scheduled',
          variables: {
            doctor_name: doctorUser?.name || 'Doctor',
            appointment_date: appointmentDate.toLocaleDateString(),
            appointment_time: timeSlot || '09:00',
            step_title: step.title,
            ...(isUpdate && {
              previous_date: appointment.metadata?.previous_date
                ? new Date(appointment.metadata.previous_date).toLocaleDateString()
                : '',
              previous_time: appointment.metadata?.previous_time || ''
            })
          },
          type: 'appointment',
          category: 'info',
          priority: 'high',
          related_record: (appointment._id as Types.ObjectId).toString(),
          related_record_type: 'appointment',
          data: {
            appointment_id: appointment._id,
            step_number: stepNum,
            consultation_id: consultationId,
            action: isUpdate ? 'rescheduled' : 'created',
            old_date: isUpdate ? appointment.metadata?.previous_date : null,
            old_time: isUpdate ? appointment.metadata?.previous_time : null,
            new_date: appointmentDate,
            new_time: timeSlot || '09:00'
          },
          action_url: `/appointments/${appointment._id}`,
          action_label: 'View Appointment'
        });

        console.log('📧 Notification sent to patient');
      }
    } catch (err) {
      console.error('❌ Notification error:', err);
    }

    // ========== PREPARE RESPONSE ==========
    const responseData = {
      success: true,
      message: isExistingAppointment
        ? 'Re-examination rescheduled successfully'
        : 'Re-examination scheduled successfully',
      data: {
        appointment: {
          _id: appointment._id,
          appointment_date: appointment.appointment_date,
          time_slot: appointment.time_slot,
          status: appointment.status,
          notes: appointment.notes,
          is_re_examination: appointment.is_re_examination,
          re_examination_step_id: appointment.re_examination_step_id,
          specialty_id: appointment.specialty_id,
          metadata: appointment.metadata
        },
        step: {
          stepNumber: stepNum,
          title: step.title,
          status: step.status,
          reExaminationScheduled: step.reExaminationScheduled,
          reExaminationDate: step.reExaminationDate,
          reExaminationTime: step.reExaminationTime,
          reExaminationAppointmentId: step.reExaminationAppointmentId
        },
        medical_record: {
          _id: medicalRecord._id,
          next_appointment: medicalRecord.next_appointment,
          consultation_status: medicalRecord.consultation_status
        },
        action: isExistingAppointment ? 'rescheduled' : 'created',
        is_reschedule: isExistingAppointment,
        allowed_reschedule: appointment.status !== 'confirmed'
      }
    };

    console.log('=== SCHEDULE RE-EXAMINATION COMPLETED ===');
    res.status(200).json(responseData);

  } catch (error: any) {
    console.error('❌ Error in scheduleReExamination:', error);
    console.error('Stack trace:', error.stack);

    let statusCode = 500;
    let errorMessage = 'Error scheduling re-examination: ' + error.message;

    if (error.name === 'ValidationError') {
      statusCode = 400;
      errorMessage = 'Validation error: ' + error.message;
    } else if (error.name === 'CastError') {
      statusCode = 400;
      errorMessage = 'Invalid ID format';
    } else if (error.name === 'DuplicateAppointmentError') {
      statusCode = 409;
      errorMessage = error.message;
    }

    res.status(statusCode).json({
      success: false,
      message: errorMessage,
      error_type: error.name,
      timestamp: new Date().toISOString()
    });
  }
};



const getAlternativeTimeSlots = async (doctorId: string, date: Date): Promise<string[]> => {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);

  const allTimeSlots = [
    '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
    '14:00', '14:30', '15:00', '15:30', '16:00', '16:30'
  ];

  const bookedAppointments = await Appointment.find({
    doctor_id: doctorId,
    appointment_date: { $gte: start, $lte: end },
    status: { $in: ['pending', 'confirmed'] }
  }).select('time_slot');

  const bookedSlots = bookedAppointments.map(app => app.time_slot);
  return allTimeSlots.filter(slot => !bookedSlots.includes(slot));
};


export const getAvailableSlots = async (req: Request, res: Response) => {
  try {
    const { date } = req.query;

    console.log('✅ Available slots requested for date:', date);
    const allSlots = [
      '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
      '13:00', '13:30', '14:00', '14:30', '15:00', '15:30',
      '16:00', '16:30'
    ];

    res.json({
      success: true,
      data: allSlots,
      message: 'Using all time slots (backend not fully implemented)'
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const cancelReExamination = async (req: AuthRequest, res: Response) => {
  try {
    const { consultationId, stepNumber } = req.params;

    const medicalRecord = await MedicalRecord.findById(consultationId);
    if (!medicalRecord) {
      return res.status(404).json({
        success: false,
        message: 'Medical record not found'
      });
    }

    const step = medicalRecord.treatment_plan.find(
      s => s.stepNumber === parseInt(stepNumber)
    );

    if (!step) {
      return res.status(404).json({
        success: false,
        message: 'Step not found'
      });
    }

    if (!step.reExaminationAppointmentId) {
      return res.status(400).json({
        success: false,
        message: 'No appointment to cancel'
      });
    }

    // Cập nhật trạng thái appointment
    await Appointment.findByIdAndUpdate(
      step.reExaminationAppointmentId,
      {
        status: 'cancelled',
        cancellation_reason: 'Doctor cancelled re-examination',
        cancelled_at: new Date()
      }
    );

    // Reset step status
    step.status = 'approved'; // Quay lại trạng thái approved
    step.reExaminationScheduled = false;
    step.reExaminationDate = undefined;
    step.reExaminationAppointmentId = undefined;
    step.needsReExamination = true; // Vẫn cần tái khám

    await medicalRecord.save();

    res.status(200).json({
      success: true,
      message: 'Re-examination cancelled successfully',
      data: {
        step: step
      }
    });
  } catch (error: any) {
    console.error('Error cancelling re-examination:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

export const confirmReExaminationArrival = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const { consultationId, stepNumber } = req.params;
    const stepNum = parseInt(stepNumber);

    // ── 1. Auth ──────────────────────────────────────────────
    const doctor_user_id = req.user?._id;
    if (!doctor_user_id) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }

    const doctor = await Doctor.findOne({ user_id: doctor_user_id });
    if (!doctor) {
      res.status(404).json({ success: false, message: 'Doctor not found' });
      return;
    }

    // ── 2. Load medical record ───────────────────────────────
    const medicalRecord = await MedicalRecord.findById(consultationId).populate(
      'user_id',
      'name email'
    );
    if (!medicalRecord) {
      res.status(404).json({ success: false, message: 'Medical record not found' });
      return;
    }

    // ── 3. Authorization ─────────────────────────────────────
    if (medicalRecord.doctor_id.toString() !== doctor.user_id.toString()) {
      res.status(403).json({
        success: false,
        message: 'Forbidden: This is not your patient',
      });
      return;
    }

    // ── 4. Find step ─────────────────────────────────────────
    const step = medicalRecord.treatment_plan.find(
      (s: any) => s.stepNumber === stepNum
    );
    if (!step) {
      res.status(404).json({ success: false, message: 'Step not found' });
      return;
    }

    // ── 5. Validate step status ──────────────────────────────
    // FIX: Chấp nhận cả 'scheduled' lẫn step đã có appointment confirmed
    if (step.status !== 'scheduled') {
      res.status(400).json({
        success: false,
        message: `Cannot start examination. Step status is '${step.status}'. Must be 'scheduled'.`,
        currentStatus: step.status,
      });
      return;
    }

    // ── 6. Validate appointment đã confirmed bởi patient ─────
    let appointment: any = null;

    if (step.reExaminationAppointmentId) {
      appointment = await Appointment.findById(step.reExaminationAppointmentId);
    }

    // Fallback search
    if (!appointment && step._id) {
      appointment = await Appointment.findOne({
        re_examination_step_id: step._id,
        is_re_examination: true,
      });
    }

    if (!appointment) {
      res.status(404).json({
        success: false,
        message: 'No appointment found for this step. Please schedule first.',
      });
      return;
    }

    // FIX: Kiểm tra patient đã check-in chưa
    // (appointment.status phải là 'confirmed' hoặc 'scheduled')
    const allowedStatuses = ['confirmed', 'scheduled'];
    if (!allowedStatuses.includes(appointment.status)) {
      res.status(400).json({
        success: false,
        message: `Cannot start examination. Appointment status is '${appointment.status}'.`,
        appointmentStatus: appointment.status,
        hint:
          appointment.status === 'cancelled'
            ? 'Please reschedule the appointment first.'
            : 'Appointment must be confirmed or scheduled.',
      });
      return;
    }

    // ── 7. Update step to in-progress ────────────────────────
    step.status = 'in-progress';
    step.arrivalConfirmed = true;
    step.arrivalConfirmedAt = new Date();
    step.startedAt = new Date();
    medicalRecord.current_step = stepNum;

    // ── 8. Update appointment ────────────────────────────────
    appointment.status = 'completed';
    // Thêm metadata của doctor
    appointment.metadata = {
      ...(appointment.metadata || {}),
      arrival_confirmed_at: new Date(),
      confirmed_by: 'doctor',
      doctor_user_id: doctor_user_id,
    };
    await appointment.save();

    await medicalRecord.save({ validateModifiedOnly: true });

    // ── 9. Notify patient ─────────────────────────────────────
    try {
      const patient = medicalRecord.user_id as any;
      const doctorUser = await User.findById(doctor.user_id);

      await notificationService.sendNotification({
        user_id: patient._id.toString(),
        title: 'Re-Examination Started',
        message: `Dr. ${doctorUser?.name || 'Doctor'} has confirmed your arrival. Your re-examination is now in progress.`,
        template_key: 're_examination_started',
        variables: {
          doctor_name: doctorUser?.name || 'Doctor',
          step_title: step.title,
        },
        type: 'appointment',
        category: 'info',
        priority: 'high',
        related_record: consultationId,
        related_record_type: 'medical_record',
        action_url: `/medical-records/${consultationId}`,
        action_label: 'View Progress',
      });
    } catch (err) {
      console.error('Notification error (non-fatal):', err);
    }

    // ── 10. Response ──────────────────────────────────────────
    res.status(200).json({
      success: true,
      message: 'Patient arrival confirmed. Examination started.',
      data: {
        step: {
          stepNumber: step.stepNumber,
          title: step.title,
          status: step.status,          // now 'in-progress'
          arrivalConfirmedAt: step.arrivalConfirmedAt,
        },
        appointment: {
          _id: appointment._id,
          status: appointment.status,   // 'confirmed'
          appointment_date: appointment.appointment_date,
          time_slot: appointment.time_slot,
        },
        consultation_id: consultationId,
      },
    });
  } catch (error: any) {
    console.error('Error confirming arrival:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const completeReExaminationStep = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const { consultationId, stepNumber } = req.params;
    const { doctorNotes } = req.body;

    /* =======================
     * 1. AUTH VALIDATION
     * ======================= */
    const doctorUserId = req.user?._id;
    if (!doctorUserId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    const doctor = await Doctor.findOne({ user_id: doctorUserId });
    if (!doctor) {
      return res.status(404).json({
        success: false,
        message: 'Doctor not found'
      });
    }

    /* =======================
     * 2. LOAD MEDICAL RECORD
     * ======================= */
    const medicalRecord = await MedicalRecord.findById(consultationId)
      .populate('user_id', 'name email');

    if (!medicalRecord) {
      return res.status(404).json({
        success: false,
        message: 'Medical record not found'
      });
    }

    /* =======================
     * 3. FIND STEP
     * ======================= */
    const stepIndex = medicalRecord.treatment_plan.findIndex(
      s => s.stepNumber === Number(stepNumber)
    );

    if (stepIndex === -1) {
      return res.status(404).json({
        success: false,
        message: 'Step not found'
      });
    }

    const step = medicalRecord.treatment_plan[stepIndex];

    /* =======================
     * 4. VALIDATE STEP STATUS
     * ======================= */
    if (step.status !== 'in-progress') {
      return res.status(400).json({
        success: false,
        message: 'Step is not in progress'
      });
    }

    /* =======================
     * 5. COMPLETE STEP
     * ======================= */
    step.status = 'completed';
    step.completedAt = new Date();
    step.doctorNotes = doctorNotes || 'Step completed by doctor';
    step.approval_requested = true;

    /* =======================
     * 6. UPDATE APPOINTMENT (IF EXISTS)
     * ======================= */
    if (step.reExaminationAppointmentId) {
      const appointment = await Appointment.findById(
        step.reExaminationAppointmentId
      );

      if (appointment) {
        appointment.status = 'completed';
        appointment.notes =
          doctorNotes ||
          'Appointment completed as part of treatment step';

        appointment.metadata = {
          ...appointment.metadata,
          completed_at: new Date(),
          completed_by: 'doctor',
          step_number: step.stepNumber
        };

        await appointment.save();
      }
    }

    /* =======================
     * 7. ACTIVATE NEXT STEP
     * ======================= */
    const nextStep = medicalRecord.treatment_plan.find(
      s => s.stepNumber === step.stepNumber + 1
    );

    if (nextStep && nextStep.status === 'pending') {
      nextStep.status = 'in-progress';
      nextStep.startedAt = new Date();
      medicalRecord.current_step = nextStep.stepNumber;
    }

    /* =======================
     * 8. SAVE MEDICAL RECORD
     * ======================= */
    await medicalRecord.save({ validateModifiedOnly: true });

    /* =======================
     * 9. SEND NOTIFICATION
     * ======================= */
    try {
      const patient = medicalRecord.user_id as any;
      const doctorUser = await User.findById(doctor.user_id);

      await notificationService.sendNotification({
        user_id: patient._id.toString(),
        title: 'Treatment Step Completed',
        message: `Dr. ${doctorUser?.name || 'Doctor'} has completed a step in your treatment plan.`,
        template_key: 'treatment_step_completed',
        variables: {
          doctor_name: doctorUser?.name || 'Doctor',
          step_title: step.title
        },
        type: 'treatment',
        category: 'success',
        priority: 'high',
        related_record: consultationId,
        related_record_type: 'medical_record',
        action_url: `/medical-records/${consultationId}`,
        action_label: 'View Treatment Plan'
      });
    } catch (notificationError) {
      console.error('Notification error:', notificationError);
    }

    /* =======================
     * 10. RESPONSE
     * ======================= */
    return res.status(200).json({
      success: true,
      message: 'Step completed successfully',
      data: {
        step,
        medical_record: medicalRecord
      }
    });

  } catch (error: any) {
    console.error('Error completing step:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Internal server error'
    });
  }
};


export const getReExaminationAppointments = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const doctor_user_id = req.user?._id;
    if (!doctor_user_id) {
      res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
      return;
    }

    // Lấy doctor info từ Doctor table
    const doctor = await Doctor.findOne({ user_id: doctor_user_id });
    if (!doctor) {
      res.status(404).json({
        success: false,
        message: 'Doctor profile not found'
      });
      return;
    }

    // Tìm appointments tái khám
    const appointments = await Appointment.find({
      doctor_id: doctor._id, // Sử dụng doctor._id từ Doctor table
      is_re_examination: true,
      status: { $in: ['scheduled', 'confirmed'] }
    })
      .populate('user_id', 'name email phoneNumber')
      .populate('re_examination_step_id')
      .sort({ appointment_date: 1 })
      .lean();

    // Lấy thông tin treatment steps tương ứng
    const appointmentsWithDetails = await Promise.all(
      appointments.map(async (appointment) => {
        // Tìm medical record chứa step này
        const medicalRecord = await MedicalRecord.findOne({
          'treatment_plan._id': appointment.re_examination_step_id
        })
          .populate('user_id', 'name email')
          .select('diagnosis treatment_plan');

        let stepDetails = null;
        if (medicalRecord && appointment.re_examination_step_id) {
          const step = (medicalRecord.treatment_plan as any).id(
            appointment.re_examination_step_id.toString());
          if (step) {
            stepDetails = {
              stepNumber: step.stepNumber,
              title: step.title,
              description: step.description,
              status: step.status,
              needsReExamination: step.needsReExamination,
              arrivalConfirmed: step.arrivalConfirmed
            };
          }
        }

        return {
          ...appointment,
          stepDetails,
          medicalRecord: medicalRecord ? {
            _id: medicalRecord._id,
            diagnosis: medicalRecord.diagnosis
          } : null
        };
      })
    );

    res.status(200).json({
      success: true,
      data: {
        total: appointmentsWithDetails.length,
        upcoming: appointmentsWithDetails.filter(app =>
          new Date(app.appointment_date) >= new Date()
        ).length,
        appointments: appointmentsWithDetails
      }
    });

  } catch (error: any) {
    console.error('Error fetching re-examination appointments:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

export const getReExaminationDetail = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { appointmentId } = req.params;

    const doctor_user_id = req.user?._id;
    if (!doctor_user_id) {
      res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
      return;
    }

    // Lấy doctor info
    const doctor = await Doctor.findOne({ user_id: doctor_user_id });
    if (!doctor) {
      res.status(404).json({
        success: false,
        message: 'Doctor profile not found'
      });
      return;
    }

    // Tìm appointment
    const appointment = await Appointment.findOne({
      _id: appointmentId,
      doctor_id: doctor._id,
      is_re_examination: true
    })
      .populate('user_id', 'name email phoneNumber dateOfBirth gender')
      .populate('re_examination_step_id')
      .lean();

    if (!appointment) {
      res.status(404).json({
        success: false,
        message: 'Re-examination appointment not found'
      });
      return;
    }

    // Tìm medical record và treatment step
    const medicalRecord = await MedicalRecord.findOne({
      'treatment_plan._id': appointment.re_examination_step_id
    })
      .populate('user_id', 'name email')
      .populate('doctor_id', 'name')
      .select('diagnosis symptoms treatment_plan');

    let stepDetails = null;
    if (medicalRecord && appointment.re_examination_step_id) {
      const step = (medicalRecord.treatment_plan as any).id(
        appointment.re_examination_step_id.toString());
      if (step) {
        stepDetails = {
          stepNumber: step.stepNumber,
          title: step.title,
          description: step.description,
          status: step.status,
          needsReExamination: step.needsReExamination,
          isReExaminationVisit: step.isReExaminationVisit,
          reExaminationScheduled: step.reExaminationScheduled,
          arrivalConfirmed: step.arrivalConfirmed,
          arrivalConfirmedAt: step.arrivalConfirmedAt
        };
      }
    }

    res.status(200).json({
      success: true,
      data: {
        appointment,
        stepDetails,
        medicalRecord: medicalRecord ? {
          _id: medicalRecord._id,
          diagnosis: medicalRecord.diagnosis,
          symptoms: medicalRecord.symptoms
        } : null,
        doctor: { _id: doctor._id, name: (doctor.user_id as any)?.name }
      }
    });

  } catch (error: any) {
    console.error('Error fetching re-examination detail:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};


export const updateAppointmentStatus = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { appointmentId } = req.params;
    const { status } = req.body;

    console.log('=== UPDATE APPOINTMENT STATUS ===');
    console.log('Appointment ID:', appointmentId);
    console.log('New status:', status);

    const doctor_user_id = req.user?._id;
    if (!doctor_user_id) {
      res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
      return;
    }

    // Lấy doctor info
    const doctor = await Doctor.findOne({ user_id: doctor_user_id });
    if (!doctor) {
      res.status(404).json({
        success: false,
        message: 'Doctor profile not found'
      });
      return;
    }

    // Tìm appointment và kiểm tra quyền
    const appointment = await Appointment.findOne({
      _id: appointmentId,
      doctor_id: doctor._id
    });

    if (!appointment) {
      res.status(404).json({
        success: false,
        message: 'Appointment not found'
      });
      return;
    }

    // Kiểm tra trạng thái hiện tại
    if (appointment.status === 'completed') {
      res.status(400).json({
        success: false,
        message: 'Appointment is already completed'
      });
      return;
    }
    if (appointment.status !== 'confirmed' && appointment.status !== 'scheduled') {
      res.status(400).json({
        success: false,
        message: `Cannot change status from ${appointment.status} to completed`
      });
      return;
    }

    appointment.status = 'completed';
    (appointment as any).updated_at = new Date();

    if (!appointment.metadata) {
      appointment.metadata = {};
    }
    appointment.metadata = {
      ...(appointment.metadata || {}),
      status_changed_at: new Date(),
      status_changed_by: 'doctor'
    } as any;

    await appointment.save();

    try {
      const patientUser = await User.findById(appointment.user_id);
      const doctorUser = await User.findById(doctor.user_id);

      if (patientUser) {
        await notificationService.sendNotification({
          user_id: (patientUser._id as Types.ObjectId).toString(),
          title: 'Appointment Status Updated',
          message: `Dr. ${doctorUser?.name || 'Doctor'} has marked your appointment as completed.`,
          template_key: 'appointment_status_updated',
          variables: {
            doctor_name: doctorUser?.name || 'Doctor',
            appointment_date: appointment.appointment_date ?
              new Date(appointment.appointment_date).toLocaleDateString() : 'your appointment',
            new_status: 'completed'
          },
          type: 'appointment',
          category: 'info',
          priority: 'medium',
          related_record: appointmentId,
          related_record_type: 'appointment',
          data: {
            appointment_id: appointmentId,
            previous_status: appointment.status,
            new_status: 'completed',
            updated_at: new Date()
          },
          action_url: `/appointments/${appointmentId}`,
          action_label: 'View Appointment'
        });
      }
    } catch (err) {
      console.error('Notification error:', err);
    }

    res.status(200).json({
      success: true,
      message: 'Appointment status updated successfully',
      data: {
        appointment: {
          _id: appointment._id,
          status: appointment.status,
          updated_at: appointment.updated_at
        }
      }
    });

  } catch (error: any) {
    console.error('Error updating appointment status:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

export const markAppointmentCompleted = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { appointmentId } = req.params;

    console.log('=== MARK APPOINTMENT COMPLETED ===');
    console.log('Appointment ID:', appointmentId);

    const doctor_user_id = req.user?._id;
    if (!doctor_user_id) {
      res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
      return;
    }

    // Lấy doctor info
    const doctor = await Doctor.findOne({ user_id: doctor_user_id });
    if (!doctor) {
      res.status(404).json({
        success: false,
        message: 'Doctor profile not found'
      });
      return;
    }

    // Tìm appointment và kiểm tra quyền
    const appointment = await Appointment.findOne({
      _id: appointmentId,
      doctor_id: doctor._id,
      status: { $in: ['confirmed', 'scheduled'] }
    });

    if (!appointment) {
      res.status(404).json({
        success: false,
        message: 'Appointment not found or cannot be marked as completed'
      });
      return;
    }

    // Cập nhật appointment
    appointment.status = 'completed';
    (appointment as any).updated_at = new Date();
    await appointment.save();

    res.status(200).json({
      success: true,
      message: 'Appointment marked as completed',
      data: {
        appointment: {
          _id: appointment._id,
          status: appointment.status
        }
      }
    });

  } catch (error: any) {
    console.error('Error marking appointment as completed:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// Hoàn thành re-examination step và appointment
export const completeReExamination = async (req: AuthRequest, res: Response) => {
  try {
    const { consultationId, stepNumber } = req.params;
    const { doctorNotes } = req.body;

    const doctor_user_id = req.user?._id;
    if (!doctor_user_id) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    const doctor = await Doctor.findOne({ user_id: doctor_user_id });
    if (!doctor) {
      return res.status(404).json({
        success: false,
        message: 'Doctor profile not found'
      });
    }

    const medicalRecord = await MedicalRecord.findById(consultationId)
      .populate('user_id', 'name email');

    if (!medicalRecord) {
      return res.status(404).json({
        success: false,
        message: 'Medical record not found'
      });
    }

    const step = medicalRecord.treatment_plan.find(
      (s: any) => s.stepNumber === parseInt(stepNumber)
    );

    if (!step) {
      return res.status(404).json({
        success: false,
        message: 'Step not found'
      });
    }

    // FIXED: Kiểm tra step có phải là re-examination bằng nhiều cách
    const isReExamination =
      step.isReExaminationVisit ||
      step.needsReExamination ||
      step.reExaminationScheduled ||
      step.title?.toLowerCase().includes('re-ex') ||
      step.title?.toLowerCase().includes('follow-up') ||
      step.title?.toLowerCase().includes('physical');

    if (!isReExamination) {
      return res.status(400).json({
        success: false,
        message: 'This step is not a re-examination visit'
      });
    }

    // Validate step is in-progress hoặc scheduled
    if (step.status !== 'in-progress' && step.status !== 'scheduled') {
      return res.status(400).json({
        success: false,
        message: `Cannot complete step. Current status: ${step.status}`
      });
    }

    // Update step status to completed
    step.status = 'completed';
    step.doctorNotes = doctorNotes || 'Physical examination completed';
    step.completedAt = new Date();
    step.approval_requested = true;

    // Update appointment status if exists
    if (step.reExaminationAppointmentId) {
      const appointment = await Appointment.findById(step.reExaminationAppointmentId);
      if (appointment) {
        step.status = 'approved';
        appointment.notes = `Physical re-examination completed: ${doctorNotes || 'Patient attended the appointment'}`;
        appointment.metadata = {
          ...appointment.metadata,
          completed_at: new Date(),
          completed_by: 'doctor',
          step_number: parseInt(stepNumber)
        };
        await appointment.save();
      }
    }

    await medicalRecord.save({ validateModifiedOnly: true });

    // Send notification to patient
    try {
      const patient = medicalRecord.user_id as any;
      const doctorUser = await User.findById(doctor.user_id);

      await notificationService.sendNotification({
        user_id: patient._id.toString(),
        title: 'Re-Examination Completed',
        message: `Dr. ${doctorUser?.name || 'Doctor'} has completed your physical re-examination. The step is now ready for review.`,
        template_key: 're_examination_completed',
        variables: {
          doctor_name: doctorUser?.name || 'Doctor',
          step_title: step.title
        },
        type: 'treatment',
        category: 'success',
        priority: 'high',
        related_record: consultationId,
        related_record_type: 'medical_record',
        action_url: `/medical-records/${consultationId}`,
        action_label: 'View Treatment Plan'
      });
    } catch (err) {
      console.error('Notification error:', err);
    }

    res.status(200).json({
      success: true,
      message: 'Re-examination completed successfully',
      data: {
        step: step,
        medical_record: medicalRecord
      }
    });

  } catch (error: any) {
    console.error('Error completing re-examination:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};


export const getStepAppointmentStatus = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const { consultationId, stepNumber } = req.params;
    const stepNum = parseInt(stepNumber);

    // Auth
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }

    const doctor = await Doctor.findOne({ user_id: req.user._id });
    if (!doctor) {
      res.status(404).json({ success: false, message: 'Doctor profile not found' });
      return;
    }

    const medicalRecord = await MedicalRecord.findById(consultationId);
    if (!medicalRecord) {
      res.status(404).json({ success: false, message: 'Medical record not found' });
      return;
    }

    // Authorization
    if (medicalRecord.doctor_id.toString() !== doctor.user_id.toString()) {
      res.status(403).json({ success: false, message: 'Forbidden' });
      return;
    }

    const step = medicalRecord.treatment_plan.find(
      (s: any) => s.stepNumber === stepNum
    );
    if (!step) {
      res.status(404).json({ success: false, message: 'Step not found' });
      return;
    }

    // Tìm appointment của step này (nhiều cách)
    let appointment: any = null;

    if (step.reExaminationAppointmentId) {
      appointment = await Appointment.findById(step.reExaminationAppointmentId)
        .populate('user_id', 'name email phoneNumber')
        .lean();
    }

    // Fallback: tìm theo step._id
    if (!appointment && step._id) {
      appointment = await Appointment.findOne({
        re_examination_step_id: step._id,
        is_re_examination: true,
      })
        .populate('user_id', 'name email phoneNumber')
        .lean();
    }

    // Fallback: tìm theo metadata
    if (!appointment) {
      appointment = await Appointment.findOne({
        'metadata.consultation_id': consultationId,
        'metadata.step_number': stepNum,
        is_re_examination: true,
      })
        .populate('user_id', 'name email phoneNumber')
        .lean();
    }

    // ── Xác định "doctor action" dựa trên trạng thái ──────────
    let doctorAction: string | null = null;
    if (appointment) {
      switch (appointment.status) {
        case 'confirmed':
          // Patient đã check-in → doctor có thể bắt đầu khám
          doctorAction = 'start_examination';
          break;
        case 'scheduled':
        case 'pending':
          // Chưa có gì → doctor chờ hoặc reschedule
          doctorAction = 'waiting_patient';
          break;
        case 'completed':
          doctorAction = 'examination_done';
          break;
        case 'cancelled':
          doctorAction = 'reschedule';
          break;
        default:
          doctorAction = null;
      }
    }

    res.status(200).json({
      success: true,
      data: {
        step: {
          stepNumber: step.stepNumber,
          title: step.title,
          status: step.status,
          reExaminationAppointmentId: step.reExaminationAppointmentId,
        },
        appointment: appointment
          ? {
            _id: appointment._id,
            status: appointment.status,
            appointment_date: appointment.appointment_date,
            time_slot: appointment.time_slot,
            patient: appointment.user_id,
            notes: appointment.notes,
            reason: appointment.reason,
          }
          : null,
        // Key field: frontend dùng cái này để render đúng UI
        doctorAction,
      },
    });
  } catch (error: any) {
    console.error('Error getting step appointment status:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const patientCheckIn = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const { appointmentId } = req.params;

    if (!req.user) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }

    const appointment = await Appointment.findOne({
      _id: appointmentId,
      user_id: req.user._id,
    });

    if (!appointment) {
      res.status(404).json({ success: false, message: 'Appointment not found' });
      return;
    }

    // Chỉ cho phép check-in khi scheduled hoặc pending
    if (!['scheduled', 'pending'].includes(appointment.status)) {
      res.status(400).json({
        success: false,
        message: `Cannot check in. Current appointment status: ${appointment.status}`,
        currentStatus: appointment.status,
      });
      return;
    }

    // Update: patient đã đến phòng khám
    appointment.status = 'confirmed';
    appointment.metadata = {
      ...(appointment.metadata || {}),
      patient_checked_in_at: new Date(),
      checked_in_by: 'patient',
      patient_user_id: req.user._id,
    } as any;
    await appointment.save();

    // Notify doctor that patient has arrived
    try {
      // Tìm doctor user để gửi notification
      const doctor = await Doctor.findById(appointment.doctor_id);
      if (doctor) {
        const patientUser = await User.findById(req.user._id).select('name');
        await notificationService.sendNotification({
          user_id: doctor.user_id.toString(),
          title: 'Patient Has Arrived',
          message: `${patientUser?.name || 'Patient'} has checked in for their appointment at ${appointment.time_slot}.`,
          template_key: 'patient_arrived',
          variables: {
            patient_name: patientUser?.name || 'Patient',
            appointment_time: appointment.time_slot,
            appointment_date: new Date(appointment.appointment_date).toLocaleDateString(),
          },
          type: 'appointment',
          category: 'info',
          priority: 'high',
          related_record: appointmentId,
          related_record_type: 'appointment',
          action_url: `/appointments/${appointmentId}`,
          action_label: 'View Appointment',
        });
      }
    } catch (err) {
      console.error('Notification error (non-fatal):', err);
    }

    res.status(200).json({
      success: true,
      message: 'Check-in successful. Doctor has been notified.',
      data: {
        appointment: {
          _id: appointment._id,
          status: appointment.status,
          appointment_date: appointment.appointment_date,
          time_slot: appointment.time_slot,
          checked_in_at: (appointment.metadata as any)?.patient_checked_in_at,
        },
      },
    });
  } catch (error: any) {
    console.error('Error during patient check-in:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const checkInAppointment = async (req: Request, res: Response) => {
  try {
    const { appointmentId } = req.params;
    const { doctorId } = req.body;

    console.log('=== CHECK-IN APPOINTMENT ===');
    console.log('Appointment ID:', appointmentId);
    console.log('Doctor ID (user_id):', doctorId);

    // Resolve doctor's ObjectId from the user_id stored in localStorage
    const doctor = await Doctor.findOne({ user_id: doctorId });
    if (!doctor) {
      return res.status(404).json({ success: false, message: 'Doctor not found' });
    }

    const appointment = await Appointment.findOneAndUpdate(
      {
        _id: appointmentId,
        doctor_id: doctor._id,
        // Only "confirmed" appointments can be checked-in
        status: 'confirmed',
      },
      {
        status: 'checked-in',
        'metadata.checked_in_at': new Date(),
        'metadata.checked_in_by': 'doctor',
      },
      { new: true }
    ).populate('user_id', 'name email phoneNumber');

    if (!appointment) {
      return res.status(404).json({
        success: false,
        message:
          'Appointment not found or cannot be checked-in (must be "confirmed" first)',
      });
    }

    // Notify patient that their turn is coming up
    try {
      const patientUserId = (appointment.user_id as any)?._id?.toString();
      if (patientUserId) {
        await notificationService.sendNotification({
          user_id: patientUserId,
          title: 'You Are Checked In',
          message: 'The clinic has confirmed your arrival. Please wait — the doctor will see you shortly.',
          template_key: 'patient_checked_in',
          variables: {
            doctor_name: (doctor.user_id as any)?.name || 'Your doctor',
            appointment_time: appointment.time_slot,
          },
          type: 'appointment',
          category: 'info',
          priority: 'high',
          related_record: appointmentId,
          related_record_type: 'appointment',
          action_url: `/appointments/${appointmentId}`,
          action_label: 'View Appointment',
        });
      }
    } catch (notifError) {
      console.error('Notification error (non-fatal):', notifError);
    }

    return res.status(200).json({
      success: true,
      message: 'Patient checked in successfully',
      data: appointment,
    });
  } catch (error) {
    console.error('Error checking in appointment:', error);
    return res.status(500).json({ success: false, message: 'Error checking in appointment' });
  }
};


export const getPatientContext = async (req: Request, res: Response) => {
  try {
    const { patientId } = req.params;

    console.log('=== GET PATIENT CONTEXT ===');
    console.log('Patient ID:', patientId);

    if (!patientId) {
      return res.status(400).json({ success: false, message: 'Patient ID is required' });
    }

    // --- Recent consultations (last 3) ---
    const recentConsultations = await MedicalRecord.find({ user_id: patientId })
      .sort({ created_at: -1 })
      .limit(3)
      .select('diagnosis severity notes created_at treatment_plan')
      .lean();

    // Shape each consultation so the frontend gets a clean initialStep summary
    const shapedConsultations = recentConsultations.map((record: any) => {
      const firstStep = record.treatment_plan?.[0] ?? null;
      return {
        _id: record._id,
        diagnosis: record.diagnosis || '',
        severity: record.severity || 'mild',
        notes: record.notes || '',
        created_at: record.created_at,
        initialStep: firstStep
          ? {
            title: firstStep.title || '',
            medication: firstStep.medication || '',
            dosage: firstStep.dosage || '',
            duration: firstStep.duration || '',
            instructions: firstStep.instructions || '',
          }
          : null,
      };
    });

    // --- Allergies & current medications from UserInformation ---
    const userInfo = await UserInformation.findOne({ user_id: patientId })
      .select('allergies chronic_diseases blood_type height weight BMI')
      .lean();
    const activeMedications: string[] = [];
    const activeRecords = await MedicalRecord.find({
      user_id: patientId,
      consultation_status: { $in: ['in-progress', 'active'] },
    })
      .select('treatment_plan')
      .lean();

    activeRecords.forEach((record: any) => {
      record.treatment_plan?.forEach((step: any) => {
        if (
          step.status === 'in-progress' &&
          step.medication &&
          !activeMedications.includes(step.medication)
        ) {
          step.medication.split(' + ').forEach((med: string) => {
            const trimmed = med.trim();
            if (trimmed && !activeMedications.includes(trimmed)) {
              activeMedications.push(trimmed);
            }
          });
        }
      });
    });

    return res.status(200).json({
      success: true,
      data: {
        recentConsultations: shapedConsultations,
        allergies: (userInfo as any)?.allergist ? [(userInfo as any).allergist] : [],
        currentMedications: activeMedications,
        bloodType: (userInfo as any)?.blood_type ?? null,
        chronicDiseases: (userInfo as any)?.chronic_diseases ?? [],
        height: (userInfo as any)?.height ?? null,
        weight: (userInfo as any)?.weight ?? null,
        BMI: (userInfo as any)?.BMI ?? null,
      },
    });
  } catch (error) {
    console.error('Error fetching patient context:', error);
    return res.status(500).json({ success: false, message: 'Error fetching patient context' });
  }
};
export const getPatientConsultations = async (req: Request, res: Response) => {
  try {
    const { patientId } = req.params;
    const limit = Math.min(parseInt(req.query.limit as string) || 5, 20);

    console.log('=== GET PATIENT CONSULTATIONS (Smart Prescription) ===');
    console.log('Patient ID:', patientId, '| Limit:', limit);

    if (!patientId) {
      return res.status(400).json({ success: false, message: 'Patient ID is required' });
    }

    const consultations = await MedicalRecord.find({ user_id: patientId })
      .sort({ created_at: -1 })
      .limit(limit)
      .select('diagnosis severity notes created_at treatment_plan consultation_status')
      .lean();

    const shaped = consultations.map((record: any) => {
      const firstStep = record.treatment_plan?.[0] ?? null;
      return {
        _id: record._id,
        diagnosis: record.diagnosis || '',
        severity: record.severity || 'mild',
        notes: record.notes || '',
        created_at: record.created_at,
        status: record.consultation_status,
        initialStep: firstStep
          ? {
            title: firstStep.title || '',
            medication: firstStep.medication || '',
            dosage: firstStep.dosage || '',
            duration: firstStep.duration || '',
            instructions: firstStep.instructions || '',
          }
          : null,
      };
    });

    return res.status(200).json({ success: true, data: shaped });
  } catch (error) {
    console.error('Error fetching patient consultations:', error);
    return res
      .status(500)
      .json({ success: false, message: 'Error fetching patient consultations' });
  }
};
export const saveDoctorAppointmentNote = async (req: Request, res: Response) => {
  try {
    const { appointmentId } = req.params;
    const { doctorNote, doctorId } = req.body;

    console.log('=== SAVE DOCTOR APPOINTMENT NOTE ===');
    console.log('Appointment ID:', appointmentId);

    if (!appointmentId) {
      return res.status(400).json({ success: false, message: 'Appointment ID is required' });
    }

    const doctor = await Doctor.findOne({ user_id: doctorId });
    if (!doctor) {
      return res.status(404).json({ success: false, message: 'Doctor not found' });
    }

    // Only the owning doctor can write notes on their appointments
    const appointment = await Appointment.findOneAndUpdate(
      { _id: appointmentId, doctor_id: doctor._id },
      {
        doctorNote,
        'metadata.note_updated_at': new Date(),
      },
      { new: true }
    );

    if (!appointment) {
      return res.status(404).json({
        success: false,
        message: 'Appointment not found or access denied',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Doctor note saved',
      data: { appointmentId, doctorNote },
    });
  } catch (error) {
    console.error('Error saving doctor note:', error);
    return res.status(500).json({ success: false, message: 'Error saving doctor note' });
  }
};
export const scheduleFollowUpAppointment = async (req: Request, res: Response) => {
  try {
    const {
      user_id,
      doctor_id,
      appointment_date,
      time_slot,
      reason,
      source_consultation_id,
    } = req.body;

    console.log('=== SCHEDULE FOLLOW-UP APPOINTMENT ===');
    console.log('Patient ID:', user_id, '| Doctor user_id:', doctor_id);
    console.log('Date:', appointment_date, '| Slot:', time_slot);

    // Validate required fields
    if (!user_id || !doctor_id || !appointment_date || !time_slot) {
      return res.status(400).json({
        success: false,
        message: 'user_id, doctor_id, appointment_date and time_slot are required',
      });
    }

    // Resolve doctor ObjectId
    const doctor = await Doctor.findOne({ user_id: doctor_id });
    if (!doctor) {
      return res.status(404).json({ success: false, message: 'Doctor not found' });
    }

    const parsedDate = new Date(appointment_date);
    if (isNaN(parsedDate.getTime())) {
      return res.status(400).json({ success: false, message: 'Invalid appointment_date format' });
    }

    // Check for slot conflict
    const startOfDay = new Date(parsedDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(parsedDate);
    endOfDay.setHours(23, 59, 59, 999);

    const conflict = await Appointment.findOne({
      doctor_id: doctor._id,
      appointment_date: { $gte: startOfDay, $lte: endOfDay },
      time_slot,
      status: { $in: ['pending', 'confirmed', 'scheduled', 'checked-in'] },
    });

    if (conflict) {
      return res.status(409).json({
        success: false,
        message: `Slot ${time_slot} on ${parsedDate.toLocaleDateString()} is already booked`,
        conflict_id: conflict._id,
      });
    }

    // Create the follow-up appointment
    const followUp = new Appointment({
      user_id,
      doctor_id: doctor._id,
      specialty_id: doctor.specialty_id,
      appointment_date: parsedDate,
      time_slot,
      status: 'scheduled',
      reason: reason || 'Follow-up consultation',
      notes: source_consultation_id
        ? `Follow-up from consultation ${source_consultation_id}`
        : undefined,
      is_follow_up: true,
      metadata: {
        source_consultation_id: source_consultation_id ?? null,
        created_by: 'doctor',
        created_at: new Date(),
        is_follow_up: true,
      },
    });

    await followUp.save();

    // Link the source consultation to this follow-up
    if (source_consultation_id) {
      await MedicalRecord.findByIdAndUpdate(source_consultation_id, {
        follow_up_appointment_id: followUp._id,
        next_appointment: parsedDate,
      });
    }
    try {
      const patientUser = await User.findById(user_id).select('name email');
      const doctorUser = await User.findById(doctor_id).select('name');

      if (patientUser) {
        await notificationService.sendNotification({
          user_id: user_id.toString(),
          title: 'Follow-Up Appointment Scheduled',
          message: `Dr. ${doctorUser?.name || 'Your doctor'} has scheduled a follow-up appointment for you on ${parsedDate.toLocaleDateString()} at ${time_slot}.`,
          template_key: 'follow_up_scheduled',
          variables: {
            doctor_name: doctorUser?.name || 'Your doctor',
            appointment_date: parsedDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }),
            appointment_time: time_slot,
          },
          type: 'appointment',
          category: 'success',
          priority: 'high',
          related_record: (followUp._id as Types.ObjectId).toString(),
          related_record_type: 'appointment',
          action_url: `/appointments/${followUp._id}`,
          action_label: 'View Appointment',
        });
        if (patientUser.email) {
          await emailService.sendAppointmentConfirmationEmail(
            patientUser.email,
            patientUser.name,
            reason || 'Follow-up consultation',
            {
              appointment_id: (followUp._id as Types.ObjectId).toString(),
              doctor_name: doctorUser?.name || 'Your doctor',
              doctor_specialty: '',
              appointment_date: parsedDate.toLocaleDateString(),
              appointment_time: time_slot,
              appointment_end_time: '',
              location: '',
              consultation_fee: 0,
              preparation_instructions: '',
              cancellation_policy: '',
              contact_info: '',
            }
          );
        }
      }
    } catch (notifError) {
      console.error('Notification error (non-fatal):', notifError);
    }

    return res.status(201).json({
      success: true,
      message: 'Follow-up appointment scheduled successfully',
      data: followUp,
    });
  } catch (error) {
    console.error('Error scheduling follow-up appointment:', error);
    return res
      .status(500)
      .json({ success: false, message: 'Error scheduling follow-up appointment' });
  }
};
