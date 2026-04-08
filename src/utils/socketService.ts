import { Server, Socket } from 'socket.io';
import http from 'http';
import jwt from 'jsonwebtoken';
import User from '../models/user';
import Conversation from '../models/conversation';
import Message from '../models/message';
import { Types } from 'mongoose';


/* =======================
   TYPES
======================= */

interface SocketUser {
  _id: string;
  role: string;
}

declare module 'socket.io' {
  interface SocketData {
    user: SocketUser;
  }
}


/* =======================
   SOCKET SERVICE
======================= */

class SocketService {
  private io?: Server;

  // userId -> socketIds[]
  private userSockets: Map<string, string[]> = new Map();

  // Track typing users per conversation
  private typingUsers: Map<string, Set<string>> = new Map();

  /* =======================
     INITIALIZE
  ======================= */
  initialize(server: http.Server, io?: Server): void {
    if (io) {
      this.io = io;
    } else {
      this.io = new Server(server, {
        cors: {
          origin: process.env.FRONTEND_URL || '*',
          methods: ['GET', 'POST'],
          credentials: true,
        },
        transports: ['websocket', 'polling'],
        pingTimeout: 60000,
        pingInterval: 25000,
      });
    }

    this.io.use(this.authenticateSocket.bind(this));
    this.io.on('connection', this.handleConnection.bind(this));

    console.log('✅ Socket.IO initialized');
  }

  /* =======================
     AUTH MIDDLEWARE
  ======================= */
  private async authenticateSocket(
    socket: Socket,
    next: (err?: Error) => void
  ): Promise<void> {
    try {
      const rawToken =
        socket.handshake.auth?.token ||
        socket.handshake.headers?.authorization;

      if (!rawToken) {
        return next(new Error('Authentication error: No token provided'));
      }

      const token = rawToken.replace('Bearer ', '');

      const decoded = jwt.verify(
        token,
        process.env.JWT_SECRET!
      ) as { id: string };

      const user = await User.findById(decoded.id).select(
        '_id role isActive'
      );

      if (!user || !user.isActive) {
        return next(new Error('Authentication error: User not found or inactive'));
      }

      socket.data.user = {
        _id: (user._id as Types.ObjectId).toString(),
        role: user.role,
      };

      next();
    } catch (error) {
      console.error('❌ Socket auth error:', error);
      next(new Error('Authentication error'));
    }
  }

