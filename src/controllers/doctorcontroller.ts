import { Request, Response } from 'express';
import mongoose from 'mongoose';
import Doctor from '../models/doctor';
import User from '../models/user';
import Appointment from '../models/appointment';
import MedicalRecord from '../models/medicalRecord';
import Notification from '../models/notification';
import Messeage from '../models/message';
import Conversation from '../models/conversation';
import path from 'path';
import fs from 'fs';
import Drug from '../models/drug';


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
    const stepData = req.body;

    console.log('=== ADD TREATMENT STEP ===');
    console.log('Consultation ID:', consultationId);
    console.log('Step data:', stepData);

    const medicalRecord = await MedicalRecord.findById(consultationId);
    if (!medicalRecord) {
      return res.status(404).json({ success: false, message: 'Medical record not found' });
    }

    const newStep = {
      stepNumber: medicalRecord.treatment_plan.length + 1,
      ...stepData,
      status: 'pending'
    };

    medicalRecord.treatment_plan.push(newStep);
    await medicalRecord.save();

    res.json({ success: true, data: medicalRecord });
  } catch (error) {
    console.error('Error adding treatment step:', error);
    res.status(500).json({ success: false, message: 'Error adding treatment step' });
  }
};

// Approve treatment step
export const approveTreatmentStep = async (req: Request, res: Response) => {
  try {
    const { consultationId, stepNumber } = req.params;
    const stepNum = parseInt(stepNumber);

    console.log('=== APPROVE TREATMENT STEP ===');
    console.log('Consultation ID:', consultationId);
    console.log('Step number:', stepNum);

    const medicalRecord = await MedicalRecord.findById(consultationId);
    if (!medicalRecord) {
      return res.status(404).json({ success: false, message: 'Medical record not found' });
    }

    const step = medicalRecord.treatment_plan.find(s => s.stepNumber === stepNum);
    if (!step) {
      return res.status(404).json({ success: false, message: 'Step not found' });
    }

    // CHỈ CHO PHÉP approve steps có status là 'completed' (đã được patient hoàn thành)
    if (step.status !== 'completed') {
      return res.status(400).json({ 
        success: false, 
        message: 'Cannot approve step that is not completed by patient' 
      });
    }

    step.status = 'approved';
    
    // KIỂM TRA: Có phải step cuối cùng không?
    const isLastStep = stepNum === medicalRecord.treatment_plan.length;
    
    // KIỂM TRA: Tất cả steps đã được approved chưa?
    const allStepsApproved = medicalRecord.treatment_plan.every(s => 
      s.status === 'approved'
    );

    console.log('🔍 Step approval check:', {
      isLastStep,
      allStepsApproved,
      totalSteps: medicalRecord.treatment_plan.length,
      approvedSteps: medicalRecord.treatment_plan.filter(s => s.status === 'approved').length
    });

    // CHỈ hoàn thành consultation khi TẤT CẢ steps đã approved
    if (isLastStep && allStepsApproved) {
      // TỰ ĐỘNG HOÀN THÀNH CONSULTATION
      medicalRecord.consultation_status = 'completed';
      medicalRecord.status = 'resolved';
      medicalRecord.updated_at = new Date();
      
      console.log('🎉 All steps approved - Consultation auto-completed');
    } else {
      // Kích hoạt step tiếp theo nếu có
      const nextStep = medicalRecord.treatment_plan.find(s => s.stepNumber === stepNum + 1);
      if (nextStep && nextStep.status === 'pending') {
        nextStep.status = 'in-progress';
        console.log('🔄 Activated next step:', nextStep.stepNumber);
      }
    }

    await medicalRecord.save();

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

    console.log('=== COMPLETE CONSULTATION ===');
    console.log('Consultation ID:', consultationId);

    const medicalRecord = await MedicalRecord.findByIdAndUpdate(
      consultationId,
      { 
        consultation_status: 'completed',
        status: 'resolved',
        updated_at: new Date()
      },
      { new: true }
    );

    if (!medicalRecord) {
      return res.status(404).json({ success: false, message: 'Medical record not found' });
    }

    res.json({ success: true, data: medicalRecord });
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
    if (!doctorId) {
      return res.status(400).json({ success: false, message: 'Doctor ID is required' });
    }
    
    const limit = parseInt(req.query.limit as string) || 10;
    
    // Get recent medical records for this doctor
    const recentRecords = await MedicalRecord.find({ 
      $or: [
        { doctor_id: doctorId }
      ]
    })
      .populate('user_id', 'name email phoneNumber dateOfBirth gender bloodGroup allergies')
      .sort({ created_at: -1 })
      .limit(limit);
    
    const patients = recentRecords.map((record: any) => record.user_id).filter(Boolean);
    
    // Remove duplicates by _id
    const uniquePatients = patients.filter((patient: any, index: number, self: any[]) =>
      index === self.findIndex((p: any) => 
        p && patient && p._id.toString() === patient._id.toString()
      )
    );
    
    res.status(200).json({ success: true, data: uniquePatients });
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


// controllers/doctorController.ts - Sửa hàm uploadDoctorAvatar
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
    
    // CHỈ LƯU TÊN FILE vào database (không lưu đường dẫn API)
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
    console.log('Search:', search);
    console.log('Page:', page, 'Limit:', limit);

    if (!doctorId) {
      return res.status(400).json({ success: false, message: 'Doctor ID is required' });
    }

    // Build match query for medical records
    let matchQuery: any = { doctor_id: doctorId };
    
    // If search provided, add patient name search
    if (search) {
      const patients = await User.find({
        name: { $regex: search, $options: 'i' },
        role: 'patient'
      }).select('_id');
      
      const patientIds = patients.map(p => p._id);
      matchQuery.user_id = { $in: patientIds };
    }

    // Get unique patients from medical records
    const patientsPipeline: any[] = [
      { $match: matchQuery },
      { $group: { _id: '$user_id' } },
      { $skip: (Number(page) - 1) * Number(limit) },
      { $limit: Number(limit) }
    ];

    const patientRecords = await MedicalRecord.aggregate(patientsPipeline);
    
    const patientIds = patientRecords.map(record => record._id);
    
    // Get patient details
    const patients = await User.find({ 
      _id: { $in: patientIds } 
    })
      .select('name email phoneNumber dateOfBirth gender bloodGroup allergies')
      .lean();

    // Get total count for pagination
    const totalCountPipeline: any[] = [
      { $match: matchQuery },
      { $group: { _id: '$user_id' } },
      { $count: 'total' }
    ];

    const totalResult = await MedicalRecord.aggregate(totalCountPipeline);
    const total = totalResult.length > 0 ? totalResult[0].total : 0;

    res.status(200).json({ 
      success: true, 
      data: patients,
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
      .populate('category_id', 'name')
      .sort({ created_at: -1 });
    res.status(200).json({ success: true, data: drugs });
  } catch (error) {
    console.error('Error fetching drugs:', error);
    res.status(500).json({ success: false, message: 'Error fetching drugs' });
  }
};


