import { Request, Response as ExpressResponse } from 'express';
import Message from '../models/message';
import Conversation from '../models/conversation';
import { AuthRequest } from '../middlewares/authmiddleware';
import { socketService } from '../utils/socketService';

/* =======================
   GET MESSAGES BY RECORD
======================= */
export const getMessagesByRecord = async (req: AuthRequest, res: ExpressResponse) => {
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

    // Mark messages as read if current user is receiver
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

/* =======================
   SEND MESSAGE (REST API)
======================= */
export const sendMessage = async (req: AuthRequest, res: ExpressResponse) => {
  try {
    const { 
      receiver_id, 
      message, 
      message_type = 'text', 
      medical_record_id, 
      appointment_id 
    } = req.body;

    if (!receiver_id || !message) {
      return res.status(400).json({ 
        success: false, 
        message: 'Receiver ID and message are required' 
      });
    }

    const senderId = req.user?._id;
    
    // Ensure consistent sorting
    const participantIds = [senderId, receiver_id].sort((a, b) => {
      const aStr = a.toString();
      const bStr = b.toString();
      return aStr.localeCompare(bStr);
    });

    // Find or create conversation
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

    // Update conversation
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

    // Populate
    await newMessage.populate('sender_id', 'name avatar role');
    await newMessage.populate('receiver_id', 'name avatar role');

    // Emit to Socket.IO
    socketService.emitNewMessage(
      conversation._id.toString(),
      newMessage
    );

    res.status(201).json({
      success: true,
      data: { 
        message: newMessage,
        conversationId: conversation._id
      }
    });
  } catch (error: any) {
    console.error('Error sending message:', error);
    
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

/* =======================
   GET CONVERSATIONS
======================= */
export const getConversations = async (req: AuthRequest, res: ExpressResponse) => {
  try {
    const userId = req.user?._id;

    const conversations = await Conversation.find({
      participant_ids: userId
    })
      .populate('participant_ids', 'name avatar role')
      .populate({
        path: 'last_message',
        populate: {
          path: 'sender_id receiver_id',
          select: 'name avatar role'
        }
      })
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
          medical_record_id: conversation.medical_record_id,
          appointment_id: conversation.appointment_id
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

/* =======================
   GET CONVERSATION MESSAGES
======================= */
export const getConversationMessages = async (req: AuthRequest, res: ExpressResponse) => {
  try {
    const { conversationId } = req.params;
    const userId = req.user?._id;

    const conversation = await Conversation.findOne({
      _id: conversationId,
      participant_ids: { $in: [userId] }
    });

    if (!conversation) {
      return res.status(403).json({
        success: false,
        message: 'Access denied to this conversation'
      });
    }

    const messages = await Message.find({
      conversation_id: conversationId,
      deleted: { $ne: true }
    })
      .populate('sender_id', 'name avatar role')
      .populate('receiver_id', 'name avatar role')
      .sort({ timestamp: 1 });

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

    await Conversation.findByIdAndUpdate(conversationId, {
      unread_count: 0
    });

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

/* =======================
   MARK MESSAGES AS READ
======================= */
export const markMessagesAsRead = async (req: AuthRequest, res: ExpressResponse) => {
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

/* =======================
   SEND MESSAGE WITH MEDIA
======================= */
export const sendMessageWithMedia = async (req: AuthRequest, res: ExpressResponse) => {
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

    const participantIds = [senderId.toString(), receiver_id.toString()].sort();

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

    await Conversation.findByIdAndUpdate(conversation._id, {
      $set: {
        last_message: newMessage._id,
        last_message_at: new Date()
      },
      $inc: { unread_count: 1 }
    });

    await newMessage.populate('sender_id', 'name avatar role');
    await newMessage.populate('receiver_id', 'name avatar role');

    socketService.emitNewMessage(
      conversation._id.toString(),
      newMessage
    );

    res.status(201).json({
      success: true,
      data: newMessage
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ 
      success: false, 
      message: 'Send media failed' 
    });
  }
};

/* =======================
   EDIT MESSAGE
======================= */
export const editMessage = async (req: AuthRequest, res: ExpressResponse) => {
  try {
    const { messageId } = req.params;
    const { newMessage } = req.body;
    const userId = req.user?._id;

    if (!newMessage) {
      return res.status(400).json({ 
        success: false, 
        message: 'New message is required' 
      });
    }

    const message = await Message.findById(messageId);

    if (!message) {
      return res.status(404).json({ 
        success: false, 
        message: 'Message not found' 
      });
    }

    if (message.sender_id.toString() !== userId.toString()) {
      return res.status(403).json({ 
        success: false, 
        message: 'You can only edit your own message' 
      });
    }

    if (message.deleted) {
      return res.status(400).json({ 
        success: false, 
        message: 'Cannot edit deleted message' 
      });
    }

    if (message.message_type !== 'text') {
      return res.status(400).json({ 
        success: false, 
        message: 'Only text messages can be edited' 
      });
    }

    message.message = newMessage;
    message.edited = true;
    message.edited_at = new Date();
    await message.save();

    await message.populate('sender_id', 'name avatar role');
    await message.populate('receiver_id', 'name avatar role');

    socketService.emitMessageEdited(
      message.conversation_id.toString(),
      message
    );

    res.status(200).json({
      success: true,
      data: message
    });
  } catch (error) {
    console.error('Edit message error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Edit message failed' 
    });
  }
};

/* =======================
   DELETE MESSAGE
======================= */
export const deleteMessage = async (req: AuthRequest, res: ExpressResponse) => {
  try {
    const { messageId } = req.params;
    const { type } = req.body; // 'everyone' or 'me'
    const userId = req.user?._id;

    const message = await Message.findById(messageId);

    if (!message) {
      return res.status(404).json({ 
        success: false, 
        message: 'Message not found' 
      });
    }

    if (type === 'everyone' && message.sender_id.toString() !== userId.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Only sender can delete message for everyone'
      });
    }

    if (type === 'everyone') {
      message.deleted = true;
      message.deleted_at = new Date();
      message.deleted_by = userId;
      message.message = 'This message was deleted';
      await message.save();

      await message.populate('sender_id', 'name avatar role');
      await message.populate('receiver_id', 'name avatar role');

      socketService.emitMessageDeleted(
        message.conversation_id.toString(),
        message
      );

      return res.status(200).json({
        success: true,
        data: message
      });
    }

    if (type === 'me') {
      return res.status(200).json({ 
        success: true,
        message: 'Message deleted for you only'
      });
    }

    res.status(400).json({
      success: false,
      message: 'Invalid delete type'
    });
  } catch (error) {
    console.error('Delete message error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Delete message failed' 
    });
  }
};

/* =======================
   ADD REACTION
======================= */
export const addReaction = async (req: AuthRequest, res: ExpressResponse) => {
  try {
    const { messageId } = req.params;
    const { reaction } = req.body;
    const userId = req.user?._id;

    if (!reaction || !messageId) {
      return res.status(400).json({
        success: false,
        message: 'Reaction and message ID are required'
      });
    }

    if (reaction.length > 10) {
      return res.status(400).json({
        success: false,
        message: 'Invalid emoji'
      });
    }

    const message = await Message.findById(messageId);
    
    if (!message) {
      return res.status(404).json({
        success: false,
        message: 'Message not found'
      });
    }

    // Fix 403: Check participation manually instead of using query
    const conversation = await Conversation.findById(message.conversation_id);

    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: 'Conversation not found'
      });
    }

    const isParticipant = conversation.participant_ids.some(
      (participant: any) => participant.toString() === userId.toString()
    );

    if (!isParticipant) {
      return res.status(403).json({
        success: false,
        message: 'You are not part of this conversation'
      });
    }

    // Toggle Reaction
    const existingReactionIndex = message.reactions.findIndex(
      (r: any) => r.user_id.toString() === userId.toString() && r.emoji === reaction
    );

    if (existingReactionIndex !== -1) {
      message.reactions.splice(existingReactionIndex, 1);
      message.reactions_count = Math.max(0, message.reactions_count - 1);
    } else {
      message.reactions.push({
        user_id: userId,
        emoji: reaction,
        createdAt: new Date()
      });
      message.reactions_count = message.reactions.length;
    }
    
    const updatedMessage = await message.save();
    
    // Populate before emitting
    await updatedMessage.populate('reactions.user_id', 'name avatar');

    // EMIT EVENT
    socketService.emitToRoom(
      `conversation:${message.conversation_id}`,
      existingReactionIndex !== -1 ? 'reaction_removed' : 'reaction_added',
      {
        messageId: message._id,
        conversationId: message.conversation_id,
        userId,
        reaction,
        message: updatedMessage.toObject(), // Send full updated object
        timestamp: new Date()
      }
    );

    res.status(200).json({
      success: true,
      data: {
        message: updatedMessage,
        reaction,
        action: existingReactionIndex !== -1 ? 'removed' : 'added'
      }
    });

  } catch (error) {
    console.error('Error adding reaction:', error);
    res.status(500).json({
      success: false,
      message: 'Error processing reaction'
    });
  }
};

