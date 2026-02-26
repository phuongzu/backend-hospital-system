import express from 'express';
import { protect } from '../middlewares/authmiddleware';
import { validateRequest } from '../middlewares/validateRequest';
import { SendMessageSchema } from '../validations/schemas';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import {
  getMessagesByRecord,
  sendMessage,
  getConversations,
  getConversationMessages,
  markMessagesAsRead,
  sendMessageWithMedia,
  editMessage,
  deleteMessage,
  addReaction,
  getMessageReactions,
  removeMyReactions
} from '../controllers/messageController';


const router = express.Router();

// ✅ Create upload directory if not exists
const uploadDir = path.join(__dirname, '..', 'chatting', 'messages');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// ✅ Configure multer with proper storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // ✅ Generate unique filename
    const uniqueId = crypto.randomBytes(16).toString('hex');
    const timestamp = Date.now();
    const ext = path.extname(file.originalname);
    const sanitizedName = file.originalname
      .replace(ext, '')
      .replace(/[^a-zA-Z0-9]/g, '-')
      .substring(0, 50);
    
    cb(null, `${timestamp}-${uniqueId}-${sanitizedName}${ext}`);
  }
});

// ✅ File filter for security
const fileFilter = (
  req: Express.Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
) => {
  const allowedMimes = [
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/gif',
    'image/webp',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain'
  ];

  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`File type ${file.mimetype} is not allowed`));
  }
};

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
    files: 1
  },
  fileFilter
});

// ✅ All routes need authentication
router.use(protect);

// Routes with validation
router.get('/record/:recordId', getMessagesByRecord);
router.post('/send', validateRequest(SendMessageSchema, 'body'), sendMessage);
router.get('/conversations', getConversations);
router.get('/conversations/:conversationId/messages', getConversationMessages);
router.patch('/conversations/:conversationId/read', markMessagesAsRead);
router.patch('/:messageId/edit', editMessage);
router.delete('/:messageId', deleteMessage);
// Reaction routes (mounted under /api/messages)
router.post('/:messageId/react', protect, addReaction);
router.get('/:messageId/reactions', protect, getMessageReactions);
router.delete('/:messageId/reactions/me', protect, removeMyReactions);

// ✅ File upload with error handling
router.post(
  '/send-with-media',
  (req, res, next) => {
    upload.single('file')(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({
            success: false,
            message: 'File too large. Maximum size is 10MB'
          });
        }
        return res.status(400).json({
          success: false,
          message: `Upload error: ${err.message}`
        });
      } else if (err) {
        return res.status(400).json({
          success: false,
          message: err.message
        });
      }
      next();
    });
  },
  sendMessageWithMedia
);

export default router;