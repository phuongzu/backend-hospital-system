import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import User, { IUser } from '../models/user';
import Doctor from '../models/doctor';
import MedicalRecord from '../models/medicalRecord';
import Specialty from '../models/specialty';
import { AuthRequest } from '../middlewares/authmiddleware';
import { emailService } from '../utils/emailService';
import UnlockRequest from '../models/unlockRequest';
import DoctorRegistrationRequest from '../models/doctorRegistrationRequest';


// Verification code storage
interface VerificationCode {
  code: string;
  email: string;
  expiresAt: Date;
}

// In-memory store for verification codes (consider using a persistent store in production)
const verificationCodes = new Map<string, VerificationCode>();

// Generate random 6-digit code
const generateVerificationCode = (): string => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Forgot password - send verification code
export const forgotPassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email } = req.body;

    console.log('📨 Forgot password request for:', email);

    if (!email) {
      res.status(400).json({
        success: false,
        message: 'Email is required'
      });
      return;
    }

    // Find user by email
    const user = await User.findOne({ email: email.toLowerCase().trim() });

    console.log('👤 User found:', !!user);

    // For security reasons, don't reveal if email exists or not
    if (!user) {
      console.log('📧 Email not found, but returning success for security');
      res.status(200).json({
        success: true,
        message: 'If the email exists, a verification code has been sent'
      });
      return;
    }

    // Generate verification code
    const verificationCode = generateVerificationCode();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    console.log('🔐 Generated code:', verificationCode);

    // Store verification code
    verificationCodes.set(email.toLowerCase().trim(), {
      code: verificationCode,
      email: email.toLowerCase().trim(),
      expiresAt
    });

    // Send verification code via email
    try {
      console.log('🚀 Attempting to send email...');
      await emailService.sendVerificationCode(
        email.toLowerCase().trim(),
        verificationCode,
        user.name
      );

      console.log('✅ Email sent successfully');

      res.status(200).json({
        success: true,
        message: 'Verification code sent to your email'
      });
    } catch (emailError) {
      console.error('❌ Email sending failed:', emailError);

      // Remove the stored code if email fails
      verificationCodes.delete(email.toLowerCase().trim());

      res.status(500).json({
        success: false,
        message: 'Failed to send verification email. Please try again later.'
      });
    }

  } catch (error) {
    console.error('❌ Error in forgotPassword:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Verify code and reset password
export const verifyCodeAndResetPassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, code, newPassword } = req.body;

    if (!email || !code || !newPassword) {
      res.status(400).json({
        success: false,
        message: 'Email, verification code, and new password are required'
      });
      return;
    }

    // Password strength validation
    if (newPassword.length < 6) {
      res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long'
      });
      return;
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Find stored verification code
    const storedCode = verificationCodes.get(normalizedEmail);

    if (!storedCode) {
      res.status(400).json({
        success: false,
        message: 'Invalid or expired verification code'
      });
      return;
    }

    // Check if code has expired
    if (new Date() > storedCode.expiresAt) {
      verificationCodes.delete(normalizedEmail);
      res.status(400).json({
        success: false,
        message: 'Verification code has expired'
      });
      return;
    }

    // Verify code
    if (storedCode.code !== code) {
      res.status(400).json({
        success: false,
        message: 'Invalid verification code'
      });
      return;
    }

    // Find user
    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      res.status(404).json({
        success: false,
        message: 'User not found'
      });
      return;
    }

    // Hash new password
    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(newPassword, saltRounds);

    // Update password
    await User.findByIdAndUpdate(user._id, {
      password: hashedPassword
    });

    // Remove used verification code
    verificationCodes.delete(normalizedEmail);

    await User.findByIdAndUpdate(user._id, {
      refreshToken: null
    });

    res.status(200).json({
      success: true,
      message: 'Password reset successfully'
    });

  } catch (error) {
    console.error('❌ Error in verifyCodeAndResetPassword:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Resend verification code
export const resendVerificationCode = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email } = req.body;

    if (!email) {
      res.status(400).json({
        success: false,
        message: 'Email is required'
      });
      return;
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Find user
    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      // Still return success for security
      res.status(200).json({
        success: true,
        message: 'If the email exists, a new verification code has been sent'
      });
      return;
    }

    // Generate new verification code
    const verificationCode = generateVerificationCode();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    // Update verification code
    verificationCodes.set(normalizedEmail, {
      code: verificationCode,
      email: normalizedEmail,
      expiresAt
    });

    // Send new verification code
    try {
      await emailService.sendVerificationCode(
        normalizedEmail,
        verificationCode,
        user.name
      );

      res.status(200).json({
        success: true,
        message: 'New verification code sent to your email'
      });
    } catch (emailError) {
      console.error('Email sending failed:', emailError);
      res.status(500).json({
        success: false,
        message: 'Failed to send verification email'
      });
    }

  } catch (error) {
    console.error('❌ Error in resendVerificationCode:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};



const generateToken = (id: string, role: string, name: string, email: string): string => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is not set');
  }

  return jwt.sign(
    {
      userId: id,
      id: id,
      role: role,
      name: name,   // Thêm name
      email: email, // Thêm email
    },
    secret,
    { expiresIn: '7d' }
  );
};


