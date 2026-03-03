import { Request, Response } from 'express';
import ChatSession, { IChatSession } from '../models/chatbot';
import { AuthRequest } from '../middlewares/authmiddleware';
import { AIMedicalService } from '../utils/aiMedicalService';
import Specialty from '../models/specialty';
import Doctor from '../models/doctor';
import Appointment from '../models/appointment';
import Review from '../models/review';


const aiService = new AIMedicalService();

export const getOrCreateChatSession = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
      return;
    }

    const session = await ChatSession.findOrCreateActiveSession(req.user._id);
    
    res.status(200).json({
      success: true,
      data: {
        session: session.getSummary(),
        messages: session.messages
      }
    });
  } catch (error) {
    console.error('Error getting chat session:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export const sendMessage = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
      return;
    }

    const { message } = req.body;

    if (!message || typeof message !== 'string') {
      res.status(400).json({
        success: false,
        message: 'Message is required'
      });
      return;
    }

    console.log('📝 [DEBUG] Starting sendMessage process for user:', req.user._id);

    // Find or create active session
    const session = await ChatSession.findOrCreateActiveSession(req.user._id);
    console.log('📝 [DEBUG] Session found/created:', session.session_id);

    // Add user message to session
    await session.addMessage({
      role: 'user',
      content: message.trim()
    });
    console.log('📝 [DEBUG] User message saved to session');

    // Process message with AI
    const aiResponse = await aiService.processMessage(message);
    console.log('📝 [DEBUG] AI response received');

    // Add AI response to session
    await session.addMessage({
      role: 'assistant',
      content: aiResponse.response,
      category: aiResponse.category,
      confidence: aiResponse.confidence,
      suggestedActions: aiResponse.suggestedActions,
      emergencyAlert: aiResponse.emergencyAlert,
      relatedSpecialties: aiResponse.relatedSpecialties,
      appointmentRecommendation: aiResponse.appointmentRecommendation
    });
    console.log('📝 [DEBUG] AI message saved to session');

    // Retrieve updated session for verification
    const updatedSession = await ChatSession.findById(session._id);
    console.log('📝 [DEBUG] Final message count:', updatedSession?.messages?.length);

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
        session_id: session.session_id
      }
    });

  } catch (error) {
    console.error('❌ [ERROR] Error sending message:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export const getChatHistory = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
      return;
    }

    const { limit = 10 } = req.query;
    const history = await ChatSession.getUserChatHistory(req.user._id, Number(limit));

    res.status(200).json({
      success: true,
      data: history
    });
  } catch (error) {
    console.error('Error getting chat history:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export const getSessionMessages = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
      return;
    }

    const { session_id } = req.params;

    const session = await ChatSession.findOne({
      session_id,
      user_id: req.user._id
    });

    if (!session) {
      res.status(404).json({
        success: false,
        message: 'Chat session not found'
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: {
        session: session.getSummary(),
        messages: session.messages
      }
    });
  } catch (error) {
    console.error('Error getting session messages:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export const closeSession = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
      return;
    }

    const { session_id } = req.params;

    const session = await ChatSession.findOne({
      session_id,
      user_id: req.user._id
    });

    if (!session) {
      res.status(404).json({
        success: false,
        message: 'Chat session not found'
      });
      return;
    }

    await session.closeSession();

    res.status(200).json({
      success: true,
      message: 'Chat session closed successfully'
    });
  } catch (error) {
    console.error('Error closing session:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export const cleanupExpiredSessions = async (req: Request, res: Response): Promise<void> => {
  try {
    const cleanedCount = await ChatSession.cleanupExpiredSessions();
    
    res.status(200).json({
      success: true,
      message: `Cleaned up ${cleanedCount} expired sessions`,
      data: { cleaned_count: cleanedCount }
    });
  } catch (error) {
    console.error('Error cleaning expired sessions:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export const chatWithAI = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { message } = req.body;
    const userId = req.user?._id;

    console.log('🔐 [AI Medical] User making request:', {
      userId: req.user?._id,
      role: req.user?.role,
      email: req.user?.email
    });

    if (!message || typeof message !== 'string') {
      res.status(400).json({
        success: false,
        message: 'Invalid message'
      });
      return;
    }

    if (!userId) {
      res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
      return;
    }

    // Log the medical query for monitoring
    console.log('🏥 [AI Medical] Processing medical query:', {
      userId,
      message: message.substring(0, 100) + (message.length > 100 ? '...' : ''),
      timestamp: new Date().toISOString()
    });

    const response = await aiService.processMessage(message);

    res.status(200).json({
      success: true,
      data: {
        response: response.response,
        confidence: response.confidence,
        suggestedActions: response.suggestedActions,
        emergencyAlert: response.emergencyAlert,
        category: response.category,
        relatedSpecialties: response.relatedSpecialties,
        appointmentRecommendation: response.appointmentRecommendation,
        timestamp: new Date()
      }
    });

  } catch (error) {
    console.error('❌ [AI Medical] Error in AI chat:', error);
    res.status(500).json({
      success: false,
      message: 'AI system error'
    });
  }
};

export const clearChatHistory = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    aiService.clearHistory();
    
    res.status(200).json({
      success: true,
      message: 'Chat history cleared successfully'
    });
  } catch (error) {
    console.error('❌ Error clearing chat history:', error);
    res.status(500).json({
      success: false,
      message: 'Error clearing chat history'
    });
  }
};

export const getSpecialties = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const specialties = aiService.getAvailableSpecialties();
    
    res.status(200).json({
      success: true,
      data: specialties
    });
  } catch (error) {
    console.error('❌ Error getting specialties:', error);
    res.status(500).json({
      success: false,
      message: 'Error retrieving specialties'
    });
  }
};

