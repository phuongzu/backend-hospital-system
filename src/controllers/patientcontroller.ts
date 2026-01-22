import { Request, Response } from 'express';
import mongoose from 'mongoose';
import Doctor from '../models/doctor';
import Appointment from '../models/appointment';
import User from '../models/user';
import MedicalRecord from '../models/medicalRecord';
import { AuthRequest } from '../middlewares/authmiddleware';
import Review from '../models/review';
import UserInfo from '../models/UserInfor';
import { notificationService } from '../utils/notificationService'; // THÊM IMPORT
import { emailService } from '../utils/emailService'; // THÊM IMPORT
import { smsService } from '../utils/smsService'; // THÊM IMPORT
import multer from 'multer';
import path from 'path';
import fs from 'fs';

const uploadDir = path.join(__dirname, '..', 'uploads', 'avatars');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const userId = (req as any).user?._id;
    const timestamp = Date.now();
    const originalExt = path.extname(file.originalname);
    
    const simpleFilename = `avatar_${userId}_${timestamp}${originalExt}`;
    cb(null, simpleFilename);
  }
});


const upload = multer({ 
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      cb(null, true);
    } else {
      cb(new Error('Chỉ chấp nhận file ảnh (jpeg, jpg, png, gif, webp)'));
    }
  }
});


const handleError = (res, error, message = 'Internal server error') => {
  console.error(`${message}:`, error);
  res.status(500).json({ 
    success: false,
    message,
    error: process.env.NODE_ENV === 'development' ? error.message : undefined
  });
};

// ========== HELPER FUNCTIONS ==========

// Get alternative time slots
const getAlternativeTimeSlots = async (doctorId: string, date: Date): Promise<string[]> => {
  try {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    // FIX: Lấy tất cả các appointment đã đặt trong ngày
    const bookedAppointments = await Appointment.find({
      doctor_id: doctorId,
      appointment_date: { $gte: startOfDay, $lte: endOfDay },
      status: { $in: ['pending', 'confirmed', 'in_progress'] }
    }).select('time_slot');

    const bookedSlots = bookedAppointments.map(app => app.time_slot);
    
    // Tất cả các time slot có sẵn
    const allTimeSlots = [
      '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
      '14:00', '14:30', '15:00', '15:30', '16:00', '16:30'
    ];

    // Lọc ra các slot chưa được đặt
    return allTimeSlots.filter(slot => !bookedSlots.includes(slot));
  } catch (error) {
    console.error('Error getting alternative slots:', error);
    return [];
  }
};
// Calculate end time based on start time and duration
const calculateEndTime = (startTime: string, durationMinutes: number): string => {
  const [hours, minutes] = startTime.split(':').map(Number);
  const startDate = new Date();
  startDate.setHours(hours, minutes, 0, 0);
  
  const endDate = new Date(startDate.getTime() + durationMinutes * 60000);
  
  const endHours = endDate.getHours().toString().padStart(2, '0');
  const endMinutes = endDate.getMinutes().toString().padStart(2, '0');
  
  return `${endHours}:${endMinutes}`;
};

// Determine urgency based on symptoms and reason
const determineUrgency = (symptoms: string[], reason: string): string => {
  const urgentKeywords = ['emergency', 'severe', 'pain', 'bleeding', 'fever', 'chest pain', 'shortness of breath'];
  const reasonLower = reason.toLowerCase();
  
  if (urgentKeywords.some(keyword => reasonLower.includes(keyword))) {
    return 'high';
  }
  
  if (symptoms && symptoms.length > 0) {
    const symptomText = symptoms.join(' ').toLowerCase();
    if (urgentKeywords.some(keyword => symptomText.includes(keyword))) {
      return 'medium';
    }
  }
  
  return 'low';
};

// Determine priority for medical record
const determinePriority = (symptoms: string[], reason: string): string => {
  const urgency = determineUrgency(symptoms, reason);
  
  switch (urgency) {
    case 'high':
      return 'urgent';
    case 'medium':
      return 'high';
    default:
      return 'medium';
  }
};

// Get preparation instructions based on specialty
const getPreparationInstructions = (specialtyId?: string): string => {
  const instructions: Record<string, string> = {
    'cardiology': 'Please bring any previous ECG or echocardiogram reports. Avoid caffeine 24 hours before appointment.',
    'gastroenterology': 'Come fasting for at least 8 hours before your appointment.',
    'neurology': 'Bring any previous MRI or CT scan reports. List all current medications.',
    'orthopedics': 'Wear comfortable clothing. Bring any X-ray or MRI reports.',
    'dermatology': 'Do not apply creams or lotions to the affected area before appointment.',
    'default': 'Bring your ID and insurance card. Arrive 15 minutes early to complete paperwork.'
  };

  // In real implementation, you would map specialtyId to specialty name
  return instructions[specialtyId || 'default'];
};

// ========== CONTROLLER FUNCTIONS ==========

// Fixed Emergency Contact Update
export const updateEmergencyContact = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ 
        success: false,
        message: 'Authentication required' 
      });
      return;
    }

    const { name, relationship, phone, email } = req.body;

    // Validate required fields
    if (!name || !phone) {
      res.status(400).json({ 
        success: false,
        message: 'Emergency contact name and phone are required' 
      });
      return;
    }

    // Validate phone format (basic validation)
    const phoneRegex = /^[\+]?[1-9][\d]{0,15}$/;
    if (!phoneRegex.test(phone.replace(/[\s\-\(\)]/g, ''))) {
      res.status(400).json({
        success: false,
        message: 'Please provide a valid phone number'
      });
      return;
    }

    let userInfo = await UserInfo.findOne({ user_id: req.user._id });
    
    const emergencyContactData = {
      name: name.trim(),
      relationship: relationship?.trim() || 'Family',
      phone: phone.trim(),
      email: email?.trim() || ''
    };

    if (!userInfo) {
      // Create new UserInfo if not exists
      userInfo = new UserInfo({ 
        user_id: req.user._id,
        emergency_contact: emergencyContactData,
        blood_type: '',
        allergist: '',
        current_medications: [],
        height: 0,
        weight: 0,
        chronic_diseases: [],
        BMI: 0
      });
    } else {
      // Update emergency contact
      userInfo.emergency_contact = emergencyContactData;
    }

    await userInfo.save();

    res.status(200).json({
      success: true,
      message: 'Emergency contact updated successfully',
      data: userInfo.getSummary()
    });
  } catch (error) {
    handleError(res, error, 'Error updating emergency contact');
  }
};

