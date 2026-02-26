// src/server.ts
import express, { Request, Response, NextFunction } from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import helmet from 'helmet';
import mongoSanitize from 'express-mongo-sanitize';
import rateLimit from 'express-rate-limit';
import http from 'http';
import path from 'path';
import fs from 'fs';


// Socket.io for real-time communication
import { Server as SocketIOServer, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';

import { connectDB } from './config/db';
import Message from './models/message';
import Conversation from './models/conversation';
import logger from './utils/logger';
import { AppError } from './utils/AppError';

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
    
    logger.debug('🔐 Socket auth attempt:', {
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
    logger.debug('🔐 Decoded token:', decoded);
        const userId = decoded.userId || decoded.id;
    if (!userId) {
      logger.error('❌ No userId or id found in token:', decoded);
      return next(new Error('Authentication error: No user ID in token'));
    }
    
    // Attach user info to socket
    socket.data.userId = userId;
    socket.data.userRole = decoded.role || 'user';
    socket.data.userName = decoded.name || decoded.email || 'User';
    
    logger.info(`✅ Socket authenticated: ${socket.data.userName} (${userId})`);
    next();
  } catch (error: any) {
    logger.error('❌ Socket authentication error:', {
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
  
  logger.info(`🟢 User connected: ${userName} (${userId}) [${userRole}] - Socket: ${socket.id}`);

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
  socket.on('send_message', async (data, callback) => {
    try {
      const {
        conversationId,
        receiverId,
        message,
        messageType = 'text',
        medicalRecordId
      } = data;

      logger.debug(`📤 Message from ${userId} to ${receiverId}:`, message.substring(0, 50) + '...');

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
      callback({
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

      logger.info(`✅ Message sent successfully from ${userId} to ${receiverId}`);

    } catch (error: any) {
    if (callback) {
      callback({
        success: false,
        error: 'Failed to send message'
      });
    }
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
      logger.error('Error handling typing event:', {
        errorMessage: (error as any).message,
        userId,
        stack: (error as any).stack
      });
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
      logger.error('Error handling stop typing event:', {
        errorMessage: (error as any).message,
        userId,
        stack: (error as any).stack
      });
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

      logger.debug(`📖 Messages marked as read by ${userId} in conversation ${conversationId}`);

    } catch (error) {
      logger.error('Error marking messages as read:', {
        conversationId,
        userId,
        errorMessage: (error as any).message
      });
    }
  });

  // Join conversation room
  socket.on('join_conversation', (conversationId) => {
    socket.join(`conversation:${conversationId}`);
    logger.debug(`User ${userId} joined conversation ${conversationId}`);
  });

  // Leave conversation room
  socket.on('leave_conversation', (conversationId) => {
    socket.leave(`conversation:${conversationId}`);
    logger.debug(`User ${userId} left conversation ${conversationId}`);
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
      logger.error('Error sending notification:', {
        errorMessage: (error as any).message,
        stack: (error as any).stack
      });
    }
  });

  /* =====================================================
     DISCONNECTION HANDLER
  ===================================================== */
  
  socket.on('disconnect', (reason) => {
    logger.info(`🔴 User disconnected: ${userName} (${userId}) - Reason: ${reason}`);
    
    // Clean up mappings
    userSocketMap.delete(userId);
    socketUserMap.delete(socket.id);
    
    // Broadcast user offline status to relevant users
    // (You might want to implement this based on your requirements)
  });

  // Handle client errors
  socket.on('error', (error) => {
    logger.error(`Socket error for user ${userId}:`, {
      errorMessage: (error as any).message || error,
      userId,
      socketId: socket.id
    });
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
    logger.error('Error sending message via socket:', {
      senderId: data.senderId,
      receiverId: data.receiverId,
      errorMessage: (error as any).message
    });
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
  logger.error('Missing environment variables:', {
    missingVars: missingEnvVars,
    requiredVars: requiredEnvVars
  });
  process.exit(1);
}

// Lấy server URL từ env hoặc dùng mặc định
const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';
logger.debug('Server configuration:', { SERVER_URL });

/* =====================================================
   MIDDLEWARES
===================================================== */

// ✅ Security middleware - Must come first
logger.info('🔒 Initializing security middleware');
app.use(helmet()); // Set security HTTP headers
app.use(mongoSanitize()); // Sanitize data against NoSQL injection

// ✅ Rate limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // Limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false, // Disable `X-RateLimit-*` headers
  skip: (req) => req.path === '/' // Skip health check
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Stricter limit for auth endpoints
  message: 'Too many login attempts, please try again later.',
  skipSuccessfulRequests: true // Don't count successful requests
});

app.use('/api/', apiLimiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);

// ✅ CORS configuration
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) {
      callback(null, true);
      return;
    }

    // Development: allow all
    if (process.env.NODE_ENV === 'development') {
      callback(null, true);
      return;
    }
    
    // Production: strict CORS policy
    const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000').split(',').map(o => o.trim());
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      logger.warn('CORS request blocked', { origin });
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  optionsSuccessStatus: 200,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With','Cache-Control'],
  maxAge: 600 // Pre-flight response cache time in seconds
}));

// ✅ Body parsing middleware with strict limits
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

// ✅ Request logging middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  logger.debug(`⮕ ${req.method} ${req.originalUrl}`, {
    ip: req.ip,
    userAgent: req.get('user-agent')
  });
  next();
});

