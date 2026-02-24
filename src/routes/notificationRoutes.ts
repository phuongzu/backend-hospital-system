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
import { validateRequest } from '../middlewares/validateRequest';
import {
  GetNotificationsSchema,
  DoctorGetAppointmentAlertsSchema,
  DoctorAcknowledgeAlertSchema,
  DoctorGetMessagesSchema,
  DoctorMessageSchema,
  DoctorMarkMessageAsReadSchema,
  DoctorBulkMarkMessagesSchema,
  DoctorNotificationPreferencesSchema,
  DoctorGetUpcomingAppointmentsAlertSchema,
  DoctorDismissAlertSchema
} from '../validations/schemas';

const router = express.Router();

// Tất cả routes require authentication
router.use(protect);

// Notification management
router.get('/', validateRequest(GetNotificationsSchema, 'query'), getUserNotifications);
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

/* =====================================================
   DOCTOR-SPECIFIC ALERTS & MESSAGES ROUTES
===================================================== */

// Doctor Appointment Alerts
router.get('/doctor/appointments/alerts', validateRequest(DoctorGetAppointmentAlertsSchema, 'query'), (req, res) => {
  // TODO: Get appointment alerts for doctor
  res.status(200).json({
    success: true,
    message: 'Doctor appointment alerts endpoint',
    data: []
  });
});

router.get('/doctor/appointments/upcoming', validateRequest(DoctorGetUpcomingAppointmentsAlertSchema, 'query'), (req, res) => {
  // TODO: Get upcoming appointments alerts
  res.status(200).json({
    success: true,
    message: 'Upcoming appointments alerts',
    data: []
  });
});

router.post('/doctor/alerts/:alertId/acknowledge', validateRequest(DoctorAcknowledgeAlertSchema, 'body'), (req, res) => {
  // TODO: Acknowledge appointment alert
  res.status(200).json({
    success: true,
    message: 'Alert acknowledged',
    data: {}
  });
});

router.post('/doctor/alerts/:alertId/dismiss', validateRequest(DoctorDismissAlertSchema, 'body'), (req, res) => {
  // TODO: Dismiss alert with optional snooze
  res.status(200).json({
    success: true,
    message: 'Alert dismissed',
    data: {}
  });
});

// Doctor Messages
router.post('/doctor/messages/send', validateRequest(DoctorMessageSchema, 'body'), (req, res) => {
  // TODO: Send message to patient or staff
  res.status(201).json({
    success: true,
    message: 'Message sent successfully',
    data: {}
  });
});

router.get('/doctor/messages', validateRequest(DoctorGetMessagesSchema, 'query'), (req, res) => {
  // TODO: Get doctor messages with filtering
  res.status(200).json({
    success: true,
    message: 'Doctor messages retrieved',
    data: {
      messages: [],
      pagination: {}
    }
  });
});

router.put('/doctor/messages/:messageId/read', validateRequest(DoctorMarkMessageAsReadSchema, 'body'), (req, res) => {
  // TODO: Mark message as read
  res.status(200).json({
    success: true,
    message: 'Message marked as read',
    data: {}
  });
});

router.post('/doctor/messages/bulk-action', validateRequest(DoctorBulkMarkMessagesSchema, 'body'), (req, res) => {
  // TODO: Bulk action on messages (read, archive, delete)
  res.status(200).json({
    success: true,
    message: 'Bulk action completed',
    data: {}
  });
});

router.delete('/doctor/messages/:messageId', (req, res) => {
  // TODO: Delete message
  res.status(200).json({
    success: true,
    message: 'Message deleted'
  });
});

// Doctor Notification Preferences
router.get('/doctor/preferences', (req, res) => {
  // TODO: Get doctor notification preferences
  res.status(200).json({
    success: true,
    message: 'Doctor preferences retrieved',
    data: {}
  });
});

router.put('/doctor/preferences', validateRequest(DoctorNotificationPreferencesSchema, 'body'), (req, res) => {
  // TODO: Update doctor notification preferences
  res.status(200).json({
    success: true,
    message: 'Preferences updated successfully',
    data: {}
  });
});

// Doctor Quick Actions
router.post('/doctor/quick-message', (req, res) => {
  // TODO: Send quick message to patient
  res.status(201).json({
    success: true,
    message: 'Quick message sent',
    data: {}
  });
});

router.get('/doctor/alerts-summary', (req, res) => {
  // TODO: Get summary of pending alerts
  res.status(200).json({
    success: true,
    message: 'Alerts summary',
    data: {
      pending_alerts: 0,
      urgent_appointments: 0,
      pending_messages: 0,
      unread_messages: 0
    }
  });
});

export default router;