export const postEmergencyContact = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
      return;
    }
    const { name, relationship, phone, email } = req.body;
    if (!name || !phone) {
      res.status(400).json({
        success: false,
        message: 'Emergency contact name and phone are required'
      });
      return;
    }
    const emergencyContactData = {
      name: name.trim(),
      relationship: relationship?.trim() || 'Family',
      phone: phone.trim(),
      email: email?.trim() || ''
    };
    let userInfo = await UserInfo.findOne({ user_id: req.user._id });
    if (!userInfo) {
      userInfo = new UserInfo({
        user_id: req.user._id,
        emergency_contact: emergencyContactData,
        blood_type: '',
        allergist: '',
        current_medications: [],
        height: 0,
        weight: 0,
        chronic_diseases: [],
        BMI: 0
      });
    } else {
      userInfo.emergency_contact = emergencyContactData;
    }
    await userInfo.save();
    res.status(200).json({
      success: true,
      message: 'Emergency contact added successfully',
      data: userInfo.getSummary()
    });
  } catch (error) {
    handleError(res, error, 'Error adding emergency contact');
  }
};

// Fixed Medications Update
export const updateMedications = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ 
        success: false,
        message: 'Authentication required' 
      });
      return;
    }

    const { medications, allergies, current_medications } = req.body;

    let userInfo = await UserInfo.findOne({ user_id: req.user._id });
    
    if (!userInfo) {
      // Create new UserInfo if not exists
      userInfo = new UserInfo({ 
        user_id: req.user._id,
        current_medications: current_medications || [],
        allergist: allergies || '',
        blood_type: '',
        height: 0,
        weight: 0,
        chronic_diseases: [],
        BMI: 0,
        emergency_contact: {
          name: '',
          relationship: 'Family',
          phone: '',
          email: ''
        }
      });
    } else {
      // Update medications and allergies
      if (current_medications !== undefined) {
        userInfo.current_medications = Array.isArray(current_medications) 
          ? current_medications 
          : [];
      }
      if (allergies !== undefined) {
        userInfo.allergist = allergies;
      }
    }

    await userInfo.save();

    // Also update the User model if medications/allergies are provided
    if (medications !== undefined || allergies !== undefined) {
      const userUpdate = {};
      if (medications !== undefined) userUpdate.medications = medications;
      if (allergies !== undefined) userUpdate.allergies = allergies;
      
      await User.findByIdAndUpdate(req.user._id, userUpdate);
    }

    res.status(200).json({
      success: true,
      message: 'Medications and allergies updated successfully',
      data: userInfo.getSummary()
    });
  } catch (error) {
    handleError(res, error, 'Error updating medications');
  }
};

// Fixed Add Medication
export const addMedication = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ 
        success: false,
        message: 'Authentication required' 
      });
      return;
    }

    const { name, dosage, frequency, start_date, reason, prescribed_by } = req.body;

    if (!name) {
      res.status(400).json({ 
        success: false,
        message: 'Medication name is required' 
      });
      return;
    }

    let userInfo = await UserInfo.findOne({ user_id: req.user._id });
    
    if (!userInfo) {
      userInfo = new UserInfo({ 
        user_id: req.user._id,
        current_medications: [],
        blood_type: '',
        allergist: '',
        height: 0,
        weight: 0,
        chronic_diseases: [],
        BMI: 0,
        emergency_contact: {
          name: '',
          relationship: 'Family',
          phone: '',
          email: ''
        }
      });
    }

    const newMedication = {
      name: name.trim(),
      dosage: dosage?.trim() || '',
      frequency: frequency?.trim() || '',
      start_date: start_date ? new Date(start_date) : new Date(),
      reason: reason?.trim() || '',
      prescribed_by: prescribed_by?.trim() || ''
    };

    // Add to current medications array
    userInfo.current_medications.push(newMedication);
    await userInfo.save();

    res.status(200).json({
      success: true,
      message: 'Medication added successfully',
      data: userInfo.getSummary()
    });
  } catch (error) {
    handleError(res, error, 'Error adding medication');
  }
};

// Fixed Remove Medication
export const removeMedication = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ 
        success: false,
        message: 'Authentication required' 
      });
      return;
    }

    const { medication_id } = req.body;

    if (!medication_id) {
      res.status(400).json({ 
        success: false,
        message: 'Medication ID is required' 
      });
      return;
    }

    const userInfo = await UserInfo.findOne({ user_id: req.user._id });
    
    if (!userInfo) {
      res.status(404).json({ 
        success: false,
        message: 'User information not found' 
      });
      return;
    }

    // Remove medication by ID
    const initialLength = userInfo.current_medications.length;
    userInfo.current_medications = userInfo.current_medications.filter(
      med => med._id.toString() !== medication_id
    );

    if (userInfo.current_medications.length === initialLength) {
      res.status(404).json({ 
        success: false,
        message: 'Medication not found' 
      });
      return;
    }

    await userInfo.save();

    res.status(200).json({
      success: true,
      message: 'Medication removed successfully',
      data: userInfo.getSummary()
    });
  } catch (error) {
    handleError(res, error, 'Error removing medication');
  }
};

// Fixed Get Patient Info
export const getPatientInfo = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ 
        success: false,
        message: 'Authentication required' 
      });
      return;
    }

    const userInfo = await UserInfo.findOne({ user_id: req.user._id });
    
    if (!userInfo) {
      // Return default structure if no user info found
      res.status(200).json({
        success: true,
        data: {
          emergency_contact: {
            name: '',
            relationship: 'Family',
            phone: '',
            email: ''
          },
          blood_type: '',
          allergist: '',
          current_medications: [],
          height: 0,
          weight: 0,
          chronic_diseases: [],
          BMI: 0
        }
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: userInfo.getSummary()
    });
  } catch (error) {
    handleError(res, error, 'Error fetching patient info');
  }
};

