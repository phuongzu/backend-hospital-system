import { Request, Response } from 'express';
import mongoose from 'mongoose';
import Doctor from '../models/doctor';
import Appointment from '../models/appointment';
import User from '../models/user';
import MedicalRecord from '../models/medicalRecord';
import { AuthRequest } from '../middlewares/authmiddleware';
import Review from '../models/review';
import UserInfo from '../models/UserInfor';


const handleError = (res, error, message = 'Internal server error') => {
  console.error(`${message}:`, error);
  res.status(500).json({ 
    success: false,
    message,
    error: process.env.NODE_ENV === 'development' ? error.message : undefined
  });
};

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

    // Check if doctor exists
    const doctor = await Doctor.findById(doctor_id);
    if (!doctor) {
      return res.status(404).json({ message: 'Doctor not found' });
    }

    // Get existing appointments for this doctor and date
    const existingAppointments = await Appointment.find({
      doctor_id,
      appointment_date: new Date(date as string),
      status: { $in: ['pending', 'confirmed'] }
    });

    const allTimeSlots = [
      '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
      '14:00', '14:30', '15:00', '15:30', '16:00', '16:30'
    ];

    // Filter out booked time slots
    const bookedSlots = existingAppointments.map(app => app.time_slot);
    const availableSlots = allTimeSlots.map(slot => ({
      time: slot,
      isAvailable: !bookedSlots.includes(slot),
      isReserved: false // This would need additional logic for reservations
    }));

    res.json({ 
      date, 
      availableSlots,
      doctor: {
        name: doctor.name,
        specialty: doctor.specialty_id
      }
    });
  } catch (error) {
    console.error('Error fetching appointment availability:', error);
    res.status(500).json({ message: 'Error fetching availability', error });
  }
};

export const bookAppointment = async (req: Request, res: Response) => {
  try {
    const { doctor_id, user_id, specialty_id, appointment_date, time_slot, reason, notes } = req.body;
    
    console.log('Booking appointment request:', req.body);

    // Validate required fields
    if (!doctor_id || !user_id || !appointment_date || !time_slot) {
      return res.status(400).json({ 
        message: 'Missing required fields',
        required: ['doctor_id', 'user_id', 'appointment_date', 'time_slot']
      });
    }

    // Validate ObjectId formats
    if (!mongoose.Types.ObjectId.isValid(doctor_id)) {
      return res.status(400).json({ message: 'Invalid doctor ID format' });
    }

    if (!mongoose.Types.ObjectId.isValid(user_id)) {
      return res.status(400).json({ message: 'Invalid user ID format' });
    }

    // Check if doctor exists
    const doctor = await Doctor.findById(doctor_id);
    if (!doctor) {
      return res.status(404).json({ message: 'Doctor not found' });
    }

    // Check if user exists
    const user = await User.findById(user_id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Check for conflicting appointments
    const existingAppointment = await Appointment.findOne({
      doctor_id,
      appointment_date,
      time_slot,
      status: { $in: ['pending', 'confirmed'] }
    });

    if (existingAppointment) {
      return res.status(409).json({ 
        message: 'Time slot not available',
        conflict: true
      });
    }

    // Create new appointment
    const appointment = new Appointment({
      doctor_id,
      user_id,
      specialty_id: specialty_id || doctor.specialty_id,
      appointment_date: new Date(appointment_date),
      time_slot,
      reason: reason || 'General consultation',
      notes: notes || '',
      status: 'pending',
      created_at: new Date(),
    });

    await appointment.save();

    // Populate the appointment data for response
    const populatedAppointment = await Appointment.findById(appointment._id)
      .populate('doctor_id', 'name email phoneNumber specialty_id')
      .populate('user_id', 'name email');

    res.status(201).json({
      message: 'Appointment booked successfully',
      appointment: populatedAppointment
    });

  } catch (error) {
    console.error('Error booking appointment:', error);
    
    if (error instanceof mongoose.Error.ValidationError) {
      return res.status(400).json({ 
        message: 'Validation error', 
        errors: error.errors 
      });
    }
    
    res.status(500).json({ 
      message: 'Error booking appointment', 
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
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
      res.status(404).json({ message: 'You don’t have any appointments yet. Tap here to schedule one.' });
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
