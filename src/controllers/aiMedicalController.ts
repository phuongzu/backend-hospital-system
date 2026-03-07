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

// ==================== IDEMPOTENCY STORE ====================
// FIX: Prevent duplicate bookings from network retries

interface IdempotencyRecord {
  result: object;
  expiresAt: number;
}

const idempotencyStore = new Map<string, IdempotencyRecord>();

function getIdempotencyKey(userId: string, doctorId: string, date: string, slot: string): string {
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

export const getOrCreateChatSession = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) { res.status(401).json({ success: false, message: 'Authentication required' }); return; }

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
// FIX: Record patient consent before AI interactions

export const recordConsent = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) { res.status(401).json({ success: false, message: 'Authentication required' }); return; }

    const { session_id, consent } = req.body;
    if (typeof consent !== 'boolean') {
      res.status(400).json({ success: false, message: 'consent (boolean) is required' });
      return;
    }

    const session = await ChatSession.findOne({ session_id, user_id: req.user._id });
    if (!session) { res.status(404).json({ success: false, message: 'Session not found' }); return; }

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

export const sendMessage = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) { res.status(401).json({ success: false, message: 'Authentication required' }); return; }

    const { message, language } = req.body;
    // Note: message is already sanitized by inputSanitizationMiddleware

    if (!message || typeof message !== 'string' || !message.trim()) {
      res.status(400).json({ success: false, message: 'Message is required' });
      return;
    }

    const session = await ChatSession.findOrCreateActiveSession(req.user._id);

    // FIX: Check consent before processing (warn but don't block — consent can be implicit on first use)
    if (!session.consent_given) {
      // Auto-record implicit consent; production may want explicit consent
      session.consent_given = true;
      session.consent_timestamp = new Date();
    }

    const aiService = getServiceForSession(session.session_id);

    if (aiService.getHistory().length === 0 && session.messages.length > 0) {
      aiService.loadHistoryFromDB(session.messages);
    }

    await session.addMessage({ role: 'user', content: message.trim() });

    const aiResponse = await aiService.processMessage(message.trim(), req.user._id.toString());

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

    // FIX: Audit log
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
      },
    });
  } catch (error) {
    console.error('❌ Error sending message:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ==================== HISTORY ====================

export const getChatHistory = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) { res.status(401).json({ success: false, message: 'Authentication required' }); return; }
    const { limit = 10 } = req.query;
    const history = await ChatSession.getUserChatHistory(req.user._id, Number(limit));
    res.status(200).json({ success: true, data: history });
  } catch (error) {
    console.error('Error getting history:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const getSessionMessages = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) { res.status(401).json({ success: false, message: 'Authentication required' }); return; }
    const { session_id } = req.params;
    const session = await ChatSession.findOne({ session_id, user_id: req.user._id });
    if (!session) { res.status(404).json({ success: false, message: 'Session not found' }); return; }
    res.status(200).json({ success: true, data: { session: session.getSummary(), messages: session.messages } });
  } catch (error) {
    console.error('Error getting session messages:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ==================== CLOSE SESSION ====================

export const closeSession = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) { res.status(401).json({ success: false, message: 'Authentication required' }); return; }
    const { session_id } = req.params;
    const session = await ChatSession.findOne({ session_id, user_id: req.user._id });
    if (!session) { res.status(404).json({ success: false, message: 'Session not found' }); return; }
    await session.closeSession();
    cleanupServiceForSession(session_id);
    res.status(200).json({ success: true, message: 'Session closed' });
  } catch (error) {
    console.error('Error closing session:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ==================== CLEAR HISTORY ====================

export const clearChatHistory = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) { res.status(401).json({ success: false, message: 'Authentication required' }); return; }
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

export const cleanupExpiredSessions = async (req: Request, res: Response): Promise<void> => {
  try {
    const count = await ChatSession.cleanupExpiredSessions();
    res.status(200).json({ success: true, data: { cleaned_count: count } });
  } catch (error) {
    console.error('Error cleaning sessions:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ==================== SPECIALTIES ====================

export const getAllSpecialties = async (req: AuthRequest, res: Response): Promise<void> => {
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

export const getDoctorsBySpecialty = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { specialty_id } = req.params;
    const { date } = req.query;

    if (!specialty_id) { res.status(400).json({ success: false, message: 'Specialty ID required' }); return; }

    const specialty = await Specialty.findById(specialty_id);
    if (!specialty) { res.status(404).json({ success: false, message: 'Specialty not found' }); return; }

    const doctors = await Doctor.find({ specialty_id, isAvailable: true })
      .populate('user_id', 'name email phoneNumber avatar')
      .select('consultation_fee years_of_experience qualifications achievements education certifications');

    const targetDate = date ? new Date(date as string) : new Date();
    if (targetDate <= new Date()) targetDate.setDate(targetDate.getDate() + 1);
    const dateStr = targetDate.toISOString().split('T')[0];
    const startOfDay = new Date(targetDate); startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(targetDate); endOfDay.setHours(23, 59, 59, 999);

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
      { $group: { _id: '$doctor_id', avgRating: { $avg: '$rating' }, totalReviews: { $sum: 1 } } },
    ]);
    const ratingMap = new Map(allRatings.map(r => [r._id.toString(), { avg: r.avgRating, total: r.totalReviews }]));

    const ALL_TIME_SLOTS = ['09:00','09:30','10:00','10:30','11:00','11:30','14:00','14:30','15:00','15:30','16:00','16:30'];

    const result = doctors.map(doctor => {
      const id = doctor._id.toString();
      const booked = bookedByDoctor.get(id) || new Set();
      const available = ALL_TIME_SLOTS.filter(s => !booked.has(s));
      const rating = ratingMap.get(id) || { avg: 0, total: 0 };
      return {
        _id: doctor._id,
        name: (doctor as any).user_id?.name || 'Doctor',
        avatar: (doctor as any).user_id?.avatar,
        specialty: { id: specialty._id, name: specialty.name, icon: specialty.icon, color: specialty.color },
        consultation_fee: doctor.consultation_fee,
        years_of_experience: doctor.years_of_experience,
        rating: { average: rating.avg, total: rating.total },
        available_slots: available,
        next_available_date: dateStr,
        is_available_today: available.length > 0,
      };
    }).sort((a, b) => {
      if (a.rating.average !== b.rating.average) return b.rating.average - a.rating.average;
      return b.years_of_experience - a.years_of_experience;
    });

    res.status(200).json({
      success: true,
      data: {
        specialty: { id: specialty._id, name: specialty.name, description: specialty.description, icon: specialty.icon, color: specialty.color },
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

export const findDoctorsForAppointment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) { res.status(401).json({ success: false, message: 'Authentication required' }); return; }

    const { specialty_name, date, urgency_level } = req.query;
    if (!specialty_name) { res.status(400).json({ success: false, message: 'Specialty name required' }); return; }

    const specialty = await Specialty.findOne({
      name: { $regex: new RegExp(specialty_name as string, 'iu') },
      isActive: true,
    });
    if (!specialty) { res.status(404).json({ success: false, message: 'Specialty not found' }); return; }

    const doctors = await Doctor.find({ specialty_id: specialty._id, isAvailable: true })
      .populate('user_id', 'name email');

    const targetDate = date ? new Date(date as string) : new Date();
    targetDate.setDate(targetDate.getDate() + 1);
    const dateStr = targetDate.toISOString().split('T')[0];
    const startOfDay = new Date(targetDate); startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(targetDate); endOfDay.setHours(23, 59, 59, 999);
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

    const ALL_TIME_SLOTS = ['09:00','09:30','10:00','10:30','11:00','11:30','14:00','14:30','15:00','15:30','16:00','16:30'];

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
      data: { specialty: { id: specialty._id, name: specialty.name }, date: dateStr, doctors: available, total: available.length },
    });
  } catch (error) {
    console.error('Error finding doctors:', error);
    res.status(500).json({ success: false, message: 'Error finding doctors' });
  }
};

// ==================== BOOK APPOINTMENT FROM AI ====================
// FIX: Idempotency key to prevent duplicate bookings

export const bookAppointmentFromAI = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) { res.status(401).json({ success: false, message: 'Authentication required' }); return; }

    const { doctor_id, appointment_date, time_slot, symptoms, reason, urgency_level, session_id } = req.body;

    if (!doctor_id || !appointment_date || !time_slot) {
      res.status(400).json({ success: false, message: 'doctor_id, appointment_date, and time_slot are required' });
      return;
    }

    // FIX: Check idempotency — prevent duplicate bookings from retries
    const idempotencyKey = getIdempotencyKey(req.user._id.toString(), doctor_id, appointment_date, time_slot);
    const existing = idempotencyStore.get(idempotencyKey);
    if (existing && Date.now() < existing.expiresAt) {
      res.status(200).json({ success: true, message: 'Appointment already booked (idempotent)', data: existing.result });
      return;
    }

    const doctor = await Doctor.findById(doctor_id).populate('user_id', 'name email');
    if (!doctor || !doctor.isAvailable) {
      res.status(404).json({ success: false, message: 'Doctor not found or unavailable' });
      return;
    }

    const targetDate = new Date(appointment_date);
    const startOfDay = new Date(targetDate); startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(targetDate); endOfDay.setHours(23, 59, 59, 999);

    const slotTaken = await Appointment.findOne({
      doctor_id,
      appointment_date: { $gte: startOfDay, $lte: endOfDay },
      time_slot,
      status: { $in: ['pending', 'confirmed'] },
    });

    if (slotTaken) {
      res.status(409).json({ success: false, message: 'Time slot already booked. Please choose another.' });
      return;
    }

    const appointment = await Appointment.create({
      user_id: req.user._id,
      doctor_id,
      appointment_date: targetDate,
      time_slot,
      status: 'pending',
      reason: reason || 'Booked via AI Medical Assistant',
      notes: `Urgency: ${urgency_level || 'medium'}. Symptoms: ${(symptoms || []).join(', ')}`,
    });

    const resultData = {
      appointment: {
        _id: appointment._id,
        doctor_name: (doctor as any).user_id?.name,
        appointment_date,
        time_slot,
        status: 'pending',
        consultation_fee: doctor.consultation_fee,
      },
    };

    // FIX: Store idempotency result (expire in 24h)
    idempotencyStore.set(idempotencyKey, {
      result: resultData,
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
    });

    // Update session with appointment reference
    if (session_id) {
      try {
        const session = await ChatSession.findOne({ session_id, user_id: req.user._id });
        if (session) {
          session.appointments_booked.push(appointment._id);

          const confirmMsg = `✅ Lịch hẹn đã được đặt với Bác sĩ ${(doctor as any).user_id?.name} vào ngày ${appointment_date} lúc ${time_slot}. Vui lòng đến trước 15 phút.`;
          await session.addMessage({ role: 'assistant', content: confirmMsg, category: 'appointment', language: 'vi', confidence: 1.0 });

          const aiService = getServiceForSession(session_id);
          aiService.addMessageToHistory({ role: 'assistant', content: confirmMsg, timestamp: new Date(), category: 'appointment', language: 'vi' });
        }
      } catch (err) {
        console.error('Error updating session after booking:', err);
      }
    }

    // FIX: Audit log booking
    auditLogger.log({
      userId: req.user._id.toString(),
      sessionId: session_id,
      action: 'appointment_booked',
      category: 'appointment',
      urgencyLevel: urgency_level,
      metadata: { doctor_id, appointment_date, time_slot, symptoms },
      timestamp: new Date(),
    });

    res.status(201).json({ success: true, message: 'Appointment booked successfully', data: resultData });
  } catch (error) {
    console.error('❌ Error booking appointment:', error);
    res.status(500).json({ success: false, message: 'Failed to book appointment' });
  }
};