export const getChatSessions = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
      return;
    }

    const { page = 1, limit = 20 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const sessions = await ChatSession.find({
      user_id: req.user._id
    })
    .select('session_id title messages category created_at updated_at last_activity')
    .sort({ last_activity: -1 })
    .skip(skip)
    .limit(Number(limit))
    .lean();

    // Format data for frontend
    const formattedSessions = sessions.map(session => ({
      id: session.session_id,
      title: session.title,
      preview: session.messages.length > 0 
        ? session.messages[session.messages.length - 1].content.substring(0, 100) + '...'
        : 'No messages yet',
      date: session.last_activity,
      messageCount: session.messages.length,
      category: session.category
    }));

    res.status(200).json({
      success: true,
      data: {
        sessions: formattedSessions,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total: await ChatSession.countDocuments({ user_id: req.user._id })
        }
      }
    });
  } catch (error) {
    console.error('Error getting chat sessions:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Search chat history
export const searchChatHistory = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
      return;
    }

    const { query } = req.query;

    if (!query || typeof query !== 'string') {
      res.status(400).json({
        success: false,
        message: 'Search query is required'
      });
      return;
    }

    const sessions = await ChatSession.find({
      user_id: req.user._id,
      $or: [
        { title: { $regex: query, $options: 'i' } },
        { 'messages.content': { $regex: query, $options: 'i' } }
      ]
    })
    .select('session_id title messages created_at')
    .sort({ last_activity: -1 })
    .limit(10)
    .lean();

    const searchResults = sessions.flatMap(session => 
      session.messages
        .filter(msg => msg.content.toLowerCase().includes(query.toLowerCase()))
        .map(msg => ({
          sessionId: session.session_id,
          sessionTitle: session.title,
          message: msg.content,
          role: msg.role,
          timestamp: msg.timestamp,
          category: msg.category
        }))
    );

    res.status(200).json({
      success: true,
      data: {
        query,
        results: searchResults.slice(0, 10) // Limit results
      }
    });
  } catch (error) {
    console.error('Error searching chat history:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get medication information
export const getMedicationInfo = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { medicationName } = req.params;

    if (!medicationName) {
      res.status(400).json({
        success: false,
        message: 'Medication name is required'
      });
      return;
    }

    // Use AI service to get medication information
    const medicationInfo = await aiService.getMedicationInfo(medicationName);

    res.status(200).json({
      success: true,
      data: medicationInfo
    });
  } catch (error) {
    console.error('Error getting medication info:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get medication information'
    });
  }
};

export const getMedicalTermExplanation = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { term } = req.params;

    if (!term) {
      res.status(400).json({
        success: false,
        message: 'Medical term is required'
      });
      return;
    }

    const explanation = await aiService.explainMedicalTerm(term);

    res.status(200).json({
      success: true,
      data: explanation
    });
  } catch (error) {
    console.error('Error getting medical term explanation:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get medical term explanation'
    });
  }
};

// Create appointment from suggestion
export const createAppointmentFromSuggestion = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
      return;
    }

    const { session_id, specialty, symptoms, urgencyLevel } = req.body;

    // Find chat session
    const session = await ChatSession.findOne({
      session_id,
      user_id: req.user._id
    });

    if (!session) {
      res.status(404).json({
        success: false,
        message: 'Chat session not found'
      });
      return;
    }

    // TODO: Create appointment in your appointment booking system
    // const appointment = await Appointment.create({ ... });

    res.status(200).json({
      success: true,
      data: {
        message: 'Appointment created successfully',
        appointment: {
          specialty,
          symptoms,
          urgencyLevel,
          suggestedDate: new Date(Date.now() + 24 * 60 * 60 * 1000) // Example: tomorrow
        }
      }
    });

  } catch (error) {
    console.error('Error creating appointment:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create appointment'
    });
  }
};

