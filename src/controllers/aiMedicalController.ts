import { Request, Response } from 'express';
import ChatSession, { IChatSession } from '../models/chatbot';
import { AuthRequest } from '../middlewares/authmiddleware';
import { AIMedicalService } from '../utils/aiMedicalService';
import DrugCategory from '../models/DrugCategory';
import Drug from '../models/Drug';


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

    // Tìm hoặc tạo session active
    const session = await ChatSession.findOrCreateActiveSession(req.user._id);
    console.log('📝 [DEBUG] Session found/created:', session.session_id);

    // Thêm tin nhắn user vào session
    await session.addMessage({
      role: 'user',
      content: message.trim()
    });
    console.log('📝 [DEBUG] User message saved to session');

    // Xử lý tin nhắn với AI
    const aiResponse = await aiService.processMessage(message);
    console.log('📝 [DEBUG] AI response received');

    // Thêm phản hồi AI vào session
    await session.addMessage({
      role: 'assistant',
      content: aiResponse.response,
      category: aiResponse.category,
      confidence: aiResponse.confidence,
      suggestedActions: aiResponse.suggestedActions,
      emergencyAlert: aiResponse.emergencyAlert,
      relatedSpecialties: aiResponse.relatedSpecialties
    });
    console.log('📝 [DEBUG] AI message saved to session');

    // Lấy lại session để kiểm tra
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
      success: false,
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

    // Format dữ liệu cho frontend
    const formattedSessions = sessions.map(session => ({
      id: session.session_id,
      title: session.title,
      preview: session.messages.length > 0 
        ? session.messages[session.messages.length - 1].content.substring(0, 100) + '...'
        : 'Chưa có tin nhắn',
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

// Tìm kiếm trong lịch sử chat
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
        results: searchResults.slice(0, 10) // Giới hạn kết quả
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

// Lấy thông tin thuốc
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

    // Sử dụng AI service để lấy thông tin thuốc
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