// Fixed Update Patient Info
export const updatePatientInfo = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ 
        success: false,
        message: 'Authentication required' 
      });
      return;
    }

    const newInfo = req.body || {};
    const allowedFields = [
      'emergency_contact', 'blood_type', 'allergist',
      'current_medications', 'height', 'weight', 'chronic_diseases'
    ];

    const updateData = {};
    allowedFields.forEach(field => {
      if (newInfo[field] !== undefined) {
        updateData[field] = newInfo[field];
      }
    });

    let userInfo = await UserInfo.findOne({ user_id: req.user._id });
    
    if (!userInfo) {
      // Create new UserInfo if not exists
      userInfo = new UserInfo({ 
        user_id: req.user._id, 
        ...updateData,
        // Ensure required fields have defaults
        emergency_contact: updateData.emergency_contact || {
          name: '',
          relationship: 'Family',
          phone: '',
          email: ''
        },
        current_medications: updateData.current_medications || [],
        chronic_diseases: updateData.chronic_diseases || [],
        blood_type: updateData.blood_type || '',
        allergist: updateData.allergist || '',
        height: updateData.height || 0,
        weight: updateData.weight || 0,
        BMI: 0
      });
    } else {
      // Update existing UserInfo
      Object.keys(updateData).forEach(key => {
        userInfo[key] = updateData[key];
      });
    }

    userInfo.calculateBMI();
    await userInfo.save();

    res.status(200).json({
      success: true,
      message: 'User information updated successfully',
      data: userInfo.getSummary()
    });
  } catch (error) {
    handleError(res, error, 'Error updating patient info');
  }
};

// Fixed Edit Patient Info
export const editInfoPatient = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ 
        success: false,
        message: 'Authentication required' 
      });
      return;
    }

    const { emergency_contact, blood_type, allergist, current_medications, height, weight, chronic_diseases } = req.body;

    const userInfo = await UserInfo.findOne({ user_id: req.user._id });
    
    if (!userInfo) {
      // Create new if not exists
      const newUserInfo = new UserInfo({
        user_id: req.user._id,
        emergency_contact: emergency_contact || {
          name: '',
          relationship: 'Family',
          phone: '',
          email: ''
        },
        blood_type: blood_type || '',
        allergist: allergist || '',
        current_medications: current_medications || [],
        height: height || 0,
        weight: weight || 0,
        chronic_diseases: chronic_diseases || [],
        BMI: 0
      });
      
      newUserInfo.calculateBMI();
      await newUserInfo.save();

      res.status(200).json({
        success: true,
        message: 'User information created successfully',
        data: newUserInfo.getSummary()
      });
      return;
    }

    // Update existing
    if (emergency_contact !== undefined) userInfo.emergency_contact = emergency_contact;
    if (blood_type !== undefined) userInfo.blood_type = blood_type;
    if (allergist !== undefined) userInfo.allergist = allergist;
    if (current_medications !== undefined) userInfo.current_medications = current_medications;
    if (height !== undefined) userInfo.height = height;
    if (weight !== undefined) userInfo.weight = weight;
    if (chronic_diseases !== undefined) userInfo.chronic_diseases = chronic_diseases;

    userInfo.calculateBMI();
    await userInfo.save();

    res.status(200).json({
      success: true,
      message: 'User information updated successfully',
      data: userInfo.getSummary()
    });
  } catch (error) {
    handleError(res, error, 'Error editing patient info');
  }
};

// Utility function for BMI calculation
export const calculateBMI = (height: number, weight: number): number => {
  if (height > 0 && weight > 0) {
    const heightInMeters = height / 100;
    return parseFloat((weight / (heightInMeters * heightInMeters)).toFixed(2));
  }
  return 0;
};

