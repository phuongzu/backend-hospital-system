import { Server, Socket } from 'socket.io';
import http from 'http';
import jwt from 'jsonwebtoken';
import User from '../models/user';
import Conversation from '../models/conversation';
import Message from '../models/message';
import { Types } from 'mongoose';

interface SocketUser {
  _id: string;
  role: string;
}

declare module 'socket.io' {
  interface SocketData {
    user: SocketUser;
  }
}

// ✅ Helper: ép toàn bộ ObjectId trong object sang string (đệ quy nông)
function stringifyIds(obj: any): any {
  if (!obj || typeof obj !== 'object') return obj;
  const result = { ...obj };
  for (const key of Object.keys(result)) {
    const val = result[key];
    if (val && typeof val === 'object' && typeof val.toString === 'function' && val._bsontype === 'ObjectId') {
      result[key] = val.toString();
    } else if (val && typeof val === 'object' && !Array.isArray(val)) {
      if (val._id) val._id = val._id?.toString?.() ?? val._id;
    }
  }
  if (result._id) result._id = result._id?.toString?.() ?? result._id;
  if (result.conversation_id) result.conversation_id = result.conversation_id?.toString?.() ?? result.conversation_id;
  if (result.sender_id && typeof result.sender_id === 'object') {
    result.sender_id = { ...result.sender_id, _id: result.sender_id._id?.toString?.() ?? result.sender_id._id };
  }
  if (result.receiver_id && typeof result.receiver_id === 'object') {
    result.receiver_id = { ...result.receiver_id, _id: result.receiver_id._id?.toString?.() ?? result.receiver_id._id };
  }
  return result;
}

class SocketService {
  private io?: Server;
  private userSockets: Map<string, string[]> = new Map();
  private typingUsers: Map<string, Set<string>> = new Map();

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

  getConnectedUserCount(): number {
    return this.userSockets.size;
  }

  getIO(): Server | undefined {
    return this.io;
  }

