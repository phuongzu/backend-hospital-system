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

const router = express.Router();

// Public routes
router.post('/register', registerUser);
router.post('/login', loginUser);
router.post('/refresh-token', refreshToken);
router.post('/forgot-password', forgotPassword);
router.post('/verify-reset-password', verifyCodeAndResetPassword);
router.post('/resend-verification-code', resendVerificationCode);

// Protected routes
router.put('/doctor/profile', protect, upsertDoctorProfile);
router.get('/patient', protect, getRecordsByPatientName);
router.get('/doctor/records', protect, getRecordsByDoctorName);
router.post('/change-password', protect, changePassword);
router.post('/logout', protect, logoutUser);
router.patch('/admin/doctors/:doctorId/unlock', protect, unlockDoctorAccount);
router.patch('/admin/doctors/:doctorId/lock', protect, lockDoctorAccount);
router.get('/admin/doctors/locked', protect, getLockedDoctors);
router.post('/unlock-request', submitUnlockRequest);
router.get('/admin/unlock-requests/pending', protect, getPendingUnlockRequests);
router.post('/admin/unlock-requests/:requestId/approve', protect, approveUnlockRequest);
router.post('/admin/unlock-requests/:requestId/reject', protect, rejectUnlockRequest);
export default router;
