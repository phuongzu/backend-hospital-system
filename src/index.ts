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

import socketService from './utils/socketService';

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

// Socket service will handle socket mappings internally

/* =====================================================
   SOCKET.IO SETUP
===================================================== */
// Initialize Socket Service with the IO instance
socketService.initialize(server, io);

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
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" }
  })
);
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
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Cache-Control'],
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
      connectedUsers: socketService.getConnectedUserCount(),
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
        connectedUsers: socketService.getConnectedUserCount(),
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
  const { filename } = req.params;
  try {
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
    connectedUsers: socketService.getConnectedUserCount(),
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
    logger.info(' MongoDB connected successfully');

    // 2️⃣ Initialize services AFTER DB is ready
    await notificationService.initializeTemplates();
    logger.info(' Notification templates initialized');

    notificationScheduler.initialize();
    logger.info('   Notification scheduler initialized');

    // 3️⃣ Start server
    server.listen(PORT, '0.0.0.0', () => {
      logger.info(`   Server started successfully!`);
      logger.info(`   Local: http://localhost:${PORT}`);
      logger.info(`   Socket.IO: ws://localhost:${PORT}`);
      logger.info(`   Health Check: http://localhost:${PORT}/health`);
      logger.info(`   Connected users: ${socketService.getConnectedUserCount()}`);
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
export default app;