const AVATAR_PUBLIC_ROUTE = '/uploads/avatars';
const AVATAR_DIR = path.join(__dirname, '..', 'src', 'uploads', 'avatars');

  
app.use('/api/chatting/messages', (req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  res.header('Cross-Origin-Resource-Policy', 'cross-origin');
  res.header('Cross-Origin-Embedder-Policy', 'credentialless');
  next();
}, express.static(path.join(__dirname, 'chatting/messages')));

app.use('/chatting/messages', (req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Cross-Origin-Resource-Policy', 'cross-origin');
  next();
}, express.static(path.join(__dirname, 'chatting', 'messages')));
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
      logger.debug('📁 Serving static file:', { filePath });
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
   404 NOT FOUND HANDLER
===================================================== */
app.use((req: Request, res: Response) => {
  logger.warn('Route not found', {
    method: req.method,
    url: req.originalUrl,
    ip: req.ip
  });

  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
    statusCode: 404,
    timestamp: new Date().toISOString()
  });
});

/* =====================================================
   GLOBAL ERROR HANDLER (Must be last)
===================================================== */
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  // Default error values
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Internal Server Error';
  let isOperational = err.isOperational !== undefined ? err.isOperational : false;

  // Handle Zod validation errors
  if (err.errors && Array.isArray(err.errors)) {
    statusCode = 400;
    message = 'Validation failed';
    isOperational = true;
  }

  // Handle MongoDB errors
  if (err.name === 'MongoError' || err.code === 11000) {
    statusCode = 409;
    message = 'Duplicate entry';
    isOperational = true;
  }

  if (err.name === 'CastError') {
    statusCode = 400;
    message = 'Invalid database ID format';
    isOperational = true;
  }

  if (err.name === 'ValidationError') {
    statusCode = 400;
    message = Object.values(err.errors).map((e: any) => e.message).join(', ');
    isOperational = true;
  }

  // Log error
  logger.error('Global error handler', {
    statusCode,
    message,
    isOperational,
    path: req.path,
    method: req.method,
    ip: req.ip,
    stack: err.stack,
    body: req.body
  });

  // Development: send full error details
  if (process.env.NODE_ENV === 'development') {
    return res.status(statusCode).json({
      success: false,
      message,
      statusCode,
      error: {
        message: err.message,
        stack: err.stack,
        ...(err.errors && { errors: err.errors })
      },
      timestamp: new Date().toISOString()
    });
  }

  // Production: hide sensitive details
  const response: any = {
    success: false,
    message: isOperational ? message : 'An unexpected error occurred. Please try again later.',
    statusCode,
    timestamp: new Date().toISOString()
  };

  // Include validation errors in production if it's a validation error
  if (statusCode === 400 && err.errors) {
    response.errors = err.errors;
  }

  return res.status(statusCode).json(response);
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
    
    logger.debug('🔍 Serving avatar:', {
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
    logger.error('❌ Error serving avatar:', {
      filename,
      errorMessage: error.message,
      stack: error.stack
    });
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
    logger.info('🔧 Starting server with configuration:', {
      serverUrl: SERVER_URL,
      port: PORT,
      environment: process.env.NODE_ENV || 'development',
      avatarDirectory: AVATAR_DIR,
      socketIOEnabled: true
    });

    // 1️⃣ Connect DB FIRST
    await connectDB();
    logger.info('✅ MongoDB connected successfully');

    // 2️⃣ Initialize services AFTER DB is ready
    await notificationService.initializeTemplates();
    logger.info('✅ Notification templates initialized');

    notificationScheduler.initialize();
    logger.info('✅ Notification scheduler initialized');

    // 3️⃣ Start server
    server.listen(PORT, '0.0.0.0', () => {
      logger.info(`🚀 Server started successfully!`);
      logger.info(`   Local: http://localhost:${PORT}`);
      logger.info(`   Socket.IO: ws://localhost:${PORT}`);
      logger.info(`   Health Check: http://localhost:${PORT}/health`);
      logger.info(`   Connected users: ${userSocketMap.size}`);
    });

  } catch (error: any) {
    logger.error('❌ Server startup failed!', {
      message: error.message,
      stack: error.stack
    });
    process.exit(1);
  }
};

// Handle graceful shutdown
const gracefulShutdown = async (signal: string) => {
  logger.info(`✋ ${signal} received, starting graceful shutdown...`);
  
  // Disconnect all sockets
  io.disconnectSockets(true);
  logger.info('🔌 All socket connections closed');
  
  // Close database connection
  server.close(async () => {
    logger.info('🛑 HTTP server closed');
    process.exit(0);
  });

  // Force shutdown after 10 seconds if not graceful
  setTimeout(() => {
    logger.error('❌ Forced shutdown (timeout exceeded)');
    process.exit(1);
  }, 10000);
};

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Handle uncaught exceptions
process.on('uncaughtException', (error: Error) => {
  logger.error('❌ Uncaught Exception!', {
    message: error.message,
    stack: error.stack
  });
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason: any) => {
  logger.error('❌ Unhandled Rejection!', {
    reason: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined
  });
  process.exit(1);
});

startServer();

// Export socket functions for use in other files
export { io, userSocketMap, socketUserMap, emitToUser, isUserOnline };
export default app;