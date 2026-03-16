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

    /* ==========================================
       CHAT EVENTS - NO MESSAGE CREATION HERE!
       Messages are created via REST API only
    ========================================== */

    /**
     * Join a conversation room
     * Client should join conversation room when opening a chat
     */
    socket.on('join_conversation', (conversationId: string) => {
      socket.join(`conversation:${conversationId}`);
      console.log(`💬 User ${userId} joined conversation: ${conversationId}`);
      
      socket.emit('conversation_joined', { 
        conversationId,
        success: true 
      });
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

    socket.on('send_message', (data: any) => {
  this.handleSendMessage(socket, data);
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

  private async handleSendMessage(socket: Socket, data: any): Promise<void> {
  try {
    const userId = socket.data.user._id;
    const { 
      conversationId, 
      receiverId, 
      message, 
      messageType = 'text' 
    } = data;

    // Validate required fields
    if (!conversationId || !receiverId || !message) {
      socket.emit('message_error', {
        error: 'Missing required fields',
        data
      });
      return;
    }

    // Import models (or pass via dependency injection)
    const Message = require('../models/message').default;
    const Conversation = require('../models/conversation').default;

    // Find conversation
    const conversation = await Conversation.findOne({
      _id: conversationId,
      participant_ids: userId
    });

    if (!conversation) {
      socket.emit('message_error', {
        error: 'Conversation not found or access denied',
        conversationId
      });
      return;
    }

    // Create message
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

    // Populate sender info
    await newMessage.populate('sender_id', 'name avatar role');
    await newMessage.populate('receiver_id', 'name avatar role');

    // Emit to conversation participants
    this.emitNewMessage(conversationId, newMessage);

    // Send success back to sender
    socket.emit('message_sent_success', {
      messageId: newMessage._id,
      conversationId,
      timestamp: new Date()
    });

  } catch (error: any) {
    console.error('Error handling send_message:', error);
    socket.emit('message_error', {
      error: 'Failed to send message',
      message: error.message
    });
  }
}


  /* =======================
     MESSAGE EMIT METHODS
     (Called from REST API after DB save)
  ======================= */

  /**
   * Emit new message to conversation participants
   * Called ONLY from messageController after message is saved to DB
   */
  emitNewMessage(conversationId: string, message: any): void {
    if (!this.io) return;

    console.log(`📤 Emitting new_message to conversation:${conversationId}`);
    
    this.io.to(`conversation:${conversationId}`).emit('new_message', {
      ...message,
      conversationId,
    });

    // Clear typing indicators for sender
    const senderId = message.sender_id?._id || message.sender_id;
    if (senderId) {
      this.handleUserStopTyping(conversationId, senderId.toString());
    }
  }

  /**
   * Emit message edited event
   */
  emitMessageEdited(conversationId: string, message: any): void {
    if (!this.io) return;

    this.io.to(`conversation:${conversationId}`).emit('message_edited', {
      messageId: message._id,
      message,
      conversationId,
      timestamp: new Date(),
    });
  }

  /**
   * Emit message deleted event
   */
  emitMessageDeleted(conversationId: string, message: any): void {
    if (!this.io) return;

    this.io.to(`conversation:${conversationId}`).emit('message_deleted', {
      messageId: message._id,
      message,
      conversationId,
      timestamp: new Date(),
    });
  }

  /**
   * Emit conversation updated event
   */
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

  updateAppointmentRealTime(
    appointmentId: string,
    updateData: any
  ): void {
    if (!this.io) return;

    this.io.to(`appointment:${appointmentId}`).emit(
      'appointment:update',
      {
        appointmentId,
        ...updateData,
        timestamp: new Date(),
      }
    );
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

  /**
   * Get IO instance (for advanced usage)
   */
  getIO(): Server | undefined {
    return this.io;
  }
}

export const socketService = new SocketService();
export default socketService;