/* =======================
   GET MESSAGE REACTIONS
======================= */
export const getMessageReactions = async (req: AuthRequest, res: ExpressResponse) => {
  try {
    const { messageId } = req.params;
    const userId = req.user?._id;

    const message = await Message.findById(messageId)
      .select('reactions reactions_count')
      .populate('reactions.user_id', 'name avatar');

    if (!message) {
      return res.status(404).json({
        success: false,
        message: 'Message not found'
      });
    }

    const conversation = await Conversation.findOne({
      _id: message.conversation_id,
      participant_ids: userId
    });

    if (!conversation) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const groupedReactions = message.reactions.reduce((acc: any, reaction: any) => {
      if (!acc[reaction.emoji]) {
        acc[reaction.emoji] = {
          emoji: reaction.emoji,
          count: 0,
          users: [],
          isReactedByMe: false
        };
      }
      
      acc[reaction.emoji].count++;
      acc[reaction.emoji].users.push({
        _id: reaction.user_id._id,
        name: reaction.user_id.name,
        avatar: reaction.user_id.avatar
      });
      
      if (reaction.user_id._id.toString() === userId.toString()) {
        acc[reaction.emoji].isReactedByMe = true;
      }
      
      return acc;
    }, {});

    const reactionsList = Object.values(groupedReactions);

    res.status(200).json({
      success: true,
      data: {
        reactions: reactionsList,
        totalCount: message.reactions_count,
        myReactions: message.reactions
          .filter((r: any) => r.user_id._id.toString() === userId.toString())
          .map((r: any) => r.emoji)
      }
    });

  } catch (error) {
    console.error('Error getting reactions:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching reactions'
    });
  }
};

