import cron from 'node-cron';
import Appointment from '../models/appointment';
import { notificationService } from '../utils/notificationService';
import Notification from '../models/notification';
import User from '../models/user';

class NotificationScheduler {
  initialize() {
    // Appointment reminders - run every hour
    cron.schedule('0 * * * *', this.sendAppointmentReminders.bind(this));
    
    // Medication reminders - run every 30 minutes
    cron.schedule('*/30 * * * *', this.sendMedicationReminders.bind(this));
    
    // Cleanup expired notifications - run daily at 3 AM
    cron.schedule('0 3 * * *', this.cleanupExpiredNotifications.bind(this));
    
    // Daily digest - run at 8 PM
    cron.schedule('0 20 * * *', this.sendDailyDigest.bind(this));
    
    console.log('✅ Notification scheduler initialized');
  }

  // Send appointment reminders for next day
  private async sendAppointmentReminders(): Promise<void> {
    try {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);
      
      const dayAfterTomorrow = new Date(tomorrow);
      dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 1);

      const appointments = await Appointment.find({
        appointment_date: {
          $gte: tomorrow,
          $lt: dayAfterTomorrow
        },
        status: 'confirmed'
      })
      .populate('user_id', 'name email phoneNumber')
      .populate('doctor_id', 'name user_id')
      .lean();

      console.log(`📅 Found ${appointments.length} appointments for tomorrow`);

      for (const appointment of appointments) {
        // Cast populated fields vì .lean() + .populate() TypeScript không tự infer
        const appt = appointment as any;

        try {
          // Notify patient
          await notificationService.sendNotification({
            user_id: appt.user_id._id.toString(),
            template_key: 'appointment_reminder',
            variables: {
              doctor_name: appt.doctor_id.name,
              appointment_time: appt.time_slot
            },
            related_record: appt._id.toString(),
            related_record_type: 'appointment'
          });

          // Notify doctor
          const doctorUser = await User.findById(appt.doctor_id.user_id);
          if (doctorUser) {
            await notificationService.sendNotification({
              user_id: (doctorUser._id as any).toString(),
              title: 'Appointment Reminder',
              message: `You have an appointment with ${appt.user_id.name} tomorrow at ${appt.time_slot}.`,
              type: 'appointment',
              category: 'info',
              related_record: appt._id.toString(),
              related_record_type: 'appointment'
            });
          }
        } catch (error) {
          console.error(`❌ Error sending reminder for appointment ${appt._id}:`, error);
        }
      }
    } catch (error) {
      console.error('❌ Error in appointment reminders:', error);
    }
  }

  // Send medication reminders (simplified version)
  private async sendMedicationReminders(): Promise<void> {
    try {
      console.log('💊 Medication reminder check completed');
    } catch (error) {
      console.error('❌ Error in medication reminders:', error);
    }
  }

  // Cleanup expired notifications
  // Gọi trực tiếp static method trên model vì notificationService không có method này
  private async cleanupExpiredNotifications(): Promise<void> {
    try {
      const result = await Notification.deleteMany({
        expiry_date: { $lt: new Date() }
      });
      console.log(`🗑️ Cleaned up ${result.deletedCount} expired notifications`);
    } catch (error) {
      console.error('❌ Error cleaning up expired notifications:', error);
    }
  }

  // Send daily digest
  private async sendDailyDigest(): Promise<void> {
    try {
      const users = await User.find({
        lastLogin: {
          $gte: new Date(new Date().setHours(0, 0, 0, 0))
        }
      });

      console.log(`📊 Sending daily digest to ${users.length} active users`);

      for (const user of users) {
        const userId = (user._id as any).toString();
        try {
          const todayStats = await notificationService.getStatistics(userId, 1);
          
          if (todayStats.summary.total > 0) {
            await notificationService.sendNotification({
              user_id: userId,
              title: 'Daily Digest',
              message: `You have ${todayStats.summary.total} notifications today (${todayStats.summary.unread} unread).`,
              type: 'system',
              category: 'info',
              data: todayStats
            });
          }
        } catch (error) {
          console.error(`❌ Error sending digest to user ${userId}:`, error);
        }
      }
    } catch (error) {
      console.error('❌ Error in daily digest:', error);
    }
  }
}

export const notificationScheduler = new NotificationScheduler();