export const getAppointmentAvailability = async (req: Request, res: Response) => {
  try {
    const { doctor_id, date } = req.query;
    
    if (!doctor_id || !date) {
      return res.status(400).json({ message: 'Doctor ID and date are required' });
    }
    
    if (!mongoose.Types.ObjectId.isValid(doctor_id as string)) {
      return res.status(400).json({ message: 'Invalid doctor ID format' });
    }

    const appointmentDate = new Date(date as string);
    const startOfDay = new Date(appointmentDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(appointmentDate);
    endOfDay.setHours(23, 59, 59, 999);

    // FIX: Lấy tất cả appointments trong ngày
    const existingAppointments = await Appointment.find({
      doctor_id,
      appointment_date: { $gte: startOfDay, $lte: endOfDay },
      status: { $in: ['pending', 'confirmed', 'in_progress'] }
    });

    const allTimeSlots = [
      '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
      '14:00', '14:30', '15:00', '15:30', '16:00', '16:30'
    ];

    const bookedSlots = existingAppointments.map(app => app.time_slot);
    
    // Tạo response chi tiết
    const availableSlots = allTimeSlots.map(slot => {
      const isBooked = bookedSlots.includes(slot);
      const bookedAppointment = existingAppointments.find(app => app.time_slot === slot);
      
      return {
        time: slot,
        isAvailable: !isBooked,
        isReserved: false, // Có thể thêm logic reservation
        bookedInfo: isBooked ? {
          appointment_id: bookedAppointment?._id,
          patient_id: bookedAppointment?.user_id,
          status: bookedAppointment?.status
        } : null
      };
    });

    // Kiểm tra số lượng slot còn trống
    const availableCount = availableSlots.filter(slot => slot.isAvailable).length;
    
    res.json({ 
      date: appointmentDate.toISOString().split('T')[0],
      availableSlots,
      summary: {
        totalSlots: allTimeSlots.length,
        bookedSlots: bookedSlots.length,
        availableCount: availableCount,
        isFullyBooked: availableCount === 0
      },
      doctor: {
        id: doctor_id
      }
    });
  } catch (error) {
    console.error('Error fetching appointment availability:', error);
    res.status(500).json({ message: 'Error fetching availability', error });
  }
};

export const bookAppointment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { 
      doctor_id, 
      specialty_id, 
      appointment_date, 
      time_slot, 
      reason, 
      notes,
      symptoms,
      preferred_language,
      insurance_info,
      emergency_contact_required 
    } = req.body;
    
    const user_id = req.user?._id;
    const user_name = req.user?.name;
    const user_email = req.user?.email;
    const user_phone = req.user?.phoneNumber;

    console.log('=== BOOK APPOINTMENT ===');
    console.log('Request from user:', { user_id, user_name, user_email });
    console.log('Appointment details:', { 
      doctor_id, 
      appointment_date, 
      time_slot, 
      reason 
    });

    // Validate required fields
    if (!doctor_id || !appointment_date || !time_slot) {
      res.status(400).json({ 
        success: false,
        message: 'Doctor ID, appointment date, and time slot are required',
        required_fields: ['doctor_id', 'appointment_date', 'time_slot']
      });
      return;
    }

    // Validate date format
    const appointmentDate = new Date(appointment_date);
    if (isNaN(appointmentDate.getTime())) {
      res.status(400).json({ 
        success: false,
        message: 'Invalid appointment date format'
      });
      return;
    }

    // Check if appointment date is in the future
    const now = new Date();
    if (appointmentDate <= now) {
      res.status(400).json({ 
        success: false,
        message: 'Appointment date must be in the future'
      });
      return;
    }

    // Check if doctor exists and is available
    const doctor = await Doctor.findById(doctor_id)
      .populate('user_id', 'name email phoneNumber status')
      .populate('specialty_id', 'name description');

    if (!doctor) {
      res.status(404).json({ 
        success: false,
        message: 'Doctor not found' 
      });
      return;
    }

    // Check if doctor is available (status working)
    if (doctor.user_id?.status !== 'working') {
      res.status(400).json({ 
        success: false,
        message: `Doctor is currently ${doctor.user_id?.status}. Please choose another doctor.`
      });
      return;
    }

    // Check if doctor is available for appointments
    if (doctor.isAvailable === false) {
      res.status(400).json({ 
        success: false,
        message: 'Doctor is not accepting new appointments at this time'
      });
      return;
    }
    const existingAppointment = await Appointment.findOne({
      doctor_id,
      appointment_date: appointmentDate,
      time_slot,
      status: { $in: ['pending', 'confirmed'] }
    });

    if (existingAppointment) {
      res.status(409).json({ 
        success: false,
        message: 'Time slot not available',
        data: {
          conflict: true,
          suggested_slots: await getAlternativeTimeSlots(doctor_id, appointmentDate)
        }
      });
      return;
    }

    // Calculate appointment end time (default 30 minutes)
    const appointmentEndTime = calculateEndTime(time_slot, 30); // SỬA: gọi hàm trực tiếp

    // Create new appointment
    const appointment = new Appointment({
      doctor_id,
      user_id,
      specialty_id: specialty_id || doctor.specialty_id,
      appointment_date: appointmentDate,
      time_slot,
      appointment_end_time: appointmentEndTime,
      reason: reason || 'General consultation',
      notes: notes || '',
      symptoms: symptoms || [],
      preferred_language: preferred_language || 'en',
      insurance_info: insurance_info || {},
      emergency_contact_required: emergency_contact_required || false,
      status: 'pending',
      is_re_examination: false,
      re_examination_step_id: null,
      created_at: new Date(),
      metadata: {
        booked_via: 'patient_portal',
        user_agent: req.headers['user-agent'],
        ip_address: req.ip
      }
    });


    await appointment.save();

    // Populate appointment data
    const populatedAppointment = await Appointment.findById(appointment._id)
      .populate('doctor_id', 'name email phoneNumber specialty_id consultation_fee')
      .populate('user_id', 'name email phoneNumber dateOfBirth gender')
      .populate('specialty_id', 'name description');

    // ========== GỬI THÔNG BÁO CHO BỆNH NHÂN ==========
    try {
      await notificationService.sendNotification({
        user_id: user_id.toString(),
        template_key: 'appointment_booked',
        variables: {
          doctor_name: doctor.user_id?.name || 'Doctor',
          appointment_date: appointmentDate.toLocaleDateString(),
          appointment_time: time_slot,
          specialty: doctor.specialty_id?.name || 'General Medicine'
        },
        type: 'appointment',
        category: 'success',
        priority: 'medium',
        related_record: appointment._id.toString(),
        related_record_type: 'appointment',
        data: {
          appointment: {
            id: appointment._id.toString(),
            date: appointmentDate.toISOString(),
            time: time_slot,
            reason: reason,
            status: 'pending'
          },
          doctor: {
            name: doctor.user_id?.name,
            specialty: doctor.specialty_id?.name,
            consultation_fee: doctor.consultation_fee
          },
          patient: {
            name: user_name,
            email: user_email
          }
        },
        channels: ['in_app', 'email', 'sms'],
        action_url: `/appointments/${appointment._id}`,
        action_label: 'View Appointment Details'
      });

      console.log('✅ Appointment booking notification sent to patient');
    } catch (patientNotifError) {
      console.error('❌ Error sending patient notification:', patientNotifError);
    }

    // ========== GỬI THÔNG BÁO CHO BÁC SĨ ==========
    try {
      const doctorUserId = doctor.user_id?._id;
      if (doctorUserId) {
        await notificationService.sendNotification({
          user_id: doctorUserId.toString(),
          template_key: 'new_appointment_request',
          variables: {
            patient_name: user_name || 'Patient',
            appointment_date: appointmentDate.toLocaleDateString(),
            appointment_time: time_slot,
            reason: reason || 'General consultation'
          },
          type: 'appointment',
          category: 'info',
          priority: 'medium',
          related_record: appointment._id.toString(),
          related_record_type: 'appointment',
          data: {
            appointment: {
              id: appointment._id.toString(),
              date: appointmentDate.toISOString(),
              time: time_slot,
              reason: reason,
              symptoms: symptoms
            },
            patient: {
              name: user_name,
              email: user_email,
              phone: user_phone
            },
            urgency: determineUrgency(symptoms, reason)
          },
          channels: ['in_app', 'email'],
          action_url: `/doctor/appointments/${appointment._id}`,
          action_label: 'Review Appointment'
        });

        console.log('✅ Appointment request notification sent to doctor');
      }
    } catch (doctorNotifError) {
      console.error('❌ Error sending doctor notification:', doctorNotifError);
    }

    // ========== GỬI EMAIL XÁC NHẬN ==========
    if (user_email) {
      try {
        await emailService.sendAppointmentConfirmationEmail(
          user_email,
          user_name || 'Patient',
          {
            appointment_id: appointment._id.toString(),
            doctor_name: doctor.user_id?.name || 'Doctor',
            doctor_specialty: doctor.specialty_id?.name || 'General Medicine',
            appointment_date: appointmentDate.toLocaleDateString(),
            appointment_time: time_slot,
            appointment_end_time: appointmentEndTime,
            location: 'Main Hospital - Room 101', // This would come from doctor profile
            consultation_fee: doctor.consultation_fee,
            preparation_instructions: getPreparationInstructions(specialty_id), // SỬA: gọi hàm trực tiếp
            cancellation_policy: 'Cancel at least 24 hours in advance to avoid fees.',
            contact_info: 'Call 123-456-7890 for assistance'
          }
        );

        console.log(`✅ Appointment confirmation email sent to ${user_email}`);
      } catch (emailError) {
        console.error('❌ Error sending confirmation email:', emailError);
      }
    }

    // ========== GỬI SMS REMINDER (nếu có số điện thoại) ==========
    if (user_phone && smsService.isAvailable()) {
      try {
        // Schedule reminder for 1 day before appointment
        const reminderDate = new Date(appointmentDate);
        reminderDate.setDate(reminderDate.getDate() - 1);

        await notificationService.sendNotification({
          user_id: user_id.toString(),
          title: 'Appointment Reminder',
          message: `Reminder: Your appointment with Dr. ${doctor.user_id?.name} is tomorrow at ${time_slot}.`,
          type: 'reminder',
          category: 'info',
          priority: 'medium',
          scheduled_time: reminderDate,
          channels: ['sms', 'push'],
          data: {
            appointment_id: appointment._id.toString(),
            appointment_time: time_slot,
            doctor_name: doctor.user_id?.name
          }
        });

        console.log('✅ SMS reminder scheduled');
      } catch (smsError) {
        console.error('❌ Error scheduling SMS reminder:', smsError);
      }
    }

    // ========== TẠO MEDICAL RECORD PLACEHOLDER ==========
    try {
      const medicalRecord = new MedicalRecord({
        appointment_id: appointment._id,
        user_id: user_id,
        doctor_id: doctor_id,
        consultation_status: 'scheduled',
        status: 'pending',
        symptoms: symptoms || [],
        reason: reason,
        notes: `Appointment scheduled for ${appointmentDate.toLocaleDateString()} at ${time_slot}`,
        priority: determinePriority(symptoms, reason), // SỬA: gọi hàm trực tiếp
        created_at: new Date()
      });

      await medicalRecord.save();
      console.log('✅ Medical record placeholder created');
    } catch (recordError) {
      console.error('❌ Error creating medical record:', recordError);
      // Continue even if medical record creation fails
    }

    // ========== UPDATE DOCTOR'S SCHEDULE ==========
    try {
      // This would update doctor's calendar/schedule
      // For now, just log the booking
      console.log(`📅 Doctor ${doctor.user_id?.name} now has appointment at ${time_slot} on ${appointmentDate.toLocaleDateString()}`);
    } catch (scheduleError) {
      console.error('❌ Error updating doctor schedule:', scheduleError);
    }

    // ========== LOG ACTIVITY ==========
    try {
      // Log booking activity
      const activityLog = {
        action: 'appointment_booked',
        user_id: user_id,
        description: `Appointment booked with Dr. ${doctor.user_id?.name} for ${appointmentDate.toLocaleDateString()} at ${time_slot}`,
        metadata: {
          appointment_id: appointment._id.toString(),
          doctor_id: doctor_id,
          time_slot: time_slot,
          reason: reason
        },
        timestamp: new Date()
      };

      // Save to activity log collection or database
      console.log('📝 Activity logged:', activityLog);
    } catch (logError) {
      console.error('❌ Error logging activity:', logError);
    }

    // ========== PREPARE RESPONSE ==========
    const responseData = {
      success: true,
      message: 'Appointment booked successfully',
      data: {
        appointment: {
          _id: appointment._id,
          appointment_date: appointment.appointment_date,
          time_slot: appointment.time_slot,
          appointment_end_time: appointment.appointment_end_time,
          reason: appointment.reason,
          status: appointment.status,
          created_at: appointment.created_at
        },
        doctor: {
          _id: doctor._id,
          name: doctor.user_id?.name,
          specialty: doctor.specialty_id?.name,
          consultation_fee: doctor.consultation_fee
        },
        patient: {
          _id: user_id,
          name: user_name,
          email: user_email
        },
        notifications: {
          patient_notified: true,
          doctor_notified: true,
          email_sent: !!user_email,
          sms_reminder_scheduled: !!user_phone
        },
        next_steps: [
          'Wait for doctor confirmation',
          'Arrive 15 minutes before appointment time',
          'Bring ID and insurance card',
          'Complete any pre-appointment forms if required'
        ]
      }
    };

    res.status(201).json(responseData);

  } catch (error: any) {
    console.error('❌ Error booking appointment:', error);
    
    // Send error notification to admin
    try {
      await notificationService.sendNotification({
        user_id: 'admin', // This would be actual admin ID
        title: 'Error Booking Appointment',
        message: `Error booking appointment: ${error.message}`,
        type: 'system',
        category: 'error',
        priority: 'high',
        data: {
          error: error.message,
          user_id: req.user?._id,
          timestamp: new Date().toISOString()
        }
      });
    } catch (notifError) {
      console.error('❌ Error sending error notification:', notifError);
    }

    // Handle specific error types
    if (error instanceof mongoose.Error.ValidationError) {
      res.status(400).json({ 
        success: false,
        message: 'Validation error',
        errors: error.errors 
      });
      return;
    }
    
    if (error.code === 11000) {
      res.status(409).json({ 
        success: false,
        message: 'Duplicate appointment detected'
      });
      return;
    }
    
    res.status(500).json({ 
      success: false,
      message: 'Error booking appointment',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Fixed Edit Reviews
export const updateReview = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const reviewId = req.params.review_id;
    const { rating, comment } = req.body;

    if (!reviewId || !rating) {
      res.status(400).json({ 
        success: false,
        message: 'Review ID and rating are required' 
      });
      return;
    }

    if (rating < 1 || rating > 5) {
      res.status(400).json({ 
        success: false,
        message: 'Rating must be between 1 and 5' 
      });
      return;
    }

    // Find and update review, ensuring it belongs to the user
    const review = await Review.findOneAndUpdate(
      { 
        _id: reviewId, 
        user_id: req.user?._id 
      },
      { 
        rating, 
        comment: comment || '',
        updated_at: new Date() 
      },
      { 
        new: true, 
        runValidators: true 
      }
    ).populate('user_id', 'name avatar')
     .populate('doctor_id', 'name specialty_id');

    if (!review) {
      res.status(404).json({ 
        success: false,
        message: 'Review not found or you do not have permission to edit this review' 
      });
      return;
    }

    res.status(200).json({
      success: true,
      message: 'Review updated successfully',
      review
    });
  } catch (error) {
    console.error('Error updating review:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error updating review', 
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

export const getAllDoctors = async (req: Request, res: Response) => {
  try {
    const doctors = await Doctor.find()
      .populate('user_id', 'name email phoneNumber')
      .populate('specialty_id', 'name description');
    
    res.json(doctors);
  } catch (error) {
    console.error('Error fetching doctors:', error);
    res.status(500).json({ message: 'Error fetching doctors', error });
  }
};

export const getAllMedicalRecordsForPatient = async (req: Request, res: Response) => {
  try {
    const userId = req.params.user_id;
    if (!userId) {
      return res.status(400).json({ message: 'Missing user_id parameter' });
    }

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: 'Invalid user ID format' });
    }

    const records = await MedicalRecord.find({ user_id: userId })
      .populate('doctor_id', 'name specialty_id')
      .sort({ date: -1 });
    
    res.json(records);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching medical records', error });
  }
};

export const getAllAppointmentsForPatient = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Authentication required' });
      return;
    }

    const appointments = await Appointment.find({ user_id: req.user._id })
      .populate({ 
        path: 'doctor_id', 
        populate: { path: 'user_id', select: 'name email' } 
      })
      .populate('specialty_id', 'name')
      .sort({ appointment_date: -1, time_slot: -1 });

    if (!appointments || appointments.length === 0) {
      res.status(404).json({ message: 'You don\'t have any appointments yet. Tap here to schedule one.' });
      return;
    }
    
    res.json(appointments);
  } catch (error) {
    console.error('Error fetching appointments:', error);
    res.status(500).json({ message: 'Error fetching appointments', error });
  }
};

