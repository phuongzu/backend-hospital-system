import nodemailer from 'nodemailer';
import  logger  from './logger';

class EmailService {
  private transporter: nodemailer.Transporter;

  constructor() {
    logger.debug('📧 Initializing EmailService...');
    
    // Direct configuration - sử dụng trực tiếp giá trị từ .env
    const smtpConfig = {
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      auth: {
        user: 'pvu7999@gmail.com',
        pass: 'nqiwqsowdrrnzpzu',
      },
      tls: {
        rejectUnauthorized: false
      }
    };

    logger.debug('🔧 Email configuration:', {
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
      logger.info('✅ SMTP connection verified successfully', { service: 'EmailService' });
    } catch (error) {
      logger.error('❌ SMTP connection failed:', { error: error instanceof Error ? error.message : String(error), service: 'EmailService' });
    }
  }

  // ========== BASIC EMAIL TEMPLATES ==========

  async sendVerificationCode(to: string, code: string, name: string): Promise<void> {
    logger.debug(`📧 Sending verification code to: ${to}`, { recipient: to, method: 'sendVerificationCode' });

    const mailOptions = {
      from: {
        name: 'MediCare Healthcare',
        address: 'pvu7999@gmail.com'
      },
      to: to,
      subject: 'Password Reset Verification Code - MediCare',
      html: this.getVerificationEmailTemplate(name, code),
      text: `Hello ${name}, Your verification code is: ${code}. This code will expire in 10 minutes.`
    };

    try {
      const info = await this.transporter.sendMail(mailOptions);
      logger.info(`✅ Verification code email sent successfully!`, { messageId: info.messageId, recipient: to });
    } catch (error: any) {
      logger.error('❌ Verification email sending failed:', {
        recipient: to,
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
            <h1>🏥 MediCare Healthcare</h1>
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
            <p>&copy; 2024 MediCare Healthcare. All rights reserved.</p>
            <p>This is an automated message, please do not reply to this email.</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  // ========== TREATMENT RELATED EMAILS ==========

  async sendTreatmentStepApprovalEmail(
    to: string,
    patientName: string,
    stepTitle: string,
    stepNumber: number,
    doctorName: string,
    doctorNotes?: string,
    isConsultationCompleted: boolean = false
  ): Promise<boolean> {
    try {
      const subject = isConsultationCompleted 
        ? `🎉 Treatment Completed - Step ${stepNumber} Approved`
        : `✅ Treatment Step ${stepNumber} Approved`;

      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
            .step-box { background: white; border-left: 4px solid #4CAF50; padding: 15px; margin: 20px 0; border-radius: 4px; }
            .doctor-notes { background: #e8f5e9; border: 1px solid #c8e6c9; padding: 15px; margin: 20px 0; border-radius: 4px; }
            .button { display: inline-block; background: #4CAF50; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold; }
            .footer { text-align: center; margin-top: 30px; color: #666; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>${isConsultationCompleted ? '🎉 Treatment Completed!' : '✅ Step Approved'}</h1>
              <p>${isConsultationCompleted ? 'All treatment steps have been completed!' : 'Your treatment progress has been updated'}</p>
            </div>
            
            <div class="content">
              <h2>Hello ${patientName},</h2>
              
              <p>${isConsultationCompleted 
                ? `We're pleased to inform you that Dr. ${doctorName} has completed your treatment consultation. All steps have been successfully approved.`
                : `Dr. ${doctorName} has approved your treatment step ${stepNumber}.`}
              </p>
              
              <div class="step-box">
                <h3>Step ${stepNumber}: ${stepTitle}</h3>
                <p><strong>Status:</strong> ✅ Approved</p>
                <p><strong>Approved by:</strong> Dr. ${doctorName}</p>
                <p><strong>Approval Date:</strong> ${new Date().toLocaleDateString()}</p>
              </div>
              
              ${doctorNotes ? `
                <div class="doctor-notes">
                  <h4>📝 Doctor's Notes:</h4>
                  <p>${doctorNotes}</p>
                </div>
              ` : ''}
              
              ${isConsultationCompleted ? `
                <h3>🎊 Congratulations!</h3>
                <p>Your treatment plan has been successfully completed. Please schedule a follow-up appointment if needed.</p>
                
                <div style="text-align: center; margin: 30px 0;">
                  <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/consultations/summary" class="button">
                    View Consultation Summary
                  </a>
                </div>
              ` : `
                <p>Please continue with the next steps in your treatment plan as scheduled.</p>
                
                <div style="text-align: center; margin: 30px 0;">
                  <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/treatment/steps/${stepNumber}" class="button">
                    View Step Details
                  </a>
                </div>
              `}
              
              <h3>📋 Next Steps:</h3>
              <ul>
                ${isConsultationCompleted ? `
                  <li>Review your completed treatment summary</li>
                  <li>Schedule follow-up appointment if required</li>
                  <li>Contact your doctor with any questions</li>
                ` : `
                  <li>Continue with the next treatment step</li>
                  <li>Follow the prescribed instructions</li>
                  <li>Report any concerns to your doctor</li>
                `}
              </ul>
              
              <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;" />
              
              <p><strong>Need Help?</strong></p>
              <p>If you have any questions about your treatment, please contact:</p>
              <ul>
                <li>📞 Call: (123) 456-7890</li>
                <li>📧 Email: support@medcare.com</li>
                <li>💬 Chat: Available in your patient portal</li>
              </ul>
            </div>
            
            <div class="footer">
              <p>This is an automated message from MediCare Healthcare. Please do not reply to this email.</p>
              <p>© ${new Date().getFullYear()} MediCare Healthcare. All rights reserved.</p>
            </div>
          </div>
        </body>
        </html>
      `;

      const mailOptions = {
        from: {
          name: 'MediCare Healthcare',
          address: 'pvu7999@gmail.com'
        },
        to: to,
        subject: subject,
        html: html
      };

      const info = await this.transporter.sendMail(mailOptions);
      logger.info(`✅ Treatment step approval email sent successfully!`, { messageId: info.messageId, recipient: to });
      return true;
    } catch (error) {
      logger.error('Error sending treatment step approval email:', { recipient: to, error: error instanceof Error ? error.message : String(error) });
      return false;
    }
  }

  async sendConsultationSummaryEmail(
    to: string,
    patientName: string,
    data: {
      consultation_id: string;
      doctor_name: string;
      diagnosis: string;
      summary: string;
      treatment_steps_completed: number;
      total_treatment_steps: number;
      follow_up_instructions?: string;
      next_appointment_date?: Date;
      completed_date: string;
    }
  ): Promise<boolean> {
    try {
      const subject = `📋 Consultation Summary - ${data.completed_date}`;

      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 700px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #6a11cb 0%, #2575fc 100%); color: white; padding: 40px; text-align: center; border-radius: 15px 15px 0 0; }
            .content { background: white; padding: 40px; border-radius: 0 0 15px 15px; box-shadow: 0 5px 15px rgba(0,0,0,0.05); }
            .section { margin: 30px 0; padding: 20px; border-radius: 10px; }
            .diagnosis-section { background: #e8f4fd; border-left: 5px solid #2196F3; }
            .summary-section { background: #f0f9ff; border-left: 5px solid #03A9F4; }
            .treatment-section { background: #f3e5f5; border-left: 5px solid #9C27B0; }
            .followup-section { background: #e8f5e9; border-left: 5px solid #4CAF50; }
            .info-box { background: #fff3cd; border: 1px solid #ffeaa7; padding: 15px; margin: 20px 0; border-radius: 8px; }
            .button { display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: bold; transition: transform 0.2s; }
            .button:hover { transform: translateY(-2px); }
            .footer { text-align: center; margin-top: 40px; color: #777; font-size: 13px; }
            .stat-box { display: inline-block; background: white; padding: 20px; margin: 10px; border-radius: 10px; box-shadow: 0 3px 10px rgba(0,0,0,0.08); text-align: center; min-width: 150px; }
            .stat-number { font-size: 36px; font-weight: bold; color: #6a11cb; }
            .stat-label { color: #666; font-size: 14px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>📋 Consultation Summary</h1>
              <p>Your medical consultation has been completed</p>
              <p style="opacity: 0.9; margin-top: 10px;">Consultation ID: ${data.consultation_id}</p>
            </div>
            
            <div class="content">
              <h2>Hello ${patientName},</h2>
              <p>Dr. ${data.doctor_name} has completed your consultation. Below is a summary of your visit:</p>
              
              <div style="text-align: center; margin: 30px 0;">
                <div class="stat-box">
                  <div class="stat-number">${data.treatment_steps_completed}/${data.total_treatment_steps}</div>
                  <div class="stat-label">Steps Completed</div>
                </div>
                <div class="stat-box">
                  <div class="stat-number">${data.completed_date}</div>
                  <div class="stat-label">Completion Date</div>
                </div>
              </div>
              
              <div class="section diagnosis-section">
                <h3>🏥 Diagnosis</h3>
                <p><strong>Primary Diagnosis:</strong> ${data.diagnosis}</p>
                <p>This diagnosis was determined based on your symptoms, examination findings, and any test results.</p>
              </div>
              
              <div class="section summary-section">
                <h3>📝 Consultation Summary</h3>
                <p>${data.summary}</p>
              </div>
              
              <div class="section treatment-section">
                <h3>💊 Treatment Progress</h3>
                <p>You have successfully completed ${data.treatment_steps_completed} out of ${data.total_treatment_steps} treatment steps.</p>
                <p>All prescribed treatments have been administered as planned.</p>
              </div>
              
              ${data.follow_up_instructions ? `
                <div class="section followup-section">
                  <h3>📅 Follow-up Instructions</h3>
                  <p>${data.follow_up_instructions}</p>
                  ${data.next_appointment_date ? `
                    <div class="info-box">
                      <strong>Next Appointment:</strong> ${new Date(data.next_appointment_date).toLocaleDateString()}
                    </div>
                  ` : ''}
                </div>
              ` : ''}
              
              <div class="info-box">
                <h4>ℹ️ Important Information</h4>
                <ul>
                  <li>Keep this summary for your medical records</li>
                  <li>Contact your doctor if symptoms persist or worsen</li>
                  <li>Follow all medication instructions carefully</li>
                  <li>Schedule follow-up appointments as recommended</li>
                </ul>
              </div>
              
              <div style="text-align: center; margin: 40px 0;">
                <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/consultations/${data.consultation_id}/summary" class="button">
                  View Complete Consultation Details
                </a>
              </div>
              
              <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;" />
              
              <h3>🆘 Emergency Contact</h3>
              <p>If you experience any of the following, seek emergency care immediately:</p>
              <ul>
                <li>Severe pain or discomfort</li>
                <li>Difficulty breathing</li>
                <li>Chest pain or pressure</li>
                <li>Severe bleeding</li>
                <li>Loss of consciousness</li>
              </ul>
              <p><strong>Emergency:</strong> Call 911 or go to the nearest emergency room</p>
              
              <div class="footer">
                <p>This consultation summary was generated by MediCare Healthcare.</p>
                <p>For non-emergency questions, contact your doctor's office.</p>
                <p>© ${new Date().getFullYear()} MediCare Healthcare. All rights reserved.</p>
              </div>
            </div>
          </div>
        </body>
        </html>
      `;

      const mailOptions = {
        from: {
          name: 'MediCare Healthcare',
          address: 'pvu7999@gmail.com'
        },
        to: to,
        subject: subject,
        html: html
      };

      const info = await this.transporter.sendMail(mailOptions);
      logger.info(`✅ Consultation summary email sent successfully!`, { messageId: info.messageId, recipient: to });
      return true;
    } catch (error) {
      logger.error('Error sending consultation summary email:', { recipient: to, error: error instanceof Error ? error.message : String(error) });
      return false;
    }
  }

  // ========== APPOINTMENT RELATED EMAILS ==========

  async sendAppointmentConfirmationEmail(
    to: string,
    patientName: string,
    data: {
      appointment_id: string;
      doctor_name: string;
      doctor_specialty: string;
      appointment_date: string;
      appointment_time: string;
      appointment_end_time: string;
      location: string;
      consultation_fee: number;
      preparation_instructions: string;
      cancellation_policy: string;
      contact_info: string;
    }
  ): Promise<boolean> {
    try {
      const subject = `✅ Appointment booked successfully - ${data.appointment_date} at ${data.appointment_time}`;

      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #4CAF50; color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .appointment-card { background: white; border: 2px solid #4CAF50; border-radius: 10px; padding: 25px; margin: 20px 0; }
            .info-row { display: flex; margin: 10px 0; }
            .info-label { font-weight: bold; width: 150px; color: #555; }
            .info-value { flex: 1; }
            .instructions { background: #e8f5e9; padding: 20px; border-radius: 8px; margin: 20px 0; }
            .button { display: inline-block; background: #4CAF50; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold; }
            .footer { text-align: center; margin-top: 30px; color: #666; font-size: 12px; }
            .qr-code { text-align: center; margin: 20px 0; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>✅ Appointment Confirmed</h1>
              <p>Your appointment has been successfully scheduled</p>
            </div>
            
            <div class="content">
              <h2>Hello ${patientName},</h2>
              <p>Your appointment has been confirmed. Please review the details below:</p>
              
              <div class="appointment-card">
                <h3 style="margin-top: 0; color: #4CAF50;">Appointment Details</h3>
                
                <div class="info-row">
                  <div class="info-label">Doctor:</div>
                  <div class="info-value">Dr. ${data.doctor_name} (${data.doctor_specialty})</div>
                </div>
                
                <div class="info-row">
                  <div class="info-label">Date & Time:</div>
                  <div class="info-value">
                    <strong>${data.appointment_date} at ${data.appointment_time}</strong><br>
                    <small>Duration: ${data.appointment_time} - ${data.appointment_end_time}</small>
                  </div>
                </div>
                
                <div class="info-row">
                  <div class="info-label">Location:</div>
                  <div class="info-value">${data.location}</div>
                </div>
                
                <div class="info-row">
                  <div class="info-label">Appointment ID:</div>
                  <div class="info-value"><code>${data.appointment_id}</code></div>
                </div>
                
                <div class="info-row">
                  <div class="info-label">Consultation Fee:</div>
                  <div class="info-value">$${data.consultation_fee.toFixed(2)}</div>
                </div>
              </div>
              
              <div class="instructions">
                <h4>📋 Preparation Instructions</h4>
                <p>${data.preparation_instructions}</p>
                <ul>
                  <li>Arrive 15 minutes before your appointment</li>
                  <li>Bring your ID and insurance card</li>
                  <li>Bring any relevant medical records</li>
                  <li>Bring a list of current medications</li>
                </ul>
              </div>
              
              <div class="qr-code">
                <div style="background: #f0f0f0; padding: 20px; display: inline-block; border-radius: 10px;">
                  <div style="font-family: monospace; font-size: 12px; letter-spacing: 2px;">
                    APPT-${data.appointment_id}
                  </div>
                  <div style="font-size: 10px; color: #666; margin-top: 5px;">Show this code at check-in</div>
                </div>
              </div>
              
              <div style="text-align: center; margin: 30px 0;">
                <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/appointments/${data.appointment_id}" class="button">
                  View Appointment Details
                </a>
                &nbsp;&nbsp;
                <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/appointments/${data.appointment_id}/cancel" style="color: #f44336; text-decoration: none;">
                  Cancel Appointment
                </a>
              </div>
              
              <div style="background: #fff3cd; padding: 15px; border-radius: 8px; margin: 20px 0;">
                <h4>⚠️ Cancellation Policy</h4>
                <p>${data.cancellation_policy}</p>
              </div>
              
              <h4>📞 Contact Information</h4>
              <p>${data.contact_info}</p>
              <p>For changes or questions about your appointment, please contact us at least 24 hours in advance.</p>
              
              <div class="footer">
                <p>This is an automated confirmation from MediCare Healthcare.</p>
                <p>© ${new Date().getFullYear()} MediCare Healthcare. All rights reserved.</p>
              </div>
            </div>
          </div>
        </body>
        </html>
      `;

      const mailOptions = {
        from: {
          name: 'MediCare Healthcare',
          address: 'pvu7999@gmail.com'
        },
        to: to,
        subject: subject,
        html: html
      };

      const info = await this.transporter.sendMail(mailOptions);
      logger.info(`✅ Appointment confirmation email sent successfully!`, { messageId: info.messageId, recipient: to });
      return true;
    } catch (error) {
      logger.error('Error sending appointment confirmation email:', { recipient: to, error: error instanceof Error ? error.message : String(error) });
      return false;
    }
  }

  // Send appointment reminder
  async sendAppointmentReminderEmail(
    to: string,
    patientName: string,
    data: {
      doctor_name: string;
      appointment_date: string;
      appointment_time: string;
      location: string;
      preparation_instructions: string;
    }
  ): Promise<boolean> {
    try {
      const subject = `📅 Appointment Reminder - ${data.appointment_date}`;

      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #FF9800; color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .reminder-box { background: #FFF3E0; border: 2px solid #FF9800; border-radius: 10px; padding: 25px; margin: 20px 0; }
            .info-row { display: flex; margin: 10px 0; }
            .info-label { font-weight: bold; width: 150px; color: #555; }
            .info-value { flex: 1; }
            .button { display: inline-block; background: #FF9800; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>📅 Appointment Reminder</h1>
              <p>Your appointment is coming up soon</p>
            </div>
            
            <div class="content">
              <h2>Hello ${patientName},</h2>
              <p>This is a friendly reminder about your upcoming appointment:</p>
              
              <div class="reminder-box">
                <h3 style="margin-top: 0; color: #FF9800;">Appointment Details</h3>
                
                <div class="info-row">
                  <div class="info-label">Doctor:</div>
                  <div class="info-value">Dr. ${data.doctor_name}</div>
                </div>
                
                <div class="info-row">
                  <div class="info-label">Date & Time:</div>
                  <div class="info-value">
                    <strong>${data.appointment_date} at ${data.appointment_time}</strong>
                  </div>
                </div>
                
                <div class="info-row">
                  <div class="info-label">Location:</div>
                  <div class="info-value">${data.location}</div>
                </div>
              </div>
              
              <div style="background: #FFF3E0; padding: 15px; border-radius: 8px; margin: 20px 0;">
                <h4>📋 Preparation Reminder</h4>
                <p>${data.preparation_instructions}</p>
              </div>
              
              <div style="text-align: center; margin: 30px 0;">
                <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/appointments" class="button">
                  View My Appointments
                </a>
              </div>
              
              <p><strong>Need to reschedule or cancel?</strong><br>
              Please contact us at least 24 hours in advance to avoid cancellation fees.</p>
            </div>
          </div>
        </body>
        </html>
      `;

      const mailOptions = {
        from: {
          name: 'MediCare Healthcare',
          address: 'pvu7999@gmail.com'
        },
        to: to,
        subject: subject,
        html: html
      };

      const info = await this.transporter.sendMail(mailOptions);
      logger.info(`✅ Appointment reminder email sent successfully!`, { messageId: info.messageId, recipient: to });
      return true;
    } catch (error) {
      logger.error('Error sending appointment reminder email:', { recipient: to, error: error instanceof Error ? error.message : String(error) });
      return false;
    }
  }

  // ========== ACCOUNT & SECURITY EMAILS ==========

  async sendUnlockRequestConfirmation(
    email: string, 
    name: string, 
    estimatedTime: Date
  ): Promise<void> {
    const formattedTime = estimatedTime.toLocaleString();
    
    logger.debug(`📧 Sending unlock confirmation to: ${email}`, { recipient: email, method: 'sendUnlockRequest' });

    const mailOptions = {
      from: {
        name: 'MediCare Healthcare',
        address: 'pvu7999@gmail.com'
      },
      to: email,
      subject: 'MediCare - Account Unlock Request Received',
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
              <h1>🏥 MediCare Healthcare</h1>
            </div>
            <div class="content">
              <h2>Account Unlock Request Received</h2>
              <p>Hello Dr. ${name},</p>
              <p>We have received your request to unlock your MediCare account.</p>
              
              <div class="info-box">
                <p style="margin: 0;"><strong>Estimated Resolution Time:</strong> ${formattedTime}</p>
              </div>
              
              <p>Our admin team will review your request and unlock your account within 24 hours.</p>
              <p>You will receive another email once your account has been unlocked.</p>
              
              <br>
              <p>If you have any urgent concerns, please contact our support team.</p>
            </div>
            <div class="footer">
              <p>Best regards,<br>MediCare Support Team</p>
              <p>&copy; 2024 MediCare Healthcare. All rights reserved.</p>
            </div>
          </div>
        </body>
        </html>
      `,
    };

    try {
      const info = await this.transporter.sendMail(mailOptions);
      logger.info(`✅ Unlock confirmation sent successfully!`, { messageId: info.messageId, recipient: email });
    } catch (error: any) {
      logger.error('❌ Failed to send unlock confirmation:', { recipient: email, error: error.message });
      throw new Error(`Failed to send unlock confirmation email: ${error.message}`);
    }
  }

  async sendUnlockRequestToAdmin(
    adminEmail: string,
    doctorName: string,
    doctorEmail: string,
    reason?: string
  ): Promise<void> {
    logger.debug(`📧 Sending unlock request notification to admin: ${adminEmail}`, { recipient: adminEmail, doctorName, method: 'sendUnlockRequestToAdmin' });

    const mailOptions = {
      from: {
        name: 'MediCare Healthcare System',
        address: 'pvu7999@gmail.com'
      },
      to: adminEmail,
      subject: `MediCare - New Account Unlock Request from Dr. ${doctorName}`,
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
              <h1>🔓 MediCare Admin Alert</h1>
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
              <p>Best regards,<br>MediCare System</p>
              <p>&copy; 2024 MediCare Healthcare. All rights reserved.</p>
            </div>
          </div>
        </body>
        </html>
      `,
    };

    try {
      const info = await this.transporter.sendMail(mailOptions);
      logger.info(`✅ Admin notification sent successfully!`, { messageId: info.messageId, recipient: adminEmail });
    } catch (error: any) {
      logger.error('❌ Failed to send admin notification:', { recipient: adminEmail, error: error instanceof Error ? error.message : String(error) });
      throw new Error(`Failed to send admin notification email: ${error.message}`);
    }
  }

  async sendAccountUnlockedNotification(
    email: string,
    name: string,
    unlockedBy: string
  ): Promise<void> {
    logger.debug(`📧 Sending account unlocked notification to: ${email}`, { recipient: email, method: 'sendAccountUnlockedNotification' });

    const mailOptions = {
      from: {
        name: 'MediCare Healthcare',
        address: 'pvu7999@gmail.com'
      },
      to: email,
      subject: 'MediCare - Your Account Has Been Unlocked',
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
              <h1>✅ MediCare Account Unlocked</h1>
            </div>
            <div class="content">
              <h2>Account Unlocked Successfully</h2>
              <p>Hello Dr. ${name},</p>
              
              <div class="success-box">
                <p style="margin: 0; color: #155724;"><strong>Your MediCare account has been successfully unlocked!</strong></p>
              </div>
              
              <p>You can now log in to your account and access all features.</p>
              <p><strong>Unlocked by:</strong> ${unlockedBy}</p>
              <p><strong>Unlock time:</strong> ${new Date().toLocaleString()}</p>
              
              <div style="text-align: center; margin: 25px 0;">
                <a href="${process.env.APP_URL || 'http://localhost:3000/login'}" 
                   class="button">
                  Login to MediCare
                </a>
              </div>
              
              <p>If you have any questions, please contact our support team.</p>
            </div>
            <div class="footer">
              <p>Best regards,<br>MediCare Team</p>
              <p>&copy; 2024 MediCare Healthcare. All rights reserved.</p>
            </div>
          </div>
        </body>
        </html>
      `,
    };

    try {
      const info = await this.transporter.sendMail(mailOptions);
      logger.info(`✅ Account unlocked notification sent successfully!`, { messageId: info.messageId, recipient: email });
    } catch (error: any) {
      logger.error('❌ Failed to send account unlocked notification:', { recipient: email, error: error instanceof Error ? error.message : String(error) });
      throw new Error(`Failed to send account unlocked notification: ${error.message}`);
    }
  }

  async sendDoctorApprovalEmail(
    email: string, 
    name: string, 
    temporaryPassword: string
  ): Promise<void> {
    console.log(`📧 Sending doctor approval email to: ${email}`);

    const mailOptions = {
      from: {
        name: 'MediCare Healthcare',
        address: 'pvu7999@gmail.com'
      },
      to: email,
      subject: 'Doctor Registration Approved - MediCare System',
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
              <h2>Welcome to MediCare System!</h2>
              <p>Dear Dr. ${name},</p>
              <p>Your doctor registration has been approved by our administration team.</p>
              <p>You can now login to the MediCare system using the following credentials:</p>
              
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
                  Login to MediCare
                </a>
              </div>
              
              <p>If you have any questions or need assistance, please contact our support team.</p>
            </div>
            <div class="footer">
              <p>Best regards,<br>MediCare Administration Team</p>
              <p>&copy; 2024 MediCare Healthcare. All rights reserved.</p>
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

  async sendDoctorRejectionEmail(
    email: string, 
    name: string, 
    reason?: string
  ): Promise<void> {
    console.log(`📧 Sending doctor rejection email to: ${email}`);

    const mailOptions = {
      from: {
        name: 'MediCare Healthcare',
        address: 'pvu7999@gmail.com'
      },
      to: email,
      subject: 'Doctor Registration Update - MediCare System',
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
              <p>Thank you for your interest in joining the MediCare system.</p>
              
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
              <p>Best regards,<br>MediCare Administration Team</p>
              <p>&copy; 2024 MediCare Healthcare. All rights reserved.</p>
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

  async sendRegistrationConfirmation(
    email: string, 
    name: string
  ): Promise<void> {
    console.log(`📧 Sending registration confirmation to: ${email}`);

    const mailOptions = {
      from: {
        name: 'MediCare Healthcare',
        address: 'pvu7999@gmail.com'
      },
      to: email,
      subject: 'Doctor Registration Received - MediCare System',
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
              <p>Thank you for submitting your doctor registration to the MediCare system.</p>
              
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
              <p>Best regards,<br>MediCare Administration Team</p>
              <p>&copy; 2024 MediCare Healthcare. All rights reserved.</p>
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

  // ========== NOTIFICATION EMAIL ==========

  async sendNotificationEmail(
    to: string,
    title: string,
    message: string,
    data?: {
      notification_id?: string;
      type?: string;
      category?: string;
      user_name?: string;
      action_url?: string;
    }
  ): Promise<boolean> {
    try {
      const subject = `🔔 ${title}`;

      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #4a90e2; color: white; padding: 20px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; }
            .notification-box { background: white; border-left: 4px solid #4a90e2; padding: 20px; margin: 20px 0; border-radius: 5px; }
            .button { display: inline-block; background: #4a90e2; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold; }
            .footer { text-align: center; margin-top: 30px; color: #666; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🔔 MediCare Notification</h1>
            </div>
            
            <div class="content">
              <h2>${title}</h2>
              
              <div class="notification-box">
                <p>${message}</p>
              </div>
              
              ${data?.action_url ? `
                <div style="text-align: center; margin: 25px 0;">
                  <a href="${data.action_url}" class="button">
                    Take Action
                  </a>
                </div>
              ` : ''}
              
              <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;" />
              
              <p><strong>Notification Details:</strong></p>
              <ul>
                <li><strong>Type:</strong> ${data?.type || 'System'}</li>
                <li><strong>Category:</strong> ${data?.category || 'Information'}</li>
                <li><strong>Time:</strong> ${new Date().toLocaleString()}</li>
                ${data?.notification_id ? `<li><strong>ID:</strong> ${data.notification_id}</li>` : ''}
              </ul>
              
              <p>If you have any questions about this notification, please contact our support team.</p>
            </div>
            
            <div class="footer">
              <p>This is an automated notification from MediCare Healthcare.</p>
              <p>© ${new Date().getFullYear()} MediCare Healthcare. All rights reserved.</p>
            </div>
          </div>
        </body>
        </html>
      `;

      const mailOptions = {
        from: {
          name: 'MediCare Healthcare',
          address: 'pvu7999@gmail.com'
        },
        to: to,
        subject: subject,
        html: html
      };

      const info = await this.transporter.sendMail(mailOptions);
      console.log(`✅ Notification email sent! Message ID: ${info.messageId}`);
      return true;
    } catch (error) {
      console.error('Error sending notification email:', error);
      return false;
    }
  }

  // ========== UTILITY METHODS ==========

  async testConnection(): Promise<boolean> {
    try {
      await this.transporter.verify();
      logger.info('✅ Email server connection verified', { service: 'EmailService' });
      return true;
    } catch (error) {
      logger.error('❌ Email server connection failed:', { error: error instanceof Error ? error.message : String(error), service: 'EmailService' });
      return false;
    }
  }

  // Send bulk emails (for notifications, reminders, etc.)
  async sendBulkEmails(recipients: Array<{email: string, name: string}>, subject: string, html: string): Promise<Array<{email: string, success: boolean, error?: string}>> {
    const results = [];

    for (const recipient of recipients) {
      try {
        const mailOptions = {
          from: {
            name: 'MediCare Healthcare',
            address: 'pvu7999@gmail.com'
          },
          to: recipient.email,
          subject: subject,
          html: html.replace(/\{name\}/g, recipient.name)
        };

        const info = await this.transporter.sendMail(mailOptions);
        results.push({ email: recipient.email, success: true, messageId: info.messageId });
      } catch (error: any) {
        logger.error(`❌ Failed to send email to ${recipient.email}:`, { recipient: recipient.email, error: error.message });
        results.push({ email: recipient.email, success: false, error: error.message });
      }
    }

    return results;
  }
}

// Export single instance
export const emailService = new EmailService();
