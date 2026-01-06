import express from 'express';
import {
  getUserNotifications,
  getNotificationById,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  registerDevice,
  unregisterDevice,
  getUserDevices,
  deleteNotification,
  clearAllNotifications,
  getNotificationStats,
  createTestNotification,
  clickNotificationAction
} from '../controllers/notificationController';
import { protect } from '../middlewares/authmiddleware';

const router = express.Router();

// Tất cả routes require authentication
router.use(protect);

// Notification management
router.get('/', getUserNotifications);
router.get('/:notificationId', getNotificationById);
router.get('/stats/unread-count', getUnreadCount);
router.get('/stats/analytics', getNotificationStats);

// Mark notifications
router.put('/:notificationId/read', markAsRead);
router.put('/read-all', markAllAsRead);

// Device management
router.post('/devices/register', registerDevice);
router.post('/devices/unregister', unregisterDevice);
router.get('/devices', getUserDevices);

// Notification actions
router.post('/:notificationId/click', clickNotificationAction);

// Delete notifications
router.delete('/:notificationId', deleteNotification);
router.delete('/', clearAllNotifications);

// Admin only
router.post('/test', protect, createTestNotification);

export default router;