  private async authenticateSocket(socket: Socket, next: (err?: Error) => void): Promise<void> {
    try {
      const rawToken = socket.handshake.auth?.token || socket.handshake.headers?.authorization;
      if (!rawToken) return next(new Error('Authentication error: No token provided'));

      const token = rawToken.replace('Bearer ', '');
      const decoded = jwt.verify(token, process.env.JWT_SECRET!) as { id: string };
      const user = await User.findById(decoded.id).select('_id role isActive');

      if (!user || !user.isActive) return next(new Error('Authentication error: User not found or inactive'));

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

  private handleConnection(socket: Socket): void {
    const userId = socket.data.user._id;
    const role = socket.data.user.role;
    const socketId = socket.id;

    console.log(`🔌 Connected: ${socketId} (user ${userId})`);

    if (!this.userSockets.has(userId)) this.userSockets.set(userId, []);
    this.userSockets.get(userId)!.push(socketId);

    socket.join(`user:${userId}`);
    socket.join(`role:${role}`);
    if (role === 'doctor') {
      socket.join(`doctor:${userId}`);
      socket.join(`doctor-dashboard:${userId}`);
    }

    this.broadcastUserOnlineStatus(userId, true);

    socket.on('join_conversation', (conversationId: string) => {
      const room = `conversation:${conversationId}`;
      socket.join(room);
      socket.join(conversationId); // Join both for compatibility
      console.log(`📡 [SERVER] ${userId} joined rooms: ${room} and ${conversationId}`);

      // Log room sizes after joining
      const room1 = this.io?.sockets.adapter.rooms.get(room);
      const room2 = this.io?.sockets.adapter.rooms.get(conversationId);
      console.log(`📊 [SERVER] Room sizes after join: ${room} (${room1?.size || 0}), ${conversationId} (${room2?.size || 0})`);

      socket.emit('conversation_joined', { conversationId, success: true });
    });

    socket.on('leave_conversation', (conversationId: string) => {
      socket.leave(`conversation:${conversationId}`);
      this.handleUserStopTyping(conversationId, userId);
    });

    socket.on('send_message', (data: any, ack?: Function) => {
      this.handleSendMessage(socket, data, ack);
    });

    // ✅ CHỈ 1 handler cho delete_message
    socket.on('delete_message', (data: any, ack?: Function) => {
      this.handleDeleteMessage(socket, data, ack);
    });

    // ✅ react_to_message - emit đến cả user: rooms
    socket.on('react_to_message', async (data: {
      messageId: string;
      reaction: string;
      conversationId: string;
    }) => {
      try {
        const { messageId, reaction, conversationId } = data;

        const conversation = await Conversation.findOne({
          _id: conversationId,
          participant_ids: userId
        });
        if (!conversation) {
          socket.emit('reaction_error', { messageId, error: 'Not in conversation' });
          return;
        }

        const message = await Message.findById(messageId);
        if (!message) {
          socket.emit('reaction_error', { messageId, error: 'Message not found' });
          return;
        }

        const existingReactionIndex = message.reactions.findIndex(
          (r: { user_id: Types.ObjectId; emoji: string }) =>
            r.user_id.toString() === userId.toString() && r.emoji === reaction
        );

        if (existingReactionIndex !== -1) {
          message.reactions.splice(existingReactionIndex, 1);
        } else {
          message.reactions.push({ user_id: userId as any, emoji: reaction, createdAt: new Date() });
        }

        message.reactions_count = message.reactions.length;
        await message.save();
        await message.populate('reactions.user_id', 'name avatar role');

        const eventName = existingReactionIndex !== -1 ? 'reaction_removed' : 'reaction_added';
        const convIdStr = conversationId.toString();

        const payload = {
          messageId: messageId.toString(),
          conversationId: convIdStr,
          userId: userId.toString(),
          reaction,
          message: stringifyIds(message.toObject()),
          timestamp: new Date()
        };

        // ✅ Emit đến conversation room VÀ cả hai user rooms
        this.io?.to(`conversation:${convIdStr}`).emit(eventName, payload);
        const participants = conversation.participant_ids.map((id: any) => id.toString());
        participants.forEach((pid: string) => {
          this.io?.to(`user:${pid}`).emit(eventName, payload);
        });

      } catch (error) {
        console.error('Error handling reaction:', error);
        socket.emit('reaction_error', { error: 'Failed to process reaction' });
      }
    });

    socket.on('typing_start', (data: { conversationId: string }) => {
      const { conversationId } = data;
      if (!this.typingUsers.has(conversationId)) this.typingUsers.set(conversationId, new Set());
      this.typingUsers.get(conversationId)!.add(userId);
      socket.to(`conversation:${conversationId}`).emit('user_typing', {
        conversationId, userId, isTyping: true, timestamp: new Date(),
      });
    });

    socket.on('typing_stop', (data: { conversationId: string }) => {
      this.handleUserStopTyping(data.conversationId, userId);
    });

    socket.on('messages_read', (data: { conversationId: string }) => {
      socket.to(`conversation:${data.conversationId}`).emit('messages_read_by_user', {
        conversationId: data.conversationId, userId, timestamp: new Date(),
      });
    });

    socket.on('mark_as_read', (data: { conversationId: string }) => {
      this.handleMarkAsRead(socket, data);
    });

    socket.on('join_room', (room: string) => socket.join(room));
    socket.on('leave_room', (room: string) => socket.leave(room));
    socket.on('notification_read', (notificationId: string) => {
      this.io?.to(`user:${userId}`).emit('notification_updated', { notificationId, read: true, timestamp: new Date() });
    });
    socket.on('ping', (callback?: (msg: string) => void) => callback?.('pong'));

    socket.on('disconnect', () => {
      console.log(`🔌 Disconnected: ${socketId}`);
      const sockets = this.userSockets.get(userId);
      if (!sockets) return;
      const index = sockets.indexOf(socketId);
      if (index !== -1) sockets.splice(index, 1);
      if (sockets.length === 0) {
        this.userSockets.delete(userId);
        this.broadcastUserOnlineStatus(userId, false);
        this.clearAllTypingForUser(userId);
      }
    });
  }

  private handleUserStopTyping(conversationId: string, userId: string): void {
    const typingSet = this.typingUsers.get(conversationId);
    if (typingSet) {
      typingSet.delete(userId);
      this.io?.to(`conversation:${conversationId}`).emit('user_typing', {
        conversationId, userId, isTyping: false, timestamp: new Date(),
      });
    }
  }

  private clearAllTypingForUser(userId: string): void {
    this.typingUsers.forEach((users, conversationId) => {
      if (users.has(userId)) {
        users.delete(userId);
        this.io?.to(`conversation:${conversationId}`).emit('user_typing', {
          conversationId, userId, isTyping: false, timestamp: new Date(),
        });
      }
    });
  }

  private broadcastUserOnlineStatus(userId: string, isOnline: boolean): void {
    if (!this.io) return;
    this.io.emit('user_status_changed', { userId, isOnline, timestamp: new Date() });
  }

  private async handleSendMessage(socket: Socket, data: any, ack?: Function): Promise<void> {
    try {
      const userId = socket.data.user._id;
      const { conversationId, receiverId, message, messageType = 'text', clientTempId } = data;

      if (!conversationId || !receiverId || !message) {
        const error = 'Missing required fields';
        if (typeof ack === 'function') ack({ success: false, error });
        socket.emit('message_error', { error, clientTempId, data });
        return;
      }

      const MessageModel = require('../models/message').default;
      const ConversationModel = require('../models/conversation').default;

      const conversation = await ConversationModel.findOne({
        _id: conversationId,
        participant_ids: userId
      });

      if (!conversation) {
        const error = 'Conversation not found or access denied';
        if (typeof ack === 'function') ack({ success: false, error });
        socket.emit('message_error', { error, clientTempId, conversationId });
        return;
      }

      const duplicateCheck = await MessageModel.findOne({
        conversation_id: conversationId,
        sender_id: userId,
        message: message,
        timestamp: { $gte: new Date(Date.now() - 5000) }
      });

      if (duplicateCheck) {
        console.log(`🔄 Duplicate detected, reusing ${duplicateCheck._id}`);
        if (typeof ack === 'function') ack({ success: true, messageId: duplicateCheck._id.toString(), clientTempId });
        socket.emit('message_sent_success', {
          messageId: duplicateCheck._id.toString(), clientTempId, conversationId, timestamp: new Date()
        });
        return;
      }

      const newMessage = new MessageModel({
        sender_id: userId,
        receiver_id: receiverId,
        message,
        message_type: messageType,
        media_url: data.media_url,
        media_name: data.media_name,
        media_size: data.media_size,
        media_mime: data.media_mime,
        conversation_id: conversationId,
        timestamp: new Date(),
        read: false
      });

      await newMessage.save();

      conversation.last_message = newMessage._id;
      conversation.last_message_at = new Date();
      if (receiverId !== userId.toString()) conversation.unread_count += 1;
      await conversation.save();

      await newMessage.populate('sender_id', 'name avatar role');
      await newMessage.populate('receiver_id', 'name avatar role');

      // ✅ Ép tất cả ObjectId sang string trước khi emit
      const messageObj = stringifyIds(newMessage.toObject());
      const convIdStr = conversationId.toString();

      const payload = {
        ...messageObj,
        conversationId: convIdStr,
        conversation_id: convIdStr,
        clientTempId,
        unread_count: messageObj.unread_count || 1 // Fallback to 1 if not provided
      };

      console.log(`📡 [SERVER] emitNewMessage: Emitting to room conversation:${convIdStr} and user rooms`);

      // Check if rooms have members
      const convRoom = this.io!.sockets.adapter.rooms.get(`conversation:${convIdStr}`);
      const idRoom = this.io!.sockets.adapter.rooms.get(convIdStr);
      console.log(`📊 [SERVER] Room status: conversation:${convIdStr} (${convRoom?.size || 0} sockets), ${convIdStr} (${idRoom?.size || 0} sockets)`);

      // Bắn đến tất cả các kênh có thể
      this.io!.to(`conversation:${convIdStr}`).to(convIdStr).emit('new_message', payload);
      if (userId) this.io!.to(`user:${userId}`).emit('new_message', payload);
      if (receiverId) this.io!.to(`user:${receiverId}`).emit('new_message', payload);

      if (typeof ack === 'function') ack({ success: true, messageId: newMessage._id.toString(), clientTempId });

      socket.emit('message_sent_success', {
        messageId: newMessage._id.toString(), clientTempId, conversationId: convIdStr, timestamp: new Date()
      });

      this.handleUserStopTyping(convIdStr, userId);

    } catch (error: any) {
      console.error('Error handling send_message:', error);
      if (typeof ack === 'function') ack({ success: false, error: 'Failed to send message' });
      socket.emit('message_error', {
        error: 'Failed to send message', clientTempId: data?.clientTempId, message: error.message
      });
    }
  }

  emitNewMessage(conversationId: string, message: any, clientTempId?: string): void {
    if (!this.io) {
      console.log('❌ Cannot emit: Socket.io not initialized');
      return;
    }

    const messageObj = stringifyIds(message.toObject ? message.toObject() : { ...message });
    const convIdStr = conversationId.toString();

    // Đảm bảo trích xuất ID người gửi/nhận chuẩn xác
    const senderId = (messageObj.sender_id?._id || messageObj.sender_id)?.toString();
    const receiverId = (messageObj.receiver_id?._id || messageObj.receiver_id)?.toString();

    const payload = {
      ...messageObj,
      conversationId: convIdStr,
      conversation_id: convIdStr,
      clientTempId: clientTempId || messageObj.clientTempId,
    };

    console.log(`📡 [SERVER] emitNewMessage: Emitting to room conversation:${convIdStr} and user rooms`);

    // Check room status
    const roomWithPrefix = this.io.sockets.adapter.rooms.get(`conversation:${convIdStr}`);
    const roomWithoutPrefix = this.io.sockets.adapter.rooms.get(convIdStr);
    console.log(`📊 [SERVER] Room status: conversation:${convIdStr} (${roomWithPrefix?.size || 0} sockets), ${convIdStr} (${roomWithoutPrefix?.size || 0} sockets)`);

    // Bắn đến tất cả các kênh có thể
    this.io.to(`conversation:${convIdStr}`).to(convIdStr).emit('new_message', payload);
    if (senderId) this.io.to(`user:${senderId}`).emit('new_message', payload);
    if (receiverId) this.io.to(`user:${receiverId}`).emit('new_message', payload);

    // Emit conversation update
    const convUpdate = {
      _id: convIdStr,
      last_message: payload,
      last_message_at: payload.timestamp,
    };
    if (senderId) this.io.to(`user:${senderId}`).emit('conversation_updated', { conversation: convUpdate, timestamp: new Date() });
    if (receiverId) {
      this.io.to(`user:${receiverId}`).emit('conversation_updated', {
        conversation: { ...convUpdate, unread_count: (payload.unread_count || 1) },
        timestamp: new Date()
      });
    }

    if (senderId) this.handleUserStopTyping(convIdStr, senderId);
  }

  private async handleDeleteMessage(socket: Socket, data: any, ack?: Function): Promise<void> {
    try {
      const userId = socket.data.user._id;
      const { messageId, conversationId, type } = data;

      if (!messageId || !conversationId || !type) {
        ack?.({ success: false, error: 'Missing required fields' });
        return;
      }

      const conversation = await Conversation.findOne({ _id: conversationId, participant_ids: userId });
      if (!conversation) {
        ack?.({ success: false, error: 'Not in conversation' });
        return;
      }

      const MessageModel = require('../models/message').default;
      const message = await MessageModel.findById(messageId);
      if (!message) {
        ack?.({ success: false, error: 'Message not found' });
        return;
      }

      const convIdStr = conversationId.toString();

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

        const messageObj = stringifyIds(message.toObject());

        const payload = {
          messageId: message._id.toString(),
          conversationId: convIdStr,
          type: 'everyone',
          userId,
          message: messageObj,
          timestamp: new Date(),
          success: true
        };

        this.io?.to(`conversation:${convIdStr}`).emit('message_deleted', payload);
        const participants = [message.sender_id._id?.toString() || message.sender_id.toString(),
        message.receiver_id._id?.toString() || message.receiver_id.toString()];
        participants.forEach(pid => this.io?.to(`user:${pid}`).emit('message_deleted', payload));

        ack?.({ success: true, messageId: message._id.toString(), conversationId: convIdStr, type });

      } else if (type === 'me') {
        const alreadyDeleted = message.deleted_for?.some((id: any) => id.toString() === userId);
        if (!alreadyDeleted) {
          await MessageModel.findByIdAndUpdate(messageId, { $addToSet: { deleted_for: userId } }, { new: true });
        }

        const payload = {
          messageId: messageId.toString(),
          conversationId: convIdStr,
          type: 'me',
          userId,
          message: {
            _id: messageId.toString(),
            conversationId: convIdStr,
            deleted_for_me: true,
            message: 'This message was deleted for you',
            message_type: 'text',
            reactions: [],
            reactions_count: 0
          },
          timestamp: new Date(),
          success: true
        };

        this.io?.to(`conversation:${convIdStr}`).emit('message_deleted', payload);
        this.io?.to(`user:${userId}`).emit('message_deleted', payload);

        ack?.({ success: true, messageId: messageId.toString(), conversationId: convIdStr, type });
      } else {
        ack?.({ success: false, error: 'Invalid delete type' });
      }

    } catch (error: any) {
      console.error('Error handling delete_message:', error);
      ack?.({ success: false, error: 'Failed to delete message' });
      socket.emit('delete_message_error', { error: 'Failed to delete message', message: error.message });
    }
  }

  emitMessageEdited(conversationId: string, message: any): void {
    if (!this.io) return;
    const convIdStr = conversationId.toString();
    const msgObj = stringifyIds(message.toObject ? message.toObject() : message);
    // ✅ Emit đến conversation room VÀ cả hai user rooms
    this.io.to(`conversation:${convIdStr}`).emit('message_edited', {
      messageId: msgObj._id,
      message: msgObj,
      conversationId: convIdStr,
      timestamp: new Date(),
    });
    const senderId = msgObj.sender_id?._id || msgObj.sender_id;
    const receiverId = msgObj.receiver_id?._id || msgObj.receiver_id;
    if (senderId) this.io.to(`user:${senderId}`).emit('message_edited', {
      messageId: msgObj._id, message: msgObj, conversationId: convIdStr, timestamp: new Date(),
    });
    if (receiverId && receiverId !== senderId) this.io.to(`user:${receiverId}`).emit('message_edited', {
      messageId: msgObj._id, message: msgObj, conversationId: convIdStr, timestamp: new Date(),
    });
  }

  emitMessageDeleted(conversationId: string, payload: any): void {
    if (!this.io) return;
    const convIdStr = conversationId.toString();

    console.log(`🗑️ emitMessageDeleted → conversation:${convIdStr}, type:${payload.type}`);

    this.io.to(`conversation:${convIdStr}`).emit('message_deleted', {
      ...payload, conversationId: convIdStr, success: true
    });

    const msg = payload.message;
    const senderIdStr = msg?.sender_id?._id?.toString?.() || msg?.sender_id?.toString?.();
    const receiverIdStr = msg?.receiver_id?._id?.toString?.() || msg?.receiver_id?.toString?.();

    if (senderIdStr) {
      this.io.to(`user:${senderIdStr}`).emit('message_deleted', {
        ...payload, conversationId: convIdStr, success: true
      });
    }
    if (receiverIdStr && receiverIdStr !== senderIdStr) {
      this.io.to(`user:${receiverIdStr}`).emit('message_deleted', {
        ...payload, conversationId: convIdStr, success: true
      });
    }

    // ✅ Emit đến userId nếu là "delete for me"
    if (payload.type === 'me' && payload.userId) {
      this.io.to(`user:${payload.userId}`).emit('message_deleted', {
        ...payload, conversationId: convIdStr, success: true
      });
    }
  }

  // ✅ emitReaction: emit đến conversation room + cả hai user rooms
  emitReaction(conversationId: string, eventName: 'reaction_added' | 'reaction_removed', payload: any): void {
    if (!this.io) return;
    const convIdStr = conversationId.toString();
    this.io.to(`conversation:${convIdStr}`).emit(eventName, payload);
    const senderId = payload.message?.sender_id?._id?.toString?.() || payload.message?.sender_id?.toString?.();
    const receiverId = payload.message?.receiver_id?._id || payload.message?.receiver_id;
    if (senderId) this.io.to(`user:${senderId}`).emit(eventName, payload);
    if (receiverId && receiverId !== senderId) this.io.to(`user:${receiverId}`).emit(eventName, payload);
  }

  private async handleMarkAsRead(socket: Socket, data: { conversationId: string }): Promise<void> {
    try {
      const { conversationId } = data;
      const userId = socket.data.user._id;
      if (!conversationId) return;

      const convIdStr = conversationId.toString();

      // 1. Cập nhật tin nhắn trong DB: đánh dấu đã đọc cho những tin nhắn mà mình là người nhận
      await Message.updateMany(
        { conversation_id: conversationId, receiver_id: userId, read: false },
        { $set: { read: true, read_at: new Date() } }
      );

      // 2. Cập nhật unread_count của conversation về 0
      // (Lưu ý: Logic này giả định unread_count dành cho người đang xem)
      const conversation = await Conversation.findById(conversationId);
      if (conversation) {
        conversation.unread_count = 0;
        await conversation.save();

        // 3. Thông báo cho người kia biết mình đã đọc
        const otherParticipantId = conversation.participant_ids.find(id => id.toString() !== userId.toString());
        if (otherParticipantId) {
          const otherIdStr = otherParticipantId.toString();

          const readPayload = {
            conversationId: convIdStr,
            readerId: userId,
            timestamp: new Date()
          };

          // Gửi đến room hội thoại
          this.io?.to(`conversation:${convIdStr}`).emit('messages_read', readPayload);
          this.io?.to(`conversation:${convIdStr}`).emit('messages_read_by_user', readPayload);

          // Gửi trực tiếp cho người kia (để cập nhật sidebar)
          this.io?.to(`user:${otherIdStr}`).emit('messages_read', readPayload);
          this.io?.to(`user:${otherIdStr}`).emit('messages_read_by_user', readPayload);

          // Cập nhật sidebar cho cả hai
          this.io?.to(`user:${userId}`).emit('conversation_updated', {
            conversation: { _id: convIdStr, unread_count: 0 },
            timestamp: new Date()
          });
          this.io?.to(`user:${otherIdStr}`).emit('conversation_updated', {
            conversation: { _id: convIdStr, unread_count: 0 },
            timestamp: new Date()
          });
        }
      }

      console.log(`📖 [SERVER] User ${userId} marked conversation ${convIdStr} as read`);

    } catch (error) {
      console.error('❌ Error in handleMarkAsRead:', error);
    }
  }

  emitConversationUpdated(userId: string, conversation: any): void {
    if (!this.io) return;
    this.io.to(`user:${userId}`).emit('conversation_updated', { conversation, timestamp: new Date() });
  }

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

  notifyNewAppointmentToDoctor(doctorId: string, appointment: any): void {
    if (!this.io) return;
    this.io.to(`doctor:${doctorId}`).emit('appointment:new', {
      type: 'APPOINTMENT_CREATED', appointment, timestamp: new Date(),
    });
    this.io.to(`doctor-dashboard:${doctorId}`).emit('dashboard:appointment-update', {
      type: 'NEW_APPOINTMENT', appointment, timestamp: new Date(),
    });
  }

  notifyPatientAppointmentStatus(patientId: string, appointment: any, action: 'created' | 'updated' | 'cancelled'): void {
    if (!this.io) return;
    this.io.to(`user:${patientId}`).emit('appointment:status', {
      type: `APPOINTMENT_${action.toUpperCase()}`, appointment, timestamp: new Date(),
    });
  }

  updateAppointmentRealTime(appointmentId: string, updateData: any): void {
    if (!this.io) return;
    this.io.to(`appointment:${appointmentId}`).emit('appointment:update', {
      appointmentId, ...updateData, timestamp: new Date(),
    });
  }

  sendNotification(userId: string, notification: any): void {
    if (!this.io) return;
    this.io.to(`user:${userId}`).emit('notification:new', { ...notification, timestamp: new Date() });
  }

  isUserOnline(userId: string): boolean {
    return this.userSockets.has(userId) && this.userSockets.get(userId)!.length > 0;
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
}

export const socketService = new SocketService();
export default socketService;