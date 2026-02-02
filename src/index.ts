// src/server.ts
import express, { Request, Response, NextFunction } from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import http from 'http';
import path from 'path';
import fs from 'fs';

// Socket.io for real-time communication
import { Server as SocketIOServer, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';

import { connectDB } from './config/db';
import Message from './models/message';
import Conversation from './models/conversation';
// Routes
import authRoutes from './routes/authroutes';
import doctorRoutes from './routes/doctorRoutes';
import specialtyRoutes from './routes/specialtyRoutes';
import patientRoutes from './routes/patientRoutes';
import medicalRecordRoutes from './routes/medicalRecordRoutes';
import ChatBotRoutes from './routes/aiMedicalRoutes';
import notificationRoutes from './routes/notificationRoutes';
import adminRoutes from './routes/adminRoutes';
import messageRoutes from './routes/messageRoutes';

// Services
import { notificationService } from './utils/notificationService';
import { notificationScheduler } from './utils/notificationScheduler';


dotenv.config();

/* =====================================================
   BASIC SETUP
===================================================== */
const app = express();
const PORT = Number(process.env.PORT) || 3000;
const server = http.createServer(app);

// Initialize Socket.io với cấu hình chi tiết
const io = new SocketIOServer(server, {
  cors: {
    origin: process.env.NODE_ENV === 'development' 
      ? ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:8081'] 
      : (process.env.ALLOWED_ORIGINS?.split(',') || []),
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    credentials: true
  },
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000,
  maxHttpBufferSize: 1e8 // 100MB
});

// Store user-socket mappings
const userSocketMap = new Map<string, string>(); // userId -> socketId
const socketUserMap = new Map<string, string>(); // socketId -> userId

/* =====================================================
   SOCKET.IO AUTHENTICATION MIDDLEWARE
===================================================== */
const socketAuthMiddleware = (socket: Socket, next: (err?: Error) => void) => {
  try {
    const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.replace('Bearer ', '');
    
    console.log('🔐 Socket auth attempt:', {
      hasToken: !!token,
      tokenLength: token?.length,
      tokenPreview: token ? token.substring(0, 50) + '...' : 'none',
      auth: socket.handshake.auth,
      headers: socket.handshake.headers
    });
    
    if (!token) {
      return next(new Error('Authentication error: No token provided'));
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;
    console.log('🔐 Decoded token:', decoded);
        const userId = decoded.userId || decoded.id;
    if (!userId) {
      console.error('❌ No userId or id found in token:', decoded);
      return next(new Error('Authentication error: No user ID in token'));
    }
    
    // Attach user info to socket
    socket.data.userId = userId;
    socket.data.userRole = decoded.role || 'user';
    socket.data.userName = decoded.name || decoded.email || 'User';
    
    console.log(`✅ Socket authenticated: ${socket.data.userName} (${userId})`);
    next();
  } catch (error: any) {
    console.error('❌ Socket authentication error:', {
      message: error.message,
      token: token?.substring(0, 20) + '...'
    });
    next(new Error('Authentication error: Invalid token'));
  }
};

// Debug endpoint for token testing
app.get('/debug/token-test', (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      message: 'No token provided'
    });
  }
  
  const token = authHeader.split(' ')[1];
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!);
    res.status(200).json({
      success: true,
      message: 'Token is valid',
      user: decoded
    });
  } catch (error) {
    res.status(401).json({
      success: false,
      message: 'Invalid token',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});
// Apply authentication middleware
io.use(socketAuthMiddleware);

/* =====================================================
   SOCKET.IO EVENT HANDLERS
===================================================== */
io.on('connection', (socket: Socket) => {
  const userId = socket.data.userId;
  const userName = socket.data.userName;
  const userRole = socket.data.userRole;
  
  console.log(`🟢 User connected: ${userName} (${userId}) [${userRole}] - Socket: ${socket.id}`);

  // Store user-socket mapping
  userSocketMap.set(userId, socket.id);
  socketUserMap.set(socket.id, userId);

  // Join user's personal room
  socket.join(`user:${userId}`);
  
  // Join all conversations that user is part of
  socket.join(`conversations:${userId}`);

  /* =====================================================
     CHAT-RELATED EVENTS
  ===================================================== */
  
  // Send message event
  socket.on('send_message', async (data) => {
    try {
      const {
        conversationId,
        receiverId,
        message,
        messageType = 'text',
        medicalRecordId
      } = data;

      console.log(`📤 Message from ${userId} to ${receiverId}:`, message.substring(0, 50) + '...');

      // Validate required fields
      if (!receiverId || !message) {
        socket.emit('message_error', { error: 'Missing required fields' });
        return;
      }

      // Create or get conversation
      let conversation;
      if (conversationId) {
        conversation = await Conversation.findById(conversationId);
      } else {
        // Find existing conversation or create new one
        conversation = await Conversation.findOne({
          participants: { $all: [userId, receiverId] }
        });

        if (!conversation) {
          conversation = await Conversation.create({
            participants: [userId, receiverId],
            last_message: null,
            last_message_at: new Date()
          });
        }
      }

      if (!conversation) {
        socket.emit('message_error', { error: 'Conversation not found' });
        return;
      }

      // Create message in database
      const newMessage = await Message.create({
        conversation_id: conversation._id,
        sender_id: userId,
        receiver_id: receiverId,
        message,
        message_type: messageType,
        medical_record_id: medicalRecordId || null,
        read: false,
        timestamp: new Date()
      });

      // Populate sender and receiver info
      await newMessage.populate([
        { path: 'sender_id', select: '_id name avatar role' },
        { path: 'receiver_id', select: '_id name avatar role' }
      ]);

      // Update conversation's last message
      conversation.last_message = newMessage._id;
      conversation.last_message_at = new Date();
      await conversation.save();

      // Prepare response data
      const messageData = {
        _id: newMessage._id,
        conversationId: conversation._id,
        sender_id: newMessage.sender_id,
        receiver_id: newMessage.receiver_id,
        message: newMessage.message,
        message_type: newMessage.message_type,
        read: newMessage.read,
        timestamp: newMessage.timestamp,
        medical_record_id: newMessage.medical_record_id
      };

      // Emit to sender (confirmation)
      socket.emit('message_sent', {
        success: true,
        message: messageData
      });

      // Emit to receiver if online
      const receiverSocketId = userSocketMap.get(receiverId);
      if (receiverSocketId) {
        io.to(receiverSocketId).emit('receive_message', {
          conversationId: conversation._id,
          message: messageData,
          senderId: userId,
          senderName: userName
        });
        
        // Also emit to receiver's conversation room
        io.to(`user:${receiverId}`).emit('new_message', messageData);
      }

      // Update conversation list for both users
      const conversationUpdate = {
        _id: conversation._id,
        last_message: messageData,
        last_message_at: newMessage.timestamp,
        unread_count: 0 // Reset for sender, increment for receiver
      };

      // Emit to sender's conversation list
      io.to(`user:${userId}`).emit('conversation_updated', conversationUpdate);
      
      // Emit to receiver's conversation list with unread count
      if (receiverSocketId) {
        io.to(`user:${receiverId}`).emit('conversation_updated', {
          ...conversationUpdate,
          unread_count: 1
        });
      }

      console.log(`✅ Message sent successfully from ${userId} to ${receiverId}`);

    } catch (error: any) {
      console.error('❌ Error sending message:', error);
      socket.emit('message_error', { 
        error: 'Failed to send message',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  });

  // Typing indicator event
  socket.on('typing', (data) => {
    try {
      const { conversationId, receiverId } = data;
      
      if (!conversationId || !receiverId) return;

      const receiverSocketId = userSocketMap.get(receiverId);
      if (receiverSocketId) {
        io.to(receiverSocketId).emit('user_typing', {
          conversationId,
          senderId: userId,
          senderName: userName,
          isTyping: true
        });
      }
    } catch (error) {
      console.error('Error handling typing event:', error);
    }
  });

  // Stop typing event
  socket.on('stop_typing', (data) => {
    try {
      const { conversationId, receiverId } = data;
      
      if (!conversationId || !receiverId) return;

      const receiverSocketId = userSocketMap.get(receiverId);
      if (receiverSocketId) {
        io.to(receiverSocketId).emit('user_typing', {
          conversationId,
          senderId: userId,
          senderName: userName,
          isTyping: false
        });
      }
    } catch (error) {
      console.error('Error handling stop typing event:', error);
    }
  });

  // Mark messages as read event
  socket.on('mark_as_read', async (data) => {
    try {
      const { conversationId } = data;
      
      if (!conversationId) return;

      // Update messages in database
      await Message.updateMany(
        {
          conversation_id: conversationId,
          receiver_id: userId,
          read: false
        },
        { $set: { read: true, read_at: new Date() } }
      );

      // Find conversation participants
      const conversation = await Conversation.findById(conversationId);
      if (!conversation) return;

      // Notify other participant that messages were read
      const otherParticipant = conversation.participant_ids.find(
  (p: any) => p.toString() !== userId.toString()
);
      if (otherParticipant) {
        const otherSocketId = userSocketMap.get(otherParticipant.toString());
        if (otherSocketId) {
          io.to(otherSocketId).emit('messages_read', {
            conversationId,
            readerId: userId,
            readerName: userName
          });
        }
      }

      // Update conversation unread count for current user
      socket.emit('conversation_updated', {
        _id: conversationId,
        unread_count: 0
      });

      console.log(`📖 Messages marked as read by ${userId} in conversation ${conversationId}`);

    } catch (error) {
      console.error('Error marking messages as read:', error);
    }
  });

  // Join conversation room
  socket.on('join_conversation', (conversationId) => {
    socket.join(`conversation:${conversationId}`);
    console.log(`User ${userId} joined conversation ${conversationId}`);
  });

  // Leave conversation room
  socket.on('leave_conversation', (conversationId) => {
    socket.leave(`conversation:${conversationId}`);
    console.log(`User ${userId} left conversation ${conversationId}`);
  });

  // Get online status
  socket.on('get_online_status', (targetUserId) => {
    const isOnline = userSocketMap.has(targetUserId);
    socket.emit('online_status', {
      userId: targetUserId,
      isOnline,
      lastSeen: isOnline ? new Date() : null
    });
  });

  /* =====================================================
     NOTIFICATION EVENTS
  ===================================================== */
  
  socket.on('notification:send', (data) => {
    try {
      const { userId: targetUserId, notification } = data;
      
      if (targetUserId) {
        // Send to specific user
        const targetSocketId = userSocketMap.get(targetUserId);
        if (targetSocketId) {
          io.to(targetSocketId).emit('notification:receive', notification);
        }
      } else {
        // Broadcast to all
        io.emit('notification:receive', notification);
      }
    } catch (error) {
      console.error('Error sending notification:', error);
    }
  });

  /* =====================================================
     DISCONNECTION HANDLER
  ===================================================== */
  
  socket.on('disconnect', (reason) => {
    console.log(`🔴 User disconnected: ${userName} (${userId}) - Reason: ${reason}`);
    
    // Clean up mappings
    userSocketMap.delete(userId);
    socketUserMap.delete(socket.id);
    
    // Broadcast user offline status to relevant users
    // (You might want to implement this based on your requirements)
  });

  // Handle client errors
  socket.on('error', (error) => {
    console.error(`Socket error for user ${userId}:`, error);
  });
});

/* =====================================================
   HELPER FUNCTIONS FOR SOCKET.IO
===================================================== */

// Function to send message via socket (can be used from routes)
export const sendMessageViaSocket = async (data: {
  senderId: string;
  receiverId: string;
  message: string;
  messageType?: string;
  medicalRecordId?: string;
}) => {
  try {
    const receiverSocketId = userSocketMap.get(data.receiverId);
    if (receiverSocketId) {
      io.to(receiverSocketId).emit('receive_message', {
        message: data.message,
        senderId: data.senderId,
        timestamp: new Date()
      });
      return true;
    }
    return false;
  } catch (error) {
    console.error('Error sending message via socket:', error);
    return false;
  }
};

// Function to check if user is online
export const isUserOnline = (userId: string): boolean => {
  return userSocketMap.has(userId);
};

// Function to get user's socket ID
export const getUserSocketId = (userId: string): string | undefined => {
  return userSocketMap.get(userId);
};

// Function to emit to specific user
export const emitToUser = (userId: string, event: string, data: any): boolean => {
  const socketId = userSocketMap.get(userId);
  if (socketId) {
    io.to(socketId).emit(event, data);
    return true;
  }
  return false;
};

/* =====================================================
   ENV VALIDATION
===================================================== */
const requiredEnvVars = ['JWT_SECRET', 'MONGODB_URI'];
const missingEnvVars = requiredEnvVars.filter(v => !process.env[v]);

if (missingEnvVars.length > 0) {
  console.error('Missing environment variables:', missingEnvVars);
  process.exit(1);
}

// Lấy server URL từ env hoặc dùng mặc định
const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';
console.log('Server URL:', SERVER_URL);

/* =====================================================
   MIDDLEWARES
===================================================== */
app.use(cors({
  origin: function (origin, callback) {
    // Cho phép tất cả trong development
    if (process.env.NODE_ENV === 'development') {
      callback(null, true);
      return;
    }
    
    // Production: chỉ cho phép các domain được cấu hình
    const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [];
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With','Cache-Control']
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging
app.use((req: Request, res: Response, next: NextFunction) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
});

const AVATAR_PUBLIC_ROUTE = '/uploads/avatars';
const AVATAR_DIR = path.join(__dirname, '..', 'src', 'uploads', 'avatars');

app.use('/api/chatting/messages', 
  express.static(path.join(__dirname, 'chatting/messages'))); 
  
app.use('/chatting/messages', express.static(path.join(__dirname, 'chatting', 'messages')));
// Đảm bảo thư mục tồn tại
if (!fs.existsSync(AVATAR_DIR)) {
  fs.mkdirSync(AVATAR_DIR, { recursive: true });
  console.log('✅ Created avatar directory:', AVATAR_DIR);
}

// Serve static files với CORS đầy đủ và cache control
app.use(AVATAR_PUBLIC_ROUTE, (req, res, next) => {
  // CORS cho tất cả static files - cho phép tất cả trong dev
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400'); // 24 hours
  
  // Cache control
  if (req.path.match(/\.(jpg|jpeg|png|gif|webp)$/)) {
    res.setHeader('Cache-Control', 'public, max-age=31536000'); // 1 year
    res.setHeader('Expires', new Date(Date.now() + 31536000000).toUTCString());
  }
  
  next();
}, express.static(AVATAR_DIR, {
  setHeaders: (res, filePath) => {
    // Thêm các headers bổ sung nếu cần
    if (process.env.NODE_ENV === 'development') {
      console.log('📁 Serving static file:', filePath);
    }
  }
}));

/* =====================================================
   API ROUTES
===================================================== */
app.use('/api/auth', authRoutes);
app.use('/api/doctors', doctorRoutes);
app.use('/api/specialties', specialtyRoutes);
app.use('/api/patient', patientRoutes);
app.use('/api/medical-records', medicalRecordRoutes);
app.use('/api/ai-medical', ChatBotRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/notifications', notificationRoutes);

/* =====================================================
   HEALTH CHECK ROUTE
===================================================== */
app.get('/', (_req: Request, res: Response) => {
  res.status(200).json({
    message: 'Backend API is running 🚀',
    health: '/health',
    apis: [
      '/api/auth',
      '/api/patient',
      '/api/doctors',
      '/api/admin'
    ],
    socket: {
      status: 'active',
      connectedUsers: userSocketMap.size,
      events: ['send_message', 'typing', 'mark_as_read', 'join_conversation']
    }
  });
});

app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    server: {
      url: SERVER_URL,
      port: PORT,
      environment: process.env.NODE_ENV || 'development',
      socket: {
        connectedUsers: userSocketMap.size,
        uptime: process.uptime()
      }
    },
    network: {
      ip: req.ip,
      hostname: req.hostname,
      protocol: req.protocol,
      method: req.method,
      originalUrl: req.originalUrl
    }
  });
});

/* =====================================================
   GET AVATAR BY FILENAME ROUTE
===================================================== */
app.get('/api/avatar/:filename', (req: Request, res: Response) => {
  try {
    const { filename } = req.params;
        if (!filename || filename.includes('..') || filename.includes('/')) {
      return res.status(400).json({
        success: false,
        message: 'Invalid filename'
      });
    }
    
    const filePath = path.join(AVATAR_DIR, filename);
    
    console.log('🔍 Serving avatar:', {
      requestedFilename: filename,
      filePath: filePath,
      exists: fs.existsSync(filePath),
      serverUrl: SERVER_URL
    });
    
    if (!fs.existsSync(filePath)) {
      const defaultAvatarPath = path.join(__dirname, '..', 'public', 'default-avatar.jpg');
      if (fs.existsSync(defaultAvatarPath)) {
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=3600');
        return res.sendFile(defaultAvatarPath);
      }
      
      return res.status(404).json({
        success: false,
        message: 'Avatar not found',
        serverUrl: SERVER_URL,
        requestedFile: filename
      });
    }
    
    const ext = path.extname(filename).toLowerCase();
    let contentType = 'image/jpeg';
    
    switch (ext) {
      case '.png':
        contentType = 'image/png';
        break;
      case '.gif':
        contentType = 'image/gif';
        break;
      case '.webp':
        contentType = 'image/webp';
        break;
      case '.svg':
        contentType = 'image/svg+xml';
        break;
      default:
        contentType = 'image/jpeg';
    }
    
    // Set headers
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=31536000');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('X-Server-URL', SERVER_URL);
    
    // Send file
    res.sendFile(filePath);
    
  } catch (error: any) {
    console.error('❌ Error serving avatar:', error);
    res.status(500).json({
      success: false,
      message: 'Error serving avatar',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/* =====================================================
   SOCKET.IO STATUS ENDPOINT
===================================================== */
app.get('/api/socket/status', (_req: Request, res: Response) => {
  res.json({
    connectedUsers: userSocketMap.size,
    users: Array.from(userSocketMap.entries()).map(([userId, socketId]) => ({
      userId,
      socketId
    })),
    uptime: process.uptime()
  });
});

/* =====================================================
   SERVER BOOTSTRAP
===================================================== */
const startServer = async () => {
  try {
    console.log('🔧 Starting server with configuration:');
    console.log('   Server URL:', SERVER_URL);
    console.log('   Port:', PORT);
    console.log('   Environment:', process.env.NODE_ENV || 'development');
    console.log('   Avatar Directory:', AVATAR_DIR);
    console.log('   Avatar Public Route:', AVATAR_PUBLIC_ROUTE);
    console.log('   Socket.IO enabled: ✅');
    
    // 1️⃣ Connect DB FIRST
    await connectDB();
    console.log('✅ MongoDB connected');

    // 2️⃣ Initialize services AFTER DB is ready
    await notificationService.initializeTemplates();
    notificationScheduler.initialize();

    // 4️⃣ Start server
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`Server running at:`);
      console.log(`   Local: http://localhost:${PORT}`);
      console.log(`   Socket.IO: ws://localhost:${PORT}`);
      console.log(`   Connected users: ${userSocketMap.size}`);
    });

  } catch (error) {
    console.error('Server startup failed:', error);
    process.exit(1);
  }
};

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('🔻 Shutting down server gracefully...');
  
  // Disconnect all sockets
  io.disconnectSockets();
  
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  console.log('🔻 Received SIGTERM, shutting down...');
  
  // Disconnect all sockets
  io.disconnectSockets();
  
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

startServer();

// Export socket functions for use in other files
export { io, userSocketMap, socketUserMap, emitToUser, isUserOnline };
export default app;