const generateRefreshToken = (id: string): string => {
  const secret = process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT refresh secret is not configured');
  }

  return jwt.sign({ id }, secret, { expiresIn: '30d' });
};



export const registerUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, email, password, role, phoneNumber, doctorProfile } = req.body;

    // Enhanced input validation
    if (!name || !email || !password) {
      res.status(400).json({
        success: false,
        message: 'Name, email, and password are required'
      });
      return;
    }

    // Email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      res.status(400).json({
        success: false,
        message: 'Please provide a valid email address'
      });
      return;
    }

    // Password strength validation
    if (password.length < 6) {
      res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long'
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

    // NEW LOGIC: If registering as doctor, create registration request instead of user
    if (role === 'doctor') {
      const { specialty_id, license_number, years_of_experience, consultation_fee } = doctorProfile || {};

      // Validate required doctor fields
      if (!specialty_id || !license_number || !years_of_experience || !consultation_fee) {
        res.status(400).json({
          success: false,
          message: 'For doctor registration, specialty, license number, years of experience, and consultation fee are required'
        });
        return;
      }

      // Check if license number already exists in registration requests
      const existingLicense = await DoctorRegistrationRequest.findOne({ license_number });
      if (existingLicense) {
        res.status(409).json({
          success: false,
          message: 'License number already exists in registration requests'
        });
        return;
      }

      // Check if email already exists in registration requests
      const existingRequest = await DoctorRegistrationRequest.findOne({ email: email.toLowerCase() });
      if (existingRequest) {
        res.status(409).json({
          success: false,
          message: 'Registration request with this email already exists and is pending review'
        });
        return;
      }

      // Create doctor registration request
      const registrationRequest = await DoctorRegistrationRequest.create({
        name: name.trim(),
        email: email.toLowerCase().trim(),
        phoneNumber: phoneNumber || '',
        specialty_id,
        license_number,
        years_of_experience,
        consultation_fee,
        status: 'pending',
        submitted_at: new Date()
      });

      console.log(`📝 Doctor registration request created: ${registrationRequest._id}`);

      res.status(201).json({
        success: true,
        message: 'Doctor registration request submitted successfully. Please wait for admin approval.',
        data: {
          requestId: registrationRequest._id,
          status: 'pending',
          estimatedReviewTime: '24-48 hours'
        }
      });
      return;
    }

    // For patient registration (existing logic)
    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Create new user (only for patients)
    const newUser: IUser = await User.create({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      password: hashedPassword,
      role: 'patient', // Default to patient role
      phoneNumber: phoneNumber || '',
      isActive: true,
      lastLogin: null,
      dateOfBirth: req.body.dateOfBirth || '',
      gender: req.body.gender || '',
      address: req.body.address || '',
    });

    // Generate tokens for patient
    const accessToken = generateToken(String(newUser._id), newUser.role, newUser.name, newUser.email);
    const refreshToken = generateRefreshToken(String(newUser._id));

    // Update user with refresh token
    await User.findByIdAndUpdate(newUser._id, {
      refreshToken: refreshToken,
      lastLogin: new Date()
    });

    res.status(201).json({
      success: true,
      message: 'Patient registered successfully',
      data: {
        _id: newUser._id,
        name: newUser.name,
        email: newUser.email,
        role: newUser.role,
        phoneNumber: newUser.phoneNumber || '',
        dateOfBirth: newUser.dateOfBirth || '',
        gender: newUser.gender || '',
        address: newUser.address || '',
        accessToken,
        refreshToken
      }
    });

  } catch (error) {
    console.error('❌ Error in registerUser:', error);

    if (error instanceof Error && error.message.includes('JWT')) {
      res.status(500).json({
        success: false,
        message: 'Server configuration error'
      });
      return;
    }

    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};


