import express, { Request, Response } from 'express';
import {
  getAllDoctors,
  updateUser,
  getUser,
  bookAppointment,
  getAllMedicalRecordsForPatient,
  getAllAppointmentsForPatient,
  editAppointment,
  cancelAppointment,
  postDoctorReview,
  getDoctorReviews,
  updateReview,
  getAppointmentAvailability,
  getPatientInfo,
  updatePatientInfo,
  editInfoPatient,
  updateEmergencyContact,
  updateMedications,
  addMedication,
  removeMedication,
  getUserReviews,
  deleteReview,
  getMyMedicalRecords,
  postEmergencyContact,
  uploadAvatar,
  deleteAvatar,
  getAvatar,
  checkInAppointment
} from '../controllers/patientcontroller';
import { protect } from '../middlewares/authmiddleware';
import { validateRequest } from '../middlewares/validateRequest';
import  logger  from '../utils/logger';
import {
  UpdatePatientInfoSchema,
  EmergencyContactSchema,
  CreateReviewSchema
} from '../validations/schemas';
import multer from 'multer';
import path from 'path';
import fs from 'fs';


const router = express.Router();

// Public routes
router.get('/doctors', getAllDoctors);
router.get('/doctors/:doctor_id/reviews', getDoctorReviews);

// Protected routes
router.use(protect);

// Profile routes
router.get('/profile', getUser);
router.put('/profile', updateUser);

// Patient info routes
router.get('/patient-info', getPatientInfo);
router.post('/patient-info', validateRequest(UpdatePatientInfoSchema, 'body'), updatePatientInfo);
router.patch('/patient-info/edit', validateRequest(UpdatePatientInfoSchema, 'body'), editInfoPatient);

// Emergency contact routes
router.put('/emergency-contact', validateRequest(EmergencyContactSchema, 'body'), updateEmergencyContact);
router.post('/emergency-contact', validateRequest(EmergencyContactSchema, 'body'), postEmergencyContact);

// Medications routes
router.put('/medications', updateMedications);
router.post('/medications/add', addMedication);
router.delete('/medications/remove', removeMedication);

// Appointment routes
router.get('/appointments/availability', getAppointmentAvailability);
router.post('/appointments', bookAppointment);
router.get('/medical-records', getAllMedicalRecordsForPatient);
router.get('/appointments/history', getAllAppointmentsForPatient);
router.patch('/appointments/:appointment_id/edit', editAppointment);
router.patch('/appointments/:appointment_id/cancel', cancelAppointment);
router.patch('/reviews/:review_id', updateReview);
router.post('/doctors/:doctor_id/reviews', validateRequest(CreateReviewSchema, 'body'), postDoctorReview);
router.get('/reviews/user', getUserReviews);
router.delete('/reviews/:review_id', deleteReview);
router.get('/medical-records/my-records', protect, getMyMedicalRecords);
router.patch('/appointments/:appointment_id/check-in', protect, checkInAppointment);




const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/avatars/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'avatar-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage,
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  },
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB
});
router.post('/upload-avatar', protect, uploadAvatar);
logger.debug('uploadAvatar function loaded');
router.delete('/remove-avatar', protect, deleteAvatar);
router.get('/avatar', protect, getAvatar);

router.get('/avatar/:filename', async (req: Request, res: Response) => {
  try {
    const { filename } = req.params;
    
    if (!filename || filename.includes('..')) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid filename' 
      });
    }

    // Đường dẫn đầy đủ tới file
    const avatarPath = path.join(__dirname, '..', 'uploads', 'avatars', filename);
    
    logger.debug('🔍 Serving avatar:', {
      requested: filename,
      fullPath: avatarPath,
      exists: fs.existsSync(avatarPath)
    });

    // Kiểm tra file tồn tại
    if (!fs.existsSync(avatarPath)) {
      logger.warn('❌ Avatar not found:', { avatarPath });
      
      // Trả về ảnh mặc định nếu không tìm thấy
      const defaultAvatarPath = path.join(__dirname, '..', 'public', 'default-avatar.jpg');
      if (fs.existsSync(defaultAvatarPath)) {
        return res.sendFile(defaultAvatarPath);
      }
      
      return res.status(404).json({ 
        success: false, 
        message: 'Avatar not found' 
      });
    }

    // Xác định Content-Type
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
      case '.svg':
        contentType = 'image/svg+xml';
        break;
    }
    
    // Set headers và gửi file
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache 1 ngày
    res.setHeader('Access-Control-Allow-Origin', '*'); // CORS
    
    logger.debug('✅ Serving avatar with headers:', {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=86400'
    });
    
    res.sendFile(avatarPath);
    
  } catch (error: any) {
    logger.error('❌ Error serving avatar:', {
      filename: req.params.filename,
      errorMessage: error.message,
      stack: error.stack
    });
    res.status(500).json({ 
      success: false, 
      message: 'Error serving avatar',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});


export default router;