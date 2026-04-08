import { Request, Response as ExpressResponse } from 'express';
import Message from '../models/message';
import Conversation from '../models/conversation';
import { AuthRequest } from '../middlewares/authmiddleware';
import { socketService } from '../utils/socketService';
import User from '../models/user';
import mongoose from 'mongoose';
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

    // ✅ Transform messages: handle deleted_for and deleted flags
    const transformedMessages = messages.map(msg => {
      const msgObj = msg.toObject();
      const currentUserIdStr = userId?.toString();

      const isDeletedForMe = msgObj.deleted_for?.some(
        (id: any) => id.toString() === currentUserIdStr
      );

      // Convert deleted_for IDs to strings for frontend consistency
      const deletedForStrings = (msgObj.deleted_for || []).map((id: any) => id.toString());

      // ✅ PRIORITY 1: Handle deleted for EVERYONE case
      if (msgObj.deleted === true) {
        return {
          ...msgObj,
          deleted: true,
          deleted_for_me: true,
          deleted_for: deletedForStrings,
          message: 'This message was deleted',
          message_type: 'text',
          media_url: undefined,
          media_name: undefined,
          reactions: [],
          reactions_count: 0,
        };
      }

      // ✅ PRIORITY 2: Handle deleted for ME ONLY case
      if (isDeletedForMe && !msgObj.deleted) {
        return {
          ...msgObj,
          deleted: false,
          deleted_for_me: true,
          deleted_for: deletedForStrings,
          message: 'This message was deleted for you',
          message_type: 'text',
          media_url: undefined,
          media_name: undefined,
          reactions: [],
          reactions_count: 0,
        };
      }

      // ✅ PRIORITY 3: Message not deleted
      return {
        ...msgObj,
        deleted: false,
        deleted_for_me: false,
        deleted_for: deletedForStrings
      };
    });

    res.status(200).json({
      success: true,
      data: {
        messages: transformedMessages,
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

    const participantIds = [senderId.toString(), receiver_id.toString()]
      .sort()
      .map(id => new mongoose.Types.ObjectId(id));

    // Find or create conversation
    const conversation = await Conversation.findOneAndUpdate(
      {
        'participant_ids.0': participantIds[0],
        'participant_ids.1': participantIds[1],
        medical_record_id: medical_record_id || null
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

    const { clientTempId } = req.body;

    // Emit to Socket.IO
    socketService.emitNewMessage(
      conversation._id.toString(),
      newMessage,
      clientTempId
    );

    res.status(201).json({
      success: true,
      data: {
        message: newMessage,
        conversationId: conversation._id,
        clientTempId: req.body.clientTempId // ✅ Return clientTempId to sync frontend
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
      .populate('participant_ids', 'name avatar role phoneNumber')
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
        // ✅ FIX: Đảm bảo tìm đúng participant
        const otherParticipant = conversation.participant_ids.find(
          (participant: any) => participant._id.toString() !== userId.toString()
        );

        // ✅ FIX: Nếu không tìm thấy participant, bỏ qua conversation này
        if (!otherParticipant) {
          console.warn(`Conversation ${conversation._id} has no valid participant`);
          return null;
        }

        const unreadCount = await Message.countDocuments({
          conversation_id: conversation._id,
          receiver_id: userId,
          read: false
        });

        let lastMessage = conversation.last_message;
        if (lastMessage) {
          const lastMsgObj = lastMessage.toObject ? lastMessage.toObject() : lastMessage;
          const isDeletedForMe = lastMsgObj.deleted_for?.some(
            (id: any) => id.toString() === userId.toString()
          );

          // ✅ PRIORITY 1: Handle deleted for EVERYONE case
          if (lastMsgObj.deleted === true) {
            lastMessage = {
              ...lastMsgObj,
              deleted: true,
              deleted_for_me: true,
              message: 'This message was deleted',
              message_type: 'text',
              media_url: undefined,
              media_name: undefined,
              reactions: [],
            } as any;
          }
          // ✅ PRIORITY 2: Handle deleted for ME ONLY case
          else if (isDeletedForMe && !lastMsgObj.deleted) {
            lastMessage = {
              ...lastMsgObj,
              deleted: false,
              deleted_for_me: true,
              message: 'This message was deleted for you',
              message_type: 'text',
              media_url: undefined,
              media_name: undefined,
              reactions: [],
            } as any;
          }
          // ✅ PRIORITY 3: Not deleted
          else {
            lastMessage = {
              ...lastMsgObj,
              deleted: false,
              deleted_for_me: false,
            } as any;
          }
        }

        return {
          _id: conversation._id,
          participant: otherParticipant, // ✅ Đã đảm bảo có value
          last_message: lastMessage,
          last_message_at: conversation.last_message_at,
          unread_count: unreadCount,
          medical_record_id: conversation.medical_record_id,
          appointment_id: conversation.appointment_id
        };
      })
    );

    // ✅ FIX: Lọc bỏ các conversation null
    const validConversations = formattedConversations.filter(c => c !== null);

    res.status(200).json({
      success: true,
      data: validConversations
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

    // THAY ĐỔI: Lấy cả messages đã bị delete_for, nhưng transform nội dung
    const messages = await Message.find({
      conversation_id: conversationId,
      // BỎ filter deleted_for ở đây
    })
      .populate('sender_id', 'name avatar role')
      .populate('receiver_id', 'name avatar role')
      .sort({ timestamp: 1 });

    // Transform messages: handle deleted_for and deleted flags
    const transformedMessages = messages.map(msg => {
      const msgObj = msg.toObject();
      const currentUserIdStr = userId?.toString();

      const isDeletedForMe = msgObj.deleted_for?.some(
        (id: any) => id.toString() === currentUserIdStr
      );

      // Convert deleted_for IDs to strings for frontend consistency
      const deletedForStrings = (msgObj.deleted_for || []).map((id: any) => id.toString());

      // ✅ PRIORITY 1: Handle deleted for EVERYONE case (takes precedence)
      if (msgObj.deleted === true) {
        // Message deleted for everyone - show deleted message to all users
        return {
          ...msgObj,
          deleted: true,
          deleted_for_me: true, // Current user sees it as deleted too
          deleted_for: deletedForStrings,
          message: 'This message was deleted',
          message_type: 'text',
          media_url: undefined,
          media_name: undefined,
          media_names: undefined,
          media_urls: undefined,
          reactions: [],
          reactions_count: 0,
          edited: false,
        };
      }

      // ✅ PRIORITY 2: Handle deleted for ME ONLY case
      if (isDeletedForMe && !msgObj.deleted) {
        // User deleted this message for themselves only
        return {
          ...msgObj,
          deleted: false, // Not deleted for everyone
          deleted_for_me: true,
          deleted_for: deletedForStrings,
          message: 'This message was deleted for you',
          message_type: 'text',
          media_url: undefined,
          media_name: undefined,
          media_names: undefined,
          media_urls: undefined,
          reactions: [],
          reactions_count: 0,
        };
      }

      // ✅ PRIORITY 3: Message not deleted - return as is with deleted_for info
      return {
        ...msgObj,
        deleted: false,
        deleted_for_me: false,
        deleted_for: deletedForStrings
      };
    });

    // Mark as read (giữ nguyên)
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
      data: transformedMessages
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

    const participantIds = [senderId.toString(), receiver_id.toString()]
      .sort()
      .map(id => new mongoose.Types.ObjectId(id));

    const conversation = await Conversation.findOneAndUpdate(
      {
        'participant_ids.0': participantIds[0],
        'participant_ids.1': participantIds[1],
        medical_record_id: medical_record_id || null
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

    const { clientTempId } = req.body;

    socketService.emitNewMessage(
      conversation._id.toString(),
      newMessage,
      clientTempId
    );

    res.status(201).json({
      success: true,
      data: {
        ...newMessage.toObject(),
        clientTempId: req.body.clientTempId // ✅ Return clientTempId to sync frontend
      }
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

    if (!messageId || !mongoose.Types.ObjectId.isValid(messageId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid message ID'
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
    const type = req.query.type || req.body.type;
    const userId = req.user?._id;

    // ✅ Validate messageId
    if (!messageId || !mongoose.Types.ObjectId.isValid(messageId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid message ID'
      });
    }

    const message = await Message.findById(messageId);

    if (!message) {
      return res.status(404).json({
        success: false,
        message: 'Message not found'
      });
    }

    // ✅ Validate user is in conversation
    const conversation = await Conversation.findById(message.conversation_id);
    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: 'Conversation not found'
      });
    }

    const isParticipant = conversation.participant_ids.some(
      (id: any) => id.toString() === userId.toString()
    );

    if (!isParticipant) {
      return res.status(403).json({
        success: false,
        message: 'You are not part of this conversation'
      });
    }

    // ✅ DELETE FOR ME
    if (type === 'me') {
      const alreadyDeleted = message.deleted_for?.includes(userId);

      if (alreadyDeleted) {
        return res.status(200).json({
          success: true,
          message: 'Already deleted for you',
          data: {
            messageId: message._id,
            deleted_for_me: true,
            message: 'This message was deleted for you'
          }
        });
      }

      message.deleted_for = message.deleted_for || [];
      message.deleted_for.push(userId);
      await message.save();

      // ✅ Transform response cho frontend
      const transformedMessage = {
        _id: message._id,
        conversation_id: message.conversation_id,
        deleted_for_me: true,
        message: 'This message was deleted for you',
        message_type: 'text',
        media_url: undefined,
        reactions: [],
        reactions_count: 0,
        timestamp: message.timestamp
      };

      // ✅ Emit socket event
      socketService.emitMessageDeleted(message.conversation_id.toString(), {
        messageId: message._id.toString(),
        conversationId: message.conversation_id.toString(),
        type: 'me',
        userId: userId.toString(),
        message: transformedMessage,
        timestamp: new Date()
      });

      return res.status(200).json({
        success: true,
        message: 'Message deleted for you',
        data: transformedMessage
      });
    }
    // ✅ DELETE FOR EVERYONE
    else if (type === 'everyone') {
      if (message.sender_id.toString() !== userId.toString()) {
        return res.status(403).json({
          success: false,
          message: 'Only the sender can delete this message for everyone'
        });
      }

      if (message.deleted) {
        return res.status(200).json({
          success: true,
          message: 'Message already deleted',
          data: {
            messageId: message._id,
            deleted: true,
            message: 'This message was deleted'
          }
        });
      }

      message.deleted = true;
      message.deleted_at = new Date();
      message.deleted_by = userId;
      message.message = 'This message was deleted';
      await message.save();

      await message.populate('sender_id', 'name avatar role');
      await message.populate('receiver_id', 'name avatar role');

      const transformedMessage = {
        ...message.toObject(),
        deleted: true,
        deleted_for_me: true,
        message: 'This message was deleted',
        message_type: 'text',
        media_url: undefined,
        reactions: [],
        reactions_count: 0
      };

      // ✅ Emit socket event
      socketService.emitMessageDeleted(message.conversation_id.toString(), {
        messageId: message._id.toString(),
        conversationId: message.conversation_id.toString(),
        type: 'everyone',
        userId: userId.toString(),
        message: transformedMessage,
        timestamp: new Date()
      });

      return res.status(200).json({
        success: true,
        message: 'Message deleted for everyone',
        data: transformedMessage
      });
    } else {
      return res.status(400).json({
        success: false,
        message: 'Invalid delete type. Use "me" or "everyone"'
      });
    }
  } catch (error) {
    console.error('Delete message error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete message'
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

    if (!messageId || !mongoose.Types.ObjectId.isValid(messageId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid message ID'
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
      .select('reactions reactions_count conversation_id')
      .populate('reactions.user_id', 'name avatar');

    if (!message) {
      return res.status(404).json({
        success: false,
        message: 'Message not found'
      });
    }

    // Ensure the requester is a participant in the conversation.
    const conversation = await Conversation.findById(message.conversation_id);

    if (!conversation || !conversation.participant_ids.some((p: any) => p.toString() === userId.toString())) {
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

export const searchUserByPhone = async (req: AuthRequest, res: ExpressResponse) => {
  try {
    const { phone } = req.query;

    if (!phone || typeof phone !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Phone number is required',
      });
    }

    // Normalize input: strip whitespace/dashes/dots, convert +84 → 0
    const normalized = phone
      .trim()
      .replace(/[\s\-\.]/g, '')
      .replace(/^\+84/, '0');

    if (normalized.length < 9) {
      return res.status(400).json({
        success: false,
        message: 'Phone number too short',
      });
    }

    // Accept both stored formats: "0912345678" and "+84912345678"
    const withZero = normalized.startsWith('0')
      ? normalized
      : `0${normalized}`;
    const with84 = normalized.startsWith('0')
      ? `+84${normalized.slice(1)}`
      : `+84${normalized}`;

    // Query directly on the `phoneNumber` field (IUser schema field name)
    const user = await User.findOne({
      phoneNumber: { $in: [withZero, with84] }, // exact match, both variants
      role: 'patient',                          // only patients
      isActive: true,                           // skip deactivated accounts
      _id: { $ne: req.user?._id },              // exclude the caller themselves
    }).select('_id name avatar phoneNumber role');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'No patient found with this phone number',
      });
    }

    return res.status(200).json({
      success: true,
      data: user,
    });
  } catch (error) {
    console.error('Search user by phone error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error searching for user',
    });
  }
};


export const searchDoctorByPhone = async (req: AuthRequest, res: ExpressResponse) => {
  try {
    const { phone } = req.query;

    if (!phone || typeof phone !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Phone number is required',
      });
    }

    const normalized = phone
      .trim()
      .replace(/[\s\-\.]/g, '');

    if (normalized.length < 9) {
      return res.status(400).json({
        success: false,
        message: 'Phone number too short',
      });
    }

    const user = await User.findOne({
      phoneNumber: normalized,
      role: 'doctor',
      isActive: true,
      _id: { $ne: req.user?._id }
    }).select('_id name avatar phoneNumber role');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'No doctor found with this phone number',
      });
    }

    return res.status(200).json({
      success: true,
      data: user,
    });
  } catch (error) {
    console.error('Search doctor by phone error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error searching for doctor',
    });
  }
};

export const findOrCreateConversation = async (req: AuthRequest, res: ExpressResponse) => {
  try {
    const { participantId } = req.body;
    const userId = req.user?._id;

    if (!participantId) {
      return res.status(400).json({
        success: false,
        message: 'participantId is required',
      });
    }

    const participantIds = [userId.toString(), participantId.toString()]
      .sort()
      .map(id => new mongoose.Types.ObjectId(id));

    const conversation = await Conversation.findOneAndUpdate(
      {
        'participant_ids.0': participantIds[0],
        'participant_ids.1': participantIds[1],
        medical_record_id: null
      },
      {
        $setOnInsert: {
          participant_ids: participantIds,
          medical_record_id: null,
          appointment_id: null,
          unread_count: 0,
          last_message_at: new Date(),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    )
      .populate('participant_ids', 'name avatar role phoneNumber')
      .populate({
        path: 'last_message',
        populate: { path: 'sender_id receiver_id', select: 'name avatar role' },
      });

    // ✅ FIX: Tìm participant khác
    const otherParticipant = conversation.participant_ids.find(
      (p: any) => p._id.toString() !== userId.toString()
    );

    // ✅ FIX: Kiểm tra tồn tại
    if (!otherParticipant) {
      return res.status(500).json({
        success: false,
        message: 'Invalid conversation state'
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        _id: conversation._id,
        participant: otherParticipant,
        last_message: conversation.last_message,
        last_message_at: conversation.last_message_at,
        unread_count: 0,
        medical_record_id: conversation.medical_record_id,
        appointment_id: conversation.appointment_id,
      },
    });
  } catch (error) {
    console.error('Find or create conversation error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error creating conversation',
    });
  }
};