  /* =======================
     CONNECTION HANDLER
  ======================= */
  private handleConnection(socket: Socket): void {
    const userId = socket.data.user._id;
    const role = socket.data.user.role;
    const socketId = socket.id;

    console.log(`🔌 Connected: ${socketId} (user ${userId})`);

    // Save socket mapping
    if (!this.userSockets.has(userId)) {
      this.userSockets.set(userId, []);
    }
    this.userSockets.get(userId)!.push(socketId);

    // Join base rooms
    socket.join(`user:${userId}`);
    socket.join(`role:${role}`);

    // Role-based rooms
    if (role === 'doctor') {
      socket.join(`doctor:${userId}`);
      socket.join(`doctor-dashboard:${userId}`);
    }

    // Emit online status to others
    this.broadcastUserOnlineStatus(userId, true);


    socket.on('join_conversation', (conversationId: string) => {
      socket.join(`conversation:${conversationId}`);
      console.log(`📡 Socket ${socket.id} joined conversation room: conversation:${conversationId}`);

      socket.emit('conversation_joined', {
        conversationId,
        success: true
      });
    });

    socket.on('delete_message', async (data, ack) => {
      try {
        const { messageId, type, conversationId } = data;
        const userId = socket.data.user._id;

        const message = await Message.findById(messageId);

        if (!message) {
          return ack?.({ success: false, error: 'Message not found' });
        }

        if (type === 'everyone') {
          if (message.sender_id.toString() !== userId) {
            return ack?.({ success: false, error: 'Not allowed' });
          }

          message.deleted = true;
          message.message = '';
        } else {
          if (!message.deleted_for) message.deleted_for = [];
          if (!message.deleted_for.includes(userId)) {
            message.deleted_for.push(userId);
          }
        }

        await message.save();

        // 🔥 emit realtime
        this.io?.to(`conversation:${conversationId}`).emit('message_deleted', {
          messageId,
          type,
          userId
        });

        // ✅ QUAN TRỌNG: luôn ack
        ack?.({ success: true });

      } catch (err) {
        console.error(err);
        ack?.({ success: false, error: 'Delete failed' });
      }
    });



    /**
     * Leave a conversation room
     */
    socket.on('leave_conversation', (conversationId: string) => {
      socket.leave(`conversation:${conversationId}`);
      console.log(`💬 User ${userId} left conversation: ${conversationId}`);

      // Stop typing when leaving
      this.handleUserStopTyping(conversationId, userId);
    });

    socket.on('send_message', (data: any, ack?: Function) => {
      this.handleSendMessage(socket, data, ack);
    });

    socket.on('delete_message', (data: any, ack?: Function) => {
      this.handleDeleteMessage(socket, data, ack);
    });


    socket.on('react_to_message', async (data: {
      messageId: string;
      reaction: string;
      conversationId: string;
    }) => {
      try {
        const { messageId, reaction, conversationId } = data;

        // Validate user is in conversation
        const conversation = await Conversation.findOne({
          _id: conversationId,
          participant_ids: userId
        });

        if (!conversation) {
          socket.emit('reaction_error', {
            messageId,
            error: 'Not in conversation'
          });
          return;
        }

        // Check if user already reacted with this emoji
        const message = await Message.findById(messageId);
        if (!message) {
          socket.emit('reaction_error', {
            messageId,
            error: 'Message not found'
          });
          return;
        }

        const existingReactionIndex = message.reactions.findIndex(
          (r: { user_id: Types.ObjectId; emoji: string }) =>
            r.user_id.toString() === userId.toString() && r.emoji === reaction
        );

        if (existingReactionIndex !== -1) {
          // Remove reaction
          message.reactions.splice(existingReactionIndex, 1);
        } else {
          // Add reaction
          message.reactions.push({
            user_id: userId,
            emoji: reaction,
            createdAt: new Date()
          });
        }

        message.reactions_count = message.reactions.length;
        await message.save();

        // Populate reactions with user data
        await message.populate('reactions.user_id', 'name avatar role');

        // Emit to conversation with full message object to prevent duplicates
        this.io?.to(`conversation:${conversationId}`).emit(
          existingReactionIndex !== -1 ? 'reaction_removed' : 'reaction_added',
          {
            messageId,
            conversationId,
            userId,
            reaction,
            message: message.toObject(),
            timestamp: new Date()
          }
        );

      } catch (error) {
        console.error('Error handling reaction:', error);
        socket.emit('reaction_error', {
          error: 'Failed to process reaction'
        });
      }
    });

    /**
     * Typing indicator - user is typing
     */
    socket.on('typing_start', (data: { conversationId: string }) => {
      const { conversationId } = data;

      if (!this.typingUsers.has(conversationId)) {
        this.typingUsers.set(conversationId, new Set());
      }

      this.typingUsers.get(conversationId)!.add(userId);

      // Broadcast to others in conversation (not to sender)
      socket.to(`conversation:${conversationId}`).emit('user_typing', {
        conversationId,
        userId,
        isTyping: true,
        timestamp: new Date(),
      });
    });

    /**
     * Typing indicator - user stopped typing
     */
    socket.on('typing_stop', (data: { conversationId: string }) => {
      const { conversationId } = data;
      this.handleUserStopTyping(conversationId, userId);
    });

    /**
     * Mark messages as read (client-side notification)
     */
    socket.on('messages_read', (data: { conversationId: string }) => {
      const { conversationId } = data;

      // Notify other participants that messages were read
      socket.to(`conversation:${conversationId}`).emit('messages_read_by_user', {
        conversationId,
        userId,
        timestamp: new Date(),
      });
    });

    /* ==========================================
       GENERAL ROOM EVENTS
    ========================================== */

    socket.on('join_room', (room: string) => {
      socket.join(room);
      console.log(`📝 ${userId} joined room ${room}`);
    });

    socket.on('leave_room', (room: string) => {
      socket.leave(room);
      console.log(`📝 ${userId} left room ${room}`);
    });

    /* ==========================================
       NOTIFICATION EVENTS
    ========================================== */

    socket.on('notification_read', (notificationId: string) => {
      this.io?.to(`user:${userId}`).emit('notification_updated', {
        notificationId,
        read: true,
        timestamp: new Date(),
      });
    });

    /* ==========================================
       HEALTH CHECK
    ========================================== */

    socket.on('ping', (callback?: (msg: string) => void) => {
      callback?.('pong');
    });

    /* ==========================================
       DISCONNECT
    ========================================== */

    socket.on('disconnect', () => {
      console.log(`🔌 Disconnected: ${socketId}`);

      const sockets = this.userSockets.get(userId);
      if (!sockets) return;

      const index = sockets.indexOf(socketId);
      if (index !== -1) sockets.splice(index, 1);

      // User fully offline if no more sockets
      if (sockets.length === 0) {
        this.userSockets.delete(userId);
        this.broadcastUserOnlineStatus(userId, false);

        // Clear typing indicators for this user
        this.clearAllTypingForUser(userId);
      }
    });
  }

