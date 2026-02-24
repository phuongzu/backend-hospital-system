import express from 'express';
import { 
  registerUser, 
  loginUser, 
  refreshToken, 
  logoutUser, 
  upsertDoctorProfile,
  changePassword,
  getRecordsByPatientName,
  getRecordsByDoctorName,
  forgotPassword,
  verifyCodeAndResetPassword,
  resendVerificationCode,
  unlockDoctorAccount,
  lockDoctorAccount,
  getLockedDoctors,
  submitUnlockRequest,
  getPendingUnlockRequests,
  approveUnlockRequest,
  rejectUnlockRequest
} from '../controllers/authcontroller';

import { protect } from '../middlewares/authmiddleware';
import { validateRequest } from '../middlewares/validateRequest';
import {
  RegisterSchema,
  LoginSchema,
  ForgotPasswordSchema,
  ResetPasswordSchema,
  ChangePasswordSchema,
  DoctorProfileSchema
} from '../validations/schemas';

const router = express.Router();

// Public routes with validation
router.post('/register', validateRequest(RegisterSchema, 'body'), registerUser);
router.post('/login', validateRequest(LoginSchema, 'body'), loginUser);
router.post('/refresh-token', refreshToken);
router.post('/forgot-password', validateRequest(ForgotPasswordSchema, 'body'), forgotPassword);
router.post('/verify-reset-password', validateRequest(ResetPasswordSchema, 'body'), verifyCodeAndResetPassword);
router.post('/resend-verification-code', resendVerificationCode);

// Protected routes with validation
router.put('/doctor/profile', protect, validateRequest(DoctorProfileSchema, 'body'), upsertDoctorProfile);
router.get('/patient', protect, getRecordsByPatientName);
router.get('/doctor/records', protect, getRecordsByDoctorName);
router.post('/change-password', protect, validateRequest(ChangePasswordSchema, 'body'), changePassword);
router.post('/logout', protect, logoutUser);
router.patch('/admin/doctors/:doctorId/unlock', protect, unlockDoctorAccount);
router.patch('/admin/doctors/:doctorId/lock', protect, lockDoctorAccount);
router.get('/admin/doctors/locked', protect, getLockedDoctors);
router.post('/unlock-request', submitUnlockRequest);
router.get('/admin/unlock-requests/pending', protect, getPendingUnlockRequests);
router.post('/admin/unlock-requests/:requestId/approve', protect, approveUnlockRequest);
router.post('/admin/unlock-requests/:requestId/reject', protect, rejectUnlockRequest);
export default router;
