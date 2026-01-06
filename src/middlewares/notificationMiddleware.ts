import { Request, Response, NextFunction } from 'express';
import { AuthRequest } from './authmiddleware';
import { notificationService } from '../utils/notificationService';
import User from '../models/user';

// Middleware to send notification for common events
export const notificationMiddleware = {
  // Send notification for appointment booking
  sendAppointmentBookedNotification: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const appointment = req.body;
      const userId = req.user?._id;

      if (appointment && userId) {
        await notificationService.sendNotification({
          user_id: userId.toString(),
          template_key: 'appointment_booked',
          variables: {
            doctor_name: appointment.doctor_name,
            appointment_date: appointment.appointment_date,
            appointment_time: appointment.time_slot
          },
          related_record: appointment._id,
          related_record_type: 'appointment'
        });
      }
    } catch (error) {
      console.error('❌ Error in appointment booking notification:', error);
      // Don't block the request if notification fails
    }
    next();
  },

  // Send notification for treatment step completion
  sendTreatmentStepCompletedNotification: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { consultationId, stepNumber } = req.params;
      const userId = req.user?._id;

      // This would be called from treatment controller
      // Implementation depends on your business logic
    } catch (error) {
      console.error('❌ Error in treatment step notification:', error);
    }
    next();
  },

  // Send notification for new message
  sendNewMessageNotification: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { receiver_id, message } = req.body;
      const senderId = req.user?._id;

      if (receiver_id && message && senderId) {
        const sender = await User.findById(senderId).select('name');
        
        await notificationService.sendNotification({
          user_id: receiver_id,
          template_key: 'new_message',
          variables: {
            sender_name: sender?.name || 'User',
            message_preview: message.substring(0, 50) + (message.length > 50 ? '...' : '')
          },
          related_record: req.body.conversation_id,
          related_record_type: 'message'
        });
      }
    } catch (error) {
      console.error('❌ Error in new message notification:', error);
    }
    next();
  },

  // Send emergency notification
  sendEmergencyNotification: async (userId: string, message: string, data?: any) => {
    try {
      await notificationService.sendNotification({
        user_id: userId,
        template_key: 'emergency_alert',
        variables: { emergency_message: message },
        channels: ['in_app', 'push', 'sms', 'email'],
        priority: 'urgent',
        data
      });
    } catch (error) {
      console.error('❌ Error sending emergency notification:', error);
    }
  },

  // Global error notification for admins
  sendErrorNotification: async (error: Error, context: string) => {
    try {
      const admins = await User.find({ role: 'admin' }).select('_id');
      
      for (const admin of admins) {
        await notificationService.sendNotification({
          user_id: admin._id.toString(),
          title: 'System Error',
          message: `Error in ${context}: ${error.message}`,
          type: 'system',
          category: 'error',
          priority: 'high',
          data: {
            error: error.message,
            stack: error.stack,
            context,
            timestamp: new Date().toISOString()
          }
        });
      }
    } catch (notifError) {
      console.error('❌ Error sending error notification:', notifError);
    }
  }
};
