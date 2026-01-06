// src/server.ts
import express, { Request, Response, NextFunction } from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import http from 'http';
import path from 'path';
import fs from 'fs';

import { connectDB } from './config/db';

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
import socketService from './utils/socketService';

dotenv.config();

/* =====================================================
   BASIC SETUP
===================================================== */
const app = express();
const PORT = Number(process.env.PORT) || 3000;
const server = http.createServer(app);

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
app.use((req: Request, _res: Response, next: NextFunction) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  console.log('Headers:', req.headers);
  next();
});

/* =====================================================
   STATIC FILES (AVATARS) - FIXED FOR MULTI-DEVICE
===================================================== */
const AVATAR_PUBLIC_ROUTE = '/uploads/avatars';
const AVATAR_DIR = path.join(__dirname, '..', 'src', 'uploads', 'avatars');

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
    ]
  });
});

app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    server: {
      url: SERVER_URL,
      port: PORT,
      environment: process.env.NODE_ENV || 'development'
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
    
    // Security check: không cho phép path traversal
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
    res.setHeader('Cache-Control', 'public, max-age=31536000'); // 1 year
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
    
    // 1️⃣ Connect DB FIRST
    await connectDB();
    console.log('✅ MongoDB connected');

    // 2️⃣ Initialize services AFTER DB is ready
    await notificationService.initializeTemplates();
    notificationScheduler.initialize();
    socketService.initialize(server);

    // 4️⃣ Start server
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`Server running at:`);
      console.log(`   Local: http://localhost:${PORT}`);
    });

  } catch (error) {
    console.error('Server startup failed:', error);
    process.exit(1);
  }
};


// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('🔻 Shutting down server gracefully...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  console.log('🔻 Received SIGTERM, shutting down...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

startServer();

export default app;