export const editAppointment = async (req: Request, res: Response) => {
  try {
    const appointmentId = req.params.appointment_id;
    const userId = req.body.user_id;
    
    if (!appointmentId || !userId) {
      return res.status(400).json({ message: 'Missing appointment_id or user_id' });
    }

    const updateFields: any = {};
    const allowedFields = ['appointment_date', 'time_slot', 'reason', 'notes'];
    
    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) {
        updateFields[field] = req.body[field];
      }
    });

    const appointment = await Appointment.findOneAndUpdate(
      { _id: appointmentId, user_id: userId, status: 'pending' },
      { $set: updateFields },
      { new: true, runValidators: true }
    );

    if (!appointment) {
      return res.status(404).json({ 
        message: 'Appointment not found, not owned by user, or cannot be modified' 
      });
    }

    res.json({ message: 'Appointment updated successfully', appointment });
  } catch (error) {
    console.error('Error updating appointment:', error);
    res.status(500).json({ message: 'Error updating appointment', error });
  }
};

export const cancelAppointment = async (req: Request, res: Response) => {
  try {
    const appointmentId = req.params.appointment_id;
    const userId = req.body.user_id;
    
    if (!appointmentId || !userId) {
      return res.status(400).json({ message: 'Missing appointment_id or user_id' });
    }

    const appointment = await Appointment.findOneAndUpdate(
      { _id: appointmentId, user_id: userId, status: { $in: ['pending', 'confirmed'] } },
      { $set: { status: 'cancelled', cancelled_at: new Date() } },
      { new: true }
    );

    if (!appointment) {
      return res.status(404).json({ 
        message: 'Appointment not found or cannot be cancelled' 
      });
    }

    res.json({ message: 'Appointment cancelled successfully', appointment });
  } catch (error) {
    console.error('Error cancelling appointment:', error);
    res.status(500).json({ message: 'Error cancelling appointment', error });
  }
};

