import { Request, Response } from 'express';
import ChatSession from '../models/chatbot';
import { AuthRequest } from '../middlewares/authmiddleware';
import {
  AIMedicalService,
  getServiceForSession,
  cleanupServiceForSession,
} from '../utils/aiMedicalService';
import Specialty from '../models/specialty';
import Doctor from '../models/doctor';
import Appointment from '../models/appointment';
import Review from '../models/review';

// ✅ FIX #3: Không còn singleton toàn app — mỗi session có instance riêng
// const aiService = new AIMedicalService(); ← ĐÃ XÓA

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

    const session = await ChatSession.findOrCreateActiveSession(req.user._id);

    // ✅ FIX #14: Load lịch sử từ DB vào AI service ngay khi lấy session
    if (session.messages.length > 0) {
      const aiService = getServiceForSession(session.session_id);
      aiService.loadHistoryFromDB(session.messages);
    }

    res.status(200).json({
      success: true,
      data: {
        session: session.getSummary(),
        messages: session.messages,
      },
    });
  } catch (error) {
    console.error('Error getting chat session:', error);
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

    if (message.trim().length > 500) {
      res.status(400).json({
        success: false,
        message: 'Message too long. Maximum 500 characters.',
      });
      return;
    }

    // Lấy hoặc tạo session
    const session = await ChatSession.findOrCreateActiveSession(req.user._id);

    // ✅ FIX #3 + #14: Lấy AI service riêng cho session này
    const aiService = getServiceForSession(session.session_id);

    // Load history vào service nếu service mới tạo (history rỗng)
    if (aiService.getHistory().length === 0 && session.messages.length > 0) {
      aiService.loadHistoryFromDB(session.messages);
    }

    // Lưu user message vào DB
    await session.addMessage({
      role: 'user',
      content: message.trim(),
    });

    // ✅ FIX #3: Truyền userId để check existing appointment
    const aiResponse = await aiService.processMessage(
      message.trim(),
      req.user._id.toString()
    );

    // Lưu AI response vào DB
    await session.addMessage({
      role: 'assistant',
      content: aiResponse.response,
      category: aiResponse.category,
      confidence: aiResponse.confidence,
      suggestedActions: aiResponse.suggestedActions,
      emergencyAlert: aiResponse.emergencyAlert,
      relatedSpecialties: aiResponse.relatedSpecialties,
      appointmentRecommendation: aiResponse.appointmentRecommendation,
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
    console.error('Error getting chat history:', error);
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
    const session = await ChatSession.findOne({
      session_id,
      user_id: req.user._id,
    });

    if (!session) {
      res.status(404).json({ success: false, message: 'Chat session not found' });
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
    const session = await ChatSession.findOne({
      session_id,
      user_id: req.user._id,
    });

    if (!session) {
      res.status(404).json({ success: false, message: 'Chat session not found' });
      return;
    }

    await session.closeSession();

    // ✅ FIX #3: Cleanup service instance khi đóng session
    cleanupServiceForSession(session_id);

    res.status(200).json({
      success: true,
      message: 'Chat session closed successfully',
    });
  } catch (error) {
    console.error('Error closing session:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ==================== CLEANUP ====================

export const cleanupExpiredSessions = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const cleanedCount = await ChatSession.cleanupExpiredSessions();
    res.status(200).json({
      success: true,
      message: `Cleaned up ${cleanedCount} expired sessions`,
      data: { cleaned_count: cleanedCount },
    });
  } catch (error) {
    console.error('Error cleaning expired sessions:', error);
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

    // Lấy active session để clear service đúng instance
    const session = await ChatSession.findOne({
      user_id: req.user._id,
      is_active: true,
    });

    if (session) {
      const aiService = getServiceForSession(session.session_id);
      aiService.clearHistory();
    }

    res.status(200).json({
      success: true,
      message: 'Chat history cleared successfully',
    });
  } catch (error) {
    console.error('❌ Error clearing chat history:', error);
    res.status(500).json({ success: false, message: 'Error clearing chat history' });
  }
};

// ==================== SPECIALTIES ====================

// ✅ FIX #1 + #2: Một hàm duy nhất getAllSpecialties lấy từ DB
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
      data: specialties.map((s) => ({
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

// ✅ FIX #2: Đổi tên getSpecialties → alias của getAllSpecialties
export const getSpecialties = getAllSpecialties;

// ==================== DOCTORS BY SPECIALTY (N+1 FIX) ====================

export const getDoctorsBySpecialty = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const { specialty_id } = req.params;
    const { date } = req.query;

    if (!specialty_id) {
      res.status(400).json({ success: false, message: 'Specialty ID is required' });
      return;
    }

    const specialty = await Specialty.findById(specialty_id);
    if (!specialty) {
      res.status(404).json({ success: false, message: 'Specialty not found' });
      return;
    }

    const doctors = await Doctor.find({
      specialty_id,
      isAvailable: true,
    })
      .populate('user_id', 'name email phoneNumber avatar')
      .select('consultation_fee years_of_experience qualifications achievements education certifications');

    const targetDate = date ? new Date(date as string) : new Date();
    if (targetDate <= new Date()) targetDate.setDate(targetDate.getDate() + 1);
    const dateStr = targetDate.toISOString().split('T')[0];
    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);

    const doctorIds = doctors.map((d) => d._id);

    // ✅ FIX #9: Batch query appointments
    const allBooked = await Appointment.find({
      doctor_id: { $in: doctorIds },
      appointment_date: { $gte: startOfDay, $lte: endOfDay },
      status: { $in: ['pending', 'confirmed'] },
    }).select('doctor_id time_slot');

    const bookedByDoctor = new Map<string, Set<string>>();
    for (const appt of allBooked) {
      const key = appt.doctor_id.toString();
      if (!bookedByDoctor.has(key)) bookedByDoctor.set(key, new Set());
      bookedByDoctor.get(key)!.add(appt.time_slot);
    }

    // ✅ FIX #9: Batch query ratings
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

    const ratingMap = new Map<string, { avg: number; total: number }>();
    for (const r of allRatings) {
      ratingMap.set(r._id.toString(), { avg: r.avgRating, total: r.totalReviews });
    }

    const ALL_TIME_SLOTS = [
      '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
      '14:00', '14:30', '15:00', '15:30', '16:00', '16:30',
    ];

    const doctorsWithAvailability = doctors.map((doctor) => {
      const docId = doctor._id.toString();
      const bookedSlots = bookedByDoctor.get(docId) || new Set();
      const availableSlots = ALL_TIME_SLOTS.filter((s) => !bookedSlots.has(s));
      const rating = ratingMap.get(docId) || { avg: 0, total: 0 };

      return {
        _id: doctor._id,
        name: (doctor as any).user_id?.name || 'Doctor',
        avatar: (doctor as any).user_id?.avatar,
        email: (doctor as any).user_id?.email,
        phone: (doctor as any).user_id?.phoneNumber,
        specialty: {
          id: specialty._id,
          name: specialty.name,
          icon: specialty.icon,
          color: specialty.color,
        },
        consultation_fee: doctor.consultation_fee,
        years_of_experience: doctor.years_of_experience,
        qualifications: (doctor as any).qualifications || [],
        achievements: (doctor as any).achievements || [],
        education: doctor.education || [],
        certifications: doctor.certifications || [],
        rating: { average: rating.avg, total: rating.total },
        available_slots: availableSlots,
        next_available_date: dateStr,
        is_available_today: availableSlots.length > 0,
      };
    });

    // Sort by rating desc, then experience desc
    doctorsWithAvailability.sort((a, b) => {
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
        doctors: doctorsWithAvailability,
        total_doctors: doctorsWithAvailability.length,
        available_today: doctorsWithAvailability.filter((d) => d.is_available_today).length,
      },
    });
  } catch (error) {
    console.error('Error fetching doctors by specialty:', error);
    res.status(500).json({ success: false, message: 'Error fetching doctors' });
  }
};

// ==================== FIND DOCTORS FOR APPOINTMENT ====================

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
      res.status(400).json({ success: false, message: 'Specialty name is required' });
      return;
    }

    const specialty = await Specialty.findOne({
      name: { $regex: new RegExp(specialty_name as string, 'i') },
      isActive: true,
    });

    if (!specialty) {
      res.status(404).json({ success: false, message: 'Specialty not found' });
      return;
    }

    const doctors = await Doctor.find({
      specialty_id: specialty._id,
      isAvailable: true,
    }).populate('user_id', 'name email');

    const targetDate = date ? new Date(date as string) : new Date();
    targetDate.setDate(targetDate.getDate() + 1);
    const dateStr = targetDate.toISOString().split('T')[0];
    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);

    const doctorIds = doctors.map((d) => d._id);

    // ✅ FIX #9: Batch queries
    const allBooked = await Appointment.find({
      doctor_id: { $in: doctorIds },
      appointment_date: { $gte: startOfDay, $lte: endOfDay },
      status: { $in: ['pending', 'confirmed'] },
    }).select('doctor_id time_slot');

    const bookedByDoctor = new Map<string, Set<string>>();
    for (const appt of allBooked) {
      const key = appt.doctor_id.toString();
      if (!bookedByDoctor.has(key)) bookedByDoctor.set(key, new Set());
      bookedByDoctor.get(key)!.add(appt.time_slot);
    }

    const ALL_TIME_SLOTS = [
      '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
      '14:00', '14:30', '15:00', '15:30', '16:00', '16:30',
    ];

    const availableDoctors = doctors
      .map((doctor) => {
        const docId = doctor._id.toString();
        const bookedSlots = bookedByDoctor.get(docId) || new Set();
        const availableSlots = ALL_TIME_SLOTS.filter((s) => !bookedSlots.has(s));
        if (availableSlots.length === 0) return null;

        return {
          _id: doctor._id,
          name: (doctor as any).user_id?.name || 'Doctor',
          specialty: { id: specialty._id, name: specialty.name, icon: specialty.icon },
          consultation_fee: doctor.consultation_fee,
          years_of_experience: doctor.years_of_experience,
          available_slots: availableSlots.slice(0, 5),
          next_available_date: dateStr,
          urgency_level: urgency_level || 'medium',
        };
      })
      .filter(Boolean);

    res.status(200).json({
      success: true,
      data: {
        specialty: { id: specialty._id, name: specialty.name, icon: specialty.icon },
        date: dateStr,
        doctors: availableDoctors,
        total: availableDoctors.length,
      },
    });
  } catch (error) {
    console.error('Error finding doctors:', error);
    res.status(500).json({ success: false, message: 'Error finding available doctors' });
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
      symptoms,
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

    const doctor = await Doctor.findById(doctor_id).populate('user_id', 'name email');
    if (!doctor || !doctor.isAvailable) {
      res.status(404).json({ success: false, message: 'Doctor not found or unavailable' });
      return;
    }

    const targetDate = new Date(appointment_date);
    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);

    // Kiểm tra slot chưa bị book
    const existingAppointment = await Appointment.findOne({
      doctor_id,
      appointment_date: { $gte: startOfDay, $lte: endOfDay },
      time_slot,
      status: { $in: ['pending', 'confirmed'] },
    });

    if (existingAppointment) {
      res.status(409).json({
        success: false,
        message: 'This time slot is already booked. Please choose another slot.',
      });
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

    // Ghi xác nhận vào chat session
    if (session_id) {
      const session = await ChatSession.findOne({
        session_id,
        user_id: req.user._id,
      });
      if (session) {
        const confirmMsg =
          `✅ Lịch hẹn đã được đặt với Bác sĩ ${(doctor as any).user_id?.name} vào ngày ${appointment_date} lúc ${time_slot}. ` +
          `Vui lòng đến trước 15 phút.`;

        await session.addMessage({
          role: 'assistant',
          content: confirmMsg,
          category: 'general',
          confidence: 1.0,
        });

        // Sync vào AI service instance
        const aiService = getServiceForSession(session_id);
        aiService.addMessageToHistory({
          role: 'assistant',
          content: confirmMsg,
          timestamp: new Date(),
          category: 'general',
          language: 'vi',
        });
      }
    }

    res.status(201).json({
      success: true,
      message: 'Appointment booked successfully',
      data: {
        appointment: {
          _id: appointment._id,
          doctor_name: (doctor as any).user_id?.name,
          appointment_date,
          time_slot,
          status: 'pending',
          consultation_fee: doctor.consultation_fee,
        },
      },
    });
  } catch (error) {
    console.error('❌ Error booking appointment from AI:', error);
    res.status(500).json({ success: false, message: 'Failed to book appointment' });
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
        .select('session_id title messages category created_at updated_at last_activity')
        .sort({ last_activity: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      ChatSession.countDocuments({ user_id: req.user._id }),
    ]);

    const formattedSessions = sessions.map((session) => ({
      id: session.session_id,
      title: session.title,
      preview:
        session.messages.length > 0
          ? session.messages[session.messages.length - 1].content.substring(0, 100) + '...'
          : 'No messages yet',
      date: session.last_activity,
      messageCount: session.messages.length,
      category: session.category,
    }));

    res.status(200).json({
      success: true,
      data: {
        sessions: formattedSessions,
        pagination: { page: Number(page), limit: Number(limit), total },
      },
    });
  } catch (error) {
    console.error('Error getting chat sessions:', error);
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
      res.status(400).json({ success: false, message: 'Search query is required' });
      return;
    }

    const sessions = await ChatSession.find({
      user_id: req.user._id,
      $or: [
        { title: { $regex: query, $options: 'i' } },
        { 'messages.content': { $regex: query, $options: 'i' } },
      ],
    })
      .select('session_id title messages created_at')
      .sort({ last_activity: -1 })
      .limit(10)
      .lean();

    const searchResults = sessions
      .flatMap((session) =>
        session.messages
          .filter((msg) => msg.content.toLowerCase().includes(query.toLowerCase()))
          .map((msg) => ({
            sessionId: session.session_id,
            sessionTitle: session.title,
            message: msg.content,
            role: msg.role,
            timestamp: msg.timestamp,
            category: msg.category,
          }))
      )
      .slice(0, 10);

    res.status(200).json({
      success: true,
      data: { query, results: searchResults },
    });
  } catch (error) {
    console.error('Error searching chat history:', error);
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
      res.status(400).json({ success: false, message: 'Medication name is required' });
      return;
    }

    // Dùng service tạm thời cho medication query (không cần session)
    const tempService = new AIMedicalService();
    const medicationInfo = await tempService.getMedicationInfo(medicationName);

    res.status(200).json({ success: true, data: medicationInfo });
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
      res.status(400).json({ success: false, message: 'Medical term is required' });
      return;
    }

    const tempService = new AIMedicalService();
    const explanation = await tempService.explainMedicalTerm(term);

    res.status(200).json({ success: true, data: explanation });
  } catch (error) {
    console.error('Error getting medical term explanation:', error);
    res.status(500).json({ success: false, message: 'Failed to get medical term explanation' });
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

    const session = await ChatSession.findOne({
      session_id,
      user_id: req.user._id,
    });

    if (!session) {
      res.status(404).json({ success: false, message: 'Chat session not found' });
      return;
    }

    res.status(200).json({
      success: true,
      data: {
        message: 'Appointment created successfully',
        appointment: {
          specialty,
          symptoms,
          urgencyLevel,
          suggestedDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      },
    });
  } catch (error) {
    console.error('Error creating appointment:', error);
    res.status(500).json({ success: false, message: 'Failed to create appointment' });
  }
};