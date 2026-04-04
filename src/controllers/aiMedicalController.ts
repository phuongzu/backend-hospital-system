import { Request, Response } from 'express';
import crypto from 'crypto';
import { Types } from 'mongoose';
import ChatSession from '../models/chatbot';
import { AuthRequest } from '../middlewares/authmiddleware';
import { AIMedicalService, getServiceForSession, cleanupServiceForSession } from '../utils/aiMedicalService';
import { auditLogger } from '../middlewares/SecurityMiddleware';
import { SymptomTrackerService } from '../data/Symptomtracker';
import Specialty from '../models/specialty';
import Doctor from '../models/doctor';
import Appointment from '../models/appointment';
import Review from '../models/review';
import { sanitizeInput } from '../middlewares/SecurityMiddleware';
import { notificationService } from '../utils/notificationService';
import { emailService } from '../utils/emailService';
import { smsService } from '../utils/smsService';
import { fetchDBContext } from '../utils/AIDecisionEngine';


function calculateEndTime(startTime: string, durationMinutes: number): string {
  const [h, m] = startTime.split(':').map(Number);
  const totalMinutes = h * 60 + m + durationMinutes;
  const endH = Math.floor(totalMinutes / 60) % 24;
  const endM = totalMinutes % 60;
  return `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
}

function determinePriority(
  symptoms: string[],
  reason?: string
): 'high' | 'medium' | 'low' {
  const highPriorityTerms = [
    'chest pain', 'đau ngực',
    'difficulty breathing', 'khó thở', 'shortness of breath',
    'severe', 'nghiêm trọng', 'dữ dội',
    'emergency', 'cấp cứu',
    'vomiting blood', 'nôn ra máu',
    'unconscious', 'bất tỉnh',
    'stroke', 'đột quỵ',
  ];
  const mediumPriorityTerms = [
    'fever', 'sốt',
    'persistent', 'kéo dài',
    'worsening', 'nặng hơn',
  ];

  const combined = [...symptoms, reason ?? ''].join(' ').toLowerCase();

  if (highPriorityTerms.some(k => combined.includes(k))) return 'high';
  if (mediumPriorityTerms.some(k => combined.includes(k)) || symptoms.length >= 3) return 'medium';
  return 'low';
}

/**
 * Return preparation instructions based on specialty.
 * In production, populate the map from your DB or config.
 */
function getPreparationInstructions(specialtyId?: string): string {
  const map: Record<string, string> = {
    // Populate with real specialty IDs from your DB
    // 'cardiology_id': 'Fast for 4 hours before ECG. Avoid caffeine.',
  };
  return (
    map[specialtyId ?? ''] ??
    'Arrive 15 minutes before your appointment time. ' +
    'Bring your ID, insurance card, and any relevant medical records or test results.'
  );
}

// ==================== IDEMPOTENCY STORE ====================
// Prevent duplicate bookings from network retries

interface IdempotencyRecord {
  result: object;
  expiresAt: number;
}

const idempotencyStore = new Map<string, IdempotencyRecord>();

function getIdempotencyKey(
  userId: string,
  doctorId: string,
  date: string,
  slot: string
): string {
  return crypto
    .createHash('sha256')
    .update(`${userId}:${doctorId}:${date}:${slot}`)
    .digest('hex');
}

function cleanupIdempotencyStore(): void {
  const now = Date.now();
  for (const [key, record] of idempotencyStore) {
    if (now > record.expiresAt) idempotencyStore.delete(key);
  }
}

setInterval(cleanupIdempotencyStore, 10 * 60 * 1000);

// ==================== SESSION ====================

export const getOrCreateChatSession = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }

    const source = (req.headers['x-client-source'] as string) || 'app';
    const session = await ChatSession.findOrCreateActiveSession(req.user._id, source);

    if (session.messages.length > 0) {
      const aiService = getServiceForSession(session.session_id);
      aiService.loadHistoryFromDB(session.messages);
    }

    res.status(200).json({
      success: true,
      data: {
        session: session.getSummary(),
        messages: session.messages,
        consent_required: !session.consent_given,
      },
    });
  } catch (error) {
    console.error('Error getting chat session:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ==================== CONSENT ====================

export const recordConsent = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }

    const { session_id, consent } = req.body;
    if (typeof consent !== 'boolean') {
      res.status(400).json({ success: false, message: 'consent (boolean) is required' });
      return;
    }

    const session = await ChatSession.findOne({ session_id, user_id: req.user._id });
    if (!session) {
      res.status(404).json({ success: false, message: 'Session not found' });
      return;
    }

    session.consent_given = consent;
    session.consent_timestamp = new Date();
    await session.save();

    auditLogger.log({
      userId: req.user._id.toString(),
      sessionId: session_id,
      action: 'consent_recorded',
      metadata: { consent },
      timestamp: new Date(),
    });

    res.status(200).json({ success: true, data: { consent, session_id } });
  } catch (error) {
    console.error('Error recording consent:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ==================== SEND MESSAGE ====================

export const sendMessage = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }
 
    const { message, language } = req.body;
 
    if (!message || typeof message !== 'string' || !message.trim()) {
      res.status(400).json({ success: false, message: 'Message is required' });
      return;
    }
 
    const session = await ChatSession.findOrCreateActiveSession(req.user._id);
 
    if (!session.consent_given) {
      session.consent_given = true;
      session.consent_timestamp = new Date();
    }
 
    // ── FIX: Detect appointment management intent BEFORE calling AI ──
    const { intent } = detectAppointmentIntentLocal(message);
 
    if (intent === 'view_upcoming') {
      await handleViewUpcomingIntent(req, res, session.session_id);
      return;
    }
 
    if (intent === 'reschedule') {
      await handleRescheduleIntent(req, res, session.session_id);
      return;
    }
 
    if (intent === 'cancel') {
      await handleCancelIntent(req, res, session.session_id);
      return;
    }
 
    // ── Normal AI flow ──────────────────────────────────────────────
    const aiService = getServiceForSession(session.session_id);
 
    if (aiService.getHistory().length === 0 && session.messages.length > 0) {
      aiService.loadHistoryFromDB(session.messages);
    }
 
    await session.addMessage({ role: 'user', content: message.trim() });
 
    const aiResponse = await aiService.processMessage(
      message.trim(),
      req.user._id.toString()
    );
 
    await session.addMessage({
      role: 'assistant',
      content: aiResponse.response,
      category: aiResponse.category,
      language: aiResponse.language,
      confidence: aiResponse.confidence,
      suggestedActions: aiResponse.suggestedActions,
      emergencyAlert: aiResponse.emergencyAlert,
      relatedSpecialties: aiResponse.relatedSpecialties,
      followUpQuestions: aiResponse.followUpQuestions,
      requiresMoreInfo: aiResponse.requiresMoreInfo,
      patientContextUsed: aiResponse.patientContextUsed,
      appointmentRecommendation: aiResponse.appointmentRecommendation as any,
    });
 
    auditLogger.log({
      userId: req.user._id.toString(),
      sessionId: session.session_id,
      action: 'chat_message',
      userMessage: message.trim(),
      aiResponse: aiResponse.response.substring(0, 500),
      category: aiResponse.category,
      urgencyLevel: aiResponse.appointmentRecommendation?.urgencyLevel,
      emergencyAlert: aiResponse.emergencyAlert,
      timestamp: new Date(),
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
 
    res.status(200).json({
      success: true,
      data: {
        response: aiResponse.response,
        confidence: aiResponse.confidence,
        suggestedActions: aiResponse.suggestedActions,
        emergencyAlert: aiResponse.emergencyAlert,
        category: aiResponse.category,
        relatedSpecialties: aiResponse.relatedSpecialties,
        // FIX: always include appointmentRecommendation with actionType if set
        appointmentRecommendation: aiResponse.appointmentRecommendation,
        followUpQuestions: aiResponse.followUpQuestions,
        requiresMoreInfo: aiResponse.requiresMoreInfo,
        patientContextUsed: aiResponse.patientContextUsed,
        language: aiResponse.language,
        session_id: session.session_id,
        urgencyLevel: aiResponse.urgencyLevel,
        triageScore: aiResponse.triageScore,
      },
    });
  } catch (error) {
    console.error('❌ Error sending message:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
 
// ============================================================
// LOCAL intent detector (self-contained, no circular import)
// ============================================================
 
function detectAppointmentIntentLocal(message: string): {
  intent: 'view_upcoming' | 'reschedule' | 'cancel' | 'none';
  confidence: number;
} {
  const lower = message.toLowerCase().trim();
 
  const viewKeywords = [
    'xem lịch', 'lịch hẹn', 'lịch khám', 'appointment',
    'sắp tới', 'upcoming', 'lịch của tôi', 'my appointment',
    'có lịch', 'đặt rồi', 'check appointment', 'kiểm tra lịch',
    'những lịch', 'danh sách lịch',
    // Quick reply exact matches
    'xem lịch hẹn sắp tới', 'view upcoming appointments',
  ];
 
  const rescheduleKeywords = [
    'đổi lịch', 'dời lịch', 'thay đổi lịch', 'reschedule',
    'đổi giờ', 'thay giờ', 'đổi ngày', 'thay ngày',
    'đổi bác sĩ', 'chuyên khoa khác', 'change appointment',
    'sửa lịch', 'cập nhật lịch', 'muốn đổi', 'cần đổi',
    // Quick reply exact matches
    'tôi muốn đổi lịch khám', 'i want to reschedule',
  ];
 
  const cancelKeywords = [
    'hủy lịch', 'cancel', 'huỷ lịch', 'bỏ lịch', 'xóa lịch',
    'không đi khám', 'không cần khám nữa', 'hủy hẹn', 'huỷ hẹn',
    'cancel appointment', 'delete appointment',
    // Quick reply exact matches
    'hủy lịch hẹn của tôi', 'cancel my appointment',
  ];
 
  // Reschedule takes priority over view (keywords can overlap)
  if (rescheduleKeywords.some(k => lower.includes(k))) return { intent: 'reschedule', confidence: 0.92 };
  if (cancelKeywords.some(k => lower.includes(k))) return { intent: 'cancel', confidence: 0.92 };
  if (viewKeywords.some(k => lower.includes(k))) return { intent: 'view_upcoming', confidence: 0.90 };
 
  return { intent: 'none', confidence: 0 };
}

// ==================== HISTORY ====================

export const getChatHistory = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }
    const { limit = 10 } = req.query;
    const history = await ChatSession.getUserChatHistory(
      req.user._id,
      Number(limit)
    );
    res.status(200).json({ success: true, data: history });
  } catch (error) {
    console.error('Error getting history:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const getSessionMessages = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }
    const { session_id } = req.params;
    const session = await ChatSession.findOne({ session_id, user_id: req.user._id });
    if (!session) {
      res.status(404).json({ success: false, message: 'Session not found' });
      return;
    }
    res.status(200).json({
      success: true,
      data: { session: session.getSummary(), messages: session.messages },
    });
  } catch (error) {
    console.error('Error getting session messages:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ==================== CLOSE SESSION ====================

export const closeSession = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }
    const { session_id } = req.params;
    const session = await ChatSession.findOne({ session_id, user_id: req.user._id });
    if (!session) {
      res.status(404).json({ success: false, message: 'Session not found' });
      return;
    }
    await session.closeSession();
    cleanupServiceForSession(session_id);
    res.status(200).json({ success: true, message: 'Session closed' });
  } catch (error) {
    console.error('Error closing session:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ==================== CLEAR HISTORY ====================

export const clearChatHistory = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }
    const session = await ChatSession.findOne({ user_id: req.user._id, is_active: true });
    if (session) {
      const aiService = getServiceForSession(session.session_id);
      aiService.clearHistory();
    }
    res.status(200).json({ success: true, message: 'Chat history cleared' });
  } catch (error) {
    console.error('Error clearing history:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ==================== CLEANUP ====================

export const cleanupExpiredSessions = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const count = await ChatSession.cleanupExpiredSessions();
    res.status(200).json({ success: true, data: { cleaned_count: count } });
  } catch (error) {
    console.error('Error cleaning sessions:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ==================== SPECIALTIES ====================

export const getAllSpecialties = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const specialties = await Specialty.find({ isActive: true })
      .select('_id name description icon color doctorCount category keywords')
      .sort({ name: 1 });

    res.status(200).json({
      success: true,
      data: specialties.map(s => ({
        id: s._id,
        name: s.name,
        description: s.description,
        icon: s.icon,
        color: s.color,
        doctorCount: s.doctorCount,
        category: s.category,
      })),
    });
  } catch (error) {
    console.error('Error fetching specialties:', error);
    res.status(500).json({ success: false, message: 'Error fetching specialties' });
  }
};

export const getSpecialties = getAllSpecialties;

// ==================== DOCTORS BY SPECIALTY ====================

export const getDoctorsBySpecialty = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const { specialty_id } = req.params;
    const { date } = req.query;

    if (!specialty_id) {
      res.status(400).json({ success: false, message: 'Specialty ID required' });
      return;
    }

    const specialty = await Specialty.findById(specialty_id);
    if (!specialty) {
      res.status(404).json({ success: false, message: 'Specialty not found' });
      return;
    }

    const doctors = await Doctor.find({ specialty_id, isAvailable: true })
      .populate('user_id', 'name email phoneNumber avatar')
      .select(
        'consultation_fee years_of_experience qualifications achievements education certifications'
      );

    const targetDate = date ? new Date(date as string) : new Date();
    if (targetDate <= new Date()) targetDate.setDate(targetDate.getDate() + 1);
    const dateStr = targetDate.toISOString().split('T')[0];
    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);

    const doctorIds = doctors.map(d => d._id);

    const allBooked = await Appointment.find({
      doctor_id: { $in: doctorIds },
      appointment_date: { $gte: startOfDay, $lte: endOfDay },
      status: { $in: ['pending', 'confirmed'] },
    }).select('doctor_id time_slot');

    const bookedByDoctor = new Map<string, Set<string>>();
    for (const appt of allBooked) {
      const k = appt.doctor_id.toString();
      if (!bookedByDoctor.has(k)) bookedByDoctor.set(k, new Set());
      bookedByDoctor.get(k)!.add(appt.time_slot);
    }

    const allRatings = await Review.aggregate([
      { $match: { doctor_id: { $in: doctorIds } } },
      {
        $group: {
          _id: '$doctor_id',
          avgRating: { $avg: '$rating' },
          totalReviews: { $sum: 1 },
        },
      },
    ]);
    const ratingMap = new Map(
      allRatings.map(r => [r._id.toString(), { avg: r.avgRating, total: r.totalReviews }])
    );

    const ALL_TIME_SLOTS = [
      '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
      '14:00', '14:30', '15:00', '15:30', '16:00', '16:30',
    ];

    const result = doctors
      .map(doctor => {
        const id = (doctor._id as Types.ObjectId).toString();
        const booked = bookedByDoctor.get(id) || new Set();
        const available = ALL_TIME_SLOTS.filter(s => !booked.has(s));
        const rating = ratingMap.get(id) || { avg: 0, total: 0 };
        return {
          _id: doctor._id,
          name: (doctor as any).user_id?.name || 'Doctor',
          avatar: (doctor as any).user_id?.avatar,
          specialty: {
            id: specialty._id,
            name: specialty.name,
            icon: specialty.icon,
            color: specialty.color,
          },
          consultation_fee: doctor.consultation_fee,
          years_of_experience: doctor.years_of_experience,
          rating: { average: rating.avg, total: rating.total },
          available_slots: available,
          next_available_date: dateStr,
          is_available_today: available.length > 0,
        };
      })
      .sort((a, b) => {
        if (a.rating.average !== b.rating.average)
          return b.rating.average - a.rating.average;
        return b.years_of_experience - a.years_of_experience;
      });

    res.status(200).json({
      success: true,
      data: {
        specialty: {
          id: specialty._id,
          name: specialty.name,
          description: specialty.description,
          icon: specialty.icon,
          color: specialty.color,
        },
        date: dateStr,
        doctors: result,
        total_doctors: result.length,
        available_today: result.filter(d => d.is_available_today).length,
      },
    });
  } catch (error) {
    console.error('Error fetching doctors:', error);
    res.status(500).json({ success: false, message: 'Error fetching doctors' });
  }
};

// ==================== FIND DOCTORS ====================

export const findDoctorsForAppointment = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }

    const { specialty_name, date, urgency_level } = req.query;
    if (!specialty_name) {
      res.status(400).json({ success: false, message: 'Specialty name required' });
      return;
    }

    const specialty = await Specialty.findOne({
      name: { $regex: new RegExp(specialty_name as string, 'iu') },
      isActive: true,
    });
    if (!specialty) {
      res.status(404).json({ success: false, message: 'Specialty not found' });
      return;
    }

    const doctors = await Doctor.find({ specialty_id: specialty._id, isAvailable: true })
      .populate('user_id', 'name email');

    const targetDate = date ? new Date(date as string) : new Date();
    targetDate.setDate(targetDate.getDate() + 1);
    const dateStr = targetDate.toISOString().split('T')[0];
    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);
    const doctorIds = doctors.map(d => d._id);

    const allBooked = await Appointment.find({
      doctor_id: { $in: doctorIds },
      appointment_date: { $gte: startOfDay, $lte: endOfDay },
      status: { $in: ['pending', 'confirmed'] },
    }).select('doctor_id time_slot');

    const bookedByDoctor = new Map<string, Set<string>>();
    for (const appt of allBooked) {
      const k = appt.doctor_id.toString();
      if (!bookedByDoctor.has(k)) bookedByDoctor.set(k, new Set());
      bookedByDoctor.get(k)!.add(appt.time_slot);
    }

    const ALL_TIME_SLOTS = [
      '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
      '14:00', '14:30', '15:00', '15:30', '16:00', '16:30',
    ];

    const available = doctors
      .map(doc => {
        const id = (doc._id as Types.ObjectId).toString();
        const booked = bookedByDoctor.get(id) || new Set();
        const slots = ALL_TIME_SLOTS.filter(s => !booked.has(s));
        if (!slots.length) return null;
        return {
          _id: doc._id,
          name: (doc as any).user_id?.name || 'Doctor',
          specialty: { id: specialty._id, name: specialty.name, icon: specialty.icon },
          consultation_fee: doc.consultation_fee,
          years_of_experience: doc.years_of_experience,
          available_slots: slots.slice(0, 5),
          next_available_date: dateStr,
          urgency_level: urgency_level || 'medium',
        };
      })
      .filter(Boolean);

    res.status(200).json({
      success: true,
      data: {
        specialty: { id: specialty._id, name: specialty.name },
        date: dateStr,
        doctors: available,
        total: available.length,
      },
    });
  } catch (error) {
    console.error('Error finding doctors:', error);
    res.status(500).json({ success: false, message: 'Error finding doctors' });
  }
};


const GROQ_MODEL = 'llama-3.3-70b-versatile';
const APPOINTMENT_DURATION_MINUTES = 30;
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000; 

// ==================== VALIDATION ====================

interface BookingRequestBody {
  doctor_id?:       string;
  specialty_id?:    string;
  appointment_date?: string;
  time_slot?:       string;
  symptoms?:        string[];
  reason?:          string;
  urgency_level?:   string;
  session_id?:      string;
  use_ai_selection?: boolean;
  ai_decision?: {
    recommendedDoctorId?:   string;
    recommendedSpecialtyId?: string;
    recommendedTimeSlot?:   string;
    recommendedDate?:       string;
    urgencyLevel?:          string;
    triageScore?:           number;
    reasoning?:             string;
  };
}

function validateBookingRequest(
  body: BookingRequestBody,
  useAI: boolean
): { valid: boolean; error?: string } {
  if (useAI) {
    // Chế độ AI: không cần doctor_id từ trước
    return { valid: true };
  }
  // Chế độ thủ công: bắt buộc đủ 3 trường
  if (!body.doctor_id)        return { valid: false, error: 'doctor_id là bắt buộc' };
  if (!body.appointment_date) return { valid: false, error: 'appointment_date là bắt buộc' };
  if (!body.time_slot)        return { valid: false, error: 'time_slot là bắt buộc' };
  return { valid: true };
}


export const bookAppointmentFromAI = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {

  // ── 0. Auth guard ────────────────────────────────────────────
  if (!req.user) {
    res.status(401).json({ success: false, message: 'Xác thực thất bại' });
    return;
  }

  const userId    = req.user._id.toString();
  const userName  = (req.user as any).name  as string | undefined;
  const userEmail = (req.user as any).email as string | undefined;
  const userPhone = (req.user as any).phoneNumber as string | undefined;

  const body: BookingRequestBody = req.body;
  const useAI = body.use_ai_selection === true;

  // ── 1. Validate request ──────────────────────────────────────
  const validation = validateBookingRequest(body, useAI);
  if (!validation.valid) {
    res.status(400).json({ success: false, message: validation.error });
    return;
  }

  try {

    // ── 2. Resolve booking params (AI vs manual) ─────────────────
    let finalDoctorId:   string;
    let finalDate:       string;
    let finalSlot:       string;
    let finalSpecialtyId: string | undefined;
    let aiDecisionMeta: object | undefined;

    if (useAI) {
      // ── 2a. Chế độ AI: fetch DB và để AI chọn ─────────────────
      const session = body.session_id
        ? await ChatSession.findOne({ session_id: body.session_id, user_id: req.user._id })
        : null;

      const conversationText = session
        ? session.messages
            .slice(-10)
            .map(m => `${m.role === 'user' ? 'Bệnh nhân' : 'AI'}: ${m.content.substring(0, 300)}`)
            .join('\n')
        : body.reason ?? 'Bệnh nhân yêu cầu đặt lịch khám';

      // Fetch toàn bộ data thật từ DB
      const dbContext = await fetchDBContext(userId);

      if (!dbContext.availableDoctors.length) {
        res.status(503).json({
          success: false,
          message: 'Hiện không có bác sĩ nào trống lịch. Vui lòng thử lại sau.',
        });
        return;
      }

      // Import AIMedicalService để lấy patientProfile
      const { AIMedicalService } = await import('../utils/aiMedicalService');
      const tempService = new AIMedicalService();
      await tempService.loadPatientProfile(userId);
      const patientProfile = (tempService as any).patientProfile;

      // Gọi AI quyết định
      const { getAIDecision: decide } = await import('../utils/AIDecisionEngine');
      const { Groq } = await import('groq-sdk');
      const { config } = await import('../config/config');
      const groqClient = new Groq({ apiKey: config.groqApiKey });

      const aiDecision = await decide(
        groqClient,
        conversationText,
        dbContext,
        patientProfile,
        'vi',
        GROQ_MODEL
      );

      // Validate AI đã chọn được bác sĩ hợp lệ
      if (!aiDecision.recommendedDoctorId || !aiDecision.recommendedTimeSlot) {
        res.status(422).json({
          success: false,
          message: 'AI không thể chọn bác sĩ phù hợp. Vui lòng chọn thủ công.',
          data: {
            availableDoctors: dbContext.availableDoctors.slice(0, 5),
            aiReasoning: aiDecision.reasoning,
          },
        });
        return;
      }

      // Emergency check
      if (aiDecision.requiresEmergency) {
        res.status(200).json({
          success: false,
          message: '🚨 Tình trạng nguy cấp. Gọi 115 ngay, không đặt lịch online.',
          data: {
            emergency: true,
            reason: aiDecision.emergencyReason,
            redFlags: aiDecision.redFlags,
          },
        });
        return;
      }

      finalDoctorId    = aiDecision.recommendedDoctorId;
      finalSlot        = aiDecision.recommendedTimeSlot;
      finalDate        = aiDecision.recommendedDate ?? new Date(Date.now() + 86400000)
                           .toISOString().split('T')[0];
      finalSpecialtyId = aiDecision.recommendedSpecialtyId;
      aiDecisionMeta   = {
        urgencyLevel: aiDecision.urgencyLevel,
        triageScore:  aiDecision.triageScore,
        reasoning:    aiDecision.reasoning,
        redFlags:     aiDecision.redFlags,
      };

    } else {
      // ── 2b. Chế độ thủ công: dùng params từ frontend ──────────
      finalDoctorId    = body.doctor_id!;
      finalDate        = body.appointment_date!;
      finalSlot        = body.time_slot!;
      finalSpecialtyId = body.specialty_id;
      aiDecisionMeta   = body.ai_decision;
    }

    // ── 3. Idempotency check ─────────────────────────────────────
    const idempotencyKey = getIdempotencyKey(userId, finalDoctorId, finalDate, finalSlot);
    const cached = idempotencyStore.get(idempotencyKey);
    if (cached && Date.now() < cached.expiresAt) {
      res.status(200).json({
        success: true,
        message: 'Lịch hẹn đã được đặt trước đó (idempotent)',
        data: cached.result,
      });
      return;
    }

    // ── 4. Kiểm tra bác sĩ tồn tại ──────────────────────────────
    const doctor = await Doctor.findById(finalDoctorId)
      .populate<{ user_id: { _id: any; name: string; email: string } }>('user_id', 'name email')
      .populate<{ specialty_id: { _id: any; name: string } }>('specialty_id', 'name _id');

    if (!doctor) {
      res.status(404).json({ success: false, message: 'Không tìm thấy bác sĩ' });
      return;
    }

    if (!doctor.isAvailable && doctor.status !== 'working') {
      res.status(409).json({
        success: false,
        message: 'Bác sĩ hiện không tiếp nhận bệnh nhân',
        data: { doctorId: finalDoctorId },
      });
      return;
    }

    // ── 5. Kiểm tra slot trống ───────────────────────────────────
    const targetDate  = new Date(finalDate);
    const startOfDay  = new Date(targetDate); startOfDay.setHours(0, 0, 0, 0);
    const endOfDay    = new Date(targetDate); endOfDay.setHours(23, 59, 59, 999);

    const slotTaken = await Appointment.exists({
      doctor_id:        finalDoctorId,
      appointment_date: { $gte: startOfDay, $lte: endOfDay },
      time_slot:        finalSlot,
      status:           { $in: ['pending', 'confirmed'] },
    });

    if (slotTaken) {
      // Gợi ý slot khác của bác sĩ đó
      const allBooked = await Appointment.find({
        doctor_id:        finalDoctorId,
        appointment_date: { $gte: startOfDay, $lte: endOfDay },
        status:           { $in: ['pending', 'confirmed'] },
      }).select('time_slot');

      const bookedSlots = new Set(allBooked.map(a => a.time_slot));
      const ALL_SLOTS   = [
        '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
        '14:00', '14:30', '15:00', '15:30', '16:00', '16:30',
      ];
      const alternativeSlots = ALL_SLOTS.filter(s => !bookedSlots.has(s));

      res.status(409).json({
        success: false,
        message: 'Slot này đã được đặt. Vui lòng chọn khung giờ khác.',
        data: { alternativeSlots: alternativeSlots.slice(0, 5) },
      });
      return;
    }

    // ── 6. Kiểm tra lịch hẹn trùng của bệnh nhân ────────────────
    const resolvedSpecialtyId = finalSpecialtyId
      ?? (doctor.specialty_id as any)?._id?.toString();

    const duplicateCheck = await Appointment.findOne({
      user_id:          userId,
      appointment_date: { $gte: startOfDay, $lte: endOfDay },
      status:           { $in: ['pending', 'confirmed'] },
    });

    if (duplicateCheck) {
      res.status(409).json({
        success: false,
        message: 'Bạn đã có lịch hẹn trong ngày này rồi.',
        data: {
          existingAppointmentId: (duplicateCheck._id as Types.ObjectId).toString(),
          date:     finalDate,
          timeSlot: duplicateCheck.time_slot,
        },
      });
      return;
    }

    // ── 7. Tạo appointment ───────────────────────────────────────
    const symptoms          = body.symptoms ?? [];
    const reason            = body.reason ?? 'Đặt lịch qua trợ lý AI';
    const urgencyLevel      = body.urgency_level
                              ?? (aiDecisionMeta as any)?.urgencyLevel
                              ?? 'medium';
    const appointmentEndTime = calculateEndTime(finalSlot, APPOINTMENT_DURATION_MINUTES);
    const priority           = determinePriority(symptoms, reason);

    const appointment = await Appointment.create({
      user_id:              req.user._id,
      doctor_id:            finalDoctorId,
      specialty_id:         resolvedSpecialtyId,
      appointment_date:     targetDate,
      time_slot:            finalSlot,
      appointment_end_time: appointmentEndTime,
      status:               'pending',
      reason,
      notes: [
        `Urgency: ${urgencyLevel}`,
        symptoms.length ? `Symptoms: ${symptoms.join(', ')}` : '',
        aiDecisionMeta ? `AI reasoning: ${(aiDecisionMeta as any).reasoning ?? ''}` : '',
      ].filter(Boolean).join(' | '),
      symptoms,
      priority,
      metadata: {
        booked_via:      'ai_assistant',
        session_id:      body.session_id,
        urgency_level:   urgencyLevel,
        triage_score:    (aiDecisionMeta as any)?.triageScore,
        ai_selected:     useAI,
        red_flags:       (aiDecisionMeta as any)?.redFlags ?? [],
      },
    });

    const appointmentId  = (appointment._id as Types.ObjectId).toString();
    const doctorName     = doctor.user_id?.name    ?? 'Bác sĩ';
    const specialtyName  = (doctor.specialty_id as any)?.name ?? 'Đa khoa';
    const specialtyId    = (doctor.specialty_id as any)?._id?.toString();
    const doctorUserId   = doctor.user_id?._id?.toString();

    // ── 8. Kết quả trả về ───────────────────────────────────────
    const resultData = {
      appointment: {
        _id:                  appointment._id,
        doctor_name:          doctorName,
        specialty:            specialtyName,
        appointment_date:     finalDate,
        time_slot:            finalSlot,
        appointment_end_time: appointmentEndTime,
        status:               'pending',
        consultation_fee:     doctor.consultation_fee,
        priority,
      },
      ai_decision: aiDecisionMeta ?? null,
    };

    // Cache idempotency
    idempotencyStore.set(idempotencyKey, {
      result:    resultData,
      expiresAt: Date.now() + IDEMPOTENCY_TTL_MS,
    });

    // ── 9. Cập nhật chat session ─────────────────────────────────
    if (body.session_id) {
      try {
        const session = await ChatSession.findOne({
          session_id: body.session_id,
          user_id:    req.user._id,
        });

        if (session) {
          session.appointments_booked.push(appointment._id as Types.ObjectId);

          const confirmMsg = [
            `✅ **Đặt lịch thành công!**`,
            ``,
            `👨‍⚕️ Bác sĩ: **${doctorName}**`,
            `🏥 Chuyên khoa: ${specialtyName}`,
            `📅 Ngày: ${targetDate.toLocaleDateString('vi-VN')}`,
            `⏰ Giờ: ${finalSlot} – ${appointmentEndTime}`,
            useAI && (aiDecisionMeta as any)?.reasoning
              ? `\n💡 Lý do AI chọn: ${(aiDecisionMeta as any).reasoning}`
              : '',
            `\nVui lòng đến trước 15 phút và mang theo giấy tờ tùy thân.`,
          ].filter(s => s !== undefined).join('\n');

          await session.addMessage({
            role:       'assistant',
            content:    confirmMsg,
            category:   'appointment',
            language:   'vi',
            confidence: 1.0,
          });

          if (body.session_id) {
            getServiceForSession(body.session_id).addMessageToHistory({
              role:      'assistant',
              content:   confirmMsg,
              timestamp: new Date(),
              category:  'appointment',
              language:  'vi',
            });
          }
        }
      } catch (err) {
        console.error('❌ Cập nhật session thất bại:', err);
      }
    }

    // ── 10. Gửi thông báo (fire-and-forget) ─────────────────────

    // Thông báo bệnh nhân
    notificationService.sendNotification({
      user_id:      userId,
      template_key: 'appointment_booked',
      variables: {
        doctor_name:      doctorName,
        appointment_date: targetDate.toLocaleDateString('vi-VN'),
        appointment_time: finalSlot,
        specialty:        specialtyName,
      },
      type:                 'appointment',
      category:             'success',
      priority:             urgencyLevel === 'high' ? 'high' : 'medium',
      related_record:       appointmentId,
      related_record_type:  'appointment',
      data: {
        appointment: {
          id:           appointmentId,
          date:         targetDate.toISOString(),
          time:         finalSlot,
          end_time:     appointmentEndTime,
          reason,
          status:       'pending',
          urgency_level: urgencyLevel,
          ai_selected:  useAI,
        },
        doctor: {
          name:             doctorName,
          specialty:        specialtyName,
          consultation_fee: doctor.consultation_fee,
        },
        patient: { name: userName, email: userEmail },
      },
      channels:     ['in_app', 'email', 'sms'],
      action_url:   `/appointments/${appointmentId}`,
      action_label: 'Xem chi tiết lịch hẹn',
    }).catch(err => console.error('❌ Patient notification failed:', err));

    // Thông báo bác sĩ
    if (doctorUserId) {
      notificationService.sendNotification({
        user_id:      doctorUserId,
        template_key: 'new_appointment_request',
        variables: {
          patient_name:     userName ?? 'Bệnh nhân',
          appointment_date: targetDate.toLocaleDateString('vi-VN'),
          appointment_time: finalSlot,
          reason:           reason,
        },
        type:                 'appointment',
        category:             'info',
        priority:             priority === 'high' ? 'high' : 'medium',
        related_record:       appointmentId,
        related_record_type:  'appointment',
        data: {
          appointment: {
            id:           appointmentId,
            date:         targetDate.toISOString(),
            time:         finalSlot,
            reason,
            symptoms,
            urgency_level: urgencyLevel,
            priority,
            ai_selected:  useAI,
          },
          patient: { name: userName, email: userEmail, phone: userPhone },
          ai_decision: aiDecisionMeta ?? null,
        },
        channels:     ['in_app', 'email'],
        action_url:   `/doctor/appointments/${appointmentId}`,
        action_label: 'Xem yêu cầu khám',
      }).catch(err => console.error('❌ Doctor notification failed:', err));
    }

    if (userEmail) {
      emailService.sendAppointmentConfirmationEmail(
        userEmail,
        userName ?? 'Patient',
        reason || null,           
        {
          appointment_id:           appointmentId,
          doctor_name:              doctorName,
          doctor_specialty:         specialtyName,
          appointment_date:         targetDate.toLocaleDateString('vi-VN'),
          appointment_time:         finalSlot,
          appointment_end_time:     appointmentEndTime,
          location:                 'Room 101, Medical Center', 
          consultation_fee:         doctor.consultation_fee,
          preparation_instructions: getPreparationInstructions(specialtyId),
          cancellation_policy:      'Please cancel at least 24 hours in advance to avoid fees.',
          contact_info:             'Hotline: 1900-9090',
        }
      ).catch(err => console.error('❌ Confirmation email failed:', err.message));    }

    if (userPhone && smsService.isAvailable()) {
      const reminderDate = new Date(targetDate);
      reminderDate.setDate(reminderDate.getDate() - 1);
      reminderDate.setHours(8, 0, 0, 0);

      notificationService.sendNotification({
        user_id:        userId,
        title:          'Nhắc nhở lịch khám',
        message:        `Nhắc nhở: Bạn có lịch khám với Bs. ${doctorName} vào ngày mai lúc ${finalSlot}.`,
        type:           'reminder',
        category:       'info',
        priority:       'medium',
        scheduled_time: reminderDate,
        channels:       ['sms', 'push'],
        data: {
          appointment_id: appointmentId,
          doctor_name:    doctorName,
          time:           finalSlot,
        },
      }).catch(err => console.error('❌ SMS reminder failed:', err));
    }

    // ── 11. Audit log ────────────────────────────────────────────
    auditLogger.log({
      userId,
      sessionId:    body.session_id,
      action:       'appointment_booked',
      category:     'appointment',
      urgencyLevel: urgencyLevel as any,
      metadata: {
        doctor_id:       finalDoctorId,
        appointment_date: finalDate,
        time_slot:       finalSlot,
        symptoms,
        ai_selected:     useAI,
        triage_score:    (aiDecisionMeta as any)?.triageScore,
      },
      timestamp: new Date(),
    });

    // ── 12. Trả về response ──────────────────────────────────────
    res.status(201).json({
      success: true,
      message: 'Đặt lịch thành công!',
      data: {
        ...resultData,
        patient: {
          _id:   req.user._id,
          name:  userName,
          email: userEmail,
        },
        booking_mode: useAI ? 'ai_selected' : 'manual',
        notifications: {
          patient_notified:       true,
          doctor_notified:        !!doctorUserId,
          email_sent:             !!userEmail,
          sms_reminder_scheduled: !!(userPhone && smsService.isAvailable()),
        },
        preparation: getPreparationInstructions(specialtyName),
        next_steps: [
          'Chờ bác sĩ xác nhận lịch hẹn',
          'Đến trước 15 phút',
          'Mang CMND/CCCD và thẻ bảo hiểm',
          'Mang kết quả xét nghiệm cũ nếu có',
        ],
      },
    });

  } catch (error: any) {
    console.error('❌ bookAppointmentFromAI error:', error);

    // Thông báo admin khi có lỗi nghiêm trọng
console.error('🔴 bookAppointmentFromAI critical error:', {
  userId,
  error: error.message,
  stack: error.stack,
  timestamp: new Date().toISOString(),
});
// Chỉ gửi notification nếu có admin userId thật từ config
const adminUserId = process.env.ADMIN_USER_ID;
if (adminUserId) {
  notificationService.sendNotification({
    user_id: adminUserId,
    title: 'Lỗi đặt lịch AI',
    message: `Lỗi: ${error.message} | User: ${userId}`,
    type: 'system',
    category: 'error',
    priority: 'high',
    data: { error: error.message, userId, timestamp: new Date().toISOString() },
  }).catch(() => {});
}

    // Duplicate key MongoDB
    if (error.code === 11000) {
      res.status(409).json({
        success: false,
        message: 'Lịch hẹn trùng lặp. Vui lòng thử lại.',
      });
      return;
    }

    res.status(500).json({
      success: false,
      message: 'Đặt lịch thất bại. Vui lòng thử lại.',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

// ==================== SYMPTOM TRENDS ====================

export const getSymptomTrends = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }

    const { days = 30 } = req.query;
    const trends = await SymptomTrackerService.getSymptomTrends(
      req.user._id.toString(),
      Number(days)
    );

    res.status(200).json({
      success: true,
      data: { trends, period_days: Number(days) },
    });
  } catch (error) {
    console.error('Error getting symptom trends:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ==================== AUDIT LOGS (Admin only) ====================

export const getAuditLogs = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }

    const { limit = 100 } = req.query;
    const logs = auditLogger.getLogs(req.user._id.toString(), Number(limit));
    res.status(200).json({ success: true, data: logs });
  } catch (error) {
    console.error('Error getting audit logs:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ==================== SESSIONS LIST & SEARCH ====================

export const getChatSessions = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }

    const { page = 1, limit = 20 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const [sessions, total] = await Promise.all([
      ChatSession.find({ user_id: req.user._id })
        .select(
          'session_id title messages category created_at updated_at last_activity appointments_booked'
        )
        .sort({ last_activity: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      ChatSession.countDocuments({ user_id: req.user._id }),
    ]);

    const formatted = sessions.map(s => ({
      id: s.session_id,
      title: s.title,
      preview:
        s.messages.length > 0
          ? s.messages.at(-1)!.content.substring(0, 100) + '...'
          : 'No messages',
      date: s.last_activity,
      messageCount: s.messages.length,
      category: s.category,
      appointmentsBooked: (s as any).appointments_booked?.length || 0,
    }));

    res.status(200).json({
      success: true,
      data: {
        sessions: formatted,
        pagination: { page: Number(page), limit: Number(limit), total },
      },
    });
  } catch (error) {
    console.error('Error getting sessions:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const searchChatHistory = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }

    const { query } = req.query;
    if (!query || typeof query !== 'string') {
      res.status(400).json({ success: false, message: 'Search query required' });
      return;
    }

    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const searchRegex = new RegExp(escaped, 'iu');

    const sessions = await ChatSession.find({
      user_id: req.user._id,
      $or: [
        { title: { $regex: searchRegex } },
        { 'messages.content': { $regex: searchRegex } },
      ],
    })
      .select('session_id title messages created_at last_activity')
      .sort({ last_activity: -1 })
      .limit(10)
      .lean();

    const results = sessions
      .flatMap(s =>
        s.messages
          .filter(m => searchRegex.test(m.content))
          .map(m => ({
            sessionId: s.session_id,
            sessionTitle: s.title,
            message: m.content.substring(0, 200),
            role: m.role,
            timestamp: m.timestamp,
            category: m.category,
            language: m.language,
          }))
      )
      .slice(0, 20);

    res.status(200).json({
      success: true,
      data: { query, results, total: results.length },
    });
  } catch (error) {
    console.error('Error searching history:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ==================== MEDICATION & TERMS ====================

export const getMedicationInfo = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const { medicationName } = req.params;
    if (!medicationName) {
      res.status(400).json({ success: false, message: 'Medication name required' });
      return;
    }

    const tempService = new AIMedicalService();
    const info = await tempService.getMedicationInfo(
      medicationName,
      req.user?._id?.toString()
    );
    res.status(200).json({ success: true, data: info });
  } catch (error) {
    console.error('Error getting medication info:', error);
    res.status(500).json({ success: false, message: 'Failed to get medication information' });
  }
};

export const getMedicalTermExplanation = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const { term } = req.params;
    if (!term) {
      res.status(400).json({ success: false, message: 'Term required' });
      return;
    }
    const tempService = new AIMedicalService();
    const explanation = await tempService.explainMedicalTerm(term);
    res.status(200).json({ success: true, data: explanation });
  } catch (error) {
    console.error('Error explaining term:', error);
    res.status(500).json({ success: false, message: 'Failed to explain term' });
  }
};

export const createAppointmentFromSuggestion = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }
    const { session_id, specialty, symptoms, urgencyLevel } = req.body;
    const session = await ChatSession.findOne({ session_id, user_id: req.user._id });
    if (!session) {
      res.status(404).json({ success: false, message: 'Session not found' });
      return;
    }
    res.status(200).json({
      success: true,
      data: {
        specialty,
        symptoms,
        urgencyLevel,
        suggestedDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });
  } catch (error) {
    console.error('Error creating appointment from suggestion:', error);
    res.status(500).json({ success: false, message: 'Failed to create appointment' });
  }
};

export const getLifestyleAdvice = async (req: Request, res: Response) => {
  try {
    const { topic } = req.params;
    const userId = (req as any).user?.id;

    if (!topic?.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Vui lòng nhập chủ đề cần tư vấn',
      });
    }

    const sanitized = sanitizeInput(topic);
    if (!sanitized.safe) {
      return res.status(400).json({
        success: false,
        message: sanitized.reason || 'Chủ đề không hợp lệ',
      });
    }

    const sessionId = `${userId}_${Date.now()}`;
    const service = getServiceForSession(sessionId);

    if (userId) {
      await service.loadPatientProfile(userId);
    }

    const advice = await service.getLifestyleAdvice(sanitized.sanitized);

    return res.status(200).json({
      success: true,
      data: {
        topic: advice.topic,
        advice: advice.advice,
        confidence: advice.confidence,
        category: advice.category,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('Error in getLifestyleAdvice:', error);
    return res.status(500).json({
      success: false,
      message: 'Có lỗi xảy ra khi lấy lời khuyên',
    });
  }
};


export const detectAppointmentIntent = (message: string): {
  intent: 'view_upcoming' | 'reschedule' | 'cancel' | 'none';
  confidence: number;
} => {
  const lower = message.toLowerCase().trim();
 
  // ── Xem lịch hẹn sắp tới ──
  const viewKeywords = [
    'xem lịch', 'lịch hẹn', 'lịch khám', 'appointment',
    'sắp tới', 'upcoming', 'lịch của tôi', 'my appointment',
    'có lịch', 'đặt rồi', 'check appointment', 'kiểm tra lịch',
    'những lịch', 'danh sách lịch',
  ];
  if (viewKeywords.some(k => lower.includes(k))) return { intent: 'view_upcoming', confidence: 0.9 };
 
  // ── Đổi / reschedule ──
  const rescheduleKeywords = [
    'đổi lịch', 'dời lịch', 'thay đổi lịch', 'reschedule',
    'đổi giờ', 'thay giờ', 'đổi ngày', 'thay ngày',
    'đổi bác sĩ', 'chuyên khoa khác', 'change appointment',
    'sửa lịch', 'cập nhật lịch', 'muốn đổi', 'cần đổi',
  ];
  if (rescheduleKeywords.some(k => lower.includes(k))) return { intent: 'reschedule', confidence: 0.9 };
 
  // ── Hủy ──
  const cancelKeywords = [
    'hủy lịch', 'cancel', 'huỷ lịch', 'bỏ lịch', 'xóa lịch',
    'không đi khám', 'không cần khám nữa', 'hủy hẹn', 'huỷ hẹn',
    'cancel appointment', 'delete appointment',
  ];
  if (cancelKeywords.some(k => lower.includes(k))) return { intent: 'cancel', confidence: 0.9 };
 
  return { intent: 'none', confidence: 0 };
}
 

export async function handleViewUpcomingIntent(
  req: AuthRequest,
  res: Response,
  sessionId: string
): Promise<void> {
  const userId = req.user!._id.toString();
  const lang   = (req.body.language as string) || 'vi';
 
  try {
    const upcoming = await Appointment.find({
      user_id:          userId,
      appointment_date: { $gte: new Date() },
      status:           { $in: ['pending', 'confirmed'] },
    })
      .populate('specialty_id', 'name')
      .sort({ appointment_date: 1 })
      .limit(5)
      .lean();
 
    // Resolve doctor names separately
    const apptList = await Promise.all(upcoming.map(async (a) => {
      const doctorDoc = await Doctor.findById(a.doctor_id)
        .populate('user_id', 'name')
        .lean();
      return {
        id:          (a._id as Types.ObjectId).toString(),
        date:        new Date(a.appointment_date).toLocaleDateString('vi-VN'),
        time:        a.time_slot,
        doctorName:  (doctorDoc?.user_id as any)?.name || 'Bác sĩ',
        specialty:   (a.specialty_id as any)?.name   || 'Đa khoa',
        status:      a.status,
      };
    }));
 
    const responseText = apptList.length === 0
      ? (lang === 'vi'
          ? '📅 Bạn hiện không có lịch hẹn nào sắp tới.\n\nBạn có muốn đặt lịch khám mới không?'
          : '📅 You have no upcoming appointments.\n\nWould you like to book a new one?')
      : (lang === 'vi'
          ? `📅 **Lịch hẹn sắp tới của bạn (${apptList.length}):**\n\n` +
            apptList.map((a, i) =>
              `${i + 1}. BS. ${a.doctorName} – ${a.specialty}\n   📆 ${a.date} lúc ${a.time}\n   🔵 ${a.status === 'confirmed' ? 'Đã xác nhận' : 'Chờ xác nhận'}`
            ).join('\n\n')
          : `📅 **Your upcoming appointments (${apptList.length}):**\n\n` +
            apptList.map((a, i) =>
              `${i + 1}. Dr. ${a.doctorName} – ${a.specialty}\n   📆 ${a.date} at ${a.time}\n   🔵 ${a.status}`
            ).join('\n\n'));
 
    // Add to session history
    const session = await ChatSession.findOne({ session_id: sessionId, user_id: req.user!._id });
    if (session) {
      await session.addMessage({ role: 'user', content: req.body.message?.trim() ?? '' });
      await session.addMessage({ role: 'assistant', content: responseText, category: 'appointment_management', language: lang as any, confidence: 1.0 });
    }
 
    res.status(200).json({
      success: true,
      data: {
        response:    responseText,
        confidence:  1.0,
        category:    'appointment_management',
        language:    lang,
        session_id:  sessionId,
        upcomingAppointments: apptList,
        suggestedActions: apptList.length > 0
          ? (lang === 'vi'
              ? ['Đổi lịch hẹn', 'Hủy lịch hẹn', 'Đặt lịch mới']
              : ['Reschedule', 'Cancel appointment', 'Book new'])
          : (lang === 'vi' ? ['Đặt lịch khám mới'] : ['Book new appointment']),
      },
    });
  } catch (error) {
    console.error('handleViewUpcomingIntent error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
}
 

export async function handleRescheduleIntent(
  req: AuthRequest,
  res: Response,
  sessionId: string
): Promise<void> {
  const userId = req.user!._id.toString();
  const lang   = (req.body.language as string) || 'vi';
 
  try {
    const upcoming = await Appointment.find({
      user_id:          userId,
      appointment_date: { $gte: new Date() },
      status:           { $in: ['pending', 'confirmed'] },
    })
      .populate('specialty_id', 'name')
      .sort({ appointment_date: 1 })
      .limit(5)
      .lean();
 
    const apptList = await Promise.all(upcoming.map(async (a) => {
      const doctorDoc = await Doctor.findById(a.doctor_id).populate('user_id', 'name').lean();
      return {
        id:         (a._id as Types.ObjectId).toString(),
        date:       new Date(a.appointment_date).toLocaleDateString('vi-VN'),
        time:       a.time_slot,
        doctorName: (doctorDoc?.user_id as any)?.name || 'Bác sĩ',
        specialty:  (a.specialty_id as any)?.name     || 'Đa khoa',
        status:     a.status,
      };
    }));
 
    const responseText = apptList.length === 0
      ? (lang === 'vi'
          ? '📅 Bạn chưa có lịch hẹn nào để đổi. Bạn có muốn đặt lịch mới không?'
          : '📅 You have no appointments to reschedule. Would you like to book a new one?')
      : (lang === 'vi'
          ? `🔄 Bạn muốn đổi lịch hẹn nào?\n\nTôi thấy bạn có **${apptList.length}** lịch hẹn sắp tới. Hãy chọn lịch cần đổi.`
          : `🔄 Which appointment would you like to reschedule?\n\nYou have **${apptList.length}** upcoming appointment(s). Please select one.`);
 
    const session = await ChatSession.findOne({ session_id: sessionId, user_id: req.user!._id });
    if (session) {
      await session.addMessage({ role: 'user', content: req.body.message?.trim() ?? '' });
      await session.addMessage({ role: 'assistant', content: responseText, category: 'appointment_management', language: lang as any, confidence: 1.0 });
    }
 
    res.status(200).json({
      success: true,
      data: {
        response:    responseText,
        confidence:  1.0,
        category:    'appointment_management',
        language:    lang,
        session_id:  sessionId,
        upcomingAppointments: apptList,
        appointmentRecommendation: {
          actionType:   'reschedule',
          shouldBook:   false,
          urgencyLevel: 'low' as const,
          symptoms:     [],
        },
      },
    });
  } catch (error) {
    console.error('handleRescheduleIntent error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
}
 

export async function handleCancelIntent(
  req: AuthRequest,
  res: Response,
  sessionId: string
): Promise<void> {
  const userId = req.user!._id.toString();
  const lang   = (req.body.language as string) || 'vi';
 
  try {
    const upcoming = await Appointment.find({
      user_id:          userId,
      appointment_date: { $gte: new Date() },
      status:           { $in: ['pending', 'confirmed'] },
    })
      .populate('specialty_id', 'name')
      .sort({ appointment_date: 1 })
      .limit(5)
      .lean();
 
    const apptList = await Promise.all(upcoming.map(async (a) => {
      const doctorDoc = await Doctor.findById(a.doctor_id).populate('user_id', 'name').lean();
      return {
        id:         (a._id as Types.ObjectId).toString(),
        date:       new Date(a.appointment_date).toLocaleDateString('vi-VN'),
        time:       a.time_slot,
        doctorName: (doctorDoc?.user_id as any)?.name || 'Bác sĩ',
        specialty:  (a.specialty_id as any)?.name     || 'Đa khoa',
        status:     a.status,
      };
    }));
 
    if (apptList.length === 0) {
      res.status(200).json({
        success: true,
        data: {
          response:    lang === 'vi' ? '📅 Bạn không có lịch hẹn nào sắp tới để hủy.' : '📅 You have no upcoming appointments to cancel.',
          confidence:  1.0,
          category:    'appointment_management',
          language:    lang,
          session_id:  sessionId,
          upcomingAppointments: [],
        },
      });
      return;
    }
 
    const responseText = lang === 'vi'
      ? `❌ Bạn muốn hủy lịch hẹn nào?\n\n⚠️ Lưu ý: Hủy trước ít nhất 24 giờ để tránh phí.`
      : `❌ Which appointment would you like to cancel?\n\n⚠️ Note: Cancel at least 24 hours in advance to avoid fees.`;
 
    const session = await ChatSession.findOne({ session_id: sessionId, user_id: req.user!._id });
    if (session) {
      await session.addMessage({ role: 'user', content: req.body.message?.trim() ?? '' });
      await session.addMessage({ role: 'assistant', content: responseText, category: 'appointment_management', language: lang as any, confidence: 1.0 });
    }
 
    res.status(200).json({
      success: true,
      data: {
        response:    responseText,
        confidence:  1.0,
        category:    'appointment_management',
        language:    lang,
        session_id:  sessionId,
        // FIX: top-level upcomingAppointments + actionType in recommendation
        upcomingAppointments: apptList,
        appointmentRecommendation: {
          actionType:   'cancel',
          shouldBook:   false,
          urgencyLevel: 'low' as const,
          symptoms:     [],
        },
      },
    });
  } catch (error) {
    console.error('handleCancelIntent error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
}



export const rescheduleAppointment = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    if (!req.user) { res.status(401).json({ success: false, message: 'Authentication required' }); return; }
 
    const { id } = req.params;
    const { new_time_slot, new_date } = req.body;
    const lang = (req.body.language as string) || 'vi';
 
    if (!new_time_slot || !new_date) {
      res.status(400).json({ success: false, message: 'new_time_slot và new_date là bắt buộc' });
      return;
    }
 
    const appointment = await Appointment.findOne({ _id: id, user_id: req.user._id });
    if (!appointment) { res.status(404).json({ success: false, message: 'Không tìm thấy lịch hẹn' }); return; }
 
    if (!['pending', 'confirmed'].includes(appointment.status)) {
      res.status(409).json({ success: false, message: 'Không thể đổi lịch hẹn đã hủy hoặc hoàn thành' });
      return;
    }
 
    const newTargetDate = new Date(new_date);
    const startOfDay = new Date(newTargetDate); startOfDay.setHours(0, 0, 0, 0);
    const endOfDay   = new Date(newTargetDate); endOfDay.setHours(23, 59, 59, 999);
 
    // Check slot conflict
    const conflict = await Appointment.exists({
      _id:              { $ne: id },
      doctor_id:        appointment.doctor_id,
      appointment_date: { $gte: startOfDay, $lte: endOfDay },
      time_slot:        new_time_slot,
      status:           { $in: ['pending', 'confirmed'] },
    });
 
    if (conflict) {
      const allBooked = await Appointment.find({
        _id:              { $ne: id },
        doctor_id:        appointment.doctor_id,
        appointment_date: { $gte: startOfDay, $lte: endOfDay },
        status:           { $in: ['pending', 'confirmed'] },
      }).select('time_slot');
      const bookedSet = new Set(allBooked.map(a => a.time_slot));
      const ALL_SLOTS = ['09:00','09:30','10:00','10:30','11:00','11:30','14:00','14:30','15:00','15:30','16:00','16:30'];
      const alternativeSlots = ALL_SLOTS.filter(s => !bookedSet.has(s));
 
      res.status(409).json({
        success: false,
        message: lang === 'vi' ? `Giờ ${new_time_slot} đã được đặt. Vui lòng chọn giờ khác.` : `Slot ${new_time_slot} is taken.`,
        data: { alternativeSlots },
      });
      return;
    }
 
    // Save old values for notification
    const oldDate = appointment.appointment_date;
    const oldSlot = appointment.time_slot;
 
    appointment.appointment_date = newTargetDate;
    appointment.time_slot        = new_time_slot;
    appointment.status           = 'pending'; // reset to pending for doctor re-confirm
    (appointment as any).notes   = [(appointment as any).notes, `Rescheduled from ${oldDate.toLocaleDateString('vi-VN')} ${oldSlot} → ${new_date} ${new_time_slot}`].filter(Boolean).join(' | ');
    await appointment.save();
 
    // Fire-and-forget notifications
    const userEmail = (req.user as any).email as string | undefined;
    const userName  = (req.user as any).name  as string | undefined;
 
    notificationService.sendNotification({
      user_id:      req.user._id.toString(),
      title:        lang === 'vi' ? 'Đổi lịch thành công' : 'Appointment Rescheduled',
      message:      lang === 'vi'
        ? `Lịch hẹn của bạn đã được đổi sang ${newTargetDate.toLocaleDateString('vi-VN')} lúc ${new_time_slot}.`
        : `Your appointment has been rescheduled to ${new_date} at ${new_time_slot}.`,
      type: 'appointment', category: 'info', priority: 'medium',
      related_record: id, related_record_type: 'appointment',
      data: { new_date, new_slot: new_time_slot, old_date: oldDate.toLocaleDateString('vi-VN'), old_slot: oldSlot },
      channels: ['in_app', 'email'],
      action_url: `/appointments/${id}`,
    }).catch(err => console.error('Reschedule notification failed:', err));
 
    res.status(200).json({
      success: true,
      message: lang === 'vi' ? 'Đổi lịch thành công!' : 'Appointment rescheduled!',
      data: {
        appointment_id:  id,
        new_date:        new_date,
        new_time_slot:   new_time_slot,
        status:          'pending',
        old_date:        oldDate.toLocaleDateString('vi-VN'),
        old_slot:        oldSlot,
      },
    });
  } catch (error) {
    console.error('rescheduleAppointment error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
 
export const cancelAppointmentByChat = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    if (!req.user) { res.status(401).json({ success: false, message: 'Authentication required' }); return; }
 
    const { id } = req.params;
    const { reason, force } = req.body;
    const lang = (req.body.language as string) || 'vi';
 
    const appointment = await Appointment.findOne({ _id: id, user_id: req.user._id })
      .populate('doctor_id', 'user_id')
      .populate('specialty_id', 'name');
 
    if (!appointment) { res.status(404).json({ success: false, message: 'Không tìm thấy lịch hẹn' }); return; }
 
    if (appointment.status === 'cancelled') {
      res.status(409).json({ success: false, message: lang === 'vi' ? 'Lịch hẹn đã được hủy trước đó' : 'Appointment already cancelled' });
      return;
    }
 
    if (appointment.status === 'completed') {
      res.status(409).json({ success: false, message: lang === 'vi' ? 'Không thể hủy lịch hẹn đã hoàn thành' : 'Cannot cancel a completed appointment' });
      return;
    }
 
    // 24h policy — only enforced when force !== true
    if (!force) {
      const now         = new Date();
      const apptTime    = new Date(appointment.appointment_date);
      const [h, m]      = appointment.time_slot.split(':').map(Number);
      apptTime.setHours(h, m, 0, 0);
      const hoursUntil  = (apptTime.getTime() - now.getTime()) / (1000 * 60 * 60);
 
      if (hoursUntil < 24) {
        // FIX: return canStillCancel: true so frontend can offer force-cancel
        res.status(409).json({
          success: false,
          message: lang === 'vi'
            ? `⚠️ Lịch hẹn chỉ còn ${Math.round(hoursUntil)} giờ nữa. Hủy trong vòng 24 giờ có thể phát sinh phí hủy.`
            : `⚠️ Appointment is in ${Math.round(hoursUntil)} hours. Cancelling within 24h may incur a fee.`,
          data: { hoursUntil: Math.round(hoursUntil), canStillCancel: true },
        });
        return;
      }
    }
 
    // Proceed with cancellation
    appointment.status = 'cancelled';
    (appointment as any).cancellation_reason = reason || (lang === 'vi' ? 'Hủy qua trợ lý AI' : 'Cancelled via AI chat');
    (appointment as any).cancelled_at = new Date();
    if (force) (appointment as any).late_cancellation = true;
    await appointment.save();
 
    // Notify doctor
    const doctorDoc = await Doctor.findById(appointment.doctor_id).populate('user_id', '_id name').lean();
    const doctorUserId = (doctorDoc?.user_id as any)?._id?.toString();
    const userName     = (req.user as any).name as string | undefined;
 
    if (doctorUserId) {
      notificationService.sendNotification({
        user_id:  doctorUserId,
        title:    lang === 'vi' ? 'Lịch hẹn bị hủy' : 'Appointment Cancelled',
        message:  lang === 'vi'
          ? `Bệnh nhân ${userName} đã hủy lịch hẹn ngày ${new Date(appointment.appointment_date).toLocaleDateString('vi-VN')} lúc ${appointment.time_slot}${force ? ' (hủy muộn)' : ''}.`
          : `Patient ${userName} cancelled appointment on ${new Date(appointment.appointment_date).toLocaleDateString()} at ${appointment.time_slot}${force ? ' (late cancellation)' : ''}.`,
        type: 'appointment', category: 'warning', priority: 'medium',
        related_record: id, related_record_type: 'appointment',
        data: { appointment_id: id, reason: reason || 'Cancelled via chat', force: !!force },
        channels: ['in_app', 'email'],
      }).catch(err => console.error('Cancel doctor notification failed:', err));
    }
 
    // Notify patient
    notificationService.sendNotification({
      user_id:  req.user._id.toString(),
      title:    lang === 'vi' ? 'Đã hủy lịch hẹn' : 'Appointment Cancelled',
      message:  lang === 'vi'
        ? `Lịch hẹn ngày ${new Date(appointment.appointment_date).toLocaleDateString('vi-VN')} lúc ${appointment.time_slot} đã được hủy thành công.`
        : `Your appointment on ${new Date(appointment.appointment_date).toLocaleDateString()} at ${appointment.time_slot} has been cancelled.`,
      type: 'appointment', category: 'info', priority: 'medium',
      related_record: id, related_record_type: 'appointment',
      data: { appointment_id: id },
      channels: ['in_app', 'email'],
      action_url: `/appointments`,
    }).catch(err => console.error('Cancel patient notification failed:', err));
 
    res.status(200).json({
      success: true,
      message: lang === 'vi' ? 'Hủy lịch hẹn thành công!' : 'Appointment cancelled!',
      data: {
        appointment_id: id,
        status:         'cancelled',
        cancelled_at:   new Date(),
        late_cancellation: !!force,
      },
    });
  } catch (error) {
    console.error('cancelAppointmentByChat error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

 

export const getAvailableSlotsForReschedule = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    if (!req.user) { res.status(401).json({ success: false, message: 'Authentication required' }); return; }
 
    const { id }  = req.params;
    const { date } = req.query;
 
    if (!date) { res.status(400).json({ success: false, message: 'date query param required' }); return; }
 
    const appointment = await Appointment.findOne({ _id: id, user_id: req.user._id });
    if (!appointment) { res.status(404).json({ success: false, message: 'Appointment not found' }); return; }
 
    const targetDate = new Date(date as string);
    const startOfDay = new Date(targetDate); startOfDay.setHours(0, 0, 0, 0);
    const endOfDay   = new Date(targetDate); endOfDay.setHours(23, 59, 59, 999);
 
    const booked = await Appointment.find({
      _id:              { $ne: id },      // exclude current appointment
      doctor_id:        appointment.doctor_id,
      appointment_date: { $gte: startOfDay, $lte: endOfDay },
      status:           { $in: ['pending', 'confirmed'] },
    }).select('time_slot').lean();
 
    const bookedSet = new Set(booked.map(b => b.time_slot));
    const ALL_SLOTS = ['09:00','09:30','10:00','10:30','11:00','11:30','14:00','14:30','15:00','15:30','16:00','16:30'];
    const freeSlots = ALL_SLOTS.filter(s => !bookedSet.has(s));
 
    res.status(200).json({ success: true, data: { slots: freeSlots, date, appointment_id: id } });
  } catch (error) {
    console.error('getAvailableSlotsForReschedule error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

