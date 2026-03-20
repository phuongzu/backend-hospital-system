import Notification from '../models/notification';
import NotificationTemplate from '../models/notificationTemplate';
import { emailService } from './emailService';
import User from '../models/user';
import Doctor from '../models/doctor';
import { Types } from 'mongoose';
import NotificationDevice from '../models/notificationDevice';

export interface SendNotificationOptions {
  user_id: string;
  template_key?: string;
  title?: string;
  message?: string;
  type?: string;
  category?: string;
  priority?: string;
  data?: Record<string, any>;
  related_record?: string;
  related_record_type?: string;
  channels?: string[];
  action_url?: string;
  action_label?: string;
  expiry_hours?: number;
  scheduled_time?: Date;
  metadata?: Record<string, any>;
  variables?: Record<string, string>;
}

export interface NotificationResponse {
  id: string;
  title: string;
  message: string;
  type: string;
  category: string;
  delivered: boolean;
  read: boolean;
  created_at: Date;
}

// Populated types dựa theo IDoctor và IUser models
interface PopulatedDoctorUser {
  _id: Types.ObjectId;
  name: string;
  email: string;
}

interface PopulatedSpecialty {
  _id: Types.ObjectId;
  name: string;
}

interface PopulatedDoctor {
  _id: Types.ObjectId;
  user_id: PopulatedDoctorUser;
  specialty_id?: PopulatedSpecialty;
}

class NotificationService {
  async initializeTemplates(): Promise<void> {
    try {
      console.log('Initializing notification templates...');

      const defaultTemplates = [
        {
          template_key: 'appointment_booked',
          title_template: 'Appointment Confirmed',
          message_template: 'Your appointment with {doctor_name} on {appointment_date} at {appointment_time} has been confirmed.',
          description: 'Notification sent when patient successfully books an appointment',
          type: 'appointment',
          category: 'success',
          default_priority: 'medium',
          default_channels: ['in_app', 'email', 'sms'],
          variables: ['doctor_name', 'appointment_date', 'appointment_time'],
          is_active: true
        },
        {
          template_key: 'appointment_reminder',
          title_template: 'Appointment Reminder',
          message_template: 'You have an appointment with {doctor_name} on {appointment_date} at {appointment_time}. Please arrive on time.',
          description: 'Reminder notification sent 1 day before appointment',
          type: 'appointment',
          category: 'info',
          default_priority: 'medium',
          default_channels: ['in_app', 'sms', 'email'],
          variables: ['doctor_name', 'appointment_date', 'appointment_time'],
          is_active: true
        },
        {
          template_key: 'treatment_step_approved',
          title_template: 'Treatment Step Approved',
          message_template: 'Doctor has approved step {step_number}: {step_title} in your treatment plan.',
          description: 'Notification sent when doctor approves a treatment step',
          type: 'treatment',
          category: 'success',
          default_priority: 'medium',
          default_channels: ['in_app', 'email'],
          variables: ['step_number', 'step_title', 'doctor_name'],
          is_active: true
        },
        {
          template_key: 'consultation_completed',
          title_template: 'Consultation Completed',
          message_template: 'Your consultation with {doctor_name} has been completed. Diagnosis: {diagnosis}',
          description: 'Notification sent when medical consultation is completed',
          type: 'consultation',
          category: 'success',
          default_priority: 'high',
          default_channels: ['in_app', 'email'],
          variables: ['doctor_name', 'diagnosis'],
          is_active: true
        },
        {
          template_key: 'new_appointment_request',
          title_template: 'New Appointment Request',
          message_template: 'Patient {patient_name} has booked an appointment on {appointment_date} at {appointment_time}. Reason: {reason}',
          description: 'Notification sent to doctor when new appointment is booked',
          type: 'appointment',
          category: 'info',
          default_priority: 'medium',
          default_channels: ['in_app', 'email'],
          variables: ['patient_name', 'appointment_date', 'appointment_time', 'reason'],
          is_active: true
        },
        {
          template_key: 'emergency_alert',
          title_template: 'EMERGENCY ALERT',
          message_template: '{emergency_message}',
          description: 'Emergency notification',
          type: 'emergency',
          category: 'urgent',
          default_priority: 'urgent',
          default_channels: ['in_app', 'email', 'sms'],
          variables: ['emergency_message'],
          is_active: true
        },
        {
          template_key: 'patient_completed_step_with_message',
          title_template: 'Patient Completed Treatment Step',
          message_template: 'Patient {patient_name} has completed step {step_number}: {step_title} and is waiting for your review.',
          description: 'Notification sent to doctor when patient completes a treatment step',
          type: 'treatment',
          category: 'info',
          default_priority: 'medium',
          default_channels: ['in_app', 'email'],
          variables: ['patient_name', 'step_number', 'step_title'],
          is_active: true
        },
        {
          template_key: 'consultation_completed_by_doctor',
          title_template: 'Consultation Completed',
          message_template: 'Dr. {doctor_name} has completed your consultation. {diagnosis}',
          description: 'Notification sent when doctor completes a consultation',
          type: 'consultation',
          category: 'success',
          default_priority: 'high',
          default_channels: ['in_app', 'email'],
          variables: ['doctor_name', 'diagnosis'],
          is_active: true
        }
      ];

      for (const template of defaultTemplates) {
        await NotificationTemplate.findOneAndUpdate(
          { template_key: template.template_key },
          template,
          { upsert: true, new: true }
        );
      }

      console.log('Notification templates initialized successfully');
    } catch (error) {
      console.error('Error initializing notification templates:', error);
    }
  }