export const getAllSpecialties = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const specialties = await Specialty.find({ isActive: true })
      .select('_id name description icon color doctorCount')
      .sort({ name: 1 });

    res.status(200).json({
      success: true,
      data: specialties.map(s => ({
        id: s._id,
        name: s.name,
        description: s.description,
        icon: s.icon,
        color: s.color,
        doctorCount: s.doctorCount
      }))
    });
  } catch (error) {
    console.error('Error fetching specialties:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching specialties'
    });
  }
};

/**
 * Lấy danh sách bác sĩ theo specialty với availability
 */
export const getDoctorsBySpecialty = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { specialty_id } = req.params;
    const { date } = req.query;

    if (!specialty_id) {
      res.status(400).json({
        success: false,
        message: 'Specialty ID is required'
      });
      return;
    }

    // Kiểm tra specialty tồn tại
    const specialty = await Specialty.findById(specialty_id);
    if (!specialty) {
      res.status(404).json({
        success: false,
        message: 'Specialty not found'
      });
      return;
    }

    // Tìm bác sĩ theo specialty
    const doctors = await Doctor.find({ 
      specialty_id,
      isAvailable: true 
    })
    .populate('user_id', 'name email phoneNumber avatar')
    .select('consultation_fee years_of_experience qualifications achievements');

    const targetDate = date ? new Date(date as string) : new Date();
    if (targetDate <= new Date()) {
      targetDate.setDate(targetDate.getDate() + 1);
    }
    const dateStr = targetDate.toISOString().split('T')[0];

    const doctorsWithAvailability = [];

    for (const doctor of doctors) {
      // Kiểm tra availability
      const startOfDay = new Date(targetDate);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(targetDate);
      endOfDay.setHours(23, 59, 59, 999);

      const bookedAppointments = await Appointment.find({
        doctor_id: doctor._id,
        appointment_date: { $gte: startOfDay, $lte: endOfDay },
        status: { $in: ['pending', 'confirmed'] }
      }).select('time_slot');

      const bookedSlots = bookedAppointments.map(app => app.time_slot);
      
      const allTimeSlots = [
        '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
        '14:00', '14:30', '15:00', '15:30', '16:00', '16:30'
      ];

      const availableSlots = allTimeSlots.filter(slot => !bookedSlots.includes(slot));

      // Tính rating trung bình
      const reviews = await Review.aggregate([
        { $match: { doctor_id: doctor._id } },
        { $group: { 
          _id: null, 
          avgRating: { $avg: '$rating' },
          totalReviews: { $sum: 1 }
        }}
      ]);

      const avgRating = reviews.length > 0 ? reviews[0].avgRating : 0;
      const totalReviews = reviews.length > 0 ? reviews[0].totalReviews : 0;

      doctorsWithAvailability.push({
        _id: doctor._id,
        name: (doctor as any).user_id?.name || 'Doctor',
        avatar: (doctor as any).user_id?.avatar,
        email: (doctor as any).user_id?.email,
        phone: (doctor as any).user_id?.phoneNumber,
        specialty: {
          id: specialty._id,
          name: specialty.name,
          icon: specialty.icon,
          color: specialty.color
        },
        consultation_fee: doctor.consultation_fee,
        years_of_experience: doctor.years_of_experience,
        qualifications: doctor.qualifications,
        achievements: doctor.achievements,
        rating: {
          average: avgRating,
          total: totalReviews
        },
        available_slots: availableSlots,
        next_available_date: dateStr,
        is_available_today: availableSlots.length > 0
      });
    }

    // Sắp xếp: bác sĩ có rating cao lên đầu, sau đó đến kinh nghiệm
    doctorsWithAvailability.sort((a, b) => {
      if (a.rating.average !== b.rating.average) {
        return b.rating.average - a.rating.average;
      }
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
          color: specialty.color
        },
        date: dateStr,
        doctors: doctorsWithAvailability,
        total_doctors: doctorsWithAvailability.length,
        available_today: doctorsWithAvailability.filter(d => d.is_available_today).length
      }
    });

  } catch (error) {
    console.error('Error fetching doctors by specialty:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching doctors'
    });
  }
};