  /* =======================
     CHAT HELPER METHODS
  ======================= */





  private handleUserStopTyping(conversationId: string, userId: string): void {
    const typingSet = this.typingUsers.get(conversationId);
    if (typingSet) {
      typingSet.delete(userId);

      // Broadcast to conversation
      this.io?.to(`conversation:${conversationId}`).emit('user_typing', {
        conversationId,
        userId,
        isTyping: false,
        timestamp: new Date(),
      });
    }
  }

  private clearAllTypingForUser(userId: string): void {
    this.typingUsers.forEach((users, conversationId) => {
      if (users.has(userId)) {
        users.delete(userId);
        this.io?.to(`conversation:${conversationId}`).emit('user_typing', {
          conversationId,
          userId,
          isTyping: false,
          timestamp: new Date(),
        });
      }
    });
  }

  private broadcastUserOnlineStatus(userId: string, isOnline: boolean): void {
    if (!this.io) return;

    this.io.emit('user_status_changed', {
      userId,
      isOnline,
      timestamp: new Date(),
    });
  }

  /* =======================
     SEND MESSAGE HANDLER
     FIX: removed duplicate ack call, cleaned up flow
  ======================= */
  private async handleSendMessage(socket: Socket, data: any, ack?: Function): Promise<void> {
    try {
      const userId = socket.data.user._id;
      const {
        conversationId,
        receiverId,
        message,
        messageType = 'text',
        clientTempId
      } = data;

      // Validate required fields
      if (!conversationId || !receiverId || !message) {
        const error = 'Missing required fields';
        if (typeof ack === 'function') {
          ack({ success: false, error });
        }
        socket.emit('message_error', { error, clientTempId, data });
        return;
      }

      const Message = require('../models/message').default;
      const Conversation = require('../models/conversation').default;

      // Find conversation and verify access
      const conversation = await Conversation.findOne({
        _id: conversationId,
        participant_ids: userId
      });

      if (!conversation) {
        const error = 'Conversation not found or access denied';
        if (typeof ack === 'function') {
          ack({ success: false, error });
        }
        socket.emit('message_error', { error, clientTempId, conversationId });
        return;
      }

      // Prevent duplicate within 5 seconds (same sender, same content)
      const duplicateCheck = await Message.findOne({
        conversation_id: conversationId,
        sender_id: userId,
        message: message,
        timestamp: { $gte: new Date(Date.now() - 5000) }
      });

      if (duplicateCheck) {
        console.log(`🔄 Duplicate message detected, reusing ${duplicateCheck._id}`);
        // Ack once — inform sender this was a duplicate
        if (typeof ack === 'function') {
          ack({ success: true, messageId: duplicateCheck._id, clientTempId });
        }
        socket.emit('message_sent_success', {
          messageId: duplicateCheck._id,
          clientTempId,
          conversationId,
          timestamp: new Date()
        });
        return;
      }

      // Create and save message
      const newMessage = new Message({
        sender_id: userId,
        receiver_id: receiverId,
        message,
        message_type: messageType,
        conversation_id: conversationId,
        timestamp: new Date(),
        read: false
      });

      await newMessage.save();

      // Update conversation
      conversation.last_message = newMessage._id;
      conversation.last_message_at = new Date();
      if (receiverId !== userId.toString()) {
        conversation.unread_count += 1;
      }
      await conversation.save();

      // Populate sender and receiver
      await newMessage.populate('sender_id', 'name avatar role');
      await newMessage.populate('receiver_id', 'name avatar role');

      const messageObj = newMessage.toObject();

      // ✅ Emit to conversation room (for those actively looking at the chat)
      // AND to participant private rooms (for those on other pages to see sidebar updates)
      this.io?.to(`conversation:${conversationId}`)
        .to(`user:${userId}`)
        .to(`user:${receiverId}`)
        .emit('new_message', {
          ...messageObj,
          conversationId,
          clientTempId,
        });

      // ✅ Send acknowledgement ONCE via ack callback (for web clients using timeout emit)
      if (typeof ack === 'function') {
        ack({ success: true, messageId: newMessage._id, clientTempId });
      }

      // ✅ Send success event for mobile clients that don't use ack pattern
      socket.emit('message_sent_success', {
        messageId: newMessage._id,
        clientTempId,
        conversationId,
        timestamp: new Date()
      });

      // Clear typing indicators
      this.handleUserStopTyping(conversationId, userId);

    } catch (error: any) {
      console.error('Error handling send_message:', error);
      if (typeof ack === 'function') {
        ack({ success: false, error: 'Failed to send message' });
      }
      socket.emit('message_error', {
        error: 'Failed to send message',
        clientTempId: data?.clientTempId,
        message: error.message
      });
    }
  }