  async registerDevice(
  userId: string,
  device_token: string,
  device_type: string,
  platform?: string,
  browser?: string
): Promise<any> {
  try {
    const device = await NotificationDevice.findOneAndUpdate(
      { device_token },
      {
        user_id: userId,
        device_token,
        device_type,
        platform: platform || 'unknown',
        browser: browser || 'unknown',
        is_active: true,
        updated_at: new Date(),
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    console.log(`Device registered for user ${userId}: ${device_token}`);
    return device;
  } catch (error) {
    console.error('Error registering device:', error);
    throw error;
  }
}

async unregisterDevice(device_token: string): Promise<void> {
  try {
    await NotificationDevice.findOneAndUpdate(
      { device_token },
      { is_active: false, updated_at: new Date() }
    );
    console.log(`Device unregistered: ${device_token}`);
  } catch (error) {
    console.error('Error unregistering device:', error);
    throw error;
  }
}

  async sendNotification(options: SendNotificationOptions): Promise<NotificationResponse> {
    try {
      const {
        user_id,
        template_key,
        title,
        message,
        type = 'system',
        category = 'info',
        priority = 'medium',
        data = {},
        related_record,
        related_record_type,
        channels = ['in_app'],
        action_url,
        action_label,
        expiry_hours,
        scheduled_time,
        metadata = {},
        variables = {}
      } = options;

      console.log(`Sending notification to user: ${user_id}`, { template_key, type, category, channels });

      const user = await User.findById(user_id).select('name email phoneNumber');
      if (!user) {
        throw new Error(`User ${user_id} not found`);
      }

      let finalTitle = title;
      let finalMessage = message;
      let finalType = type;
      let finalCategory = category;
      let finalPriority = priority;
      let finalChannels = channels;

      if (template_key) {
        const template = await NotificationTemplate.findOne({
          template_key,
          is_active: true
        });

        if (template) {
          finalTitle = this.replaceTemplateVariables(template.title_template, variables);
          finalMessage = this.replaceTemplateVariables(template.message_template, variables);
          finalType = template.type;
          finalCategory = template.category;
          finalPriority = template.default_priority;
          finalChannels = template.default_channels;
        }
      }

      if (!finalTitle || !finalMessage) {
        throw new Error('Title and message are required');
      }

      const notification = new Notification({
        user_id,
        title: finalTitle,
        message: finalMessage,
        type: finalType,
        category: finalCategory,
        priority: finalPriority,
        data,
        related_record,
        related_record_type,
        channels: finalChannels,
        action_url,
        action_label,
        metadata: {
          ...metadata,
          user_name: user.name,
          user_email: user.email
        }
      });

      if (expiry_hours) {
        notification.expiry_date = new Date(Date.now() + expiry_hours * 60 * 60 * 1000);
      }

      await notification.save();
      await this.deliverToChannels(notification, user);

      console.log(`Notification sent successfully: ${notification._id}`);

      return {
        id: (notification._id as Types.ObjectId).toString(),
        title: finalTitle,
        message: finalMessage,
        type: finalType,
        category: finalCategory,
        delivered: notification.delivered,
        read: notification.read,
        created_at: notification.created_at
      };
    } catch (error) {
      console.error('Error sending notification:', error);
      throw error;
    }
  }

  private async deliverToChannels(notification: any, user: any): Promise<void> {
    for (const channel of notification.channels) {
      try {
        switch (channel) {
          case 'email':
            if (user.email) {
              await emailService.sendNotificationEmail(
                user.email,
                notification.title,
                notification.message,
                {
                  notification_id: notification._id.toString(),
                  type: notification.type,
                  category: notification.category,
                  user_name: user.name,
                  action_url: notification.action_url
                }
              );
            }
            break;

          case 'sms':
            console.log(`SMS would be sent to ${user.phoneNumber}: ${notification.message}`);
            break;

          case 'in_app':
            break;
        }

        console.log(`Notification delivered via ${channel} to user ${user._id}`);
      } catch (error) {
        console.error(`Error delivering notification via ${channel}:`, error);
      }
    }
  }

  private replaceTemplateVariables(template: string, variables: Record<string, string>): string {
    let result = template;
    for (const [key, value] of Object.entries(variables)) {
      result = result.replace(new RegExp(`{${key}}`, 'g'), value);
    }
    return result;
  }

  async sendAppointmentBookedNotification(
    patientId: string,
    doctorId: string,
    appointmentData: {
      appointment_id: string;
      appointment_date: string;
      time_slot: string;
      reason?: string;
    }
  ): Promise<void> {
    try {
      // Cast kết quả populate sang PopulatedDoctor
      const doctor = await Doctor.findById(doctorId)
        .populate('user_id', 'name email')
        .populate('specialty_id', 'name')
        .lean() as unknown as PopulatedDoctor | null;

      if (!doctor || !doctor.user_id) {
        throw new Error('Doctor not found');
      }

      // ✅ dòng 325 — user_id đã populate, có .name
      await this.sendNotification({
        user_id: patientId,
        template_key: 'appointment_booked',
        variables: {
          doctor_name: doctor.user_id.name,
          appointment_date: appointmentData.appointment_date,
          appointment_time: appointmentData.time_slot
        },
        related_record: appointmentData.appointment_id,
        related_record_type: 'appointment',
        data: {
          appointment: appointmentData,
          doctor: {
            name: doctor.user_id.name,                    // ✅ dòng 334
            specialty: doctor.specialty_id?.name          // ✅ dòng 335
          }
        }
      });

      // Tìm User của doctor để gửi notification
      const doctorUser = await User.findById(doctor.user_id._id).select('name email');
      if (doctorUser) {
        const patient = await User.findById(patientId).select('name');
        await this.sendNotification({
          user_id: (doctorUser._id as Types.ObjectId).toString(), // ✅ dòng 344
          template_key: 'new_appointment_request',
          variables: {
            patient_name: patient?.name || 'Patient',
            appointment_date: appointmentData.appointment_date,
            appointment_time: appointmentData.time_slot,
            reason: appointmentData.reason || 'General consultation'
          },
          related_record: appointmentData.appointment_id,
          related_record_type: 'appointment'
        });
      }

      console.log('Appointment booking notifications sent');
    } catch (error) {
      console.error('Error sending appointment booking notifications:', error);
      throw error;
    }
  }

  async sendTreatmentStepApprovalNotification(
    patientId: string,
    doctorId: string,
    consultationId: string,
    stepData: {
      step_number: number;
      step_title: string;
      doctor_notes?: string;
      is_consultation_completed?: boolean;
    }
  ): Promise<void> {
    try {
      // doctor_id trong MedicalRecord ref tới User, không phải Doctor
      // Tìm Doctor theo user_id rồi populate user_id để lấy name
      const doctor = await Doctor.findOne({ user_id: doctorId })
        .populate('user_id', 'name email')
        .lean() as unknown as PopulatedDoctor | null;

      // ✅ dòng 379
      const doctorName = doctor?.user_id?.name || 'Doctor';

      await this.sendNotification({
        user_id: patientId,
        template_key: 'treatment_step_approved',
        variables: {
          step_number: stepData.step_number.toString(),
          step_title: stepData.step_title,
          doctor_name: doctorName
        },
        type: 'treatment',
        category: 'success',
        priority: 'medium',
        related_record: consultationId,
        related_record_type: 'medical_record',
        data: {
          step: stepData,
          consultation_id: consultationId,
          doctor_notes: stepData.doctor_notes,
          is_consultation_completed: stepData.is_consultation_completed
        },
        action_url: `/consultations/${consultationId}/steps/${stepData.step_number}`,
        action_label: 'View Step Details'
      });

      if (stepData.is_consultation_completed) {
        await this.sendNotification({
          user_id: patientId,
          template_key: 'consultation_completed',
          variables: {
            doctor_name: doctorName
          },
          type: 'consultation',
          category: 'success',
          priority: 'high',
          related_record: consultationId,
          related_record_type: 'medical_record',
          data: {
            consultation_id: consultationId,
            completed_at: new Date().toISOString()
          },
          action_url: `/consultations/${consultationId}/summary`,
          action_label: 'View Summary'
        });
      }

      console.log('Treatment step approval notifications sent');
    } catch (error) {
      console.error('Error sending treatment step approval notifications:', error);
      throw error;
    }
  }

  async sendConsultationCompletionNotification(
    patientId: string,
    doctorId: string,
    consultationId: string,
    consultationData: {
      diagnosis?: string;
      summary?: string;
      follow_up_instructions?: string;
      next_appointment_date?: Date;
    }
  ): Promise<void> {
    try {
      const doctor = await Doctor.findOne({ user_id: doctorId })
        .populate('user_id', 'name email')
        .lean() as unknown as PopulatedDoctor | null;

      // ✅ dòng 447
      const doctorName = doctor?.user_id?.name || 'Doctor';

      await this.sendNotification({
        user_id: patientId,
        template_key: 'consultation_completed',
        variables: {
          doctor_name: doctorName,
          diagnosis: consultationData.diagnosis || 'Completed'
        },
        type: 'consultation',
        category: 'success',
        priority: 'high',
        related_record: consultationId,
        related_record_type: 'medical_record',
        data: consultationData,
        channels: ['in_app', 'email'],
        action_url: `/consultations/${consultationId}/summary`,
        action_label: 'View Summary'
      });

      console.log('Consultation completion notification sent');
    } catch (error) {
      console.error('Error sending consultation completion notification:', error);
      throw error;
    }
  }

  async sendAppointmentReminder(
    patientId: string,
    appointmentData: {
      appointment_id: string;
      doctor_name: string;
      appointment_date: string;
      appointment_time: string;
      location?: string;
    }
  ): Promise<void> {
    try {
      await this.sendNotification({
        user_id: patientId,
        template_key: 'appointment_reminder',
        variables: {
          doctor_name: appointmentData.doctor_name,
          appointment_date: appointmentData.appointment_date,
          appointment_time: appointmentData.appointment_time
        },
        type: 'reminder',
        category: 'info',
        priority: 'medium',
        related_record: appointmentData.appointment_id,
        related_record_type: 'appointment',
        data: appointmentData,
        channels: ['in_app', 'sms', 'email']
      });

      console.log('Appointment reminder sent');
    } catch (error) {
      console.error('Error sending appointment reminder:', error);
      throw error;
    }
  }

  async sendEmergencyAlert(
    userId: string,
    message: string,
    data?: Record<string, any>
  ): Promise<void> {
    try {
      await this.sendNotification({
        user_id: userId,
        template_key: 'emergency_alert',
        variables: {
          emergency_message: message
        },
        type: 'emergency',
        category: 'urgent',
        priority: 'urgent',
        channels: ['in_app', 'email', 'sms'],
        data: data
      });

      console.log('Emergency alert sent');
    } catch (error) {
      console.error('Error sending emergency alert:', error);
      throw error;
    }
  }

  async getUserNotifications(
    user_id: string,
    options: {
      page?: number;
      limit?: number;
      read?: boolean;
      type?: string;
      category?: string;
      priority?: string;
      start_date?: Date;
      end_date?: Date;
    } = {}
  ): Promise<{
    notifications: any[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      pages: number;
      unread_count: number;
    };
  }> {
    const {
      page = 1,
      limit = 20,
      read,
      type,
      category,
      priority,
      start_date,
      end_date
    } = options;

    const skip = (page - 1) * limit;
    const query: any = { user_id };

    if (read !== undefined) query.read = read;
    if (type) query.type = type;
    if (category) query.category = category;
    if (priority) query.priority = priority;

    if (start_date || end_date) {
      query.created_at = {};
      if (start_date) query.created_at.$gte = start_date;
      if (end_date) query.created_at.$lte = end_date;
    }

    const [notifications, total, unreadCount] = await Promise.all([
      Notification.find(query)
        .sort({ created_at: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Notification.countDocuments(query),
      Notification.countDocuments({ user_id, read: false })
    ]);

    return {
      notifications,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
        unread_count: unreadCount
      }
    };
  }

  async getUnreadCount(user_id: string): Promise<number> {
    return Notification.countDocuments({ user_id, read: false });
  }

  async markAsRead(notification_id: string, user_id: string): Promise<any> {
    const notification = await Notification.findOne({
      _id: notification_id,
      user_id
    });

    if (!notification) return null;

    notification.read = true;
    notification.read_at = new Date();
    await notification.save();

    return notification;
  }

  async markAllAsRead(user_id: string): Promise<number> {
    const result = await Notification.updateMany(
      { user_id, read: false },
      { $set: { read: true, read_at: new Date() } }
    );

    return result.modifiedCount || 0;
  }

  async getStatistics(user_id: string, days: number = 30): Promise<any> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const stats = await Notification.aggregate([
      {
        $match: {
          user_id: user_id,
          created_at: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: { type: '$type', read: '$read' },
          count: { $sum: 1 }
        }
      },
      {
        $group: {
          _id: '$_id.type',
          total: { $sum: '$count' },
          read: {
            $sum: { $cond: [{ $eq: ['$_id.read', true] }, '$count', 0] }
          },
          unread: {
            $sum: { $cond: [{ $eq: ['$_id.read', false] }, '$count', 0] }
          }
        }
      }
    ]);

    const dailyStats = await Notification.aggregate([
      {
        $match: {
          user_id: user_id,
          created_at: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$created_at' } },
          count: { $sum: 1 },
          read_count: {
            $sum: { $cond: [{ $eq: ['$read', true] }, 1, 0] }
          }
        }
      },
      { $sort: { '_id': 1 } }
    ]);

    return {
      by_type: stats,
      daily: dailyStats,
      summary: {
        total: stats.reduce((sum, item) => sum + item.total, 0),
        read: stats.reduce((sum, item) => sum + item.read, 0),
        unread: stats.reduce((sum, item) => sum + item.unread, 0)
      }
    };
  }
}

export const notificationService = new NotificationService();