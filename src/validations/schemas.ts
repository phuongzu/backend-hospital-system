import { z } from 'zod';

/**
 * Authentication Schemas
 */
export const RegisterSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(100).trim(),
  email: z.string().email('Invalid email address').toLowerCase(),
  password: z.string()
    .min(6, 'Password must be at least 6 characters')
    .max(128)
    .optional(),
  phoneNumber: z.string().optional(),
  role: z.enum(['patient', 'doctor']).default('patient'),
  doctorProfile: z.object({
    specialty_id: z.string().optional(),
    license_number: z.string().optional(),
    years_of_experience: z.number().optional(),
    consultation_fee: z.number().optional(),
  }).optional()
}).superRefine((data, ctx) => {
  if (data.role !== 'doctor' && !data.password) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Password is required for patient registration',
      path: ['password'],
    });
  }
});

export const LoginSchema = z.object({
  email: z.string().email('Invalid email address').toLowerCase(),
  password: z.string().min(6, 'Password is required')
});

export const ChangePasswordSchema = z.object({
  oldPassword: z.string().min(6, 'Current password is required'),
  newPassword: z.string()
    .min(8, 'New password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain an uppercase letter')
    .regex(/[0-9]/, 'Password must contain a number')
    .regex(/[!@#$%^&*]/, 'Password must contain a special character'),
  confirmPassword: z.string()
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

export const ForgotPasswordSchema = z.object({
  email: z.string().email('Invalid email address').toLowerCase()
});

export const ResetPasswordSchema = z.object({
  email: z.string().email('Invalid email address').toLowerCase(),
  code: z.string().min(4, 'Invalid verification code').max(10),
  newPassword: z.string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain an uppercase letter')
    .regex(/[0-9]/, 'Password must contain a number')
}).refine((data) => true, 'Validation passed');

/**
 * Appointment Schemas
 */
export const CreateAppointmentSchema = z.object({
  doctor_id: z.string().min(1, 'Doctor is required'),
  appointment_date: z.string().refine(
    (date) => new Date(date) > new Date(),
    'Appointment date must be in the future'
  ),
  appointment_time: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, 'Invalid time format (HH:mm)'),
  reason: z.string().min(10, 'Please provide a reason (minimum 10 characters)').max(500, 'Reason must be less than 500 characters'),
  notes: z.string().max(1000, 'Notes must be less than 1000 characters').optional()
});

export const UpdateAppointmentSchema = z.object({
  appointment_date: z.string().optional(),
  appointment_time: z.string().optional(),
  reason: z.string().optional(),
  notes: z.string().optional(),
  status: z.enum(['pending', 'confirmed', 'completed', 'cancelled']).optional()
});

export const CancelAppointmentSchema = z.object({
  reason: z.string().max(500).optional()
});

/**
 * Doctor Schemas
 */
export const DoctorProfileSchema = z.object({
  specialty_id: z.string().min(1, 'Specialty is required'),
  license_number: z.string().min(5, 'License number must be at least 5 characters').max(50),
  years_of_experience: z.number().min(0, 'Years must be 0 or more').max(70, 'Years cannot exceed 70'),
  consultation_fee: z.number().min(0, 'Fee must be 0 or more').max(10000, 'Fee cannot exceed 10000'),
  bio: z.string().max(1000, 'Bio must be less than 1000 characters').optional(),
  education: z.array(z.string()).optional(),
  certifications: z.array(z.string()).optional(),
  availability: z.object({
    monday: z.boolean().optional(),
    tuesday: z.boolean().optional(),
    wednesday: z.boolean().optional(),
    thursday: z.boolean().optional(),
    friday: z.boolean().optional(),
    saturday: z.boolean().optional(),
    sunday: z.boolean().optional(),
  }).optional(),
  consultation_duration: z.number().min(15, 'Duration must be at least 15 minutes').max(180, 'Duration cannot exceed 180 minutes').optional()
});

/**
 * Patient Schemas
 */
export const UpdatePatientInfoSchema = z.object({
  phoneNumber: z.string().optional(),
  dateOfBirth: z.string().optional(),
  gender: z.enum(['male', 'female', 'other', 'prefer_not_to_say']).optional(),
  address: z.string().optional(),
  blood_type: z.string().optional(),
  allergist: z.string().optional(),
  current_medications: z.array(z.object({
    _id: z.string().optional(),
    name: z.string(),
    dosage: z.string().optional(),
    frequency: z.string().optional(),
    start_date: z.string().optional(),
    reason: z.string().optional(),
    prescribed_by: z.string().optional()
  })).optional(),
  height: z.number().optional(),
  weight: z.number().optional(),
  BMI: z.number().optional(),
  chronic_diseases: z.array(z.string()).optional(),
  emergency_contact: z.object({
    name: z.string(),
    relationship: z.string().optional(),
    phone: z.string(),
    email: z.string().optional()
  }).optional()
});

export const EmergencyContactSchema = z.object({
  name: z.string().min(2, 'Name is required').max(100),
  relationship: z.string().min(2, 'Relationship is required').max(50),
  phone: z.string().regex(/^\+?[\d\s-]{10,}$/, 'Invalid phone number'),
  email: z.string().email('Invalid email').optional()
});

/**
 * Medical Record Schemas
 */
export const CreateMedicalRecordSchema = z.object({
  patient_id: z.string().min(1, 'Patient is required'),
  doctor_id: z.string().min(1, 'Doctor is required'),
  diagnosis: z.string().min(5).max(500),
  treatment_plan: z.string().min(5).max(1000),
  medications: z.array(z.object({
    name: z.string(),
    dosage: z.string(),
    frequency: z.string()
  })).optional(),
  notes: z.string().max(1000).optional()
});

/**
 * Message Schemas
 */
export const SendMessageSchema = z.object({
  receiver_id: z.string().min(1, 'Receiver is required'),
  message: z.string().min(1, 'Message cannot be empty').max(2000, 'Message is too long'),
  message_type: z.enum(['text', 'image', 'file']).default('text'),
  medical_record_id: z.string().optional()
});

/**
 * Review Schemas
 */
export const CreateReviewSchema = z.object({
  rating: z.number()
    .min(1, 'Rating must be at least 1')
    .max(5, 'Rating must be at most 5'),
  comment: z.string()
    .max(500, 'Comment cannot exceed 500 characters')
    .optional(),
  appointment_id: z.string()
    .min(1, 'Appointment ID is required')
    .regex(/^[0-9a-fA-F]{24}$/, 'Invalid appointment ID format')
});


/**
 * Notification Schemas
 */
export const SendNotificationSchema = z.object({
  user_id: z.string().min(1, 'User ID is required'),
  template_key: z.string().optional(),
  title: z.string().min(1, 'Title is required').max(200, 'Title must be less than 200 characters'),
  message: z.string().min(1, 'Message is required').max(1000, 'Message must be less than 1000 characters'),
  type: z.enum(['appointment', 'treatment', 'consultation', 'system', 'reminder', 'alert']).default('system'),
  category: z.enum(['success', 'info', 'warning', 'error']).default('info'),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
  channels: z.array(z.enum(['in_app', 'email', 'sms', 'push'])).default(['in_app']),
  action_url: z.string().url().optional(),
  action_label: z.string().max(100).optional(),
  related_record: z.string().optional(),
  related_record_type: z.string().optional(),
  expiry_hours: z.number().min(1, 'Expiry must be at least 1 hour').optional(),
  data: z.record(z.any()).optional(),
  metadata: z.record(z.any()).optional()
});

export const MarkNotificationAsReadSchema = z.object({
  notification_id: z.string().min(1, 'Notification ID is required')
});

export const MarkAllNotificationsAsReadSchema = z.object({
  notification_ids: z.array(z.string()).optional(),
  filter_type: z.enum(['all', 'unread', 'by_category']).optional(),
  category: z.string().optional()
});

export const DeleteNotificationSchema = z.object({
  notification_id: z.string().min(1, 'Notification ID is required')
});

export const ClearAllNotificationsSchema = z.object({
  filter_type: z.enum(['all', 'read', 'expired', 'by_category']).default('all'),
  category: z.string().optional(),
  before_date: z.string().optional()
});

export const RegisterNotificationDeviceSchema = z.object({
  device_token: z.string().min(1, 'Device token is required'),
  device_type: z.enum(['ios', 'android', 'web']).default('web'),
  device_name: z.string().optional(),
  push_enabled: z.boolean().default(true),
  email_enabled: z.boolean().default(true),
  sms_enabled: z.boolean().default(false)
});

export const UnregisterNotificationDeviceSchema = z.object({
  device_token: z.string().min(1, 'Device token is required')
});

export const NotificationPreferencesSchema = z.object({
  appointment_notifications: z.object({
    enabled: z.boolean().default(true),
    channels: z.array(z.enum(['in_app', 'email', 'sms', 'push'])).optional(),
    reminder_hours_before: z.number().min(1, 'Reminder must be at least 1 hour before').max(72).default(24)
  }).optional(),
  treatment_notifications: z.object({
    enabled: z.boolean().default(true),
    channels: z.array(z.enum(['in_app', 'email', 'sms', 'push'])).optional()
  }).optional(),
  system_notifications: z.object({
    enabled: z.boolean().default(true),
    channels: z.array(z.enum(['in_app', 'email', 'sms', 'push'])).optional()
  }).optional(),
  quiet_hours: z.object({
    enabled: z.boolean().default(false),
    start_time: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, 'Invalid time format (HH:mm)').optional(),
    end_time: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, 'Invalid time format (HH:mm)').optional()
  }).optional(),
  frequency_limit: z.enum(['none', 'daily', 'weekly']).default('none'),
  notification_batching: z.boolean().default(false),
  batch_interval_minutes: z.number().min(5, 'Batch interval must be at least 5 minutes').max(1440).optional()
});

export const GetNotificationsSchema = z.object({
  page: z.number().min(1).default(1),
  limit: z.number().min(1).max(100).default(20),
  type: z.string().optional(),
  category: z.string().optional(),
  read_status: z.enum(['read', 'unread', 'all']).default('all'),
  date_from: z.string().optional(),
  date_to: z.string().optional(),
  search: z.string().max(100).optional()
});

export const NotificationStatsSchema = z.object({
  start_date: z.string().optional(),
  end_date: z.string().optional(),
  group_by: z.enum(['type', 'category', 'date', 'channel']).optional()
});

/**
 * Doctor Notification & Alert Schemas
 */
export const DoctorAppointmentAlertSchema = z.object({
  appointment_id: z.string().min(1, 'Appointment ID is required'),
  alert_type: z.enum(['new_booking', 'cancellation', 'rescheduled', 'emergency']).default('new_booking'),
  urgency_level: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
  notify_immediately: z.boolean().default(true),
  include_patient_details: z.boolean().default(true),
  require_acknowledgment: z.boolean().default(false)
});

export const DoctorGetAppointmentAlertsSchema = z.object({
  page: z.number().min(1).default(1),
  limit: z.number().min(1).max(100).default(20),
  status: z.enum(['pending', 'acknowledged', 'dismissed', 'all']).default('all'),
  urgency: z.enum(['low', 'medium', 'high', 'critical', 'all']).default('all'),
  date_from: z.string().optional(),
  date_to: z.string().optional(),
  sort_by: z.enum(['date', 'urgency', 'patient_name']).default('date'),
  sort_order: z.enum(['asc', 'desc']).default('desc')
});

export const DoctorAcknowledgeAlertSchema = z.object({
  notification_id: z.string().min(1, 'Notification ID is required'),
  acknowledgment_type: z.enum(['reviewed', 'accepted', 'deferred']).default('reviewed'),
  notes: z.string().max(500).optional(),
  action_taken: z.enum(['accept_appointment', 'reschedule_proposed', 'refer_patient', 'none']).optional(),
  action_details: z.object({
    proposed_date: z.string().optional(),
    proposed_time: z.string().optional(),
    referral_to: z.string().optional(),
    referral_reason: z.string().optional()
  }).optional()
});

export const DoctorMessageSchema = z.object({
  recipient_id: z.string().min(1, 'Recipient ID is required'),
  subject: z.string().min(5, 'Subject must be at least 5 characters').max(200),
  message: z.string().min(10, 'Message must be at least 10 characters').max(2000),
  message_type: z.enum(['appointment_note', 'patient_update', 'consultation_follow_up', 'urgent', 'general']).default('general'),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
  attachments: z.array(z.object({
    file_name: z.string(),
    file_type: z.string(),
    file_url: z.string().url()
  })).optional(),
  scheduled_send: z.string().optional(),
  require_read_receipt: z.boolean().default(false)
});

export const DoctorGetMessagesSchema = z.object({
  page: z.number().min(1).default(1),
  limit: z.number().min(1).max(100).default(20),
  folder: z.enum(['inbox', 'sent', 'drafts', 'archived']).default('inbox'),
  read_status: z.enum(['read', 'unread', 'all']).default('all'),
  priority: z.enum(['low', 'normal', 'high', 'urgent', 'all']).default('all'),
  message_type: z.string().optional(),
  search: z.string().max(200).optional(),
  date_from: z.string().optional(),
  date_to: z.string().optional()
});

export const DoctorMarkMessageAsReadSchema = z.object({
  message_id: z.string().min(1, 'Message ID is required')
});

export const DoctorBulkMarkMessagesSchema = z.object({
  message_ids: z.array(z.string().min(1)).min(1, 'At least one message ID is required'),
  action: z.enum(['read', 'unread', 'archive', 'delete']).default('read')
});

export const DoctorNotificationPreferencesSchema = z.object({
  appointment_alerts: z.object({
    enabled: z.boolean().default(true),
    notify_immediately: z.boolean().default(true),
    include_patient_details: z.boolean().default(true),
    require_acknowledgment: z.boolean().default(false),
    channels: z.array(z.enum(['in_app', 'email', 'sms', 'push'])).default(['in_app', 'email']),
    alert_types: z.array(z.enum(['new_booking', 'cancellation', 'rescheduled', 'emergency'])).default(['new_booking', 'emergency'])
  }).optional(),
  message_notifications: z.object({
    enabled: z.boolean().default(true),
    channels: z.array(z.enum(['in_app', 'email', 'sms', 'push'])).default(['in_app', 'email']),
    priority_filter: z.enum(['all', 'high_and_urgent', 'urgent_only']).default('all')
  }).optional(),
  emergency_protocols: z.object({
    enabled: z.boolean().default(true),
    escalation_enabled: z.boolean().default(true),
    alternate_contact: z.string().optional(),
    alternate_contact_title: z.string().optional()
  }).optional(),
  quiet_hours: z.object({
    enabled: z.boolean().default(false),
    start_time: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).optional(),
    end_time: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).optional(),
    allow_emergency_alerts: z.boolean().default(true)
  }).optional(),
  auto_acknowledgment: z.object({
    enabled: z.boolean().default(false),
    acknowledgment_type: z.enum(['reviewed', 'accepted']).optional(),
    delay_minutes: z.number().min(0).max(60).optional()
  }).optional()
});

