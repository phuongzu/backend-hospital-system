import express from 'express';
import {
    markNotificationAsRead,
    getUnreadNotificationsCount
} from '../controllers/notificationController';

const router = express.Router();


router.patch('/notifications/:notificationId/mark-as-read', markNotificationAsRead);
router.get('/notifications/unread-count', getUnreadNotificationsCount);

export default router;