// server.ts
import express, { Request, Response, NextFunction } from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import { connectDB } from './config/db';
import path from 'path';

// Route imports
import authRoutes from './routes/authroutes';
import doctorRoutes from './routes/doctorRoutes';
import specialtyRoutes from './routes/specialtyRoutes';
import patientRoutes from './routes/patientRoutes';
import medicalRecordRoutes from './routes/medicalRecordRoutes';
import ChatBotRoutes from "./routes/aiMedicalRoutes";
import notificationRoutes from './routes/notificationRoutes';
import adminRoutes from './routes/adminRoutes';
import messageRoutes from './routes/messageRoutes';


dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Check required environment variables
const requiredEnvVars = ['JWT_SECRET', 'MONGODB_URI'];
const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);

if (missingEnvVars.length > 0) {
  console.error('❌ Missing required environment variables:', missingEnvVars);
  console.error('Please create a .env file with the required variables');
  process.exit(1);
}

// ✅ Database connection
connectDB()
  .then(() => console.log('✅ MongoDB connected'))
  .catch((err) => {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
  });

// ✅ CORS config
app.use(cors({
  origin: process.env.FRONTEND_URL?.split(',') || ['http://localhost:8080'],
  credentials: true,
}));

// ✅ Middlewares
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ✅ Logging middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
});

// ✅ Routes
app.use('/api/auth', authRoutes);
app.use('/api/doctors', doctorRoutes);
app.use('/api/specialties', specialtyRoutes);
app.use('/api/patient', patientRoutes);
app.use('/api/medical-records', medicalRecordRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/ai-medical', ChatBotRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/messages', messageRoutes);
app.use('/assets', express.static(path.join(__dirname, '..', 'web', 'src', 'assets')));

// ✅ Health check route

app.get('/', (req: Request, res: Response) => {
  res.json({
    success: true,
    message: '🚀 Healthcare API is running...',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

// ✅ 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    message: 'Route not found',
  });
});

// ✅ Global error handler
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  console.error('❌ Global error:', err);

  if (err.type === 'entity.parse.failed') {
    res.status(400).json({
      success: false,
      message: 'Invalid JSON format in request body',
    });
    return;
  }

  res.status(500).json({
    success: false,
    message: err.message || 'Internal server error',
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
