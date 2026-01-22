import { Request, Response } from 'express';
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
import doctor from '../models/doctor';




export const getActiveConsultation = async (req: Request, res: Response) => {
  try {
    const { doctorId } = req.params;
    console.log('=== GET ACTIVE CONSULTATIONS ===');
    console.log('Doctor ID from params:', doctorId);
    // FIXED: Use correct field names from your CSV
    const consultations = await MedicalRecord.find({
      doctor_id: doctorId,
      $or: [
        { consultation_status: 'in-progress' },  // This is the correct field
        { status: 'active' }  // Keep this as backup
      ]
    })
    .populate('user_id', 'name email phoneNumber dateOfBirth gender')
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
    await medicalRecord.populate('user_id', 'name email phoneNumber dateOfBirth gender');

    console.log('Medical record created:', medicalRecord);

    res.json({ success: true, data: medicalRecord });
  } catch (error) {
    console.error('Error creating consultation:', error);
    res.status(500).json({ success: false, message: 'Error creating consultation' });
  }
};


// Add treatment step
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


    // 1. Add the step to Medical Record
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

    medicalRecord.treatment_plan.push(newStep);
    await medicalRecord.save();

    // 2. Reduce Stock Logic
    // We expect a 'prescriptions' array from the frontend containing { medication, dosage, duration } objects
    if (prescriptions && Array.isArray(prescriptions) && prescriptions.length > 0) {
      console.log('Updating stock for prescriptions:', prescriptions);
      
      for (const item of prescriptions) {
        if (!item.medication) continue;

        // Calculate how much to deduct
        const quantityToDeduct = calculateQuantity(item.dosage || '', item.duration || '');
        
        console.log(`Deducting ${quantityToDeduct} from ${item.medication}`);

        // Find the drug by name and reduce stock
        // We use $inc with a negative number.
        // FIXED: Used 'stock_quantity' to match the Drug model
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

    // Validate/Fix severity to avoid save error on legacy data
    const validSeverities = ['mild', 'moderate', 'severe', 'critical'];
    if (medicalRecord.severity && !validSeverities.includes(medicalRecord.severity)) {
       if (medicalRecord.severity === 'low') medicalRecord.severity = 'mild';
       else if (medicalRecord.severity === 'medium') medicalRecord.severity = 'moderate';
       else if (medicalRecord.severity === 'high') medicalRecord.severity = 'severe';
       else medicalRecord.severity = 'mild'; // Fallback
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
      .populate('doctor_id', 'user_id name'); // Chỉ populate doctor_id

    if (!medicalRecord) {
      return res.status(404).json({ success: false, message: 'Medical record not found' });
    }

    // Nếu cần thông tin user của doctor, query riêng
    let doctorUserInfo = null;
    if (medicalRecord.doctor_id) {
      // Cast to any để truy cập thuộc tính
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
      // Get patient info
      const patientUserId = (medicalRecord.user_id as any)._id;
      
      // Sử dụng doctorUserInfo thay vì medicalRecord.doctor_id.user_id
      if (patientUserId && doctorUserInfo) {
        // Send notification to patient
        await notificationService.sendNotification({
          user_id: patientUserId.toString(),
          template_key: 'treatment_step_approved',
          variables: {
            step_number: stepNum.toString(),
            step_title: step.title,
            doctor_name: doctorUserInfo.name // Sử dụng tên từ doctorUserInfo
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
            doctorUserInfo.name, // Sử dụng tên từ doctorUserInfo
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

    // Tìm medical record với thông tin liên quan
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


    // Enforce: all steps must be approved before completing
    const allApproved = medicalRecord.treatment_plan.every((step: any) => step.status === 'approved');
    if (!allApproved) {
      return res.status(400).json({ success: false, message: 'All steps must be approved before completing the consultation.' });
    }

    // Cập nhật consultation sử dụng instance method
    medicalRecord.consultation_status = 'completed';
    medicalRecord.status = 'resolved';
    medicalRecord.updated_at = new Date();
    
    // Cập nhật các trường thông tin nếu có
    if (diagnosis) medicalRecord.diagnosis = diagnosis;
    if (notes) medicalRecord.notes = notes;
    if (follow_up_instructions) medicalRecord.follow_up_instructions = follow_up_instructions;
    if (next_appointment) medicalRecord.next_appointment = next_appointment;

    await medicalRecord.save();

    // ================= NOTIFICATION LOGIC =================
    try {
      // Get patient and doctor info
      const patientUserId = medicalRecord.user_id._id;
      const doctorUser = medicalRecord.doctor_id.user_id;

      if (patientUserId && doctorUser) {
        // Send notification to patient
        await notificationService.sendNotification({
          user_id: patientUserId.toString(),
          title: 'Consultation Completed',
          message: `Dr. ${medicalRecord.doctor_id.name} has completed your consultation. ${medicalRecord.diagnosis ? `Diagnosis: ${medicalRecord.diagnosis}` : ''}`,
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
              doctor_name: medicalRecord.doctor_id.name,
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
          message: `You have completed consultation with ${medicalRecord.user_id.name}. Medical record has been updated.`,
          type: 'consultation',
          category: 'info',
          priority: 'medium',
          related_record: consultationId,
          related_record_type: 'medical_record',
          data: {
            patient_name: medicalRecord.user_id.name,
            completion_date: new Date().toISOString(),
            diagnosis: medicalRecord.diagnosis
          }
        });
      }

      console.log('✅ Consultation completion notifications sent');
    } catch (notifError) {
      console.error('❌ Error sending notifications:', notifError);
      // Don't fail the whole request if notification fails
    }
    // ================= END NOTIFICATION LOGIC =================

    // Send real-time notification via socket
    const patientUser = await User.findById(medicalRecord.user_id._id);
    if (patientUser) {
      socketService.emitToUser(
        patientUser._id.toString(),
        'consultation_completed',
        {
          consultation_id: consultationId,
          doctor_name: medicalRecord.doctor_id.name,
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
    console.log('=== GET DOCTOR APPOINTMENTS ===');
    console.log('Doctor ID from params:', doctorId);
    
    if (!doctorId) {
      return res.status(400).json({ success: false, message: 'Doctor ID is required' });
    }

    // First, find the doctor document by user_id
    const doctor = await Doctor.findOne({ user_id: doctorId });
    console.log('Found doctor:', doctor);
    
    if (!doctor) {
      return res.status(404).json({ success: false, message: 'Doctor not found' });
    }

    // Use the doctor's _id to find appointments
    const doctorObjectId = doctor._id;
    console.log('Using doctor ObjectId for appointments:', doctorObjectId);

    let query: any = { doctor_id: doctorObjectId };
    
    // Optional: filter by date if provided as query param
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

    console.log('Found appointments:', appointments.length);
    console.log('Appointments:', appointments);

    res.status(200).json({ 
      success: true, 
      data: appointments,
      debug: {
        doctorIdFromParams: doctorId,
        doctorObjectId: doctorObjectId,
        appointmentsCount: appointments.length
      }
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

    // Build query để lấy patients từ medical records
    let matchQuery: any = { doctor_id: doctorId };
    
    // Lấy tất cả medical records của doctor này để có danh sách patient IDs
    const medicalRecords = await MedicalRecord.find(matchQuery)
      .distinct('user_id')
      .lean();

    const patientIds = medicalRecords.map(id => id.toString());

    // Query chính để lấy thông tin bệnh nhân
    let userQuery: any = { 
      _id: { $in: patientIds },
      role: 'patient'
    };

    // Thêm search nếu có
    if (search) {
      userQuery.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phoneNumber: { $regex: search, $options: 'i' } }
      ];
    }

    // Lấy thông tin từ User model
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
          allergies: userInfo?.allergies || [],
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

    // Cập nhật trạng thái: completed (chờ approval), KHÔNG PHẢI approved
    step.status = 'completed';
    step.completedAt = new Date();
    step.approval_requested = true;
    
    if (patientMessage) {
      step.patient_message = patientMessage;
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
    const {initialStep, Description, Prescriptions} = req.body;

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

    // Chuẩn bị data cho step mới nếu cần
    let newStepData = null;
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

    // Thực hiện quyết định của bác sĩ
    await medicalRecord.doctorDecision(
      parseInt(stepNumber),
      decision as any,
      doctor_notes,
      newStepData
    );

    // Gửi notification cho bệnh nhân
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
          doctor_name: medicalRecord.doctor_id?.name || 'Doctor',
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
          medicalRecord.doctor_id?.name || 'Doctor',
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
      followUpInstructions,
      additionalStepTitle,
      additionalStepDescription,
      completeConsultation
    } = req.body;
    
    const stepNum = parseInt(stepNumber);

    console.log('=== FIX: REVIEW AND DECIDE STEP WITH VALIDATION BYPASS ===');
    console.log('Request body:', req.body);

    if (!req.user || req.user.role !== 'doctor') {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const medicalRecord = await MedicalRecord.findById(consultationId)
      .populate('user_id', 'name email phoneNumber')
      .populate({
        path: 'doctor_id',
        select: 'name email role',
        model: 'User'
      });

    if (!medicalRecord) {
      res.status(404).json({ success: false, message: 'Medical record not found' });
      return;
    }

    const doctorInRecord = medicalRecord.doctor_id as any;
    if (doctorInRecord._id.toString() !== req.user._id.toString()) {
      res.status(403).json({ success: false, message: 'Forbidden: Assigned doctor only' });
      return;
    }

    const step = medicalRecord.treatment_plan.find((s: any) => s.stepNumber === stepNum);
    if (!step) {
      res.status(404).json({ success: false, message: 'Step not found' });
      return;
    }

    if (step.status !== 'completed') {
      res.status(400).json({ success: false, message: 'Can only review completed steps' });
      return;
    }

    const doctorName = doctorInRecord?.name || 'Doctor';
    const patient = medicalRecord.user_id;

        switch (decision) {
      case 'approve_with_followup':
        // 1. Approve current step
        step.status = 'approved';
        step.doctorNotes = doctorNotes;
        step.approvedAt = new Date();
        step.approval_requested = false;
        step.needsReExamination = true;
        step.reExaminationNotes = followUpInstructions;
        

        // 3. Add next step if requested (optional)
        if (requireFollowUp && additionalStepTitle) {
          const nextStepNumber = medicalRecord.treatment_plan.length + 1;
          const newStep: any = {
            stepNumber: nextStepNumber,
            title: additionalStepTitle,
            description: additionalStepDescription || 'Follow-up phase after clinical review',
            status: 'pending',
            instructions: followUpInstructions,
            needsReExamination: true,
            created_at: new Date()
          };
          medicalRecord.treatment_plan.push(newStep);
        }

        // 4. Activate next step in queue
        const nextStepInPlan = medicalRecord.treatment_plan.find((s: any) => s.stepNumber === stepNum + 1);
        if (nextStepInPlan && nextStepInPlan.status === 'pending') {
          nextStepInPlan.status = 'in-progress';
          nextStepInPlan.startedAt = new Date();
          medicalRecord.current_step = stepNum + 1;
        }

        // Send notification WITHOUT appointment info
        try {
          await notificationService.sendNotification({
            user_id: (patient as any)._id.toString(),
            title: 'Treatment Phase Approved',
            message: `Dr. ${doctorName} has approved step ${stepNum}: ${step.title}. Follow-up visit required.`,
            template_key: 'step_approved_needs_followup',
            variables: {
              step_number: stepNum.toString(),
              step_title: step.title,
              doctor_name: doctorName
            },
            type: 'treatment',
            category: 'info',
            priority: 'medium',
            related_record: consultationId,
            related_record_type: 'medical_record',
            data: {
              decision: 'approved_needs_followup',
              doctorNotes: doctorNotes
            },
            action_url: `/medical-records/${consultationId}`,
            action_label: 'View Treatment Plan'
          });
        } catch (err) { console.error('Notification error:', err); }
        break;

      case 'approve_and_complete':
        step.status = 'approved';
        step.doctorNotes = doctorNotes;
        step.approvedAt = new Date();
        step.approval_requested = false;

        const allStepsApproved = medicalRecord.treatment_plan.every((s: any) => s.status === 'approved');
        if (allStepsApproved) {
          medicalRecord.consultation_status = 'completed';
          medicalRecord.status = 'resolved';
          medicalRecord.updated_at = new Date();
          
          try {
            await notificationService.sendNotification({
              user_id: (patient as any)._id.toString(),
              title: 'Consultation Completed',
              message: `Your treatment plan is complete. Diagnosis: ${medicalRecord.diagnosis || 'Resolved'}.`,
              template_key: 'consultation_completed_by_doctor',
              variables: {
                doctor_name: doctorName,
                diagnosis: medicalRecord.diagnosis || 'Treatment Completed'
              },
              type: 'consultation',
              category: 'success',
              priority: 'high',
              related_record: consultationId,
              related_record_type: 'medical_record',
              action_url: `/medical-records/${consultationId}/summary`,
              action_label: 'View Summary'
            });
          } catch (err) { console.error('Notification error:', err); }
        }
        break;

      case 'reject':
        step.status = 'pending';
        step.rejectionReason = doctorNotes;
        step.rejectedAt = new Date();
        step.approval_requested = false;
        
        try {
          await notificationService.sendNotification({
            user_id: (patient as any)._id.toString(),
            title: 'Step Revision Required',
            message: `Dr. ${doctorName} has requested a revision for step ${stepNum}.`,
            template_key: 'step_rejected_needs_revision',
            variables: {
              step_number: stepNum.toString(),
              step_title: step.title,
              doctor_name: doctorName
            },
            type: 'treatment',
            category: 'warning',
            priority: 'medium',
            related_record: consultationId,
            related_record_type: 'medical_record'
          });
        } catch (err) { console.error('Notification error:', err); }
        break;
    }

    // CRITICAL FIX: Use validateModifiedOnly: true to bypass existing invalid diagnosis data (like "a")
    await medicalRecord.save({ validateModifiedOnly: true });

    res.status(200).json({
      success: true,
      data: {
        medical_record: medicalRecord,
        consultation_status: medicalRecord.consultation_status
      },
      message: `Step ${decision.replace(/_/g, ' ')} successfully`
    });

  } catch (error: any) {
    console.error('Error in reviewAndDecideStep:', error);
    res.status(500).json({ success: false, message: 'Error reviewing step: ' + error.message });
  }
};


export const scheduleReExamination = async (req: AuthRequest, res: Response) => {
  try {
    const { consultationId, stepNumber } = req.params;
    const { appointmentDateTime, notes, timeSlot } = req.body;
    
    // Validate input
    if (!appointmentDateTime) {
      return res.status(400).json({ 
        success: false, 
        message: 'appointmentDateTime is required' 
      });
    }
    
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
        message: 'Doctor not found' 
      });
    }
    
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

    const appointmentDate = new Date(appointmentDateTime);
    
    // ========== PHẦN QUAN TRỌNG ĐÃ SỬA ==========
    // TÌM KIẾM APPOINTMENT CŨ THEO MULTIPLE CRITERIA
    let appointment;
    
    // 1. Tìm theo appointmentId đã có trong step (nếu có)
    if (step.reExaminationAppointmentId) {
      appointment = await Appointment.findById(step.reExaminationAppointmentId);
      console.log('🔍 Found appointment by ID:', step.reExaminationAppointmentId);
    }
    
    // 2. Nếu không tìm thấy, tìm theo step._id (nếu có)
    if (!appointment && step._id) {
      appointment = await Appointment.findOne({
        re_examination_step_id: step._id,
        is_re_examination: true,
        user_id: medicalRecord.user_id,
        doctor_id: doctor._id
      });
      console.log('🔍 Searched appointment by step_id:', step._id, 'found:', appointment?._id);
    }
    
    // 3. Nếu vẫn không tìm thấy, tìm theo consultationId và stepNumber
    if (!appointment) {
      appointment = await Appointment.findOne({
        'metadata.consultation_id': consultationId,
        'metadata.step_number': parseInt(stepNumber),
        is_re_examination: true,
        status: { $in: ['confirmed', 'scheduled', 'pending'] }
      });
      console.log('🔍 Searched appointment by metadata:', consultationId, stepNumber, 'found:', appointment?._id);
    }
    
    if (appointment) {
      // CẬP NHẬT lịch hẹn hiện có
      console.log('✅ Updating existing appointment:', appointment._id);
      appointment.appointment_date = appointmentDate;
      appointment.time_slot = timeSlot || '09:00';
      appointment.notes = notes || `Re-examination: ${step.title}`;
      appointment.status = 'confirmed';
      appointment.updated_at = new Date();
      appointment.is_re_examination = true;
      appointment.re_examination_step_id = step._id;
      
      // Cập nhật metadata để dễ tìm kiếm sau này
      appointment.metadata = {
        ...appointment.metadata,
        consultation_id: consultationId,
        step_number: parseInt(stepNumber),
        step_title: step.title,
        updated_by: 'doctor',
        updated_at: new Date()
      };
      
      await appointment.save();
      
    } else {
      // TẠO MỚI lịch hẹn
      console.log('🆕 Creating new appointment');
      appointment = await createNewAppointment();
    }
    
    async function createNewAppointment() {
      const newAppointment = new Appointment({
        user_id: medicalRecord.user_id,
        doctor_id: doctor._id,
        appointment_date: appointmentDate,
        time_slot: timeSlot || '09:00',
        status: 'pending',
        reason: `Re-examination: ${step.title}`,
        notes: notes || 'Physical assessment',
        is_re_examination: true,
        re_examination_step_id: step._id,
        metadata: {
          consultation_id: consultationId,
          step_number: parseInt(stepNumber),
          step_title: step.title,
          created_by: 'doctor',
          created_at: new Date()
        }
      });
      await newAppointment.save();
      return newAppointment;
    }
    // ========== KẾT THÚC PHẦN QUAN TRỌNG ==========
    
    // Cập nhật step
    step.status = 'scheduled';
    step.reExaminationScheduled = true;
    step.reExaminationDate = appointmentDate;
    step.reExaminationTime = timeSlot || '09:00';
    step.reExaminationAppointmentId = appointment._id;
    step.needsReExamination = false; // Đã lập lịch xong
    step.reExaminationNotes = notes;
    
    // Đánh dấu consultation có follow-up nếu cần
    if (!medicalRecord.next_appointment || medicalRecord.next_appointment < appointmentDate) {
      medicalRecord.next_appointment = appointmentDate;
    }
    
    await medicalRecord.save();
    
    // Gửi thông báo cho bệnh nhân
    try {
      const patient = await User.findById(medicalRecord.user_id);
      const doctorUser = await User.findById(doctor.user_id);
      
      if (patient) {
        const isUpdate = step.reExaminationScheduled && step.reExaminationAppointmentId;
        
        await notificationService.sendNotification({
          user_id: patient._id.toString(),
          title: isUpdate ? 'Appointment Rescheduled' : 'Re-examination Scheduled',
          message: isUpdate 
            ? `Dr. ${doctorUser?.name || 'Doctor'} has rescheduled your re-examination to ${appointmentDate.toLocaleDateString()} at ${timeSlot}.`
            : `Dr. ${doctorUser?.name || 'Doctor'} has scheduled a re-examination for ${appointmentDate.toLocaleDateString()} at ${timeSlot}.`,
          template_key: 're_examination_scheduled',
          variables: {
            doctor_name: doctorUser?.name || 'Doctor',
            appointment_date: appointmentDate.toLocaleDateString(),
            appointment_time: timeSlot,
            step_title: step.title
          },
          type: 'appointment',
          category: 'info',
          priority: 'high',
          related_record: appointment._id,
          related_record_type: 'appointment',
          action_url: `/appointments/${appointment._id}`,
          action_label: 'View Appointment'
        });
      }
    } catch (err) {
      console.error('Notification error:', err);
    }
    
    res.status(200).json({
      success: true,
      message: step.reExaminationScheduled ? 'Re-examination rescheduled successfully' : 'Re-examination scheduled successfully',
      data: {
        appointment: appointment,
        step: step,
        action: appointment ? 'updated' : 'created'
      }
    });
  } catch (error: any) {
    console.error('Error scheduling re-examination:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
};


const getAlternativeTimeSlots = async (doctorId: string, date: Date): Promise<string[]> => {
  const start = new Date(date);
  start.setHours(0,0,0,0);
  const end = new Date(date);
  end.setHours(23,59,59,999);

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

export const confirmReExaminationArrival = async (req: Request, res: Response) => {
  try {
    const { consultationId, stepNumber } = req.params;
    
    const medicalRecord = await MedicalRecord.findById(consultationId);
    if (!medicalRecord) {
      return res.status(404).json({ success: false, message: 'Medical record not found' });
    }
    
    const step = medicalRecord.treatment_plan.find(s => s.stepNumber === parseInt(stepNumber));
    if (!step) {
      return res.status(404).json({ success: false, message: 'Step not found' });
    }
    
    if (!step.reExaminationScheduled) {
      return res.status(400).json({ success: false, message: 'Re-examination not scheduled' });
    }
    
    // Check if appointment is today
    const appointmentDate = new Date(step.reExaminationDate);
    const today = new Date();
    
    if (appointmentDate.toDateString() !== today.toDateString()) {
      return res.status(400).json({ 
        success: false, 
        message: 'Can only confirm arrival on scheduled date' 
      });
    }
    
    // Update step status
    step.status = 'in-progress';
    step.arrivalConfirmed = true;
    step.arrivalConfirmedAt = new Date();
    
    // Update appointment status
    if (step.reExaminationAppointmentId) {
      await Appointment.findByIdAndUpdate(
        step.reExaminationAppointmentId,
        { 
          status: 'in_progress',
          check_in_time: new Date()
        }
      );
    }
    
    await medicalRecord.save();
    
    res.status(200).json({
      success: true,
      message: 'Arrival confirmed, re-examination started',
      data: medicalRecord
    });
    
  } catch (error) {
    console.error('Error confirming arrival:', error);
    res.status(500).json({ success: false, message: 'Error confirming arrival' });
  }
};


export const getAvailableSlots = async (req: Request, res: Response) => {
  try {
    const { date } = req.query;
    
    console.log('✅ Available slots requested for date:', date);
    
    // Return all slots for now (simplest fix)
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