export const DoctorGetUpcomingAppointmentsAlertSchema = z.object({
  hours_ahead: z.number().min(1).max(24).default(24),
  include_pending: z.boolean().default(true),
  include_confirmed: z.boolean().default(true),
  sort_by: z.enum(['time', 'urgency', 'patient_name']).default('time')
});

export const DoctorDismissAlertSchema = z.object({
  notification_id: z.string().min(1, 'Notification ID is required'),
  dismiss_reason: z.enum(['read_later', 'not_relevant', 'already_handled', 'other']).optional(),
  snooze_minutes: z.number().min(5).max(1440).optional()
});

export const DoctorSendQuickMessageSchema = z.object({
  patient_id: z.string().min(1, 'Patient ID is required'),
  appointment_id: z.string().min(1, 'Appointment ID is required'),
  template_id: z.string().optional(),
  custom_message: z.string().max(500).optional(),
  message_type: z.enum(['reminder', 'reschedule', 'instructions', 'custom']).default('custom'),
  scheduled_time: z.string().optional()
});

// Export inferred types
export type RegisterInput = z.infer<typeof RegisterSchema>;
export type LoginInput = z.infer<typeof LoginSchema>;
export type ChangePasswordInput = z.infer<typeof ChangePasswordSchema>;
export type CreateAppointmentInput = z.infer<typeof CreateAppointmentSchema>;
export type DoctorProfileInput = z.infer<typeof DoctorProfileSchema>;
export type UpdatePatientInfoInput = z.infer<typeof UpdatePatientInfoSchema>;
export type SendMessageInput = z.infer<typeof SendMessageSchema>;
export type CreateReviewInput = z.infer<typeof CreateReviewSchema>;
export type SendNotificationInput = z.infer<typeof SendNotificationSchema>;
export type MarkNotificationAsReadInput = z.infer<typeof MarkNotificationAsReadSchema>;
export type RegisterNotificationDeviceInput = z.infer<typeof RegisterNotificationDeviceSchema>;
export type NotificationPreferencesInput = z.infer<typeof NotificationPreferencesSchema>;
export type GetNotificationsInput = z.infer<typeof GetNotificationsSchema>;
export type DoctorAppointmentAlertInput = z.infer<typeof DoctorAppointmentAlertSchema>;
export type DoctorGetAppointmentAlertsInput = z.infer<typeof DoctorGetAppointmentAlertsSchema>;
export type DoctorAcknowledgeAlertInput = z.infer<typeof DoctorAcknowledgeAlertSchema>;
export type DoctorMessageInput = z.infer<typeof DoctorMessageSchema>;
export type DoctorGetMessagesInput = z.infer<typeof DoctorGetMessagesSchema>;
export type DoctorMarkMessageAsReadInput = z.infer<typeof DoctorMarkMessageAsReadSchema>;
export type DoctorBulkMarkMessagesInput = z.infer<typeof DoctorBulkMarkMessagesSchema>;
export type DoctorNotificationPreferencesInput = z.infer<typeof DoctorNotificationPreferencesSchema>;
export type DoctorGetUpcomingAppointmentsAlertInput = z.infer<typeof DoctorGetUpcomingAppointmentsAlertSchema>;
export type DoctorDismissAlertInput = z.infer<typeof DoctorDismissAlertSchema>;
export type DoctorSendQuickMessageInput = z.infer<typeof DoctorSendQuickMessageSchema>;
