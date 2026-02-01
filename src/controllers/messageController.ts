// controllers/messageController.ts
import { Request, Response } from 'express';
import Message from '../models/message';
import Conversation from '../models/conversation';
import { AuthRequest } from '../middlewares/authmiddleware';


// Lấy tin nhắn theo medical record
export const getMessagesByRecord = async (req: AuthRequest, res: Response) => {
  try {
    const { recordId } = req.params;
    
    if (!recordId) {
      return res.status(400).json({
        success: false,
        message: 'Medical record ID is required'
      });
    }

    const messages = await Message.find({
      medical_record_id: recordId
    })
      .populate('sender_id', 'name avatar role')
      .populate('receiver_id', 'name avatar role')
      .sort({ timestamp: 1 });

    // Đánh dấu tin nhắn là đã đọc nếu người dùng hiện tại là receiver
    const userId = req.user?._id;
    await Message.updateMany(
      {
        medical_record_id: recordId,
        receiver_id: userId,
        read: false
      },
      {
        read: true,
        read_at: new Date()
      }
    );

    res.status(200).json({
      success: true,
      data: {
        messages,
        recordId
      }
    });
  } catch (error) {
    console.error('Error fetching messages by record:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching messages'
    });
  }
};

export const sendMessage = async (req: AuthRequest, res: Response) => {
  try {
    const { receiver_id, message, message_type = 'text', medical_record_id, appointment_id } = req.body;

    if (!receiver_id || !message) {
      return res.status(400).json({ 
        success: false, 
        message: 'Receiver ID and message are required' 
      });
    }

    const senderId = req.user?._id;
    
    // ✅ FIX: Ensure consistent sorting
    const participantIds = [senderId.toString(), receiver_id.toString()].sort();

    // ✅ FIX: Use findOneAndUpdate with upsert (atomic operation)
    const conversation = await Conversation.findOneAndUpdate(
      {
        participant_ids: participantIds,
        ...(medical_record_id && { medical_record_id })
      },
      {
        $setOnInsert: {
          participant_ids: participantIds,
          medical_record_id: medical_record_id || null,
          appointment_id: appointment_id || null,
          unread_count: 0,
          last_message_at: new Date()
        }
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true
      }
    );

    // Create message
    const newMessage = new Message({
      sender_id: senderId,
      receiver_id,
      message,
      message_type,
      medical_record_id: medical_record_id || null,
      appointment_id: appointment_id || null,
      conversation_id: conversation._id,
      timestamp: new Date(),
      read: false
    });

    await newMessage.save();

    // ✅ FIX: Atomic update to prevent race conditions
    await Conversation.findByIdAndUpdate(
      conversation._id,
      {
        $set: {
          last_message: newMessage._id,
          last_message_at: new Date()
        },
        $inc: {
          unread_count: receiver_id !== senderId.toString() ? 1 : 0
        }
      }
    );

    // Populate for response
    await newMessage.populate('sender_id', 'name avatar role');
    await newMessage.populate('receiver_id', 'name avatar role');

    res.status(201).json({
      success: true,
      data: { message: newMessage }
    });
  } catch (error: any) {
    console.error('Error sending message:', error);
    
    // ✅ Better error handling
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'Duplicate conversation error'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Error sending message',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Lấy danh sách conversations
export const getConversations = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?._id;

    const conversations = await Conversation.find({
      participant_ids: userId
    })
      .populate('participant_ids', 'name avatar role')
      .populate('last_message')
      .populate('medical_record_id')
      .sort({ last_message_at: -1 });

    const formattedConversations = await Promise.all(
      conversations.map(async (conversation) => {
        const otherParticipant = conversation.participant_ids.find(
          (participant: any) => participant._id.toString() !== userId.toString()
        );

        const unreadCount = await Message.countDocuments({
          conversation_id: conversation._id,
          receiver_id: userId,
          read: false
        });

        return {
          _id: conversation._id,
          participant: otherParticipant,
          last_message: conversation.last_message,
          last_message_at: conversation.last_message_at,
          unread_count: unreadCount,
          medical_record_id: conversation.medical_record_id
        };
      })
    );

    res.status(200).json({
      success: true,
      data: formattedConversations
    });
  } catch (error) {
    console.error('Error fetching conversations:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching conversations'
    });
  }
};

