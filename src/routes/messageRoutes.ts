// routes/messageRoutes.ts
import express from 'express';
import { protect } from '../middlewares/authmiddleware';
import {
  getMessagesByRecord,
  sendMessage,
  getConversations,
  getConversationMessages,
  markMessagesAsRead
} from '../controllers/messageController';

const router = express.Router();

// Tất cả routes đều cần authentication
router.use(protect);

// Lấy tin nhắn theo medical record
router.get('/record/:recordId', getMessagesByRecord);

// Gửi tin nhắn mới
router.post('/send', sendMessage);

// Lấy danh sách conversations
router.get('/conversations', getConversations);

// Lấy tin nhắn trong conversation
router.get('/conversations/:conversationId/messages', getConversationMessages);

// Đánh dấu tin nhắn đã đọc
router.patch('/conversations/:conversationId/read', markMessagesAsRead);

export default router;