export const getMyMedicalRecords = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const role = req.user?.role;

    if (!userId || !role) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    let records;

    if (role === 'patient') {
      records = await MedicalRecord.find({ user_id: userId })
        .populate('user_id', 'name email phoneNumber')
        .populate('doctor_id', 'name email') // Directly populate user fields
        .populate('appointment_id', 'appointment_date appointment_time');

    } else if (role === 'doctor') {
      records = await MedicalRecord.find({ doctor_id: userId })
        .populate('user_id', 'name email phoneNumber')
        .populate('doctor_id', 'name email') // Directly populate user fields
        .populate('appointment_id', 'appointment_date appointment_time');

    } else {
      return res.status(403).json({ message: 'Access denied' });
    }

    res.json(records);
  } catch (error: any) {
    console.error('Error fetching medical records:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

export const getUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ 
        success: false, 
        message: 'Authentication required' 
      });
      return;
    }

    let doctorProfile = null;
    if (req.user.role === 'doctor') {
      const doctor = await Doctor.findOne({ user_id: req.user._id })
        .populate('specialty_id', 'name');
      if (doctor) {
        doctorProfile = {
          specialty_id: doctor.specialty_id,
          license_number: doctor.license_number,
          years_of_experience: doctor.years_of_experience,
          isAvailable: doctor.isAvailable,
          consultation_fee: doctor.consultation_fee
        };
      }
    }

    res.status(200).json({
      success: true,
      data: {
        _id: req.user._id,
        name: req.user.name,
        email: req.user.email,
        role: req.user.role,
        phoneNumber: req.user.phoneNumber || '',
        dateOfBirth: req.user.dateOfBirth || '',
        gender: req.user.gender || '',
        address: req.user.address || '',
        avatar: req.user.avatar || '',
        emergencyContact: req.user.emergencyContact || '',
        bloodType: req.user.bloodType || '',
        allergies: req.user.allergies || '',
        medications: req.user.medications || '',
        doctorProfile
      }
    });
  } catch (error) {
    console.error('Error in getUser:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
};

export const updateUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ 
        success: false, 
        message: 'Authentication required' 
      });
      return;
    }

    const body = req.body || {};
    const updates: any = {};
    
    const allowedFields = [
      'name', 'phoneNumber', 'dateOfBirth', 'gender', 'address',
      'emergencyContact', 'bloodType', 'allergies', 'medications', 'avatar'
    ];

    allowedFields.forEach(field => {
      if (body[field] !== undefined) {
        updates[field] = body[field];
      }
    });

    const updatedUser = await User.findByIdAndUpdate(
      req.user._id, 
      updates, 
      { new: true, runValidators: true }
    );

    if (!updatedUser) {
      res.status(404).json({ success: false, message: 'User not found' });
      return;
    }

    res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      data: {
        _id: updatedUser._id,
        name: updatedUser.name,
        email: updatedUser.email,
        role: updatedUser.role,
        phoneNumber: updatedUser.phoneNumber || '',
        dateOfBirth: updatedUser.dateOfBirth || '',
        gender: updatedUser.gender || '',
        address: updatedUser.address || ''
      }
    });
  } catch (error) {
    console.error('Error in updateUser:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
};

export const postDoctorReview = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const doctor_id = req.params.doctor_id;
    const user_id = req.user?._id;
    const { rating, comment, appointment_id } = req.body;

    // Validate required fields
    if (!doctor_id || !user_id || !rating || !appointment_id) {
      res.status(400).json({ 
        success: false,
        message: 'Missing required fields: doctor_id, user_id, rating, and appointment_id are required' 
      });
      return;
    }

    // Validate rating range
    if (rating < 1 || rating > 5) {
      res.status(400).json({ 
        success: false,
        message: 'Rating must be between 1 and 5' 
      });
      return;
    }

    // Validate ObjectId formats
    if (!mongoose.Types.ObjectId.isValid(doctor_id)) {
      res.status(400).json({ 
        success: false,
        message: 'Invalid doctor ID format' 
      });
      return;
    }

    if (!mongoose.Types.ObjectId.isValid(appointment_id)) {
      res.status(400).json({ 
        success: false,
        message: 'Invalid appointment ID format' 
      });
      return;
    }

    // Check if doctor exists
    const doctor = await Doctor.findById(doctor_id);
    if (!doctor) {
      res.status(404).json({ 
        success: false,
        message: 'Doctor not found' 
      });
      return;
    }

    // Check if appointment exists and belongs to user
    const appointment = await Appointment.findOne({
      _id: appointment_id,
      user_id: user_id,
      doctor_id: doctor_id,
      status: 'completed'
    });

    if (!appointment) {
      res.status(400).json({ 
        success: false,
        message: 'Cannot review without a completed appointment that belongs to you' 
      });
      return;
    }

    // Check if user has already reviewed this appointment
    const existingReview = await Review.findOne({ 
      appointment_id, 
      user_id 
    });

    if (existingReview) {
      res.status(400).json({ 
        success: false,
        message: 'You have already reviewed this appointment. Please edit your existing review instead.' 
      });
      return;
    }

    // Create and save review
    const review = new Review({
      doctor_id,
      user_id,
      appointment_id,
      rating,
      comment: comment || '',
      created_at: new Date(),
    });

    await review.save();

    // Populate the review for response
    const populatedReview = await Review.findById(review._id)
      .populate('user_id', 'name avatar')
      .populate('doctor_id', 'name specialty_id');

    res.status(201).json({
      success: true,
      message: 'Review submitted successfully',
      review: populatedReview
    });
  } catch (error) {
    console.error('Error submitting review:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error submitting review', 
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

export const getDoctorReviews = async (req: Request, res: Response): Promise<void> => {
  try {
    const doctor_id = req.params.doctor_id;
    
    if (!doctor_id || !mongoose.Types.ObjectId.isValid(doctor_id)) {
      res.status(400).json({ message: 'Invalid or missing doctor_id parameter' });
      return;
    }

    const reviews = await Review.find({ doctor_id })
      .populate({ path: 'user_id', select: 'name avatar' })
      .sort({ created_at: -1 });

    res.status(200).json({ reviews });
  } catch (error) {
    console.error('Error fetching reviews:', error);
    res.status(500).json({ message: 'Error fetching reviews', error });
  }
};

export const getUserReviews = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ 
        success: false,
        message: 'Authentication required' 
      });
      return;
    }
    
    const reviews = await Review.find({ user_id: req.user._id })
      .populate('doctor_id', 'name specialty_id')
      .populate('appointment_id', '_id appointment_date time_slot') // Đảm bảo chỉ lấy _id
      .sort({ created_at: -1 });

    console.log('🔍 Backend - Fetched reviews:', reviews.map(r => ({
      id: r._id,
      appointment_id: r.appointment_id?._id || r.appointment_id,
      rating: r.rating
    })));

    res.status(200).json({
      success: true,
      reviews
    });
  } catch (error) {
    console.error('Error fetching user reviews:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error fetching user reviews' 
    });
  }
};

