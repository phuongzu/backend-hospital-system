import cron from 'node-cron';
import Appointment from '../models/appointment';
import { notificationService } from '../utils/notificationService';
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
      .populate('doctor_id', 'name user_id');

      console.log(`📅 Found ${appointments.length} appointments for tomorrow`);

      for (const appointment of appointments) {
        try {
          // Notify patient
          await notificationService.sendNotification({
            user_id: appointment.user_id._id.toString(),
            template_key: 'appointment_reminder',
            variables: {
              doctor_name: appointment.doctor_id.name,
              appointment_time: appointment.time_slot
            },
            related_record: appointment._id.toString(),
            related_record_type: 'appointment'
          });

          // Notify doctor
          const doctorUser = await User.findById(appointment.doctor_id.user_id);
          if (doctorUser) {
            await notificationService.sendNotification({
              user_id: doctorUser._id.toString(),
              title: 'Appointment Reminder',
              message: `You have an appointment with ${appointment.user_id.name} tomorrow at ${appointment.time_slot}.`,
              type: 'appointment',
              category: 'info',
              related_record: appointment._id.toString(),
              related_record_type: 'appointment'
            });
          }
        } catch (error) {
          console.error(`❌ Error sending reminder for appointment ${appointment._id}:`, error);
        }
      }
    } catch (error) {
      console.error('❌ Error in appointment reminders:', error);
    }
  }

  // Send medication reminders (simplified version)
  private async sendMedicationReminders(): Promise<void> {
    try {
      // This would query medication schedules and send reminders
      // Implementation depends on your medication scheduling system
      console.log('💊 Medication reminder check completed');
    } catch (error) {
      console.error('❌ Error in medication reminders:', error);
    }
  }

  // Cleanup expired notifications
  private async cleanupExpiredNotifications(): Promise<void> {
    try {
      const count = await notificationService.cleanupExpired();
      console.log(`🗑️ Cleaned up ${count} expired notifications`);
    } catch (error) {
      console.error('❌ Error cleaning up expired notifications:', error);
    }
  }

  // Send daily digest
  private async sendDailyDigest(): Promise<void> {
    try {
      // Get all users with activity today
      const users = await User.find({
        lastLogin: {
          $gte: new Date(new Date().setHours(0, 0, 0, 0))
        }
      });

      console.log(`📊 Sending daily digest to ${users.length} active users`);

      for (const user of users) {
        try {
          // Get today's notifications summary
          const todayStart = new Date();
          todayStart.setHours(0, 0, 0, 0);
          
          const todayStats = await notificationService.getStatistics(user._id.toString(), 1);
          
          if (todayStats.summary.total > 0) {
            await notificationService.sendNotification({
              user_id: user._id.toString(),
              title: 'Daily Digest',
              message: `You have ${todayStats.summary.total} notifications today (${todayStats.summary.unread} unread).`,
              type: 'system',
              category: 'info',
              data: todayStats
            });
          }
        } catch (error) {
          console.error(`❌ Error sending digest to user ${user._id}:`, error);
        }
      }
    } catch (error) {
      console.error('❌ Error in daily digest:', error);
    }
  }
}

export const notificationScheduler = new NotificationScheduler();
