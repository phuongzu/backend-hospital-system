import express from 'express';
import rateLimit from 'express-rate-limit';
import { body, param, query, validationResult } from 'express-validator';
import {
  getChatHistory,
  clearChatHistory,
  getAllSpecialties,       
  getOrCreateChatSession,
  sendMessage,
  getSessionMessages,
  closeSession,
  getChatSessions,
  searchChatHistory,
  getMedicationInfo,
  getMedicalTermExplanation,
  createAppointmentFromSuggestion,
  getDoctorsBySpecialty,
  findDoctorsForAppointment,
  bookAppointmentFromAI,
} from '../controllers/aiMedicalController';
import { protect } from '../middlewares/authmiddleware';

const router = express.Router();

// ==================== MIDDLEWARE ====================

// ✅ FIX #16: Rate limiting per-user cho chat endpoint
const chatRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 phút
  max: 20,             // 20 requests/phút/user
  keyGenerator: (req: any) => req.user?._id?.toString() || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many requests. Please slow down and try again in a minute.',
  },
  skip: (req: any) => !req.user, // Skip nếu chưa auth (sẽ bị chặn ở protect)
});

// Rate limiter nhẹ hơn cho các endpoints khác
const generalRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  keyGenerator: (req: any) => req.user?._id?.toString() || req.ip,
  message: { success: false, message: 'Too many requests. Please try again later.' },
});

// ✅ FIX #18: Validation middleware
const validateChatMessage = [
  body('message')
    .trim()
    .notEmpty()
    .withMessage('Message cannot be empty')
    .isLength({ max: 500 })
    .withMessage('Message too long (max 500 characters)')
    .escape(),
  (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ success: false, errors: errors.array() });
      return;
    }
    next();
  },
];

const validateBookAppointment = [
  body('doctor_id').notEmpty().withMessage('doctor_id is required'),
  body('appointment_date')
    .notEmpty()
    .withMessage('appointment_date is required')
    .isISO8601()
    .withMessage('Invalid date format'),
  body('time_slot')
    .notEmpty()
    .withMessage('time_slot is required')
    .matches(/^\d{2}:\d{2}$/)
    .withMessage('time_slot must be in HH:MM format'),
  (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ success: false, errors: errors.array() });
      return;
    }
    next();
  },
];

// ==================== AUTH ====================

router.use(protect);

// ==================== CHAT ENDPOINTS ====================

// ✅ FIX #1: Chỉ một route /specialties duy nhất
router.get('/specialties', generalRateLimiter, getAllSpecialties);

// Session management
router.get('/session', generalRateLimiter, getOrCreateChatSession);
router.get('/session/:session_id', generalRateLimiter, getSessionMessages);
router.post('/session/:session_id/close', generalRateLimiter, closeSession);

// ✅ FIX #16 + #18: Chat với rate limiter + validation
router.post('/chat', chatRateLimiter, validateChatMessage, sendMessage);

// History
router.get('/history', generalRateLimiter, getChatHistory);
router.delete('/history', generalRateLimiter, clearChatHistory);
router.get('/sessions', generalRateLimiter, getChatSessions);
router.get('/search', generalRateLimiter, searchChatHistory);

// Medical info
router.get('/medication/:medicationName', generalRateLimiter, getMedicationInfo);
router.get('/explain/:term', generalRateLimiter, getMedicalTermExplanation);

// Doctors
router.get('/specialties/:specialty_id/doctors', generalRateLimiter, getDoctorsBySpecialty);
router.get('/doctors/available', generalRateLimiter, findDoctorsForAppointment);

// Appointments
router.post('/appointments/create', generalRateLimiter, createAppointmentFromSuggestion);
router.post(
  '/appointments/book-from-ai',
  generalRateLimiter,
  validateBookAppointment,
  bookAppointmentFromAI
);

export default router;