export const deleteReview = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const reviewId = req.params.review_id;
    
    if (!reviewId) {
      res.status(400).json({ message: 'Review ID is required' });
      return;
    }

    const review = await Review.findOneAndDelete({ 
      _id: reviewId, 
      user_id: req.user?._id 
    });

    if (!review) {
      res.status(404).json({ message: 'Review not found' });
      return;
    }

    res.status(200).json({ message: 'Review deleted successfully' });
  } catch (error) {
    console.error('Error deleting review:', error);
    res.status(500).json({ message: 'Error deleting review', error });
  }
};

export const uploadAvatar = [
  upload.single('avatar'),
  
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      // 1. Authentication check
      if (!req.user) {
        res.status(401).json({ 
          success: false, 
          message: 'Authentication required' 
        });
        return;
      }

      // 2. File check
      if (!req.file) {
        res.status(400).json({ 
          success: false, 
          message: 'No image file provided' 
        });
        return;
      }

      const userId = req.user._id;
      const filename = req.file.filename; // Đã là avatar_userId_timestamp.ext
      
      console.log('📤 Uploading avatar:', {
        userId,
        filename,
        size: req.file.size
      });

      // 3. Get user and delete old avatar
      const user = await User.findById(userId);
      if (!user) {
        deleteAvatarFile(filename);
        res.status(404).json({ 
          success: false, 
          message: 'User not found' 
        });
        return;
      }

      // 4. Delete old avatar file if exists
      if (user.avatar && user.avatar !== filename) {
        deleteAvatarFile(user.avatar);
      }

      // 5. Lưu CHỈ TÊN FILE vào database
      user.avatar = filename;
      user.avatarUpdatedAt = new Date();
      await user.save();

      // 6. Tạo URL để trả về (không lưu vào DB)
      const baseUrl = getBaseUrlFromRequest(req);
      const avatarUrl = `${baseUrl}/uploads/avatars/${filename}?t=${Date.now()}`;

      // 7. Response
      res.status(200).json({
        success: true,
        message: 'Avatar uploaded successfully',
        data: {
          avatar: filename, // Chỉ tên file
          avatarUrl: avatarUrl, // URL đầy đủ (tạm thời cho response)
          user: {
            _id: user._id,
            name: user.name,
            email: user.email
          }
        }
      });

    } catch (error: any) {
      console.error('Avatar upload error:', error);
      
      if (req.file) {
        deleteAvatarFile(req.file.filename);
      }
      
      res.status(500).json({ 
        success: false, 
        message: 'Error uploading avatar',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }
];

const deleteAvatarFile = (filename: string): void => {
  try {
    if (!filename) return;
    
    const filePath = path.join(uploadDir, filename);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log('🗑️ Deleted avatar file:', filename);
    }
  } catch (error) {
    console.error('Error deleting avatar file:', error);
  }
};


