import mongoose, { Schema, Document } from 'mongoose';

export interface INotificationTemplate extends Document {
  template_key: string;
  title_template: string;
  message_template: string;
  description: string;
  type: string;
  category: string;
  default_priority: string;
  default_channels: string[];
  variables: string[];
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

const notificationTemplateSchema = new Schema<INotificationTemplate>({
  template_key: {
    type: String,
    required: true,
    unique: true,
    index: true,
    trim: true
  },
  title_template: {
    type: String,
    required: true,
    trim: true
  },
  message_template: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    required: true,
    trim: true
  },
  type: {
    type: String,
    required: true,
    enum: ['system', 'appointment', 'treatment', 'medication', 'reminder', 
           'emergency', 'approval', 'message', 'medical_record', 'consultation', 'security'],
    index: true
  },
  category: {
    type: String,
    required: true,
    enum: ['info', 'warning', 'success', 'error', 'urgent'],
    default: 'info'
  },
  default_priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium'
  },
  default_channels: [{
    type: String,
    enum: ['in_app', 'email', 'sms', 'push', 'whatsapp'],
    default: ['in_app']
  }],
  variables: [{
    type: String,
    required: true
  }],
  is_active: {
    type: Boolean,
    default: true,
    index: true
  }
}, {
  timestamps: {
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  }
});

// Predefined templates
notificationTemplateSchema.statics.initializeTemplates = async function() {
  const templates = [
    // Appointment templates
    {
      template_key: 'appointment_booked',
      title_template: 'Appointment Booked',
      message_template: 'Your appointment with {doctor_name} on {appointment_date} at {appointment_time} has been confirmed.',
      description: 'Notification when a patient successfully books an appointment',
      type: 'appointment',
      category: 'success',
      default_priority: 'medium',
      default_channels: ['in_app', 'email'],
      variables: ['doctor_name', 'appointment_date', 'appointment_time'],
      is_active: true
    },
    {
      template_key: 'appointment_reminder',
      title_template: 'Appointment Reminder',
      message_template: 'You have an appointment with {doctor_name} tomorrow at {appointment_time}. Please arrive on time.',
      description: 'Appointment reminder 1 day in advance',
      type: 'appointment',
      category: 'info',
      default_priority: 'medium',
      default_channels: ['in_app', 'sms', 'email'],
      variables: ['doctor_name', 'appointment_time'],
      is_active: true
    },
    {
      template_key: 'appointment_cancelled',
      title_template: 'Appointment Cancelled',
      message_template: 'Your appointment with {doctor_name} on {appointment_date} has been cancelled.',
      description: 'Notification when an appointment is cancelled',
      type: 'appointment',
      category: 'warning',
      default_priority: 'medium',
      default_channels: ['in_app', 'email'],
      variables: ['doctor_name', 'appointment_date'],
      is_active: true
    },

    // Treatment templates
    {
      template_key: 'treatment_step_completed',
      title_template: 'Treatment Step Completed',
      message_template: 'Patient {patient_name} has completed step {step_number}: {step_title}. Please review and approve.',
      description: 'Notification for doctors when a patient completes a treatment step',
      type: 'treatment',
      category: 'info',
      default_priority: 'high',
      default_channels: ['in_app', 'push'],
      variables: ['patient_name', 'step_number', 'step_title'],
      is_active: true
    },
    {
      template_key: 'treatment_step_approved',
      title_template: 'Treatment Step Approved',
      message_template: 'Your doctor has approved step {step_number}: {step_title} in your treatment plan.',
      description: 'Notification for patients when a doctor approves a treatment step',
      type: 'treatment',
      category: 'success',
      default_priority: 'medium',
      default_channels: ['in_app', 'push'],
      variables: ['step_number', 'step_title'],
      is_active: true
    },

    // Medical record templates
    {
      template_key: 'medical_record_updated',
      title_template: 'Medical Record Updated',
      message_template: 'Your medical record has been updated by {doctor_name}.',
      description: 'Notification when a medical record is updated',
      type: 'medical_record',
      category: 'info',
      default_priority: 'medium',
      default_channels: ['in_app'],
      variables: ['doctor_name'],
      is_active: true
    },

    // Message templates
    {
      template_key: 'new_message',
      title_template: 'New Message from {sender_name}',
      message_template: '{message_preview}',
      description: 'Notification when there is a new message',
      type: 'message',
      category: 'info',
      default_priority: 'medium',
      default_channels: ['in_app', 'push'],
      variables: ['sender_name', 'message_preview'],
      is_active: true
    },

    // Emergency templates
    {
      template_key: 'emergency_alert',
      title_template: 'EMERGENCY ALERT',
      message_template: '{emergency_message}',
      description: 'Emergency notification',
      type: 'emergency',
      category: 'urgent',
      default_priority: 'urgent',
      default_channels: ['in_app', 'push', 'sms', 'email'],
      variables: ['emergency_message'],
      is_active: true
    },

    // System templates
    {
      template_key: 'account_locked',
      title_template: 'Account Locked',
      message_template: 'Your account has been locked due to {reason}. Please contact the administrator.',
      description: 'Notification when an account is locked',
      type: 'security',
      category: 'error',
      default_priority: 'high',
      default_channels: ['in_app', 'email'],
      variables: ['reason'],
      is_active: true
    },
    {
      template_key: 'password_changed',
      title_template: 'Password Changed',
      message_template: 'Your account password has been changed successfully.',
      description: 'Notification when a password is changed',
      type: 'security',
      category: 'info',
      default_priority: 'medium',
      default_channels: ['in_app', 'email'],
      variables: [],
      is_active: true
    }
  ];

  for (const template of templates) {
    await this.findOneAndUpdate(
      { template_key: template.template_key },
      template,
      { upsert: true, new: true }
    );
  }
};


const NotificationTemplate = mongoose.model<INotificationTemplate>('NotificationTemplate', notificationTemplateSchema);

export default NotificationTemplate;