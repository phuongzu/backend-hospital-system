import express from 'express';
import rateLimit from 'express-rate-limit';
import { body, param, query, validationResult } from 'express-validator';
import {
  getAllSpecialties,
  getOrCreateChatSession,
  sendMessage,
  getSessionMessages,
  closeSession,
  getChatHistory,
  clearChatHistory,
  getChatSessions,
  searchChatHistory,
  getMedicationInfo,
  getMedicalTermExplanation,
  createAppointmentFromSuggestion,
  getDoctorsBySpecialty,
  findDoctorsForAppointment,
  bookAppointmentFromAI,
  getSymptomTrends,
  getAuditLogs,
  recordConsent,
  cleanupExpiredSessions,
  getLifestyleAdvice
} from '../controllers/aiMedicalController';
import { protect } from '../middlewares/authmiddleware';
import { inputSanitizationMiddleware } from '../middlewares/SecurityMiddleware';

const router = express.Router();

// ==================== RATE LIMITERS ====================

// Strict limiter for chat (20/min per user)
const chatRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  keyGenerator: (req: any) => req.user?._id?.toString() || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests. Please slow down.' },
  skip: (req: any) => !req.user,
});

// Daily limiter for chat (200/day per user)
const chatDailyLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  max: 200,
  keyGenerator: (req: any) => req.user?._id?.toString() || req.ip,
  message: { success: false, message: 'Daily limit reached. Please try again tomorrow.' },
  skip: (req: any) => !req.user,
});

// General API limiter (60/min)
const generalRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  keyGenerator: (req: any) => req.user?._id?.toString() || req.ip,
  message: { success: false, message: 'Too many requests. Please try again later.' },
});

// Booking limiter (5/min — prevent spam bookings)
const bookingRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  keyGenerator: (req: any) => req.user?._id?.toString() || req.ip,
  message: { success: false, message: 'Too many booking attempts. Please wait.' },
});

// ==================== VALIDATION MIDDLEWARE ====================

const handleValidationErrors = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
): void => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ success: false, errors: errors.array() });
    return;
  }
  next();
};

const validateChatMessage = [
  body('message')
    .trim()
    .notEmpty().withMessage('Message cannot be empty')
    .isLength({ min: 1, max: 500 }).withMessage('Message must be 1-500 characters')
    .escape(),
  handleValidationErrors,
];

const validateBookAppointment = [
  body('doctor_id').notEmpty().withMessage('doctor_id is required'),
  body('appointment_date')
    .notEmpty().withMessage('appointment_date is required')
    .isISO8601().withMessage('appointment_date must be valid ISO 8601 date')
    .custom(value => {
      const date = new Date(value);
      if (date <= new Date()) throw new Error('Appointment date must be in the future');
      return true;
    }),
  body('time_slot')
    .notEmpty().withMessage('time_slot is required')
    .matches(/^\d{2}:\d{2}$/).withMessage('time_slot must be HH:MM format'),
  body('symptoms').optional().isArray().withMessage('symptoms must be an array'),
  body('urgency_level').optional().isIn(['low', 'medium', 'high']).withMessage('urgency_level must be low/medium/high'),
  handleValidationErrors,
];

const validateConsent = [
  body('session_id').notEmpty().withMessage('session_id is required'),
  body('consent').isBoolean().withMessage('consent must be boolean'),
  handleValidationErrors,
];

const validateSpecialtyId = [
  param('specialty_id').notEmpty().isMongoId().withMessage('Valid specialty_id is required'),
  handleValidationErrors,
];

// ==================== AUTH ====================

router.use(protect);

// ==================== CHAT ROUTES ====================

// Session management
router.get('/session', generalRateLimiter, getOrCreateChatSession);
router.get('/session/:session_id', generalRateLimiter, getSessionMessages);
router.post('/session/:session_id/close', generalRateLimiter, closeSession);
router.post('/consent', generalRateLimiter, validateConsent, recordConsent);
router.get('/lifestyle/:topic', protect, getLifestyleAdvice);

// Chat — apply both per-minute and daily rate limits + input sanitization
router.post(
  '/chat',
  chatRateLimiter,
  chatDailyLimiter,
  inputSanitizationMiddleware,
  validateChatMessage,
  sendMessage
);

// History
router.get('/history', generalRateLimiter, getChatHistory);
router.delete('/history', generalRateLimiter, clearChatHistory);
router.get('/sessions', generalRateLimiter, getChatSessions);
router.get('/search', generalRateLimiter, [
  query('query').notEmpty().isLength({ min: 2, max: 100 }).withMessage('Query must be 2-100 characters'),
  handleValidationErrors,
], searchChatHistory);

// ==================== SPECIALTY ROUTES ====================

router.get('/specialties', generalRateLimiter, getAllSpecialties);
router.get('/specialties/:specialty_id/doctors', generalRateLimiter, validateSpecialtyId, getDoctorsBySpecialty);

// ==================== DOCTOR ROUTES ====================

router.get('/doctors/available', generalRateLimiter, [
  query('specialty_name').notEmpty().withMessage('specialty_name is required'),
  handleValidationErrors,
], findDoctorsForAppointment);

// ==================== APPOINTMENT ROUTES ====================

router.post(
  '/appointments/book-from-ai',
  bookingRateLimiter,
  validateBookAppointment,
  bookAppointmentFromAI
);
router.post('/appointments/create', generalRateLimiter, createAppointmentFromSuggestion);

// ==================== MEDICAL INFO ROUTES ====================

router.get('/medication/:medicationName', generalRateLimiter, [
  param('medicationName').notEmpty().isLength({ min: 2, max: 100 }).withMessage('Valid medication name required'),
  handleValidationErrors,
], getMedicationInfo);

router.get('/explain/:term', generalRateLimiter, [
  param('term').notEmpty().isLength({ min: 2, max: 100 }).withMessage('Valid term required'),
  handleValidationErrors,
], getMedicalTermExplanation);

// ==================== SYMPTOM TRACKING ROUTES (NEW) ====================

router.get('/symptoms/trends', generalRateLimiter, [
  query('days').optional().isInt({ min: 1, max: 365 }).withMessage('days must be 1-365'),
  handleValidationErrors,
], getSymptomTrends);

// ==================== AUDIT LOGS (Admin) ====================

router.get('/audit/logs', generalRateLimiter, getAuditLogs);

// ==================== ADMIN ====================

router.post('/admin/cleanup', cleanupExpiredSessions);

export default router;