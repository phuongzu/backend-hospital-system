import { Request, Response } from 'express';
import crypto from 'crypto';
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
      appointmentRecommendation: aiResponse.appointmentRecommendation,
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
        appointmentRecommendation: aiResponse.appointmentRecommendation,
        followUpQuestions: aiResponse.followUpQuestions,
        requiresMoreInfo: aiResponse.requiresMoreInfo,
        patientContextUsed: aiResponse.patientContextUsed,
        language: aiResponse.language,
        session_id: session.session_id,
        // FIX: Expose urgency and triage score so frontend can use them
        urgencyLevel: aiResponse.urgencyLevel,
        triageScore: aiResponse.triageScore,
      },
    });
  } catch (error) {
    console.error('❌ Error sending message:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

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
        const id = doctor._id.toString();
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
        const id = doc._id.toString();
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

// ==================== BOOK APPOINTMENT FROM AI ====================

export const bookAppointmentFromAI = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }

    const {
      doctor_id,
      appointment_date,
      time_slot,
      symptoms = [],
      reason,
      urgency_level,
      session_id,
    } = req.body;

    if (!doctor_id || !appointment_date || !time_slot) {
      res.status(400).json({
        success: false,
        message: 'doctor_id, appointment_date, and time_slot are required',
      });
      return;
    }

    // ── 1. Idempotency check ─────────────────────────────────────────────────
    const idempotencyKey = getIdempotencyKey(
      req.user._id.toString(),
      doctor_id,
      appointment_date,
      time_slot
    );
    const cached = idempotencyStore.get(idempotencyKey);
    if (cached && Date.now() < cached.expiresAt) {
      res.status(200).json({
        success: true,
        message: 'Appointment already booked (idempotent)',
        data: cached.result,
      });
      return;
    }

    // ── 2. Validate doctor ───────────────────────────────────────────────────
    const doctor = await Doctor.findById(doctor_id)
      .populate<{ user_id: { _id: any; name: string; email: string } }>('user_id', 'name email')
      .populate<{ specialty_id: { _id: any; name: string } }>('specialty_id', 'name');

    if (!doctor || !doctor.isAvailable) {
      res.status(404).json({ success: false, message: 'Doctor not found or unavailable' });
      return;
    }

    // ── 3. Check slot availability ───────────────────────────────────────────
    const targetDate = new Date(appointment_date);
    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);

    const slotTaken = await Appointment.exists({
      doctor_id,
      appointment_date: { $gte: startOfDay, $lte: endOfDay },
      time_slot,
      status: { $in: ['pending', 'confirmed'] },
    });

    if (slotTaken) {
      res.status(409).json({
        success: false,
        message: 'Time slot already booked. Please choose another.',
      });
      return;
    }

    // ── 4. Create appointment ────────────────────────────────────────────────
    const appointmentEndTime = calculateEndTime(time_slot, 30);

    const appointment = await Appointment.create({
      user_id: req.user._id,
      doctor_id,
      specialty_id: doctor.specialty_id,
      appointment_date: targetDate,
      time_slot,
      appointment_end_time: appointmentEndTime,
      status: 'pending',
      reason: reason || 'Booked via AI Medical Assistant',
      notes: `Urgency: ${urgency_level || 'medium'}. Symptoms: ${symptoms.join(', ')}`,
      symptoms,
      metadata: {
        booked_via: 'ai_assistant',
        session_id,
        urgency_level: urgency_level || 'medium',
      },
    });

    // ── 5. Build result payload ──────────────────────────────────────────────
    const doctorName = doctor.user_id?.name ?? 'Doctor';
    const specialtyName = (doctor.specialty_id as any)?.name ?? 'General Medicine';
    const specialtyId = (doctor.specialty_id as any)?._id?.toString();
    const appointmentId = appointment._id.toString();

    const user_id = req.user._id.toString();
    const user_name = (req.user as any).name as string | undefined;
    const user_email = (req.user as any).email as string | undefined;
    const user_phone = (req.user as any).phoneNumber as string | undefined;

    const resultData = {
      appointment: {
        _id: appointment._id,
        doctor_name: doctorName,
        specialty: specialtyName,
        appointment_date,
        time_slot,
        appointment_end_time: appointmentEndTime,
        status: 'pending',
        consultation_fee: doctor.consultation_fee,
      },
    };

    // ── 6. Cache idempotency result (24 h) ───────────────────────────────────
    idempotencyStore.set(idempotencyKey, {
      result: resultData,
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
    });

    // ── 7. Update chat session ───────────────────────────────────────────────
    if (session_id) {
      try {
        const session = await ChatSession.findOne({ session_id, user_id: req.user._id });
        if (session) {
          session.appointments_booked.push(appointment._id);

          const confirmMsg =
            `✅ Lịch hẹn đã được đặt với Bác sĩ ${doctorName} vào ngày ` +
            `${appointment_date} lúc ${time_slot}. Vui lòng đến trước 15 phút.`;

          await session.addMessage({
            role: 'assistant',
            content: confirmMsg,
            category: 'appointment',
            language: 'vi',
            confidence: 1.0,
          });

          getServiceForSession(session_id).addMessageToHistory({
            role: 'assistant',
            content: confirmMsg,
            timestamp: new Date(),
            category: 'appointment',
            language: 'vi',
          });
        }
      } catch (err) {
        console.error('❌ Error updating session after booking:', err);
      }
    }

    // ── 8. Side-effects (fire-and-forget) ───────────────────────────────────

    // Patient notification
    notificationService
      .sendNotification({
        user_id,
        template_key: 'appointment_booked',
        variables: {
          doctor_name: doctorName,
          appointment_date: targetDate.toLocaleDateString(),
          appointment_time: time_slot,
          specialty: specialtyName,
        },
        type: 'appointment',
        category: 'success',
        priority: urgency_level === 'high' ? 'high' : 'medium',
        related_record: appointmentId,
        related_record_type: 'appointment',
        data: {
          appointment: {
            id: appointmentId,
            date: targetDate.toISOString(),
            time: time_slot,
            reason,
            status: 'pending',
            urgency_level,
          },
          doctor: {
            name: doctorName,
            specialty: specialtyName,
            consultation_fee: doctor.consultation_fee,
          },
          patient: { name: user_name, email: user_email },
        },
        channels: ['in_app', 'email', 'sms'],
        action_url: `/appointments/${appointmentId}`,
        action_label: 'View Appointment Details',
      })
      .catch(err => console.error('❌ Patient notification failed:', err));

    // Doctor notification
    const doctorUserId = doctor.user_id?._id?.toString();
    if (doctorUserId) {
      notificationService
        .sendNotification({
          user_id: doctorUserId,
          template_key: 'new_appointment_request',
          variables: {
            patient_name: user_name ?? 'Patient',
            appointment_date: targetDate.toLocaleDateString(),
            appointment_time: time_slot,
            reason: reason ?? 'General consultation',
          },
          type: 'appointment',
          category: 'info',
          priority: urgency_level === 'high' ? 'high' : 'medium',
          related_record: appointmentId,
          related_record_type: 'appointment',
          data: {
            appointment: {
              id: appointmentId,
              date: targetDate.toISOString(),
              time: time_slot,
              reason,
              symptoms,
              urgency_level,
            },
            patient: { name: user_name, email: user_email, phone: user_phone },
            urgency: urgency_level ?? 'medium',
          },
          channels: ['in_app', 'email'],
          action_url: `/doctor/appointments/${appointmentId}`,
          action_label: 'Review Appointment',
        })
        .catch(err => console.error('❌ Doctor notification failed:', err));
    }

    // Confirmation email
    if (user_email) {
      emailService
        .sendAppointmentConfirmationEmail(user_email, user_name ?? 'Patient', {
          appointment_id: appointmentId,
          doctor_name: doctorName,
          doctor_specialty: specialtyName,
          appointment_date: targetDate.toLocaleDateString(),
          appointment_time: time_slot,
          appointment_end_time: appointmentEndTime,
          location: 'Main Hospital - Room 101',
          consultation_fee: doctor.consultation_fee,
          preparation_instructions: getPreparationInstructions(specialtyId),
          cancellation_policy: 'Cancel at least 24 hours in advance to avoid fees.',
          contact_info: 'Call 123-456-7890 for assistance',
        })
        .catch(err => console.error('❌ Confirmation email failed:', err));
    }

    // SMS reminder (1 day before)
    if (user_phone && smsService.isAvailable()) {
      const reminderDate = new Date(targetDate);
      reminderDate.setDate(reminderDate.getDate() - 1);

      notificationService
        .sendNotification({
          user_id,
          title: 'Appointment Reminder',
          message: `Reminder: Your appointment with Dr. ${doctorName} is tomorrow at ${time_slot}.`,
          type: 'reminder',
          category: 'info',
          priority: 'medium',
          scheduled_time: reminderDate,
          channels: ['sms', 'push'],
          data: {
            appointment_id: appointmentId,
            appointment_time: time_slot,
            doctor_name: doctorName,
          },
        })
        .catch(err => console.error('❌ SMS reminder failed:', err));
    }

    // FIX: MedicalRecord is optional — only create if model is available
    // Import your MedicalRecord model here if you have one, e.g.:
    // import MedicalRecord from '../models/medicalRecord';
    // Then uncomment the block below:
    /*
    MedicalRecord.create({
      appointment_id: appointment._id,
      user_id:        req.user._id,
      doctor_id,
      consultation_status: 'scheduled',
      status:   'pending',
      symptoms,
      reason,
      notes:    `Appointment scheduled for ${targetDate.toLocaleDateString()} at ${time_slot}`,
      priority: determinePriority(symptoms, reason),
      created_at: new Date(),
    }).catch(err => console.error('❌ Medical record creation failed:', err));
    */

    // ── 9. Audit log ─────────────────────────────────────────────────────────
    auditLogger.log({
      userId: user_id,
      sessionId: session_id,
      action: 'appointment_booked',
      category: 'appointment',
      urgencyLevel: urgency_level,
      metadata: { doctor_id, appointment_date, time_slot, symptoms },
      timestamp: new Date(),
    });

    // ── 10. Respond ──────────────────────────────────────────────────────────
    res.status(201).json({
      success: true,
      message: 'Appointment booked successfully',
      data: {
        ...resultData,
        patient: { _id: req.user._id, name: user_name, email: user_email },
        notifications: {
          patient_notified: true,
          doctor_notified: !!doctorUserId,
          email_sent: !!user_email,
          sms_reminder_scheduled: !!(user_phone && smsService.isAvailable()),
        },
        next_steps: [
          'Wait for doctor confirmation',
          'Arrive 15 minutes before appointment time',
          'Bring ID and insurance card',
          'Complete any pre-appointment forms if required',
        ],
      },
    });
  } catch (error: any) {
    console.error('❌ Error booking appointment from AI:', error);

    notificationService
      .sendNotification({
        user_id: 'admin',
        title: 'Error Booking AI Appointment',
        message: `Error: ${error.message}`,
        type: 'system',
        category: 'error',
        priority: 'high',
        data: {
          error: error.message,
          user_id: req.user?._id,
          timestamp: new Date().toISOString(),
        },
      })
      .catch(() => {});

    if (error.code === 11000) {
      res.status(409).json({ success: false, message: 'Duplicate appointment detected' });
      return;
    }

    res.status(500).json({
      success: false,
      message: 'Failed to book appointment',
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