  /* =======================
     EMIT NEW MESSAGE (from REST API)
  ======================= */
  emitNewMessage(conversationId: string, message: any, clientTempId?: string): void {
    if (!this.io) return;

    console.log(`📤 Emitting new_message to conversation:${conversationId}`);

    const messageObj = message.toObject ? message.toObject() : message;

    // ✅ Emit to both conversation room and participant user rooms
    const senderId = (message.sender_id?._id || message.sender_id).toString();
    const receiverId = (message.receiver_id?._id || message.receiver_id).toString();

    this.io.to(`conversation:${conversationId}`)
      .to(`user:${senderId}`)
      .to(`user:${receiverId}`)
      .emit('new_message', {
        ...messageObj,
        conversationId,
        clientTempId: clientTempId || message.clientTempId || messageObj.clientTempId,
      });

    // Clear typing indicators for sender
    if (senderId) {
      this.handleUserStopTyping(conversationId, senderId.toString());
    }
  }

  /* =======================
     DELETE MESSAGE HANDLER
  ======================= */
  private async handleDeleteMessage(socket: Socket, data: any, ack?: Function): Promise<void> {
    try {
      const userId = socket.data.user._id;
      const { messageId, conversationId, type } = data;

      if (!messageId || !conversationId || !type) {
        ack?.({ success: false, error: 'Missing required fields' });
        return;
      }

      // Kiểm tra user có trong conversation không
      const conversation = await Conversation.findOne({
        _id: conversationId,
        participant_ids: userId
      });

      if (!conversation) {
        ack?.({ success: false, error: 'Not in conversation' });
        return;
      }

      const Message = require('../models/message').default;
      const message = await Message.findById(messageId);

      if (!message) {
        ack?.({ success: false, error: 'Message not found' });
        return;
      }

      // ✅ DELETE FOR EVERYONE
      if (type === 'everyone') {
        if (message.sender_id.toString() !== userId) {
          ack?.({ success: false, error: 'Only sender can delete for everyone' });
          return;
        }

        message.deleted = true;
        message.deleted_at = new Date();
        message.deleted_by = userId;
        message.message = 'This message was deleted';
        await message.save();

        await message.populate('sender_id', 'name avatar role');
        await message.populate('receiver_id', 'name avatar role');

        // ✅ Broadcast đến conversation room và cả 2 users
        const messageObj = message.toObject();

        this.io?.to(`conversation:${conversationId}`).emit('message_deleted', {
          messageId: message._id,
          conversationId,
          type: 'everyone',
          userId,
          message: messageObj,
          timestamp: new Date(),
          success: true
        });

        // ✅ Gửi riêng đến từng user để cập nhật sidebar
        const participants = [message.sender_id.toString(), message.receiver_id.toString()];
        participants.forEach(pid => {
          this.io?.to(`user:${pid}`).emit('message_deleted', {
            messageId: message._id,
            conversationId,
            type: 'everyone',
            userId,
            message: messageObj,
            timestamp: new Date(),
            success: true
          });
        });

        ack?.({ success: true, messageId, conversationId, type });
      }
      // ✅ DELETE FOR ME ONLY
      else if (type === 'me') {
        // Thêm user vào deleted_for array
        const alreadyDeleted = message.deleted_for?.some(
          (id: any) => id.toString() === userId
        );

        if (!alreadyDeleted) {
          await Message.findByIdAndUpdate(
            messageId,
            { $addToSet: { deleted_for: userId } },
            { new: true }
          );
        }

        // ✅ Tạo message object đã transform
        const transformedMessage = {
          _id: messageId,
          conversationId,
          deleted_for_me: true,
          message: 'This message was deleted for you',
          message_type: 'text',
          media_url: undefined,
          reactions: [],
          reactions_count: 0
        };

        // ✅ Broadcast đến conversation room để cập nhật UI cho tất cả
        this.io?.to(`conversation:${conversationId}`).emit('message_deleted', {
          messageId,
          conversationId,
          type: 'me',
          userId,
          message: transformedMessage,
          timestamp: new Date(),
          success: true
        });

        // ✅ Gửi riêng đến user bị xóa để cập nhật sidebar
        this.io?.to(`user:${userId}`).emit('message_deleted', {
          messageId,
          conversationId,
          type: 'me',
          userId,
          message: transformedMessage,
          timestamp: new Date(),
          success: true
        });

        ack?.({ success: true, messageId, conversationId, type });
      } else {
        ack?.({ success: false, error: 'Invalid delete type' });
      }

    } catch (error: any) {
      console.error('Error handling delete_message:', error);
      ack?.({ success: false, error: 'Failed to delete message' });
      socket.emit('delete_message_error', {
        error: 'Failed to delete message',
        message: error.message
      });
    }
  }