// Lấy tin nhắn trong conversation
export const getConversationMessages = async (req: AuthRequest, res: Response) => {
  try {
    const { conversationId } = req.params;
    const userId = req.user?._id;

    // Kiểm tra xem user có trong conversation không
    const conversation = await Conversation.findOne({
      _id: conversationId,
      participant_ids: userId
    });

    if (!conversation) {
      return res.status(403).json({
        success: false,
        message: 'Access denied to this conversation'
      });
    }

    const messages = await Message.find({
      conversation_id: conversationId
    })
      .populate('sender_id', 'name avatar role')
      .populate('receiver_id', 'name avatar role')
      .sort({ timestamp: 1 });

    // Đánh dấu tin nhắn là đã đọc
    await Message.updateMany(
      {
        conversation_id: conversationId,
        receiver_id: userId,
        read: false
      },
      {
        read: true,
        read_at: new Date()
      }
    );

    // Reset unread count
    conversation.unread_count = 0;
    await conversation.save();

    res.status(200).json({
      success: true,
      data: messages
    });
  } catch (error) {
    console.error('Error fetching conversation messages:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching messages'
    });
  }
};

// Đánh dấu tin nhắn đã đọc
export const markMessagesAsRead = async (req: AuthRequest, res: Response) => {
  try {
    const { conversationId } = req.params;
    const userId = req.user?._id;

    const result = await Message.updateMany(
      {
        conversation_id: conversationId,
        receiver_id: userId,
        read: false
      },
      {
        read: true,
        read_at: new Date()
      }
    );

    // Cập nhật unread count trong conversation
    await Conversation.findByIdAndUpdate(conversationId, {
      unread_count: 0
    });

    res.status(200).json({
      success: true,
      message: 'Messages marked as read',
      data: {
        modifiedCount: result.modifiedCount
      }
    });
  } catch (error) {
    console.error('Error marking messages as read:', error);
    res.status(500).json({
      success: false,
      message: 'Error marking messages as read'
    });
  }
};


export const sendMessageWithMedia = async (req: AuthRequest, res: Response) => {
  try {
    const {
      receiver_id,
      message,
      medical_record_id,
      appointment_id
    } = req.body;

    const senderId = req.user?._id;
    const file = req.file;

    if (!receiver_id || !file) {
      return res.status(400).json({
        success: false,
        message: 'Receiver and media file are required'
      });
    }

    const participantIds = [senderId, receiver_id].sort();

    let conversation = await Conversation.findOne({
      participant_ids: { $all: participantIds, $size: 2 },
      ...(medical_record_id && { medical_record_id })
    });

    if (!conversation) {
      conversation = await Conversation.create({
        participant_ids: participantIds,
        medical_record_id: medical_record_id || null,
        appointment_id: appointment_id || null
      });
    }

    const newMessage = await Message.create({
      sender_id: senderId,
      receiver_id,
      message: message || '',
      message_type: file.mimetype.startsWith('image') ? 'image' : 'file',

      media_url: `/chatting/messages/${file.filename}`,
      media_name: file.originalname,
      media_size: file.size,
      media_mime: file.mimetype,

      medical_record_id,
      appointment_id,
      conversation_id: conversation._id,
      read: false
    });

    conversation.last_message = newMessage._id;
    conversation.last_message_at = new Date();
    conversation.unread_count += 1;
    await conversation.save();

    await newMessage.populate('sender_id', 'name avatar role');
    await newMessage.populate('receiver_id', 'name avatar role');

    res.status(201).json({
      success: true,
      data: newMessage
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Send media failed' });
  }
};
