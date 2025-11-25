import nodemailer from 'nodemailer';

class EmailService {
  private transporter: nodemailer.Transporter;

  constructor() {
    console.log('📧 Initializing EmailService...');
    
    // Direct configuration - sử dụng trực tiếp giá trị từ .env
    const smtpConfig = {
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      auth: {
        user: 'pvu7999@gmail.com', // Sử dụng trực tiếp
        pass: 'nqiwqsowdrrnzpzu',  // Sử dụng trực tiếp
      },
      tls: {
        rejectUnauthorized: false
      }
    };

    console.log('🔧 Email configuration:', {
      host: smtpConfig.host,
      port: smtpConfig.port,
      user: smtpConfig.auth.user,
      hasPassword: !!smtpConfig.auth.pass
    });

    this.transporter = nodemailer.createTransport(smtpConfig);
    
    // Verify connection on startup
    this.verifyConnection();
  }

  private async verifyConnection(): Promise<void> {
    try {
      await this.transporter.verify();
      console.log('✅ SMTP connection verified successfully');
    } catch (error) {
      console.error('❌ SMTP connection failed:', error);
    }
  }

  async sendVerificationCode(to: string, code: string, name: string): Promise<void> {
    console.log(`📧 Sending verification code to: ${to}`);

    const mailOptions = {
      from: {
        name: 'MedPro Healthcare',
        address: 'pvu7999@gmail.com'
      },
      to: to,
      subject: 'Password Reset Verification Code - MedPro',
      html: this.getVerificationEmailTemplate(name, code),
      text: `Hello ${name}, Your verification code is: ${code}. This code will expire in 10 minutes.`
    };

    try {
      const info = await this.transporter.sendMail(mailOptions);
      console.log(`✅ Email sent successfully! Message ID: ${info.messageId}`);
    } catch (error: any) {
      console.error('❌ Email sending failed:', {
        code: error.code,
        command: error.command,
        response: error.response,
        message: error.message
      });
      throw new Error(`Failed to send verification email: ${error.message}`);
    }
  }

