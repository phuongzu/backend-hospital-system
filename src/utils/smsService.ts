import twilio from 'twilio';

export interface SMSOptions {
  to: string;
  body: string;
  from?: string;
  mediaUrl?: string;
}

class SMSService {
  private twilioClient: any;
  private isEnabled: boolean;

  constructor() {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;

  this.isEnabled = Boolean(
    accountSid &&
    accountSid.startsWith('AC') &&
    authToken &&
    twilioPhoneNumber
  );

    if (this.isEnabled) {
      this.twilioClient = twilio(accountSid, authToken);
      console.log('✅ Twilio SMS service initialized');
    } else {
      console.warn('⚠️ Twilio credentials not found, SMS service disabled');
    }
  }

  // Send SMS
  async sendSMS(options: SMSOptions): Promise<boolean> {
    if (!this.isEnabled) {
      console.warn('⚠️ SMS service is disabled');
      return false;
    }

    try {
      const message = await this.twilioClient.messages.create({
        body: options.body,
        from: options.from || process.env.TWILIO_PHONE_NUMBER,
        to: options.to,
        ...(options.mediaUrl && { mediaUrl: [options.mediaUrl] })
      });

      console.log(`✅ SMS sent to ${options.to}, SID: ${message.sid}`);
      return true;
    } catch (error: any) {
      console.error('❌ SMS sending error:', error.message);
      return false;
    }
  }

  // Send notification SMS
  async sendNotificationSMS(
    phoneNumber: string, 
    message: string,
    options?: {
      notification_id?: string;
      priority?: string;
    }
  ): Promise<boolean> {
    // Format phone number
    const formattedPhone = this.formatPhoneNumber(phoneNumber);
    
    if (!formattedPhone) {
      console.error(`❌ Invalid phone number: ${phoneNumber}`);
      return false;
    }

    // Add notification prefix for high priority
    const prefix = options?.priority === 'urgent' ? '[URGENT] ' : '';
    const fullMessage = `${prefix}${message}`;

    return this.sendSMS({
      to: formattedPhone,
      body: fullMessage
    });
  }

  // Format phone number
  private formatPhoneNumber(phoneNumber: string): string | null {
    // Remove all non-digit characters
    const digits = phoneNumber.replace(/\D/g, '');
    
    if (digits.length < 10) {
      return null;
    }

    // Add country code if missing
    if (digits.length === 10) {
      return `+1${digits}`; // Default to US
    }

    return `+${digits}`;
  }

  // Send verification code via SMS
  async sendVerificationCode(phoneNumber: string, code: string): Promise<boolean> {
    const message = `Your verification code is: ${code}. This code will expire in 10 minutes.`;
    
    return this.sendNotificationSMS(phoneNumber, message);
  }

  // Send appointment reminder via SMS
  async sendAppointmentReminder(
    phoneNumber: string,
    doctorName: string,
    appointmentTime: string,
    location?: string
  ): Promise<boolean> {
    const message = `Reminder: You have an appointment with Dr. ${doctorName} at ${appointmentTime}. ${
      location ? `Location: ${location}` : ''
    }`;

    return this.sendNotificationSMS(phoneNumber, message);
  }

  // Check if SMS service is available
  isAvailable(): boolean {
    return this.isEnabled;
  }
}

export const smsService = new SMSService();