// Thêm vào file controller của bạn
export const deleteAvatar = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ 
        success: false, 
        message: 'Authentication required' 
      });
      return;
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
      return;
    }

    // Xóa file từ disk
    if (user.avatar) {
      const filePath = path.join(uploadDir, user.avatar);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log('🗑️ Deleted old avatar file:', user.avatar);
      }
    }

    // Cập nhật user - xóa avatar
    user.avatar = '';
    user.avatarUpdatedAt = new Date();
    await user.save();

    res.status(200).json({
      success: true,
      message: 'Avatar deleted successfully',
      data: {
        user: {
          _id: user._id,
          name: user.name,
          email: user.email,
          avatar: user.avatar
        }
      }
    });
  } catch (error: any) {
    console.error('Delete avatar error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error deleting avatar',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

const getBaseUrlFromRequest = (req: Request): string => {
  if (process.env.SERVER_URL) {
    return process.env.SERVER_URL;
  }
  
  const protocol = req.protocol || 'http';
  let host = req.get('host');
  if (!host) {
    const serverIP = process.env.SERVER_IP || 'localhost';
    const serverPort = process.env.PORT || '3000';
    host = `${serverIP}:${serverPort}`;
  }
  
  return `${protocol}://${host}`;
};


export const getAvatar = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ 
        success: false, 
        message: 'Authentication required' 
      });
      return;
    }

    const user = await User.findById(req.user._id).select('avatar avatarUpdatedAt name email');
    if (!user) {
      res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
      return;
    }

    // Chỉ trả về thông tin cơ bản
    const response = {
      success: true,
      data: {
        avatar: user.avatar, // Chỉ tên file
        avatarUpdatedAt: user.avatarUpdatedAt,
        user: {
          _id: user._id,
          name: user.name,
          email: user.email
        }
      }
    };

    // Nếu client cần URL, tạo dynamic
    if (req.query.includeUrl === 'true') {
      const baseUrl = getBaseUrlFromRequest(req);
      const timestamp = user.avatarUpdatedAt ? user.avatarUpdatedAt.getTime() : Date.now();
      response.data['avatarUrl'] = user.avatar 
        ? `${baseUrl}/uploads/avatars/${user.avatar}?t=${timestamp}`
        : '';
    }

    res.status(200).json(response);
  } catch (error: any) {
    console.error('Get avatar error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error getting avatar',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};


// Debug endpoint cho avatar
export const debugAvatar = async (req: Request, res: Response): Promise<void> => {
  try {
    const avatarsDir = uploadDir;
    const files = fs.readdirSync(avatarsDir);
    
    const avatarFiles = files
      .filter(file => file.match(/\.(jpg|jpeg|png|gif|webp)$/i))
      .map(file => {
        const filePath = path.join(avatarsDir, file);
        const stats = fs.statSync(filePath);
        return {
          filename: file,
          path: filePath,
          url: `${getBaseUrlFromRequest(req)}/uploads/avatars/${file}`,
          urlWithTimestamp: `${getBaseUrlFromRequest(req)}/uploads/avatars/${file}?t=${Date.now()}`,
          size: stats.size,
          created: stats.birthtime,
          modified: stats.mtime,
          exists: true
        };
      });

    res.status(200).json({
      success: true,
      timestamp: new Date().toISOString(),
      data: {
        uploadDir: avatarsDir,
        exists: fs.existsSync(avatarsDir),
        totalFiles: files.length,
        avatarFiles: avatarFiles.length,
        files: avatarFiles,
        server: {
          baseUrl: getBaseUrlFromRequest(req),
          port: process.env.PORT || 3000,
          nodeEnv: process.env.NODE_ENV || 'development'
        },
        testUrls: avatarFiles.map(file => ({
          original: file.url,
          withCacheBuster: `${file.url}?t=${Date.now()}&v=1`,
          direct: `${getBaseUrlFromRequest(req)}/api/avatar/${file.filename}`
        }))
      }
    });
  } catch (error: any) {
    console.error('Debug avatar error:', error);
    res.status(500).json({
      success: false,
      message: 'Error debugging avatar',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
      uploadDir: uploadDir,
      exists: fs.existsSync(uploadDir)
    });
  }
};

const getNextAvailableDates = async (doctorId: string, days: number = 7): Promise<any[]> => {
  const availableDates = [];
  const today = new Date();
  
  for (let i = 1; i <= days; i++) {
    const date = new Date(today);
    date.setDate(today.getDate() + i);
    
    // Kiểm tra xem ngày này có slot nào trống không
    const slots = await getAlternativeTimeSlots(doctorId, date);
    if (slots.length > 0) {
      availableDates.push({
        date: date.toISOString().split('T')[0],
        available_slots: slots.length,
        slots: slots
      });
    }
  }
  
  return availableDates;
};

export const checkRealTimeAvailability = async (req: Request, res: Response): Promise<void> => {
  try {
    const { doctor_id, date, time_slot } = req.query;
    
    if (!doctor_id || !date || !time_slot) {
      res.status(400).json({ 
        success: false,
        message: 'doctor_id, date, and time_slot are required' 
      });
      return;
    }

    const appointmentDate = new Date(date as string);
    const startOfDay = new Date(appointmentDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(appointmentDate);
    endOfDay.setHours(23, 59, 59, 999);

    // Kiểm tra real-time
    const existingAppointment = await Appointment.findOne({
      doctor_id,
      appointment_date: { $gte: startOfDay, $lte: endOfDay },
      time_slot: time_slot,
      status: { $in: ['pending', 'confirmed'] }
    });

    res.status(200).json({
      success: true,
      data: {
        isAvailable: !existingAppointment,
        timeSlot: time_slot,
        date: date,
        checkedAt: new Date().toISOString(),
        conflict: existingAppointment ? {
          appointmentId: existingAppointment._id,
          status: existingAppointment.status,
          createdAt: existingAppointment.created_at
        } : null
      }
    });
  } catch (error) {
    console.error('Error checking real-time availability:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error checking availability' 
    });
  }
};