export const loginUser = async (req: Request, res: Response): Promise<void> => {
  try {
    console.log('🔐 Login request received:', {
      email: req.body.email,
      passwordLength: req.body.password ? req.body.password.length : 0
    });

    const { email, password } = req.body as { email?: string; password?: string };

    // Input validation
    if (!email || !password) {
      console.log('❌ Missing email or password');
      res.status(400).json({
        success: false,
        message: 'Email and password are required'
      });
      return;
    }

    // Normalize email - FIX QUAN TRỌNG
    const normalizedEmail = email.toLowerCase().trim();
    console.log('📧 Normalized email:', normalizedEmail);

    // Find user with password - FIX: select đúng các field cần thiết
    const user = await User.findOne({
      email: normalizedEmail
    }).select('+password +refreshToken +isActive +isLocked +loginAttempts +role');

    console.log('👤 User found:', user ? 'Yes' : 'No');
    if (user) {
      console.log('🔍 User details:', {
        id: user._id,
        email: user.email,
        role: user.role,
        isActive: user.isActive,
        isLocked: user.isLocked,
        loginAttempts: user.loginAttempts
      });
    } else {
      console.log('❌ No user found with email:', normalizedEmail);
      // Log all admin users for debugging
      const allAdmins = await User.find({ role: 'admin' }).select('email');
      console.log('📋 All admin users:', allAdmins.map(admin => admin.email));
    }

    if (!user) {
      res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
      return;
    }

    // Check if account is locked (for doctors)
    if (user.role === 'doctor' && user.isLocked) {
      const lockDate = user.lockedAt ? new Date(user.lockedAt).toLocaleDateString() : 'unknown date';
      res.status(423).json({
        success: false,
        message: `Account has been locked since ${lockDate}. Please contact administrator to unlock your account.`
      });
      return;
    }

    // Check if account is active
    if (!user.isActive) {
      console.log('❌ Account inactive for:', user.email);
      res.status(403).json({
        success: false,
        message: 'Account is deactivated. Please contact support.'
      });
      return;
    }

    // Verify password - FIX: Thêm log chi tiết
    console.log('🔑 Starting password verification...');
    console.log('🔑 Input password length:', password.length);
    console.log('🔑 Stored password hash:', user.password ? 'Exists' : 'Missing');

    const isPasswordValid = await bcrypt.compare(password, user.password);
    console.log('🔑 Password validation result:', isPasswordValid);

    if (!isPasswordValid) {
      console.log('❌ Password invalid for user:', user.email);

      // Handle failed login attempts for doctors
      if (user.role === 'doctor') {
        const currentAttempts = user.loginAttempts || 0;
        user.loginAttempts = currentAttempts + 1;

        if (user.loginAttempts >= 5) {
          user.isLocked = true;
          user.lockedAt = new Date();
          await user.save();

          console.log(`🔒 Account locked for doctor: ${user.email}`);

          res.status(423).json({
            success: false,
            message: 'Account has been locked due to too many failed attempts. Please contact administrator.'
          });
          return;
        } else {
          await user.save();
          console.log(`⚠️ Login attempts for ${user.email}: ${user.loginAttempts}`);
        }
      }

      res.status(401).json({
        success: false,
        message: `Invalid credentials. ${user.role === 'doctor' ? `Attempts remaining: ${5 - (user.loginAttempts || 0)}` : ''}`
      });
      return;
    }

    console.log('✅ Password valid for user:', user.email);

    // Reset login attempts for doctors on successful login
    if (user.role === 'doctor' && (user.loginAttempts && user.loginAttempts > 0)) {
      user.loginAttempts = 0;
      await user.save();
    }

    // Generate tokens
    const accessToken = generateToken(
      String(user._id),
      user.role,
      user.name,
      user.email  // thêm email
    );
    const refreshToken = generateRefreshToken(String(user._id));

    // Update user with refresh token and last login
    const updateData: any = {
      refreshToken: refreshToken,
      lastLogin: new Date()
    };
    if (user.role === 'doctor') {
      updateData.loginAttempts = 0;
    }

    await User.findByIdAndUpdate(user._id, updateData);

    // Get doctor profile if user is doctor
    let doctorProfile = null;
    if (user.role === 'doctor') {
      const doctor = await Doctor.findOne({ user_id: user._id })
        .populate('user_id', 'name email phoneNumber')
        .populate('specialty_id', 'name');

      if (doctor) {
        doctorProfile = {
          _id: doctor._id,
          specialty_id: doctor.specialty_id,
          license_number: doctor.license_number,
          years_of_experience: doctor.years_of_experience,
          isAvailable: doctor.isAvailable,
          consultation_fee: doctor.consultation_fee
        };
      }
    }

    console.log('🎉 Login successful for:', {
      email: user.email,
      role: user.role,
      userId: user._id
    });

    // Successful login response
    res.status(200).json({
      success: true,
      message: 'Login successful',
      data: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        phoneNumber: user.phoneNumber || '',
        dateOfBirth: user.dateOfBirth || '',
        gender: user.gender || '',
        address: user.address || '',
        accessToken,
        refreshToken,
        lastLogin: user.lastLogin,
        doctorProfile: doctorProfile || undefined
      }
    });

  } catch (error) {
    console.error('❌ Login error:', error);
    if (error instanceof mongoose.Error.ValidationError) {
      res.status(400).json({
        success: false,
        message: 'Validation error: ' + Object.values(error.errors).map(e => e.message).join(', ')
      });
      return;
    }

    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export const upsertDoctorProfile = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
      return;
    }

    if (req.user.role !== 'doctor') {
      res.status(403).json({
        success: false,
        message: 'Only doctors can update doctor profiles'
      });
      return;
    }

    const {
      specialty_id,
      license_number,
      years_of_experience,
      available_hours,
      isAvailable,
      consultation_fee,
      languages,
      education,
      certifications
    } = req.body;

    // Validate required fields
    if (!specialty_id || !license_number) {
      res.status(400).json({
        success: false,
        message: 'Specialty and license number are required'
      });
      return;
    }

    // Upsert doctor profile
    const doctorProfile = await Doctor.findOneAndUpdate(
      { user_id: req.user._id },
      {
        specialty_id,
        license_number,
        years_of_experience: years_of_experience || 0,
        available_hours: available_hours || [],
        isAvailable: isAvailable !== undefined ? isAvailable : true,
        consultation_fee: consultation_fee || 0,
        languages: languages || [],
        education: education || [],
        certifications: certifications || []
      },
      {
        upsert: true,
        new: true,
        runValidators: true
      }
    ).populate('specialty_id', 'name');

    res.status(200).json({
      success: true,
      message: 'Doctor profile updated successfully',
      data: doctorProfile
    });
  } catch (error) {
    console.error('❌ Error in upsertDoctorProfile:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// authcontroller.ts
export const getRecordsByPatientName = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }

    const { patientName } = req.query;

    if (!patientName) {
      res.status(400).json({ success: false, message: 'Patient name is required' });
      return;
    }

    // Tìm patients bằng tên
    const patients = await User.find({
      name: { $regex: patientName, $options: 'i' },
      role: 'patient'
    });

    const patientIds = patients.map(patient => patient._id);

    // Tìm records bằng patient_id
    const records = await MedicalRecord.find({
      patient_id: { $in: patientIds }
    })
      .populate('patient_id', 'name email phoneNumber')
      .populate('doctor_id', 'name email')
      .populate('appointment_id');

    res.status(200).json({
      success: true,
      data: records
    });
  } catch (error) {
    console.error('❌ Error in getRecordsByPatientName:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const getRecordsByDoctorName = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }

    const { doctorName } = req.query;

    if (!doctorName) {
      res.status(400).json({ success: false, message: 'Doctor name is required' });
      return;
    }

    // Tìm doctors bằng tên
    const doctors = await User.find({
      name: { $regex: doctorName, $options: 'i' },
      role: 'doctor'
    });

    const doctorIds = doctors.map(doctor => doctor._id);

    // Tìm records bằng doctor_id
    const records = await MedicalRecord.find({
      doctor_id: { $in: doctorIds }
    })
      .populate('patient_id', 'name email phoneNumber')
      .populate('doctor_id', 'name email')
      .populate('appointment_id');

    res.status(200).json({
      success: true,
      data: records
    });
  } catch (error) {
    console.error('❌ Error in getRecordsByDoctorName:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Refresh access token
export const refreshToken = async (req: Request, res: Response): Promise<void> => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      res.status(400).json({
        success: false,
        message: 'Refresh token is required'
      });
      return;
    }

    // Verify refresh token
    const secret = process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET;
    if (!secret) {
      res.status(500).json({
        success: false,
        message: 'Server configuration error'
      });
      return;
    }

    const decoded = jwt.verify(refreshToken, secret) as { id: string };

    // Find user and check if refresh token matches
    const user = await User.findById(decoded.id);
    if (!user || user.refreshToken !== refreshToken) {
      res.status(401).json({
        success: false,
        message: 'Invalid refresh token'
      });
      return;
    }
    const newAccessToken = generateToken(String(user._id), user.role, user.name, user.email);
    const newRefreshToken = generateRefreshToken(String(user._id));

    // Update refresh token
    await User.findByIdAndUpdate(user._id, {
      refreshToken: newRefreshToken
    });

    res.status(200).json({
      success: true,
      message: 'Token refreshed successfully',
      data: {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
      }
    });

  } catch (error) {
    console.error('❌ Error in refreshToken:', error);

    if (error instanceof jwt.JsonWebTokenError) {
      res.status(401).json({
        success: false,
        message: 'Invalid refresh token'
      });
      return;
    }

    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Logout user with token invalidation
export const logoutUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
      return;
    }

    // Invalidate refresh token
    await User.findByIdAndUpdate(req.user._id, {
      refreshToken: null
    });

    res.status(200).json({
      success: true,
      message: 'Logout successful'
    });

  } catch (error) {
    console.error('❌ Error in logoutUser:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Change password
export const changePassword = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
      return;
    }

    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      res.status(400).json({
        success: false,
        message: 'Current password and new password are required'
      });
      return;
    }

    if (newPassword.length < 6) {
      res.status(400).json({
        success: false,
        message: 'New password must be at least 6 characters long'
      });
      return;
    }

    // Get user with password
    const user = await User.findById(req.user._id).select('+password');
    if (!user) {
      res.status(404).json({
        success: false,
        message: 'User not found'
      });
      return;
    }
    // Verify current password
    const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password);
    if (!isCurrentPasswordValid) {
      res.status(400).json({
        success: false,
        message: 'Current password is incorrect'
      });
      return;
    }

    // Hash new password
    const saltRounds = 12;
    const hashedNewPassword = await bcrypt.hash(newPassword, saltRounds);

    // Update password
    await User.findByIdAndUpdate(req.user._id, {
      password: hashedNewPassword
    });

    res.status(200).json({
      success: true,
      message: 'Password changed successfully'
    });

  } catch (error) {
    console.error('❌ Error in changePassword:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Unlock doctor account (Admin only)
export const unlockDoctorAccount = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { doctorId } = req.params;
    const adminId = req.user?._id;
    if (req.user?.role !== 'admin') {
      res.status(403).json({
        success: false,
        message: 'Access denied. Admin role required.'
      });
      return;
    }

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
    console.error('Unlock doctor account error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Lock doctor account manually (Admin only)
export const lockDoctorAccount = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { doctorId } = req.params;
    const adminId = req.user?._id;
    const { reason } = req.body;
    if (req.user?.role !== 'admin') {
      res.status(403).json({
        success: false,
        message: 'Access denied. Admin role required.'
      });
      return;
    }

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
    console.error('Lock doctor account error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};
export const getLockedDoctors = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (req.user?.role !== 'admin') {
      res.status(403).json({
        success: false,
        message: 'Access denied. Admin role required.'
      });
      return;
    }

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
    console.error('Get locked doctors error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Submit unlock request from locked doctor
export const submitUnlockRequest = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, reason } = req.body;

    console.log('🔓 Unlock request received for email:', email);

    if (!email) {
      res.status(400).json({
        success: false,
        message: 'Email is required'
      });
      return;
    }

    // Find the locked doctor
    const doctor = await User.findOne({
      email: email.toLowerCase().trim(),
      role: 'doctor'
    });

    if (!doctor) {
      console.log('❌ No doctor found with email:', email);
      res.status(404).json({
        success: false,
        message: 'No doctor account found with this email'
      });
      return;
    }

    // Check if account is actually locked
    if (!doctor.isLocked) {
      res.status(400).json({
        success: false,
        message: 'Your account is not locked. You can login normally.'
      });
      return;
    }

    console.log('✅ Found locked doctor:', doctor.name, doctor.email);

    // Check if there's already a pending request
    const existingRequest = await UnlockRequest.findOne({
      doctor_id: doctor._id,
      status: 'pending'
    });

    if (existingRequest) {
      console.log('⚠️ Pending request already exists for doctor:', doctor.email);
      res.status(409).json({
        success: false,
        message: 'You already have a pending unlock request. Please wait for admin review.'
      });
      return;
    }

    // Create unlock request
    const estimatedUnlockTime = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours from now

    const unlockRequest = await UnlockRequest.create({
      doctor_id: doctor._id,
      doctor_email: doctor.email,
      doctor_name: doctor.name,
      request_reason: reason,
      status: 'pending',
      estimated_unlock_time: estimatedUnlockTime
    });

    console.log('✅ Unlock request created:', unlockRequest._id);

    // Send confirmation email to doctor
    try {
      await emailService.sendUnlockRequestConfirmation(
        doctor.email,
        doctor.name,
        estimatedUnlockTime
      );
      console.log(`✅ Unlock request confirmation sent to: ${doctor.email}`);
    } catch (emailError) {
      console.error('❌ Failed to send confirmation email:', emailError);
      // Continue anyway - don't fail the request because of email
    }

    // Send notification to ALL admins
    try {
      const admins = await User.find({ role: 'admin' }).select('email name');
      console.log(`📧 Found ${admins.length} admins to notify`);

      if (admins.length === 0) {
        console.log('⚠️ No admin users found in the system');
      } else {
        for (const admin of admins) {
          try {
            await emailService.sendUnlockRequestToAdmin(
              admin.email,
              doctor.name,
              doctor.email,
              reason
            );
            console.log(`✅ Unlock request notification sent to admin: ${admin.email}`);
          } catch (adminEmailError) {
            console.error(`❌ Failed to send email to admin ${admin.email}:`, adminEmailError);
            // Continue with other admins
          }
        }
        console.log(`✅ Successfully notified ${admins.length} admins`);
      }
    } catch (adminError) {
      console.error('❌ Error in admin notification process:', adminError);
      // Continue anyway - don't fail the main request
    }

    res.status(200).json({
      success: true,
      message: 'Unlock request submitted successfully. You will receive an email confirmation and our admin team will review your request within 24 hours.',
      data: {
        request_id: unlockRequest._id,
        estimated_unlock_time: estimatedUnlockTime
      }
    });

  } catch (error) {
    console.error('❌ Error in submitUnlockRequest:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get all pending unlock requests (Admin only)
export const getPendingUnlockRequests = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (req.user?.role !== 'admin') {
      res.status(403).json({
        success: false,
        message: 'Access denied. Admin role required.'
      });
      return;
    }

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

// Approve unlock request (Admin only)
export const approveUnlockRequest = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { requestId } = req.params;
    const adminId = req.user?._id;
    const { admin_notes } = req.body;

    if (req.user?.role !== 'admin') {
      res.status(403).json({
        success: false,
        message: 'Access denied. Admin role required.'
      });
      return;
    }

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

    // Send unlock notification to doctor
    try {
      await emailService.sendAccountUnlockedNotification(
        doctor.email,
        doctor.name,
        req.user.name
      );
      console.log(`✅ Account unlocked notification sent to: ${doctor.email}`);
    } catch (emailError) {
      console.error('❌ Failed to send unlock notification:', emailError);
    }

    res.status(200).json({
      success: true,
      message: 'Doctor account unlocked successfully',
      data: {
        doctor: {
          _id: doctor._id,
          name: doctor.name,
          email: doctor.email
        },
        unlocked_by: req.user.name,
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

// Reject unlock request (Admin only)
export const rejectUnlockRequest = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { requestId } = req.params;
    const adminId = req.user?._id;
    const { admin_notes } = req.body;

    if (req.user?.role !== 'admin') {
      res.status(403).json({
        success: false,
        message: 'Access denied. Admin role required.'
      });
      return;
    }

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


// Submit doctor registration request
export const submitDoctorRegistration = async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      name,
      email,
      phoneNumber,
      specialty_id,
      license_number,
      years_of_experience,
      consultation_fee
    } = req.body;

    // Validate required fields
    if (!name || !email || !phoneNumber || !specialty_id || !license_number) {
      res.status(400).json({
        success: false,
        message: 'All fields are required'
      });
      return;
    }

    // Check if email already exists in users or pending requests
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      res.status(409).json({
        success: false,
        message: 'Email already registered'
      });
      return;
    }

    const existingRequest = await DoctorRegistrationRequest.findOne({
      email: email.toLowerCase(),
      status: 'pending'
    });
    if (existingRequest) {
      res.status(409).json({
        success: false,
        message: 'Registration request already submitted and pending review'
      });
      return;
    }

    // Check if license number already exists
    const existingLicense = await Doctor.findOne({ license_number });
    if (existingLicense) {
      res.status(409).json({
        success: false,
        message: 'License number already registered'
      });
      return;
    }

    // Create registration request
    const registrationRequest = await DoctorRegistrationRequest.create({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      phoneNumber: phoneNumber.trim(),
      specialty_id,
      license_number: license_number.trim(),
      years_of_experience: years_of_experience || 0,
      consultation_fee: consultation_fee || 0,
      status: 'pending'
    });

    // Send confirmation email
    try {
      await emailService.sendRegistrationConfirmation(
        email,
        name
      );
    } catch (emailError) {
      console.error('Error sending confirmation email:', emailError);
    }

    res.status(201).json({
      success: true,
      message: 'Registration request submitted successfully. Please wait for admin approval.',
      data: {
        requestId: registrationRequest._id,
        status: 'pending'
      }
    });
  } catch (error) {
    console.error('Error submitting doctor registration:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};