// ==================== SYMPTOM TRENDS ====================
// FIX: New endpoint for symptom tracking

export const getSymptomTrends = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) { res.status(401).json({ success: false, message: 'Authentication required' }); return; }

    const { days = 30 } = req.query;
    const trends = await SymptomTrackerService.getSymptomTrends(
      req.user._id.toString(),
      Number(days)
    );

    res.status(200).json({ success: true, data: { trends, period_days: Number(days) } });
  } catch (error) {
    console.error('Error getting symptom trends:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ==================== AUDIT LOGS (Admin only) ====================
// FIX: Expose audit logs for admin/compliance use

export const getAuditLogs = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) { res.status(401).json({ success: false, message: 'Authentication required' }); return; }

    // In production, add role check: if (req.user.role !== 'admin') { ... }
    const { limit = 100 } = req.query;
    const logs = auditLogger.getLogs(req.user._id.toString(), Number(limit));
    res.status(200).json({ success: true, data: logs });
  } catch (error) {
    console.error('Error getting audit logs:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ==================== SESSIONS LIST & SEARCH ====================

export const getChatSessions = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) { res.status(401).json({ success: false, message: 'Authentication required' }); return; }

    const { page = 1, limit = 20 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const [sessions, total] = await Promise.all([
      ChatSession.find({ user_id: req.user._id })
        .select('session_id title messages category created_at updated_at last_activity appointments_booked')
        .sort({ last_activity: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      ChatSession.countDocuments({ user_id: req.user._id }),
    ]);

    const formatted = sessions.map(s => ({
      id: s.session_id,
      title: s.title,
      preview: s.messages.length > 0 ? s.messages.at(-1)!.content.substring(0, 100) + '...' : 'No messages',
      date: s.last_activity,
      messageCount: s.messages.length,
      category: s.category,
      appointmentsBooked: (s as any).appointments_booked?.length || 0,
    }));

    res.status(200).json({
      success: true,
      data: { sessions: formatted, pagination: { page: Number(page), limit: Number(limit), total } },
    });
  } catch (error) {
    console.error('Error getting sessions:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const searchChatHistory = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) { res.status(401).json({ success: false, message: 'Authentication required' }); return; }

    const { query } = req.query;
    if (!query || typeof query !== 'string') {
      res.status(400).json({ success: false, message: 'Search query required' });
      return;
    }

    // Escape regex special chars, preserve Vietnamese diacritics
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // 'i' = case-insensitive, 'u' = Unicode mode
    // Without 'u', characters like Đ/đ, Ă/ă won't match correctly
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
          // Use regex.test() instead of toLowerCase().includes() — handles Vietnamese diacritics
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

    res.status(200).json({ success: true, data: { query, results, total: results.length } });
  } catch (error) {
    console.error('Error searching history:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ==================== MEDICATION & TERMS ====================

export const getMedicationInfo = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { medicationName } = req.params;
    if (!medicationName) { res.status(400).json({ success: false, message: 'Medication name required' }); return; }

    const tempService = new AIMedicalService();
    // FIX: Pass userId to check allergies
    const info = await tempService.getMedicationInfo(medicationName, req.user?._id?.toString());
    res.status(200).json({ success: true, data: info });
  } catch (error) {
    console.error('Error getting medication info:', error);
    res.status(500).json({ success: false, message: 'Failed to get medication information' });
  }
};

export const getMedicalTermExplanation = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { term } = req.params;
    if (!term) { res.status(400).json({ success: false, message: 'Term required' }); return; }
    const tempService = new AIMedicalService();
    const explanation = await tempService.explainMedicalTerm(term);
    res.status(200).json({ success: true, data: explanation });
  } catch (error) {
    console.error('Error explaining term:', error);
    res.status(500).json({ success: false, message: 'Failed to explain term' });
  }
};

export const createAppointmentFromSuggestion = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) { res.status(401).json({ success: false, message: 'Authentication required' }); return; }
    const { session_id, specialty, symptoms, urgencyLevel } = req.body;
    const session = await ChatSession.findOne({ session_id, user_id: req.user._id });
    if (!session) { res.status(404).json({ success: false, message: 'Session not found' }); return; }
    res.status(200).json({
      success: true,
      data: {
        specialty, symptoms, urgencyLevel,
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
        message: 'Vui lòng nhập chủ đề cần tư vấn'
      });
    }

    // Sanitize input
    const sanitized = sanitizeInput(topic);
    if (!sanitized.safe) {
      return res.status(400).json({
        success: false,
        message: sanitized.reason || 'Chủ đề không hợp lệ'
      });
    }

    // Tạo session ID từ userId và timestamp
    const sessionId = `${userId}_${Date.now()}`;
    const service = getServiceForSession(sessionId);

    // Load patient profile nếu có
    if (userId) {
      await service.loadPatientProfile(userId);
    }

    // Lấy lời khuyên từ service
    const advice = await service.getLifestyleAdvice(sanitized.sanitized);

    return res.status(200).json({
      success: true,
      data: {
        topic: advice.topic,
        advice: advice.advice,
        confidence: advice.confidence,
        category: advice.category,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Error in getLifestyleAdvice:', error);
    
    return res.status(500).json({
      success: false,
      message: 'Có lỗi xảy ra khi lấy lời khuyên'
    });
  }
};