  /* =======================
     MESSAGE EMIT METHODS
  ======================= */

  emitMessageEdited(conversationId: string, message: any): void {
    if (!this.io) return;
    this.io.to(`conversation:${conversationId}`).emit('message_edited', {
      messageId: message._id,
      message,
      conversationId,
      timestamp: new Date(),
    });
  }

  emitMessageDeleted(conversationId: string, payload: any): void {
    if (!this.io) return;

    const {
      messageId,
      conversationId: convId,
      type,
      userId,
      message,
      timestamp
    } = payload;

    console.log(`🗑️ Emitting message_deleted:`, {
      messageId,
      conversationId: convId,
      type,
      timestamp
    });

    // ✅ BROADCAST TO CONVERSATION ROOM (all active users in chat)
    this.io.to(`conversation:${conversationId}`).emit('message_deleted', {
      messageId,
      conversationId,
      type,
      userId,
      message,
      timestamp,
      success: true
    });

    // ✅ ALSO notify both participants in their private rooms (for sidebar updates)
    if (message?.sender_id?._id) {
      const senderIdStr = message.sender_id._id.toString?.() || message.sender_id._id;
      this.io.to(`user:${senderIdStr}`).emit('message_deleted', {
        messageId,
        conversationId,
        type,
        userId,
        message,
        timestamp,
        success: true
      });
    }

    if (message?.receiver_id?._id) {
      const receiverIdStr = message.receiver_id._id.toString?.() || message.receiver_id._id;
      this.io.to(`user:${receiverIdStr}`).emit('message_deleted', {
        messageId,
        conversationId,
        type,
        userId,
        message,
        timestamp,
        success: true
      });
    }
  }



