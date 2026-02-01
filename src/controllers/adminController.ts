import { Request, Response } from 'express';
import { AuthRequest } from '../middlewares/authmiddleware';
import User from '../models/user';
import Doctor from '../models/doctor';
import MedicalRecord from '../models/medicalRecord';
import Appointment from '../models/appointment';
import UnlockRequest from '../models/unlockRequest';
import Specialty from '../models/specialty';
import bcrypt from 'bcryptjs';
import DoctorRegistrationRequest from '../models/doctorRegistrationRequest';
import mongoose from 'mongoose';
import DrugCategory from '../models/DrugCategory'
import Drug from '../models/drug'


export const getAdminDashboard = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const [
      totalUsers,
      totalDoctors,
      totalPatients,
      totalAppointments,
      activeAppointments,
      completedAppointments,
      pendingAppointments,
      totalMedicalRecords,
      pendingUnlockRequests,
      lockedDoctors,
      recentAppointments,
      monthlyRevenue,
      previousMonthlyRevenue,
      specialtiesCount,
      pendingRegistrations
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ role: 'doctor' }),
      User.countDocuments({ role: 'patient' }),
      Appointment.countDocuments(),
      Appointment.countDocuments({ status: 'confirmed' }),
      Appointment.countDocuments({ status: 'completed' }),
      Appointment.countDocuments({ status: 'pending' }),
      MedicalRecord.countDocuments(),
      UnlockRequest.countDocuments({ status: 'pending' }),
      User.countDocuments({ role: 'doctor', isLocked: true }),
      Appointment.find()
        .populate('user_id', 'name')
        .populate('doctor_id', 'name')
        .sort({ createdAt: -1 })
        .limit(5),
      // Calculate current month revenue
      Appointment.aggregate([
        {
          $match: {
            status: 'completed',
            createdAt: { 
              $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
              $lt: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1)
            }
          }
        },
        {
          $lookup: {
            from: 'doctors',
            localField: 'doctor_id',
            foreignField: '_id',
            as: 'doctor'
          }
        },
        {
          $group: {
            _id: null,
            totalRevenue: { $sum: { $arrayElemAt: ['$doctor.consultation_fee', 0] } }
          }
        }
      ]),
      // Calculate previous month revenue
      Appointment.aggregate([
        {
          $match: {
            status: 'completed',
            createdAt: {
              $gte: new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1),
              $lt: new Date(new Date().getFullYear(), new Date().getMonth(), 1)
            }
          }
        },
        {
          $lookup: {
            from: 'doctors',
            localField: 'doctor_id',
            foreignField: '_id',
            as: 'doctor'
          }
        },
        {
          $group: {
            _id: null,
            totalRevenue: { $sum: { $arrayElemAt: ['$doctor.consultation_fee', 0] } }
          }
        }
      ]),
      Specialty.countDocuments(),
      DoctorRegistrationRequest.countDocuments({ status: 'pending' })
    ]);

    // Get recent unlock requests
    const recentUnlockRequests = await UnlockRequest.find({ status: 'pending' })
      .populate('doctor_id', 'name email phoneNumber lockedAt')
      .sort({ submitted_at: -1 })
      .limit(5);

    // Get recent registration requests
    const recentRegistrationRequests = await DoctorRegistrationRequest.find({ status: 'pending' })
      .populate('specialty_id', 'name')
      .sort({ submitted_at: -1 })
      .limit(5);

    // Get system alerts - THÊM alert cho registration requests
    const systemAlerts = [];
    if (pendingUnlockRequests > 0) {
      systemAlerts.push({
        type: 'warning',
        message: `${pendingUnlockRequests} pending unlock requests need attention`,
        count: pendingUnlockRequests
      });
    }
    if (lockedDoctors > 0) {
      systemAlerts.push({
        type: 'error',
        message: `${lockedDoctors} doctor accounts are locked`,
        count: lockedDoctors
      });
    }
    if (pendingRegistrations > 0) {
      systemAlerts.push({
        type: 'info',
        message: `${pendingRegistrations} doctor registration requests pending review`,
        count: pendingRegistrations
      });
    }

    // Monthly revenue trend calculation
    const currentRevenue = monthlyRevenue.length > 0 ? monthlyRevenue[0].totalRevenue : 0;
    const prevRevenue = previousMonthlyRevenue.length > 0 ? previousMonthlyRevenue[0].totalRevenue : 0;
    let revenueChange = 0;
    if (prevRevenue > 0) {
      revenueChange = ((currentRevenue - prevRevenue) / prevRevenue) * 100;
    }

    // System health metrics (placeholders, replace with real monitoring if available)
    const systemUptime = 99.9; // percent
    const averageResponseTime = 20; // ms
    const errorRate = 0.5; // percent
    const databaseSize = 50; // MB
    const activeConnections = 5;

    res.status(200).json({
      success: true,
      data: {
        stats: {
          totalUsers,
          totalDoctors,
          totalPatients,
          totalAppointments,
          activeAppointments,
          completedAppointments,
          pendingAppointments,
          totalMedicalRecords,
          pendingUnlockRequests,
          lockedDoctors,
          monthlyRevenue: currentRevenue,
          revenueChange,
          specialtiesCount,
          pendingRegistrations,
          systemUptime,
          averageResponseTime,
          errorRate,
          databaseSize,
          activeConnections
        },
        recentUnlockRequests,
        recentAppointments,
        recentRegistrationRequests,
        systemAlerts
      }
    });
  } catch (error) {
    console.error('❌ Error in getAdminDashboard:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};



// Get all doctors with pagination, search, and detailed info
export const getAllDoctors = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { page = 1, limit = 1000, search = '', status = '' } = req.query; // Tăng limit lên 1000

    const query: any = { role: 'doctor' };
    
    // Search by name or email
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }

    // Filter by status
    if (status === 'locked') {
      query.isLocked = true;
    } else if (status === 'active') {
      query.isLocked = false;
      query.isActive = true;
    }

    // Lấy tất cả doctors không phân trang
    const doctors = await User.find(query)
      .select('name email phoneNumber isLocked lockedAt lastLogin createdAt isActive status')
      .sort({ createdAt: -1 });

    // Get detailed doctor information
    const doctorsWithDetails = await Promise.all(
      doctors.map(async (doctor) => {
        // Find doctor profile from Doctor collection
        const doctorProfile = await Doctor.findOne({ user_id: doctor._id })
          .populate('specialty_id', 'name');
        
        // Get appointment statistics
        const appointmentStats = await Appointment.aggregate([
          { $match: { doctor_id: doctorProfile?._id } },
          { $group: { _id: '$status', count: { $sum: 1 } } }
        ]);

        return {
          _id: doctor._id,
          name: doctor.name,
          email: doctor.email,
          phoneNumber: doctor.phoneNumber,
          isLocked: doctor.isLocked,
          lockedAt: doctor.lockedAt,
          lastLogin: doctor.lastLogin,
          createdAt: doctor.createdAt,
          isActive: doctor.isActive,
          status: doctor.status,
          // Include doctor profile details
          specialty: doctorProfile?.specialty_id?.name || 'Not specified',
          licenseNumber: doctorProfile?.license_number || 'Not specified',
          yearsOfExperience: doctorProfile?.years_of_experience || 0,
          consultationFee: doctorProfile?.consultation_fee || 0,
          isAvailable: doctorProfile?.isAvailable || false,
          // Appointment statistics
          appointmentStats: appointmentStats.reduce((acc: any, stat) => {
            acc[stat._id] = stat.count;
            return acc;
          }, {})
        };
      })
    );

    res.status(200).json({
      success: true,
      data: {
        doctors: doctorsWithDetails,
        total: doctorsWithDetails.length
      }
    });
  } catch (error) {
    console.error('❌ Error in getAllDoctors:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get all patients with pagination, search, and detailed info
export const getAllPatients = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { page = 1, limit = 1000, search = '' } = req.query;

    const query: any = { role: 'patient' };
    
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }

    // Lấy tất cả patients với status
    const patients = await User.find(query)
      .select('name email phoneNumber dateOfBirth gender address createdAt lastLogin isActive status')
      .sort({ createdAt: -1 });

    // Get patient statistics
    const patientsWithStats = await Promise.all(
      patients.map(async (patient) => {
        const appointmentCount = await Appointment.countDocuments({ user_id: patient._id });
        const medicalRecordCount = await MedicalRecord.countDocuments({ user_id: patient._id });
        
        // Lấy appointment gần nhất
        const lastAppointment = await Appointment.findOne({ user_id: patient._id })
          .sort({ appointment_date: -1 })
          .select('appointment_date');

        // Tính patient status dựa trên activity
        let patientStatus = 'inactive';
        const lastLoginDate = patient.lastLogin ? new Date(patient.lastLogin) : null;
        const now = new Date();
        
        if (lastLoginDate) {
          const daysSinceLastLogin = Math.floor((now.getTime() - lastLoginDate.getTime()) / (1000 * 60 * 60 * 24));
          
          if (daysSinceLastLogin <= 7) {
            patientStatus = 'active';
          } else if (daysSinceLastLogin <= 30) {
            patientStatus = 'moderate';
          } else {
            patientStatus = 'inactive';
          }
        }

        // Nếu có appointment trong 30 ngày qua, đánh giá là active
        if (lastAppointment) {
          const appointmentDate = new Date(lastAppointment.appointment_date);
          const daysSinceLastAppointment = Math.floor((now.getTime() - appointmentDate.getTime()) / (1000 * 60 * 60 * 24));
          
          if (daysSinceLastAppointment <= 30) {
            patientStatus = 'active';
          }
        }

        return {
          ...patient.toObject(),
          appointmentCount,
          medicalRecordCount,
          lastAppointment: lastAppointment?.appointment_date,
          patientStatus, // Thêm patient status
          lastLogin: patient.lastLogin,
          isActive: patient.isActive
        };
      })
    );

    res.status(200).json({
      success: true,
      data: {
        patients: patientsWithStats,
        total: patientsWithStats.length
      }
    });
  } catch (error) {
    console.error('❌ Error in getAllPatients:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Create new doctor (Admin only)
export const createDoctor = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { 
      name, 
      email, 
      password, 
      phoneNumber, 
      dateOfBirth, 
      gender, 
      address,
      specialty_id, 
      license_number, 
      years_of_experience, 
      consultation_fee 
    } = req.body;

    // Validate required fields
    if (!name || !email || !password || !specialty_id || !license_number) {
      res.status(400).json({
        success: false,
        message: 'Name, email, password, specialty, and license number are required'
      });
      return;
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      res.status(409).json({
        success: false,
        message: 'User with this email already exists'
      });
      return;
    }

    // Hash password
    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Create user
    const newUser = await User.create({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      password: hashedPassword,
      role: 'doctor',
      phoneNumber: phoneNumber || '',
      dateOfBirth: dateOfBirth || '',
      gender: gender || '',
      address: address || '',
      isActive: true
    });

    // Create doctor profile
    const doctorProfile = await Doctor.create({
      user_id: newUser._id,
      specialty_id,
      license_number,
      years_of_experience: years_of_experience || 0,
      consultation_fee: consultation_fee || 0,
      isAvailable: true
    });

    res.status(201).json({
      success: true,
      message: 'Doctor created successfully',
      data: {
        user: newUser,
        doctorProfile
      }
    });
  } catch (error) {
    console.error('❌ Error in createDoctor:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};
// Update user status (activate/deactivate)
export const updateUserStatus = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { userId } = req.params;
    const { isActive } = req.body;

    if (typeof isActive !== 'boolean') {
      res.status(400).json({
        success: false,
        message: 'isActive field is required and must be boolean'
      });
      return;
    }

    const user = await User.findByIdAndUpdate(
      userId,
      { isActive },
      { new: true }
    ).select('name email role isActive');

    if (!user) {
      res.status(404).json({
        success: false,
        message: 'User not found'
      });
      return;
    }

    res.status(200).json({
      success: true,
      message: `User ${isActive ? 'activated' : 'deactivated'} successfully`,
      data: user
    });
  } catch (error) {
    console.error('❌ Error in updateUserStatus:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get user details
export const getUserDetails = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { userId } = req.params;

    const user = await User.findById(userId).select('-password');
    if (!user) {
      res.status(404).json({
        success: false,
        message: 'User not found'
      });
      return;
    }

    let additionalData: any = {};
    
    if (user.role === 'doctor') {
      // FIX: Get doctor profile from Doctor collection, not populate
      const doctorProfile = await Doctor.findOne({ user_id: userId })
        .populate('specialty_id', 'name description');
      
      // Get doctor statistics
      const appointmentStats = await Appointment.aggregate([
        { $match: { doctor_id: doctorProfile?._id } },
        { $group: { _id: '$status', count: { $sum: 1 } } }
      ]);
      
      additionalData = {
        doctorProfile,
        appointmentStats: appointmentStats.reduce((acc: any, stat) => {
          acc[stat._id] = stat.count;
          return acc;
        }, {})
      };
    } else if (user.role === 'patient') {
      const appointmentCount = await Appointment.countDocuments({ user_id: userId });
      const medicalRecordCount = await MedicalRecord.countDocuments({ user_id: userId });
      
      additionalData = {
        appointmentCount,
        medicalRecordCount
      };
    }

    res.status(200).json({
      success: true,
      data: {
        user,
        ...additionalData
      }
    });
  } catch (error) {
    console.error('❌ Error in getUserDetails:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};


// Get system analytics
export const getSystemAnalytics = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    // Monthly appointments trend
    const monthlyAppointments = await Appointment.aggregate([
      {
        $match: {
          createdAt: { $gte: new Date(new Date().getFullYear(), 0, 1) }
        }
      },
      {
        $group: {
          _id: { $month: '$createdAt' },
          count: { $sum: 1 }
        }
      },
      { $sort: { '_id': 1 } }
    ]);

    // Doctor specialties distribution
    const specialtiesDistribution = await Doctor.aggregate([
      {
        $group: {
          _id: '$specialty_id',
          count: { $sum: 1 }
        }
      },
      {
        $lookup: {
          from: 'specialties',
          localField: '_id',
          foreignField: '_id',
          as: 'specialty'
        }
      },
      {
        $project: {
          specialty: { $arrayElemAt: ['$specialty.name', 0] },
          count: 1
        }
      }
    ]);

    // Appointment status distribution
    const appointmentStatusDistribution = await Appointment.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    // User registration trend (last 6 months)
    const registrationTrend = await User.aggregate([
      {
        $match: {
          createdAt: { $gte: new Date(new Date().setMonth(new Date().getMonth() - 6)) }
        }
      },
      {
        $group: {
          _id: {
            month: { $month: '$createdAt' },
            year: { $year: '$createdAt' },
            role: '$role'
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ]);

    res.status(200).json({
      success: true,
      data: {
        monthlyAppointments,
        specialtiesDistribution,
        appointmentStatusDistribution,
        registrationTrend
      }
    });
  } catch (error) {
    console.error('❌ Error in getSystemAnalytics:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get locked doctors
export const getLockedDoctors = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const lockedDoctors = await User.find({
      role: 'doctor',
      isLocked: true
    })
    .select('name email phoneNumber lockedAt loginAttempts')
    .populate('lockedBy', 'name email')
    .sort({ lockedAt: -1 });

    res.status(200).json({
      success: true,
      data: lockedDoctors
    });
  } catch (error) {
    console.error('❌ Error in getLockedDoctors:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Unlock doctor account
export const unlockDoctorAccount = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { doctorId } = req.params;
    const adminId = req.user?._id;

    const user = await User.findById(doctorId);
    
    if (!user) {
      res.status(404).json({
        success: false,
        message: 'Doctor not found'
      });
      return;
    }

    if (user.role !== 'doctor') {
      res.status(400).json({
        success: false,
        message: 'User is not a doctor'
      });
      return;
    }

    // Reset lock status
    user.isLocked = false;
    user.loginAttempts = 0;
    user.lockedAt = undefined;
    user.lockedBy = adminId;
    await user.save();

    console.log(`🔓 Account unlocked for doctor: ${user.email} by admin: ${adminId}`);

    res.status(200).json({
      success: true,
      message: 'Doctor account unlocked successfully'
    });
  } catch (error) {
    console.error('❌ Error in unlockDoctorAccount:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Lock doctor account manually
export const lockDoctorAccount = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { doctorId } = req.params;
    const adminId = req.user?._id;
    const { reason } = req.body;

    const user = await User.findById(doctorId);
    
    if (!user) {
      res.status(404).json({
        success: false,
        message: 'Doctor not found'
      });
      return;
    }

    if (user.role !== 'doctor') {
      res.status(400).json({
        success: false,
        message: 'User is not a doctor'
      });
      return;
    }

    user.isLocked = true;
    user.lockedAt = new Date();
    user.lockedBy = adminId;
    await user.save();

    console.log(`🔒 Account manually locked for doctor: ${user.email} by admin: ${adminId}, reason: ${reason}`);

    res.status(200).json({
      success: true,
      message: 'Doctor account locked successfully'
    });
  } catch (error) {
    console.error('❌ Error in lockDoctorAccount:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get pending unlock requests
export const getPendingUnlockRequests = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const pendingRequests = await UnlockRequest.find({
      status: 'pending'
    })
    .populate('doctor_id', 'name email phoneNumber lockedAt loginAttempts')
    .sort({ submitted_at: -1 });

    res.status(200).json({
      success: true,
      data: pendingRequests
    });
  } catch (error) {
    console.error('❌ Error in getPendingUnlockRequests:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Approve unlock request
export const approveUnlockRequest = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { requestId } = req.params;
    const adminId = req.user?._id;
    const { admin_notes } = req.body;

    const unlockRequest = await UnlockRequest.findById(requestId)
      .populate('doctor_id');

    if (!unlockRequest) {
      res.status(404).json({
        success: false,
        message: 'Unlock request not found'
      });
      return;
    }

    if (unlockRequest.status !== 'pending') {
      res.status(400).json({
        success: false,
        message: 'This request has already been processed'
      });
      return;
    }

    // Unlock the doctor account
    const doctor = await User.findByIdAndUpdate(
      unlockRequest.doctor_id._id,
      {
        isLocked: false,
        loginAttempts: 0,
        lockedAt: undefined,
        lockedBy: adminId
      },
      { new: true }
    );

    if (!doctor) {
      res.status(404).json({
        success: false,
        message: 'Doctor account not found'
      });
      return;
    }

    // Update unlock request
    unlockRequest.status = 'approved';
    unlockRequest.reviewed_at = new Date();
    unlockRequest.reviewed_by = adminId;
    unlockRequest.admin_notes = admin_notes;
    await unlockRequest.save();

    res.status(200).json({
      success: true,
      message: 'Doctor account unlocked successfully',
      data: {
        doctor: {
          _id: doctor._id,
          name: doctor.name,
          email: doctor.email
        },
        unlocked_by: req.user?.name,
        unlocked_at: new Date()
      }
    });
  } catch (error) {
    console.error('❌ Error in approveUnlockRequest:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Reject unlock request
export const rejectUnlockRequest = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { requestId } = req.params;
    const adminId = req.user?._id;
    const { admin_notes } = req.body;

    const unlockRequest = await UnlockRequest.findById(requestId)
      .populate('doctor_id');

    if (!unlockRequest) {
      res.status(404).json({
        success: false,
        message: 'Unlock request not found'
      });
      return;
    }

    if (unlockRequest.status !== 'pending') {
      res.status(400).json({
        success: false,
        message: 'This request has already been processed'
      });
      return;
    }

    // Update unlock request status to rejected
    unlockRequest.status = 'rejected';
    unlockRequest.reviewed_at = new Date();
    unlockRequest.reviewed_by = adminId;
    unlockRequest.admin_notes = admin_notes;
    await unlockRequest.save();

    res.status(200).json({
      success: true,
      message: 'Unlock request rejected successfully'
    });
  } catch (error) {
    console.error('❌ Error in rejectUnlockRequest:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get all doctor registration requests
export const getDoctorRegistrationRequests = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { status = 'pending', page = 1, limit = 10 } = req.query;

    const query: any = {};
    if (status && status !== 'all') {
      query.status = status;
    }

    const requests = await DoctorRegistrationRequest.find(query)
      .populate('specialty_id', 'name')
      .populate('reviewed_by', 'name email')
      .sort({ submitted_at: -1 })
      .limit(Number(limit) * 1)
      .skip((Number(page) - 1) * Number(limit));

    const total = await DoctorRegistrationRequest.countDocuments(query);

    res.status(200).json({
      success: true,
      data: {
        requests,
        totalPages: Math.ceil(total / Number(limit)),
        currentPage: Number(page),
        total
      }
    });
  } catch (error) {
    console.error('❌ Error fetching doctor registration requests:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Approve doctor registration
export const approveDoctorRegistration = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { requestId } = req.params;
    const adminId = req.user?._id;
    const { admin_notes } = req.body;

    if (!req.user || req.user.role !== 'admin') {
      res.status(403).json({
        success: false,
        message: 'Access denied. Admin role required.'
      });
      return;
    }

    console.log(`🔍 Processing registration approval for request: ${requestId}`);

    const request = await DoctorRegistrationRequest.findById(requestId);
    if (!request) {
      res.status(404).json({
        success: false,
        message: 'Registration request not found'
      });
      return;
    }

    if (request.status !== 'pending') {
      res.status(400).json({
        success: false,
        message: 'This request has already been processed'
      });
      return;
    }

    console.log(`📋 Request details:`, {
      name: request.name,
      email: request.email,
      license: request.license_number,
      status: request.status
    });

    // Kiểm tra trùng lặp
    const existingUser = await User.findOne({ email: request.email.toLowerCase() });
    if (existingUser) {
      console.log(`❌ User with email ${request.email} already exists`);
      res.status(409).json({
        success: false,
        message: 'User with this email already exists in the system'
      });
      return;
    }

    const existingDoctor = await Doctor.findOne({ license_number: request.license_number });
    if (existingDoctor) {
      console.log(`❌ Doctor with license ${request.license_number} already exists`);
      res.status(409).json({
        success: false,
        message: 'Doctor with this license number already exists'
      });
      return;
    }

    const specialtyExists = await Specialty.findById(request.specialty_id);
    if (!specialtyExists) {
      console.log(`❌ Specialty ${request.specialty_id} not found`);
      res.status(400).json({
        success: false,
        message: 'Specialty not found'
      });
      return;
    }

    console.log('✅ All checks passed, creating user and doctor...');

    // Generate random password
    const randomPassword = Math.random().toString(36).slice(-8) + 'A1!';
    const hashedPassword = await bcrypt.hash(randomPassword, 12);
    
    // 🔥 SỬA QUAN TRỌNG: Tạo user với status hợp lệ cho doctor
    const newUser = await User.create({
      name: request.name,
      email: request.email.toLowerCase(),
      password: hashedPassword,
      role: 'doctor',
      phoneNumber: request.phoneNumber,
      isActive: true,
      // 🔥 STATUS HỢP LỆ: 'working', 'busy', hoặc 'not working'
      status: 'working' // Doctor mới approved nên set status là 'working'
    });

    console.log(`✅ User created: ${newUser._id}`);

    // Create doctor profile
    const doctorProfile = await Doctor.create({
      user_id: newUser._id,
      specialty_id: request.specialty_id,
      license_number: request.license_number,
      years_of_experience: request.years_of_experience,
      consultation_fee: request.consultation_fee,
      isAvailable: true
    });

    console.log(`✅ Doctor profile created: ${doctorProfile._id}`);

    // Update request status
    request.status = 'approved';
    request.reviewed_by = adminId;
    request.reviewed_at = new Date();
    request.admin_notes = admin_notes;
    await request.save();

    console.log(`✅ Request status updated to approved`);

    // Send welcome email with temporary password
    try {
      await emailService.sendDoctorApprovalEmail(
        request.email,
        request.name,
        randomPassword
      );
      console.log(`✅ Approval email sent to: ${request.email}`);
    } catch (emailError) {
      console.error('❌ Error sending approval email:', emailError);
      // Continue even if email fails
    }

    res.status(200).json({
      success: true,
      message: 'Doctor registration approved successfully',
      data: {
        doctor: {
          _id: newUser._id,
          name: newUser.name,
          email: newUser.email,
          status: newUser.status
        },
        doctorProfile: {
          _id: doctorProfile._id,
          license_number: doctorProfile.license_number,
          specialty: doctorProfile.specialty_id,
          consultation_fee: doctorProfile.consultation_fee
        },
        temporaryPassword: process.env.NODE_ENV === 'development' ? randomPassword : undefined
      }
    });

  } catch (error) {
    console.error('❌ Error approving doctor registration:', error);
    
    // Xử lý lỗi validation chi tiết
    if (error instanceof mongoose.Error.ValidationError) {
      const errorDetails = Object.values(error.errors).map((err: any) => ({
        field: err.path,
        message: err.message,
        value: err.value
      }));
      
      console.error('❌ Validation errors:', errorDetails);
      
      res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errorDetails
      });
      return;
    }
    
    if (error.code === 11000) {
      res.status(409).json({
        success: false,
        message: 'Duplicate entry found'
      });
      return;
    }
    
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Reject doctor registration
export const rejectDoctorRegistration = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { requestId } = req.params;
    const adminId = req.user?._id;
    const { admin_notes } = req.body;

    if (!req.user || req.user.role !== 'admin') {
      res.status(403).json({
        success: false,
        message: 'Access denied. Admin role required.'
      });
      return;
    }

    const request = await DoctorRegistrationRequest.findById(requestId);
    if (!request) {
      res.status(404).json({
        success: false,
        message: 'Registration request not found'
      });
      return;
    }

    if (request.status !== 'pending') {
      res.status(400).json({
        success: false,
        message: 'This request has already been processed'
      });
      return;
    }

    // Update request status
    request.status = 'rejected';
    request.reviewed_by = adminId;
    request.reviewed_at = new Date();
    request.admin_notes = admin_notes || 'Registration rejected by administrator';
    await request.save();

    // Send rejection email
    try {
      await emailService.sendDoctorRejectionEmail(
        request.email,
        request.name,
        admin_notes
      );
      console.log(`✅ Rejection email sent to: ${request.email}`);
    } catch (emailError) {
      console.error('❌ Error sending rejection email:', emailError);
      // Continue even if email fails
    }

    res.status(200).json({
      success: true,
      message: 'Doctor registration rejected successfully'
    });
  } catch (error) {
    console.error('❌ Error rejecting doctor registration:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// controllers/adminController.ts - Thêm các hàm còn thiếu
export const getAllAppointments = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const appointments = await Appointment.find()
      .populate('user_id', 'name email')
      .populate('doctor_id', 'name email')
      .populate('specialty_id', 'name')
      .sort({ created_at: -1 });

    res.status(200).json({
      success: true,
      data: appointments
    });
  } catch (error) {
    console.error('❌ Error in getAllAppointments:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export const getAllMedicalRecords = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const medicalRecords = await MedicalRecord.find()
      .populate('user_id', 'name email')
      .populate('doctor_id', 'name email')
      .sort({ created_at: -1 });

    res.status(200).json({
      success: true,
      data: medicalRecords
    });
  } catch (error) {
    console.error('❌ Error in getAllMedicalRecords:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export const getSystemLogs = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const logs: SystemLog[] = []; // Thay bằng SystemLog.find() nếu có model
    
    res.status(200).json({
      success: true,
      data: logs
    });
  } catch (error) {
    console.error('❌ Error in getSystemLogs:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};


export const getRegistrationRequestById = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { requestId } = req.params;

    const request = await DoctorRegistrationRequest.findById(requestId)
      .populate('specialty_id', 'name description')
      .populate('reviewed_by', 'name email');

    if (!request) {
      res.status(404).json({
        success: false,
        message: 'Registration request not found'
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: request
    });
  } catch (error) {
    console.error('❌ Error in getRegistrationRequestById:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};


export const lockUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { userId } = req.params;
    const adminId = req.user?._id;
    const { reason } = req.body;

    const user = await User.findById(userId);
    
    if (!user) {
      res.status(404).json({
        success: false,
        message: 'User not found'
      });
      return;
    }

    user.isLocked = true;
    user.lockedAt = new Date();
    user.lockedBy = adminId;
    await user.save();

    console.log(`🔒 Account locked for user: ${user.email} by admin: ${adminId}, reason: ${reason}`);

    res.status(200).json({
      success: true,
      message: 'User account locked successfully'
    });
  } catch (error) {
    console.error('❌ Error in lockUser:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export const unlockUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { userId } = req.params;
    const adminId = req.user?._id;

    const user = await User.findById(userId);
    
    if (!user) {
      res.status(404).json({
        success: false,
        message: 'User not found'
      });
      return;
    }

    // Reset lock status
    user.isLocked = false;
    user.loginAttempts = 0;
    user.lockedAt = undefined;
    user.lockedBy = adminId;
    await user.save();

    console.log(`🔓 Account unlocked for user: ${user.email} by admin: ${adminId}`);

    res.status(200).json({
      success: true,
      message: 'User account unlocked successfully'
    });
  } catch (error) {
    console.error('❌ Error in unlockUser:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};


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

export const getDrugById = async (req: Request, res: Response) => {
  try {
    const drug = await Drug.findById(req.params.id).populate('category_id', 'name');
    if (!drug) {
      return res.status(404).json({ success: false, message: 'Drug not found' });
    }
    res.status(200).json({ success: true, data: drug });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error fetching drug' });
  }
};

export const createDrug = async (req: Request, res: Response) => {
  try {
    const newDrug = new Drug(req.body);
    const savedDrug = await newDrug.save();
    res.status(201).json({ success: true, message: 'Drug created successfully', data: savedDrug });
  } catch (error: any) {
    console.error('Error creating drug:', error);
    res.status(400).json({ success: false, message: error.message || 'Error creating drug' });
  }
};

export const updateDrug = async (req: Request, res: Response) => {
  try {
    const updatedDrug = await Drug.findByIdAndUpdate(
      req.params.id,
      { $set: req.body },
      { new: true, runValidators: true }
    );
    if (!updatedDrug) {
      return res.status(404).json({ success: false, message: 'Drug not found' });
    }
    res.status(200).json({ success: true, message: 'Drug updated successfully', data: updatedDrug });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message || 'Error updating drug' });
  }
};

export const deleteDrug = async (req: Request, res: Response) => {
  try {
    const deletedDrug = await Drug.findByIdAndDelete(req.params.id);
    if (!deletedDrug) {
      return res.status(404).json({ success: false, message: 'Drug not found' });
    }
    res.status(200).json({ success: true, message: 'Drug deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error deleting drug' });
  }
};

// --- Categories ---

export const getAllCategories = async (req: Request, res: Response) => {
  try {
    const categories = await DrugCategory.find({}).sort({ name: 1 });
    res.status(200).json({ success: true, data: categories });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error fetching categories' });
  }
};

export const createCategory = async (req: Request, res: Response) => {
  try {
    const newCategory = new DrugCategory(req.body);
    const savedCategory = await newCategory.save();
    res.status(201).json({ success: true, message: 'Category created', data: savedCategory });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const createSpecialty = async (req: Request, res: Response) => {
  try {
    const newSpecialty = new Specialty(req.body);
    const savedSpecialty = await newSpecialty.save();
    res.status(201).json({ success: true, message: 'Specialty created successfully', data: savedSpecialty });
  } catch (error: any) {
    console.error('Error creating specialty:', error);
    // Handle duplicate key error
    if (error.code === 11000) {
      return res.status(400).json({ success: false, message: 'A specialty with this name already exists' });
    }
    res.status(400).json({ success: false, message: error.message || 'Error creating specialty' });
  }
};
