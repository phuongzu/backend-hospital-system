// routes/admin.ts - Đảm bảo tất cả routes đều tồn tại
import express from 'express';
import {
  getAdminDashboard,
  getAllDoctors,
  getAllPatients,
  getAllAppointments,
  getAllMedicalRecords,
  getPendingUnlockRequests,
  getDoctorRegistrationRequests,
  approveDoctorRegistration,
  rejectDoctorRegistration,
  approveUnlockRequest,
  rejectUnlockRequest,
  getSystemLogs,
  lockUser,
  unlockUser,
  updateUserStatus,
  getAllDrugs,
  getDrugById,
  updateDrug,
  deleteDrug,
  getAllCategories,
  createCategory,
  createDrug
} from '../controllers/adminController';
import { protect } from '../middlewares/authmiddleware';
import { validateRequest } from '../middlewares/validateRequest';

const router = express.Router();

// Tất cả routes phải tồn tại
router.get('/dashboard', protect, getAdminDashboard);
router.get('/doctors', protect, getAllDoctors);
router.get('/patients', protect, getAllPatients);
router.get('/appointments', protect, getAllAppointments);
router.get('/medical-records', protect, getAllMedicalRecords);
router.get('/unlock-requests', protect, getPendingUnlockRequests);
router.get('/doctor-registrations', protect, getDoctorRegistrationRequests);
router.get('/system-logs', protect, getSystemLogs);

// Approval routes
router.post('/doctor-registrations/:requestId/approve', protect, approveDoctorRegistration);
router.post('/doctor-registrations/:requestId/reject', protect, rejectDoctorRegistration);
router.post('/unlock-requests/:requestId/approve', protect, approveUnlockRequest);
router.post('/unlock-requests/:requestId/reject', protect, rejectUnlockRequest);


router.patch('/users/:userId/lock', protect, lockUser);
router.patch('/users/:userId/unlock', protect, unlockUser);
router.patch('/users/:userId/status', protect, updateUserStatus);


router.get('/drugs', getAllDrugs);
router.get('/drugs/:id',getDrugById);
router.post('/drugs',createDrug);
router.put('/drugs/:id',updateDrug);
router.delete('/drugs/:id',deleteDrug);

// --- Drug Category Routes ---
router.get('/drug-categories',getAllCategories);
router.post('/drug-categories',createCategory);

export default router;