  emitConversationUpdated(userId: string, conversation: any): void {
    if (!this.io) return;
    this.io.to(`user:${userId}`).emit('conversation_updated', {
      conversation,
      timestamp: new Date(),
    });
  }

  /* =======================
     GENERAL EMIT HELPERS
  ======================= */

  emitToUser(userId: string, event: string, data: any): void {
    if (!this.io) return;
    this.io.to(`user:${userId}`).emit(event, data);
  }

  emitToUsers(userIds: string[], event: string, data: any): void {
    if (!this.io) return;
    userIds.forEach(id => this.emitToUser(id, event, data));
  }

  emitToAll(event: string, data: any): void {
    if (!this.io) return;
    this.io.emit(event, data);
  }

  emitToRole(role: string, event: string, data: any): void {
    if (!this.io) return;
    this.io.to(`role:${role}`).emit(event, data);
  }

  emitToRoom(room: string, event: string, data: any): void {
    if (!this.io) return;
    this.io.to(room).emit(event, data);
  }

  /* =======================
     APPOINTMENT EVENTS
  ======================= */

  notifyNewAppointmentToDoctor(doctorId: string, appointment: any): void {
    if (!this.io) return;

    this.io.to(`doctor:${doctorId}`).emit('appointment:new', {
      type: 'APPOINTMENT_CREATED',
      appointment,
      timestamp: new Date(),
    });

    this.io.to(`doctor-dashboard:${doctorId}`).emit(
      'dashboard:appointment-update',
      {
        type: 'NEW_APPOINTMENT',
        appointment,
        timestamp: new Date(),
      }
    );
  }

  notifyPatientAppointmentStatus(
    patientId: string,
    appointment: any,
    action: 'created' | 'updated' | 'cancelled'
  ): void {
    if (!this.io) return;

    this.io.to(`user:${patientId}`).emit('appointment:status', {
      type: `APPOINTMENT_${action.toUpperCase()}`,
      appointment,
      timestamp: new Date(),
    });
  }

  updateAppointmentRealTime(appointmentId: string, updateData: any): void {
    if (!this.io) return;

    this.io.to(`appointment:${appointmentId}`).emit('appointment:update', {
      appointmentId,
      ...updateData,
      timestamp: new Date(),
    });
  }

  /* =======================
     NOTIFICATION METHODS
  ======================= */

  sendNotification(userId: string, notification: any): void {
    if (!this.io) return;
    this.io.to(`user:${userId}`).emit('notification:new', {
      ...notification,
      timestamp: new Date(),
    });
  }

  /* =======================
     UTILITY METHODS
  ======================= */

  isUserOnline(userId: string): boolean {
    return (
      this.userSockets.has(userId) &&
      this.userSockets.get(userId)!.length > 0
    );
  }

  getOnlineUsersCount(): number {
    return this.userSockets.size;
  }

  async getOnlineDoctors(): Promise<string[]> {
    if (!this.io) return [];
    const sockets = await this.io.in('role:doctor').fetchSockets();
    return [...new Set(sockets.map(s => s.data.user._id))];
  }

  getUserSocketIds(userId: string): string[] {
    return this.userSockets.get(userId) || [];
  }

  getTypingUsers(conversationId: string): string[] {
    const typingSet = this.typingUsers.get(conversationId);
    return typingSet ? Array.from(typingSet) : [];
  }

  getIO(): Server | undefined {
    return this.io;
  }
}

export const socketService = new SocketService();
export default socketService;