  private getVerificationEmailTemplate(name: string, code: string): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          .container { max-width: 600px; margin: 0 auto; padding: 20px; font-family: Arial, sans-serif; border: 1px solid #e0e0e0; border-radius: 10px; }
          .header { background: #4a90e2; color: white; padding: 20px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { padding: 30px 20px; background: #f9fafb; line-height: 1.6; }
          .code { font-size: 32px; font-weight: bold; text-align: center; color: #4a90e2; margin: 30px 0; padding: 20px; background: white; border-radius: 8px; border: 2px dashed #4a90e2; }
          .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 14px; border-top: 1px solid #e0e0e0; }
          .warning { background: #fff3cd; border: 1px solid #ffeaa7; color: #856404; padding: 15px; border-radius: 5px; margin: 20px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🏥 MedPro Healthcare</h1>
          </div>
          <div class="content">
            <h2>Hello ${name},</h2>
            <p>You requested to reset your password. Please use the verification code below:</p>
            <div class="code">${code}</div>
            <div class="warning">
              <strong>⚠️ Important:</strong> This code will expire in 10 minutes.
            </div>
            <p>If you didn't request this password reset, please ignore this email and your account will remain secure.</p>
          </div>
          <div class="footer">
            <p>&copy; 2024 MedPro Healthcare. All rights reserved.</p>
            <p>This is an automated message, please do not reply to this email.</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  // Send unlock request confirmation to doctor
  async sendUnlockRequestConfirmation(
    email: string, 
    name: string, 
    estimatedTime: Date
  ): Promise<void> {
    const formattedTime = estimatedTime.toLocaleString();
    
    console.log(`📧 Sending unlock confirmation to: ${email}`);

    const mailOptions = {
      from: {
        name: 'MedPro Healthcare',
        address: 'pvu7999@gmail.com'
      },
      to: email,
      subject: 'MedPro - Account Unlock Request Received',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            .container { max-width: 600px; margin: 0 auto; padding: 20px; font-family: Arial, sans-serif; border: 1px solid #e0e0e0; border-radius: 10px; }
            .header { background: #4a90e2; color: white; padding: 20px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { padding: 30px 20px; background: #f9fafb; line-height: 1.6; }
            .info-box { background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; border-radius: 5px; margin: 20px 0; }
            .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 14px; border-top: 1px solid #e0e0e0; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🏥 MedPro Healthcare</h1>
            </div>
            <div class="content">
              <h2>Account Unlock Request Received</h2>
              <p>Hello Dr. ${name},</p>
              <p>We have received your request to unlock your MedPro account.</p>
              
              <div class="info-box">
                <p style="margin: 0;"><strong>Estimated Resolution Time:</strong> ${formattedTime}</p>
              </div>
              
              <p>Our admin team will review your request and unlock your account within 24 hours.</p>
              <p>You will receive another email once your account has been unlocked.</p>
              
              <br>
              <p>If you have any urgent concerns, please contact our support team.</p>
            </div>
            <div class="footer">
              <p>Best regards,<br>MedPro Support Team</p>
              <p>&copy; 2024 MedPro Healthcare. All rights reserved.</p>
            </div>
          </div>
        </body>
        </html>
      `,
    };

    try {
      const info = await this.transporter.sendMail(mailOptions);
      console.log(`✅ Unlock confirmation sent successfully! Message ID: ${info.messageId}`);
    } catch (error: any) {
      console.error('❌ Failed to send unlock confirmation:', error);
      throw new Error(`Failed to send unlock confirmation email: ${error.message}`);
    }
  }

  // Send unlock notification to admin
  async sendUnlockRequestToAdmin(
    adminEmail: string,
    doctorName: string,
    doctorEmail: string,
    reason?: string
  ): Promise<void> {
    console.log(`📧 Sending unlock request notification to admin: ${adminEmail}`);

    const mailOptions = {
      from: {
        name: 'MedPro Healthcare System',
        address: 'pvu7999@gmail.com'
      },
      to: adminEmail,
      subject: `MedPro - New Account Unlock Request from Dr. ${doctorName}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            .container { max-width: 600px; margin: 0 auto; padding: 20px; font-family: Arial, sans-serif; border: 1px solid #e0e0e0; border-radius: 10px; }
            .header { background: #4a90e2; color: white; padding: 20px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { padding: 30px 20px; background: #f9fafb; line-height: 1.6; }
            .request-details { background: #e7f3ff; padding: 15px; border-radius: 5px; margin: 20px 0; }
            .button { background: #4a90e2; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block; }
            .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 14px; border-top: 1px solid #e0e0e0; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🔓 MedPro Admin Alert</h1>
            </div>
            <div class="content">
              <h2>New Account Unlock Request</h2>
              <p>Hello Admin,</p>
              
              <div class="request-details">
                <h3 style="color: #4a90e2; margin-top: 0;">Request Details:</h3>
                <p><strong>Doctor Name:</strong> Dr. ${doctorName}</p>
                <p><strong>Email:</strong> ${doctorEmail}</p>
                <p><strong>Request Time:</strong> ${new Date().toLocaleString()}</p>
                ${reason ? `<p><strong>Reason Provided:</strong> ${reason}</p>` : ''}
              </div>
              
              <p>Please review this request in the admin panel and take appropriate action within 24 hours.</p>
              
              <div style="text-align: center; margin: 25px 0;">
                <a href="${process.env.ADMIN_PANEL_URL || 'http://localhost:3000/admin'}" 
                   class="button">
                  Go to Admin Panel
                </a>
              </div>
            </div>
            <div class="footer">
              <p>Best regards,<br>MedPro System</p>
              <p>&copy; 2024 MedPro Healthcare. All rights reserved.</p>
            </div>
          </div>
        </body>
        </html>
      `,
    };

    try {
      const info = await this.transporter.sendMail(mailOptions);
      console.log(`✅ Admin notification sent successfully! Message ID: ${info.messageId}`);
    } catch (error: any) {
      console.error('❌ Failed to send admin notification:', error);
      throw new Error(`Failed to send admin notification email: ${error.message}`);
    }
  }

  // Send account unlocked notification to doctor
  async sendAccountUnlockedNotification(
    email: string,
    name: string,
    unlockedBy: string
  ): Promise<void> {
    console.log(`📧 Sending account unlocked notification to: ${email}`);

    const mailOptions = {
      from: {
        name: 'MedPro Healthcare',
        address: 'pvu7999@gmail.com'
      },
      to: email,
      subject: 'MedPro - Your Account Has Been Unlocked',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            .container { max-width: 600px; margin: 0 auto; padding: 20px; font-family: Arial, sans-serif; border: 1px solid #e0e0e0; border-radius: 10px; }
            .header { background: #28a745; color: white; padding: 20px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { padding: 30px 20px; background: #f9fafb; line-height: 1.6; }
            .success-box { background: #d4edda; border-left: 4px solid #28a745; padding: 15px; border-radius: 5px; margin: 20px 0; }
            .button { background: #28a745; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block; }
            .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 14px; border-top: 1px solid #e0e0e0; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>✅ MedPro Account Unlocked</h1>
            </div>
            <div class="content">
              <h2>Account Unlocked Successfully</h2>
              <p>Hello Dr. ${name},</p>
              
              <div class="success-box">
                <p style="margin: 0; color: #155724;"><strong>Your MedPro account has been successfully unlocked!</strong></p>
              </div>
              
              <p>You can now log in to your account and access all features.</p>
              <p><strong>Unlocked by:</strong> ${unlockedBy}</p>
              <p><strong>Unlock time:</strong> ${new Date().toLocaleString()}</p>
              
              <div style="text-align: center; margin: 25px 0;">
                <a href="${process.env.APP_URL || 'http://localhost:3000/login'}" 
                   class="button">
                  Login to MedPro
                </a>
              </div>
              
              <p>If you have any questions, please contact our support team.</p>
            </div>
            <div class="footer">
              <p>Best regards,<br>MedPro Team</p>
              <p>&copy; 2024 MedPro Healthcare. All rights reserved.</p>
            </div>
          </div>
        </body>
        </html>
      `,
    };

    try {
      const info = await this.transporter.sendMail(mailOptions);
      console.log(`✅ Account unlocked notification sent successfully! Message ID: ${info.messageId}`);
    } catch (error: any) {
      console.error('❌ Failed to send account unlocked notification:', error);
      throw new Error(`Failed to send account unlocked notification: ${error.message}`);
    }
  }

  // Send doctor approval email
  async sendDoctorApprovalEmail(
    email: string, 
    name: string, 
    temporaryPassword: string
  ): Promise<void> {
    console.log(`📧 Sending doctor approval email to: ${email}`);

    const mailOptions = {
      from: {
        name: 'MedPro Healthcare',
        address: 'pvu7999@gmail.com'
      },
      to: email,
      subject: 'Doctor Registration Approved - MedPro System',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            .container { max-width: 600px; margin: 0 auto; padding: 20px; font-family: Arial, sans-serif; border: 1px solid #e0e0e0; border-radius: 10px; }
            .header { background: #28a745; color: white; padding: 20px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { padding: 30px 20px; background: #f9fafb; line-height: 1.6; }
            .credentials { background: #e7f3ff; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #4a90e2; }
            .warning { background: #fff3cd; border: 1px solid #ffeaa7; color: #856404; padding: 15px; border-radius: 5px; margin: 20px 0; }
            .button { background: #28a745; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block; }
            .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 14px; border-top: 1px solid #e0e0e0; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>✅ Doctor Registration Approved</h1>
            </div>
            <div class="content">
              <h2>Welcome to MedPro System!</h2>
              <p>Dear Dr. ${name},</p>
              <p>Your doctor registration has been approved by our administration team.</p>
              <p>You can now login to the MedPro system using the following credentials:</p>
              
              <div class="credentials">
                <h3 style="color: #4a90e2; margin-top: 0;">Your Login Credentials:</h3>
                <p><strong>Email:</strong> ${email}</p>
                <p><strong>Temporary Password:</strong> ${temporaryPassword}</p>
              </div>
              
              <div class="warning">
                <strong>⚠️ Security Notice:</strong> Please change your password after first login for security.
              </div>
              
              <div style="text-align: center; margin: 25px 0;">
                <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/doctor-login" 
                   class="button">
                  Login to MedPro
                </a>
              </div>
              
              <p>If you have any questions or need assistance, please contact our support team.</p>
            </div>
            <div class="footer">
              <p>Best regards,<br>MedPro Administration Team</p>
              <p>&copy; 2024 MedPro Healthcare. All rights reserved.</p>
            </div>
          </div>
        </body>
        </html>
      `,
    };

    try {
      const info = await this.transporter.sendMail(mailOptions);
      console.log(`✅ Doctor approval email sent successfully! Message ID: ${info.messageId}`);
    } catch (error: any) {
      console.error('❌ Failed to send doctor approval email:', error);
      throw new Error(`Failed to send doctor approval email: ${error.message}`);
    }
  }

  // Send doctor rejection email
  async sendDoctorRejectionEmail(
    email: string, 
    name: string, 
    reason?: string
  ): Promise<void> {
    console.log(`📧 Sending doctor rejection email to: ${email}`);

    const mailOptions = {
      from: {
        name: 'MedPro Healthcare',
        address: 'pvu7999@gmail.com'
      },
      to: email,
      subject: 'Doctor Registration Update - MedPro System',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            .container { max-width: 600px; margin: 0 auto; padding: 20px; font-family: Arial, sans-serif; border: 1px solid #e0e0e0; border-radius: 10px; }
            .header { background: #6c757d; color: white; padding: 20px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { padding: 30px 20px; background: #f9fafb; line-height: 1.6; }
            .notice { background: #f8d7da; border-left: 4px solid #dc3545; padding: 15px; border-radius: 5px; margin: 20px 0; }
            .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 14px; border-top: 1px solid #e0e0e0; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>📋 Registration Update</h1>
            </div>
            <div class="content">
              <h2>Registration Status Update</h2>
              <p>Dear ${name},</p>
              <p>Thank you for your interest in joining the MedPro system.</p>
              
              <div class="notice">
                <p style="margin: 0; color: #721c24;">
                  <strong>After careful review, we regret to inform you that your doctor registration request could not be approved at this time.</strong>
                </p>
              </div>
              
              ${reason ? `
                <div style="background: #fff3cd; padding: 15px; border-radius: 5px; margin: 20px 0;">
                  <p style="margin: 0;"><strong>Reason:</strong> ${reason}</p>
                </div>
              ` : ''}
              
              <p>If you believe this is an error or would like more information about our requirements, please contact our administration team.</p>
              
              <p>We appreciate your understanding and encourage you to review our doctor registration requirements before submitting a new application.</p>
            </div>
            <div class="footer">
              <p>Best regards,<br>MedPro Administration Team</p>
              <p>&copy; 2024 MedPro Healthcare. All rights reserved.</p>
            </div>
          </div>
        </body>
        </html>
      `,
    };

    try {
      const info = await this.transporter.sendMail(mailOptions);
      console.log(`✅ Doctor rejection email sent successfully! Message ID: ${info.messageId}`);
    } catch (error: any) {
      console.error('❌ Failed to send doctor rejection email:', error);
      throw new Error(`Failed to send doctor rejection email: ${error.message}`);
    }
  }

  // Send registration confirmation email
  async sendRegistrationConfirmation(
    email: string, 
    name: string
  ): Promise<void> {
    console.log(`📧 Sending registration confirmation to: ${email}`);

    const mailOptions = {
      from: {
        name: 'MedPro Healthcare',
        address: 'pvu7999@gmail.com'
      },
      to: email,
      subject: 'Doctor Registration Received - MedPro System',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            .container { max-width: 600px; margin: 0 auto; padding: 20px; font-family: Arial, sans-serif; border: 1px solid #e0e0e0; border-radius: 10px; }
            .header { background: #4a90e2; color: white; padding: 20px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { padding: 30px 20px; background: #f9fafb; line-height: 1.6; }
            .info-box { background: #e7f3ff; border-left: 4px solid #4a90e2; padding: 15px; border-radius: 5px; margin: 20px 0; }
            .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 14px; border-top: 1px solid #e0e0e0; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>📋 Registration Received</h1>
            </div>
            <div class="content">
              <h2>Thank You for Your Registration</h2>
              <p>Dear ${name},</p>
              <p>Thank you for submitting your doctor registration to the MedPro system.</p>
              
              <div class="info-box">
                <p style="margin: 0;">
                  <strong>Your application is currently under review by our administration team.</strong><br>
                  This process typically takes 1-3 business days.
                </p>
              </div>
              
              <p>You will receive an email notification once your application has been processed.</p>
              
              <p>If you have any questions during this process, please don't hesitate to contact our support team.</p>
            </div>
            <div class="footer">
              <p>Best regards,<br>MedPro Administration Team</p>
              <p>&copy; 2024 MedPro Healthcare. All rights reserved.</p>
            </div>
          </div>
        </body>
        </html>
      `,
    };

    try {
      const info = await this.transporter.sendMail(mailOptions);
      console.log(`✅ Registration confirmation sent successfully! Message ID: ${info.messageId}`);
    } catch (error: any) {
      console.error('❌ Failed to send registration confirmation:', error);
      throw new Error(`Failed to send registration confirmation: ${error.message}`);
    }
  }

  // Test email connection
  async testConnection(): Promise<boolean> {
    try {
      await this.transporter.verify();
      console.log('✅ Email server connection verified');
      return true;
    } catch (error) {
      console.error('❌ Email server connection failed:', error);
      return false;
    }
  }
}

// Tạo và export instance
export const emailService = new EmailService();