// Update findDoctorsForAppointment để sử dụng dynamic specialty
export const findDoctorsForAppointment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
      return;
    }

    const { specialty_name, date, urgency_level } = req.query;

    if (!specialty_name) {
      res.status(400).json({
        success: false,
        message: 'Specialty name is required'
      });
      return;
    }

    // Tìm specialty theo tên (không phân biệt hoa thường)
    const specialty = await Specialty.findOne({ 
      name: { $regex: new RegExp(specialty_name as string, 'i') },
      isActive: true 
    });

    if (!specialty) {
      res.status(404).json({
        success: false,
        message: 'Specialty not found'
      });
      return;
    }

    // Tìm bác sĩ theo specialty
    const doctors = await Doctor.find({ 
      specialty_id: specialty._id,
      isAvailable: true 
    }).populate('user_id', 'name email');

    const availableDoctors = [];
    const targetDate = date ? new Date(date as string) : new Date();
    targetDate.setDate(targetDate.getDate() + 1);
    const dateStr = targetDate.toISOString().split('T')[0];

    for (const doctor of doctors) {
      const startOfDay = new Date(targetDate);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(targetDate);
      endOfDay.setHours(23, 59, 59, 999);

      const bookedAppointments = await Appointment.find({
        doctor_id: doctor._id,
        appointment_date: { $gte: startOfDay, $lte: endOfDay },
        status: { $in: ['pending', 'confirmed'] }
      }).select('time_slot');

      const bookedSlots = bookedAppointments.map(app => app.time_slot);
      
      const allTimeSlots = [
        '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
        '14:00', '14:30', '15:00', '15:30', '16:00', '16:30'
      ];

      const availableSlots = allTimeSlots.filter(slot => !bookedSlots.includes(slot));

      if (availableSlots.length > 0) {
        availableDoctors.push({
          _id: doctor._id,
          name: (doctor as any).user_id?.name || 'Doctor',
          specialty: {
            id: specialty._id,
            name: specialty.name,
            icon: specialty.icon
          },
          consultation_fee: doctor.consultation_fee,
          years_of_experience: doctor.years_of_experience,
          available_slots: availableSlots.slice(0, 5),
          next_available_date: dateStr,
          urgency_level: urgency_level || 'medium'
        });
      }
    }

    res.status(200).json({
      success: true,
      data: {
        specialty: {
          id: specialty._id,
          name: specialty.name,
          icon: specialty.icon
        },
        date: dateStr,
        doctors: availableDoctors,
        total: availableDoctors.length
      }
    });

  } catch (error) {
    console.error('Error finding doctors:', error);
    res.status(500).json({
      success: false,
      message: 'Error finding available doctors'
    });
  }
};


// aiMedicalController.ts — sửa hàm bookAppointmentFromAI

export const bookAppointmentFromAI = async (req: AuthRequest, res: Response): Promise<void> => {
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
      session_id
    } = req.body;

    if (!doctor_id || !appointment_date || !time_slot) {
      res.status(400).json({
        success: false,
        message: 'doctor_id, appointment_date, and time_slot are required'
      });
      return;
    }

    // ── Kiểm tra doctor tồn tại ─────────────────────────────────────
    const doctor = await Doctor.findById(doctor_id).populate('user_id', 'name email');
    if (!doctor || !doctor.isAvailable) {
      res.status(404).json({ success: false, message: 'Doctor not found or unavailable' });
      return;
    }

    // ── Kiểm tra slot chưa bị book ──────────────────────────────────
    const targetDate  = new Date(appointment_date);
    const startOfDay  = new Date(targetDate); startOfDay.setHours(0, 0, 0, 0);
    const endOfDay    = new Date(targetDate); endOfDay.setHours(23, 59, 59, 999);

    const existingAppointment = await Appointment.findOne({
      doctor_id,
      appointment_date: { $gte: startOfDay, $lte: endOfDay },
      time_slot,
      status: { $in: ['pending', 'confirmed'] }
    });

    if (existingAppointment) {
      res.status(409).json({
        success: false,
        message: 'This time slot is already booked. Please choose another slot.'
      });
      return;
    }

    // ── Tạo appointment — dùng đúng field name theo model ───────────
    const appointment = await Appointment.create({
      user_id:          req.user._id,   // ✅ đổi patient_id → user_id
      doctor_id,
      appointment_date: targetDate,
      time_slot,
      status:           'pending',
      reason:           reason || 'Booked via AI Medical Assistant',
      notes:            `Urgency: ${urgency_level}. Symptoms: ${(symptoms || []).join(', ')}`
    });

    // ── Ghi log vào chat session nếu có ─────────────────────────────
    if (session_id) {
      const session = await ChatSession.findOne({ session_id, user_id: req.user._id });
      if (session) {
        await session.addMessage({
          role:       'assistant',
          content:    `✅ Appointment confirmed with Dr. ${(doctor as any).user_id?.name} on ${appointment_date} at ${time_slot}.`,
          category:   'general',
          confidence: 1.0
        });
      }
    }

    res.status(201).json({
      success: true,
      message: 'Appointment booked successfully',
      data: {
        appointment: {
          _id:              appointment._id,
          doctor_name:      (doctor as any).user_id?.name,
          appointment_date,
          time_slot,
          status:           'pending',
          consultation_fee: doctor.consultation_fee
        }
      }
    });

  } catch (error) {
    console.error('❌ Error booking appointment from AI:', error);
    res.status(500).json({ success: false, message: 'Failed to book appointment' });
  }
};