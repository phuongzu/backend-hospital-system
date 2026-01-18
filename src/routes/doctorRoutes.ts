import express from 'express';
import { 
  getAvailableDoctors, 
  getDoctorsBySpecialty, 
  getDoctorsFromUsers,
  changeDoctorStatus,
  getDoctorAppointments,
  getDoctorPatients,
  getDoctorNotifications,
  getDoctorStats,
  getDoctorProfile,
  updateDoctorAvailability,
  confirmAppointment,
  cancelAppointment,
  completeAppointment,
  uploadDoctorAvatar,
  getDoctorAvatar,
  getActiveConsultation,
  createConsultation,
  addTreatmentStep,
  approveTreatmentStep,
  completeConsultation,
  updateConsultationStatus,
  setActiveConsultation,
  clearActiveConsultation,
  getDoctorConsultations,
  updateConsultationDetails,
  updateTreatmentStep,
  getAllPatients,
  getAllDrugs,
  deleteTreatmentStep,
  startTreatmentStep,
  rejectTreatmentStep,
  reviewAndDecideStep,
  scheduleReExamination,
  confirmReExaminationArrival,
  getAvailableSlots
} from '../controllers/doctorcontroller';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { protect } from '../middlewares/authmiddleware';

const router = express.Router();


const uploadsDir = path.join(__dirname, '..', 'uploads', 'avatars');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    console.log('=== MULTER FILENAME DEBUG ===');
    
    let doctorId = req.query.doctorId as string;
    
    console.log('DoctorId from query:', doctorId);
    
    if (!doctorId || doctorId === 'undefined') {
      console.error('❌ Doctor ID not found in query parameters');
      return cb(new Error('Doctor ID is required'), '');
    }
    
    doctorId = String(doctorId).trim();
    
    // Tạo tên file: doctor-{doctorId}-{timestamp}.{ext}
    const ext = path.extname(file.originalname).toLowerCase();
    const timestamp = Date.now();
    const filename = `doctor-${doctorId}-${timestamp}${ext}`;
    console.log('✅ Final filename:', filename);
    cb(null, filename);
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'));
    }
  }
});


// Get all available doctors (filtered by user.status === 'working')
router.get('/', getAvailableDoctors);

// Get available doctors by specialty (filtered by user.status === 'working')
router.get('/specialty/:specialtyId', getDoctorsBySpecialty);

// Search doctors from user accounts
router.get('/search', getDoctorsFromUsers);

// Change status of doctor
router.patch('/:doctorId/status', changeDoctorStatus);

// Update doctor availability
router.patch('/availability', updateDoctorAvailability);

// Get appointments for a specific doctor
router.get('/:doctorId/appointments', getDoctorAppointments);

// Get patients for a specific doctor
router.get('/:doctorId/patients', getDoctorPatients);

// Get profile for a specific doctor
router.get('/profile/:doctorId', getDoctorProfile);

// Get notifications for a specific doctor
router.get('/notifications/:doctorId', getDoctorNotifications);

// Get statistics for a specific doctor
router.get('/stats/:doctorId', getDoctorStats);
router.post(
  '/consultations/:consultationId/steps/:stepNumber/review',
  protect,
  reviewAndDecideStep
);


// Thêm vào doctor routes
router.post('/consultations/:consultationId/steps/:stepNumber/schedule-re-examination',protect, scheduleReExamination);
router.post('/consultations/:consultationId/steps/:stepNumber/confirm-arrival', confirmReExaminationArrival);

// upload image  doctor avatar
router.post('/avatar', 
  (req, res, next) => {
    console.log('=== AVATAR UPLOAD MIDDLEWARE ===');
    console.log('Query params:', req.query);
    console.log('Doctor ID from query:', req.query.doctorId);
    next();
  },
  upload.single('avatar'),
  (req, res, next) => {
    if (!req.file) {
      return res.status(400).json({ 
        success: false, 
        message: 'No file uploaded or upload failed' 
      });
    }
    next();
  },
  uploadDoctorAvatar
);

// Get doctor avatar by filename
router.get('/avatar/:filename', getDoctorAvatar);

// NEW: Appointment actions
router.patch('/appointments/:appointmentId/confirm', confirmAppointment);
router.patch('/appointments/:appointmentId/cancel', cancelAppointment);
router.patch('/appointments/:appointmentId/complete', completeAppointment);

// Consultation routes
router.get('/:doctorId/consultations/active', getActiveConsultation);
router.post('/consultations', createConsultation);
router.post('/consultations/:consultationId/steps', addTreatmentStep);
router.post('/consultations/:consultationId/steps/:stepNumber/approve', approveTreatmentStep);
router.post('/consultations/:consultationId/complete', completeConsultation);
router.put('/consultations/:consultationId/steps/:stepNumber', updateTreatmentStep);
router.patch('/consultations/:consultationId/status', updateConsultationStatus);
router.post('/consultations/:consultationId/set-active', setActiveConsultation);
router.post('/consultations/clear-active/:doctorId', clearActiveConsultation);
router.get('/:doctorId/consultations', getDoctorConsultations);
router.put('/consultations/:consultationId', updateConsultationDetails);
router.delete('/consultations/:consultationId/steps/:stepNumber', deleteTreatmentStep);
router.post('/consultations/:consultationId/steps/:stepNumber/start', startTreatmentStep);
router.post('/consultations/:consultationId/steps/:stepNumber/reject', rejectTreatmentStep);
router.get('/drugs', getAllDrugs);
router.get('/appointments/available-slots', getAvailableSlots);
// Patient routes
router.get('/:doctorId/patients/all', getAllPatients);

export default router;