/* =======================
   REMOVE ALL MY REACTIONS
======================= */
export const removeMyReactions = async (req: AuthRequest, res: ExpressResponse) => {
  try {
    const { messageId } = req.params;
    const userId = req.user?._id;

    const message = await Message.findById(messageId);
    
    if (!message) {
      return res.status(404).json({
        success: false,
        message: 'Message not found'
      });
    }

    const reactionsToRemove = message.reactions.filter(
      (r: any) => r.user_id.toString() === userId.toString()
    );

    if (reactionsToRemove.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No reactions to remove'
      });
    }

    message.reactions = message.reactions.filter(
      (r: any) => r.user_id.toString() !== userId.toString()
    );
    message.reactions_count = message.reactions.length;
    
    const updatedMessage = await message.save();

    reactionsToRemove.forEach((reaction: any) => {
      socketService.emitToRoom(
        `conversation:${message.conversation_id}`,
        'reaction_removed',
        {
          messageId: message._id,
          userId,
          reaction: reaction.emoji,
          conversationId: message.conversation_id,
          reactionsCount: updatedMessage.reactions_count,
          timestamp: new Date()
        }
      );
    });

    res.status(200).json({
      success: true,
      data: {
        message: updatedMessage,
        removedCount: reactionsToRemove.length
      }
    });

  } catch (error) {
    console.error('Error removing reactions:', error);
    res.status(500).json({
      success: false,
      message: 'Error removing reactions'
    });
  }
};