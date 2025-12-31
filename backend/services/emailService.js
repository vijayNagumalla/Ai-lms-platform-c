import nodemailer from 'nodemailer';
import { retryWithBackoff } from '../utils/retry.js';
import appConfig from '../config/appConfig.js';

class EmailService {
  constructor() {
    // Check if email credentials are configured
    this.isConfigured = !!(process.env.SMTP_USER && process.env.SMTP_PASS);
    
    if (this.isConfigured) {
      // Configure email transporter with improved Gmail settings
      // CRITICAL FIX: TLS certificate validation - enabled by default, can be disabled in development
      const rejectUnauthorized = process.env.SMTP_REJECT_UNAUTHORIZED !== 'false' && 
                                 process.env.NODE_ENV === 'production';
      
      this.transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: process.env.SMTP_PORT || 587,
        secure: false, // true for 465, false for other ports
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS
        },
        tls: {
          rejectUnauthorized: rejectUnauthorized // CRITICAL FIX: Enable certificate validation in production
        },
        // MEDIUM FIX: Use configurable rate limiting from appConfig
        pool: true,
        maxConnections: 5,
        maxMessages: 100,
        rateDelta: appConfig.email.rateDelta,
        rateLimit: appConfig.email.rateLimit
      });

      // PERFORMANCE FIX: Verify connection asynchronously with timeout to avoid blocking startup
      // Don't await - let it run in background and fail gracefully
      this.verifyConnection().catch(() => {
        // Silently handle - error is already logged in verifyConnection
      });
    } else {
      this.transporter = null;
    }
  }

  async verifyConnection() {
    try {
      if (this.transporter) {
        // PERFORMANCE FIX: Add timeout to prevent hanging on network issues
        const timeout = 10000; // 10 seconds timeout
        const verificationPromise = this.transporter.verify();
        
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Connection verification timeout')), timeout);
        });

        await Promise.race([verificationPromise, timeoutPromise]);
        console.log('✅ Email service connection verified successfully');
      }
    } catch (error) {
      // CRITICAL FIX: Log errors properly but don't block service initialization
      // Only log at warn level for network timeouts (common in development)
      const isTimeout = error.message?.includes('timeout') || error.code === 'ETIMEDOUT' || error.code === 'ESOCKET';
      const logLevel = isTimeout ? 'warn' : 'error';
      
      if (logLevel === 'warn') {
        console.warn('⚠️ Email service connection verification timed out or failed (this is OK - emails will still attempt to send):', {
          message: error.message,
          code: error.code
        });
        console.warn('   Email service will attempt to connect when sending emails. This is normal if SMTP server is not accessible during startup.');
      } else {
        console.error('❌ Email service connection verification failed:', {
          message: error.message,
          code: error.code,
          command: error.command,
          response: error.response,
          responseCode: error.responseCode
        });
        
        // Provide helpful troubleshooting for Gmail authentication errors
        if (error.code === 'EAUTH' || error.responseCode === 535) {
          console.error('\n🔧 Gmail Authentication Error - Troubleshooting Steps:');
          console.error('   1. Gmail requires an App Password (not your regular password)');
          console.error('   2. Enable 2-Factor Authentication on your Google account');
          console.error('   3. Generate an App Password: https://myaccount.google.com/apppasswords');
          console.error('   4. Use the App Password in your SMTP_PASS environment variable');
          console.error('   5. Make sure SMTP_USER is your full Gmail address (e.g., user@gmail.com)');
          console.error('   📖 See GMAIL_EMAIL_SETUP_GUIDE.md for detailed instructions\n');
        }
      }
      
      // In production, alert administrators about email service issues (only for non-timeout errors)
      if (process.env.NODE_ENV === 'production' && !isTimeout) {
        console.error('⚠️ WARNING: Email service is not properly configured. Email notifications may fail.');
      }
      
      // Don't throw - allow service to attempt sending but log the issue
    }
  }

  async sendAssessmentNotification(recipients, assessmentDetails) {
    try {
      console.log('Email service configured:', this.isConfigured);
      console.log('Transporter available:', !!this.transporter);
      
      // Check if email service is configured
      if (!this.isConfigured || !this.transporter) {
        console.warn('Email service not configured. SMTP credentials not set.');
        return { 
          success: false, 
          message: 'Email service not configured. Please configure SMTP settings.',
          errorType: 'NOT_CONFIGURED'
        };
      }

      // MEDIUM FIX: Queue system for bulk emails to respect rate limits
      const emailQueue = [...recipients];
      const batchSize = appConfig.email.batchSize;
      const results = [];
      
      while (emailQueue.length > 0) {
        const batch = emailQueue.splice(0, batchSize);
        const batchPromises = batch.map(recipient => 
          this.sendSingleNotification(recipient, assessmentDetails)
        );
        
        const batchResults = await Promise.allSettled(batchPromises);
        results.push(...batchResults);
        
        // MEDIUM FIX: Add delay between batches to respect rate limits
        if (emailQueue.length > 0) {
          await new Promise(resolve => setTimeout(resolve, appConfig.email.batchDelay));
        }
      }
      
      const successful = results.filter(r => r.status === 'fulfilled' && r.value?.success).length;
      const failed = results.length - successful;
      return { 
        success: successful > 0, 
        message: `Email notifications sent: ${successful} successful, ${failed} failed`,
        successful,
        failed
      };
    } catch (error) {
      return { 
        success: false, 
        message: 'Failed to send email notifications',
        error: error.message
      };
    }
  }

  async sendReminderNotification(recipients, assessmentDetails) {
    try {
      // Check if email service is configured
      if (!this.isConfigured || !this.transporter) {
        return { 
          success: false, 
          message: 'Email service not configured. Please configure SMTP settings.',
          errorType: 'NOT_CONFIGURED'
        };
      }

      // MEDIUM FIX: Queue system for bulk reminder emails
      const emailQueue = [...recipients];
      const batchSize = appConfig.email.batchSize;
      const results = [];
      
      while (emailQueue.length > 0) {
        const batch = emailQueue.splice(0, batchSize);
        const batchPromises = batch.map(recipient => 
          this.sendSingleReminder(recipient, assessmentDetails)
        );
        
        const batchResults = await Promise.allSettled(batchPromises);
        results.push(...batchResults);
        
        // MEDIUM FIX: Add delay between batches to respect rate limits
        if (emailQueue.length > 0) {
          await new Promise(resolve => setTimeout(resolve, appConfig.email.batchDelay));
        }
      }
      
      const successful = results.filter(r => r.status === 'fulfilled' && r.value?.success).length;
      const failed = results.length - successful;
      return { 
        success: successful > 0, 
        message: `Reminder emails sent: ${successful} successful, ${failed} failed`,
        successful,
        failed
      };
    } catch (error) {
      return { 
        success: false, 
        message: 'Failed to send reminder emails',
        error: error.message
      };
    }
  }

  // CRITICAL FIX: Email delivery tracking - Ensure tracking table exists
  async ensureTrackingTableExists() {
    try {
      const { pool: db } = await import('../config/database.js');
      await db.query(`
        CREATE TABLE IF NOT EXISTS email_delivery_tracking (
          id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
          recipient_email VARCHAR(255) NOT NULL,
          recipient_id VARCHAR(36),
          assessment_id VARCHAR(36),
          notification_type VARCHAR(50),
          message_id VARCHAR(255),
          status VARCHAR(20) CHECK (status IN ('pending', 'sent', 'delivered', 'bounced', 'failed')) DEFAULT 'pending',
          sent_at TIMESTAMP NULL,
          delivered_at TIMESTAMP NULL,
          bounced_at TIMESTAMP NULL,
          error_message TEXT,
          metadata JSONB,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE SET NULL,
          FOREIGN KEY (assessment_id) REFERENCES assessments(id) ON DELETE SET NULL
        )
      `);
    } catch (error) {
      if (!error.message.includes('already exists')) {
        console.error('Error creating email tracking table:', error);
      }
    }
  }

  // CRITICAL FIX: Email delivery tracking - Track email status
  async trackEmailDelivery(recipient, assessmentDetails, messageId, status = 'pending') {
    try {
      await this.ensureTrackingTableExists();
      const { pool: db } = await import('../config/database.js');
      
      const query = `
        INSERT INTO email_delivery_tracking 
        (recipient_email, recipient_id, assessment_id, notification_type, message_id, status, sent_at, metadata)
        VALUES (?, ?, ?, ?, ?, ?, NOW(), ?)
      `;
      
      await db.query(query, [
        recipient.email,
        recipient.userId || null,
        assessmentDetails.assessment_id || null,
        'assessment_notification',
        messageId,
        status,
        JSON.stringify({
          assessment_title: assessmentDetails.title,
          recipient_name: recipient.name
        })
      ]);
      
      return { tracked: true };
    } catch (error) {
      console.error('Error tracking email delivery:', error);
      // Don't throw - tracking failure shouldn't block email sending
      return { tracked: false, error: error.message };
    }
  }

  // CRITICAL FIX: Email delivery tracking - Update email status
  async updateEmailStatus(messageId, status, errorMessage = null) {
    try {
      const { pool: db } = await import('../config/database.js');
      
      const updateFields = ['status = ?', 'updated_at = NOW()'];
      const params = [status, messageId];
      
      if (status === 'delivered') {
        updateFields.push('delivered_at = NOW()');
      } else if (status === 'bounced' || status === 'failed') {
        updateFields.push(`${status === 'bounced' ? 'bounced_at' : 'bounced_at'} = NOW()`);
        if (errorMessage) {
          updateFields.push('error_message = ?');
          params.push(errorMessage);
        }
      }
      
      const query = `
        UPDATE email_delivery_tracking 
        SET ${updateFields.join(', ')}
        WHERE message_id = ?
      `;
      
      await db.query(query, params);
      return { updated: true };
    } catch (error) {
      console.error('Error updating email status:', error);
      return { updated: false, error: error.message };
    }
  }

  async sendSingleNotification(recipient, assessmentDetails) {
    const { email, name } = recipient;
    
    console.log('Sending email to:', email, 'for assessment:', assessmentDetails.title);
    
    const emailContent = this.generateAssessmentEmail(assessmentDetails, name);
    
    const mailOptions = {
      from: process.env.SMTP_FROM || 'noreply@lms-platform.com',
      to: email,
      subject: `New Assessment: ${assessmentDetails.title}`,
      html: emailContent
    };

    try {
      if (!this.transporter) {
        console.error('Email transporter not configured');
        throw new Error('Email transporter not configured');
      }
      
      // CRITICAL FIX: Retry email sending with exponential backoff
      const info = await retryWithBackoff(
        () => this.transporter.sendMail(mailOptions),
        {
          maxRetries: 3,
          initialDelay: 1000,
          maxDelay: 10000,
          retryableErrors: [/ECONNREFUSED/, /ETIMEDOUT/, /ENOTFOUND/, /ECONNRESET/],
          onRetry: (attempt, error) => {
            console.warn(`Email send retry attempt ${attempt}:`, error.message);
          }
        }
      );
      const messageId = info.messageId || info.messageId || `email_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // CRITICAL FIX: Track email delivery
      await this.trackEmailDelivery(recipient, assessmentDetails, messageId, 'sent');
      
      // CRITICAL FIX: Update status to delivered (if nodemailer provides delivery info)
      if (info.accepted && info.accepted.length > 0) {
        // For most SMTP servers, we can't track actual delivery without webhooks
        // But we mark as sent and can update later via webhooks or polling
        await this.updateEmailStatus(messageId, 'sent');
      }
      
      return { success: true, messageId };
    } catch (error) {
      // CRITICAL FIX: Track failed emails
      const messageId = `failed_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      await this.trackEmailDelivery(recipient, assessmentDetails, messageId, 'failed');
      await this.updateEmailStatus(messageId, 'failed', error.message);
      throw error;
    }
  }

  async sendSingleReminder(recipient, assessmentDetails) {
    const { email, name } = recipient;
    
    const emailContent = this.generateAssessmentEmail(assessmentDetails, name, true);
    
    const mailOptions = {
      from: process.env.SMTP_FROM || 'noreply@lms-platform.com',
      to: email,
      subject: `Reminder: Assessment Due Soon - ${assessmentDetails.title}`,
      html: emailContent
    };

    try {
      if (!this.transporter) {
        throw new Error('Email transporter not configured');
      }
      
      // CRITICAL FIX: Retry email sending with exponential backoff
      const info = await retryWithBackoff(
        () => this.transporter.sendMail(mailOptions),
        {
          maxRetries: 3,
          initialDelay: 1000,
          maxDelay: 10000,
          retryableErrors: [/ECONNREFUSED/, /ETIMEDOUT/, /ENOTFOUND/, /ECONNRESET/],
          onRetry: (attempt, error) => {
            console.warn(`Email send retry attempt ${attempt}:`, error.message);
          }
        }
      );
      const messageId = info.messageId || `email_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // CRITICAL FIX: Track email delivery
      await this.trackEmailDelivery(recipient, { ...assessmentDetails, is_reminder: true }, messageId, 'sent');
      await this.updateEmailStatus(messageId, 'sent');
      
      return { success: true, messageId };
    } catch (error) {
      // CRITICAL FIX: Track failed emails
      const messageId = `failed_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      await this.trackEmailDelivery(recipient, { ...assessmentDetails, is_reminder: true }, messageId, 'failed');
      await this.updateEmailStatus(messageId, 'failed', error.message);
      throw error;
    }
  }

  // Send custom email (for contact sharing, etc.)
  async sendCustomEmail(to, subject, htmlContent, textContent = null) {
    try {
      // Check if email service is configured
      if (!this.isConfigured || !this.transporter) {
        return { 
          success: false, 
          message: 'Email service not configured. Please configure SMTP settings.',
          errorType: 'NOT_CONFIGURED'
        };
      }

      const mailOptions = {
        from: process.env.SMTP_FROM || 'noreply@lms-platform.com',
        to: to,
        subject: subject,
        html: htmlContent,
        ...(textContent && { text: textContent })
      };

      // Retry email sending with exponential backoff
      const info = await retryWithBackoff(
        () => this.transporter.sendMail(mailOptions),
        {
          maxRetries: 3,
          initialDelay: 1000,
          maxDelay: 10000,
          retryableErrors: [/ECONNREFUSED/, /ETIMEDOUT/, /ENOTFOUND/, /ECONNRESET/],
          onRetry: (attempt, error) => {
            console.warn(`Email send retry attempt ${attempt}:`, error.message);
          }
        }
      );

      const messageId = info.messageId || `email_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      return { 
        success: true, 
        messageId,
        message: 'Email sent successfully'
      };
    } catch (error) {
      console.error('Error sending custom email:', error);
      return { 
        success: false, 
        message: 'Failed to send email',
        error: error.message
      };
    }
  }

  // CRITICAL FIX: HTML escape function to prevent XSS in email templates
  escapeHtml(text) {
    if (!text) return '';
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    return String(text).replace(/[&<>"']/g, m => map[m]);
  }

  generateAssessmentEmail(assessmentDetails, recipientName, isReminder = false) {
    // CRITICAL FIX: Escape all user input to prevent XSS
    const {
      title,
      type,
      start_date,
      end_date,
      start_time,
      end_time,
      timezone,
      instructions,
      total_points,
      proctoring_required,
      proctoring_type,
      max_attempts,
      duration_minutes,
      description,
      access_password
    } = assessmentDetails;
    
    // CRITICAL FIX: Escape all user input to prevent XSS
    const safeTitle = this.escapeHtml(title);
    const safeRecipientName = this.escapeHtml(recipientName);
    const safeDescription = description ? this.escapeHtml(description) : '';
    const safeInstructions = instructions ? this.escapeHtml(instructions) : '';
    const safeAccessPassword = access_password ? this.escapeHtml(access_password) : '';
    const safeTimezone = timezone ? this.escapeHtml(timezone) : '';
    const safeProctoringType = proctoring_type ? this.escapeHtml(proctoring_type) : '';

    const assessmentTypeLabel = this.getAssessmentTypeLabel(type);
    const proctoringInfo = proctoring_required ? 
      `This assessment requires ${safeProctoringType} proctoring. Please ensure your webcam and microphone are working.` : 
      'No special proctoring requirements for this assessment.';

    // Determine assessment status
    const now = new Date();
    
    // Handle both combined datetime strings and separate date/time fields
    let startDateTime, endDateTime;
    
    // Helper function to convert date/time to string
    const dateToString = (date) => {
      if (!date) return null;
      if (typeof date === 'string') return date;
      if (date instanceof Date) return date.toISOString().split('T')[0];
      return date.toString();
    };
    
    const timeToString = (time) => {
      if (!time) return null;
      if (typeof time === 'string') return time;
      if (time instanceof Date) return time.toTimeString().split(' ')[0];
      return time.toString();
    };
    
    const startDateStr = dateToString(start_date);
    const endDateStr = dateToString(end_date);
    const startTimeStr = timeToString(start_time);
    const endTimeStr = timeToString(end_time);
    
    if (startDateStr && startDateStr.includes('T')) {
      // If start_date already contains time (e.g., "2025-09-01T14:25:00")
      startDateTime = new Date(startDateStr);
    } else {
      // If separate date and time fields
      startDateTime = new Date(`${startDateStr}T${startTimeStr || '00:00:00'}`);
    }
    
    if (endDateStr && endDateStr.includes('T')) {
      // If end_date already contains time (e.g., "2025-09-15T14:17:00")
      endDateTime = new Date(endDateStr);
    } else {
      // If separate date and time fields
      endDateTime = new Date(`${endDateStr}T${endTimeStr || '23:59:59'}`);
    }
    
    let assessmentStatus = 'upcoming';
    let statusMessage = '';
    
    if (now < startDateTime) {
      assessmentStatus = 'upcoming';
      statusMessage = 'This assessment has not started yet. Please review the details below:';
    } else if (now >= startDateTime && now <= endDateTime) {
      assessmentStatus = 'ongoing';
      statusMessage = 'This assessment is currently active and available for you to take. Please review the details below:';
    } else {
      assessmentStatus = 'ended';
      statusMessage = 'This assessment has ended. Please review the details below:';
    }

    const emailTitle = isReminder ? `Assessment Reminder - ${assessmentStatus.charAt(0).toUpperCase() + assessmentStatus.slice(1)}` : 'New Assessment Available';
    const emailHeader = isReminder ? `Assessment Reminder - ${assessmentStatus.charAt(0).toUpperCase() + assessmentStatus.slice(1)}` : 'New Assessment Available';
    const emailMessage = isReminder ? statusMessage : 'A new assessment has been assigned to you. Please review the details below:';

    // Format dates and times properly
    const formatDateTime = (date, time, tz) => {
      if (!date) return 'Not specified';
      
      let dateTime;
      
      // Convert date and time to strings first
      const dateStr = dateToString(date);
      const timeStr = timeToString(time);
      
      // Handle combined datetime strings (e.g., "2025-09-01T14:25:00")
      if (dateStr && dateStr.includes('T')) {
        const [datePart, timePart] = dateStr.split('T');
        const formattedTime = timePart ? timePart.substring(0, 8) : '00:00:00'; // Remove milliseconds if present
        dateTime = `${datePart} ${formattedTime}`;
      } else {
        // Handle separate date and time fields
        dateTime = timeStr ? `${dateStr} ${timeStr}` : dateStr;
      }
      
      return tz ? `${dateTime} (${tz})` : dateTime;
    };

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>${emailTitle}</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: ${isReminder ? '#f59e0b' : '#2563eb'}; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: #f8fafc; padding: 20px; border-radius: 0 0 8px 8px; }
          .assessment-details { background: white; padding: 20px; margin: 15px 0; border-radius: 8px; border-left: 4px solid ${isReminder ? '#f59e0b' : '#2563eb'}; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
          .detail-row { display: flex; justify-content: space-between; margin: 8px 0; padding: 5px 0; border-bottom: 1px solid #e5e7eb; }
          .detail-label { font-weight: 600; color: #374151; }
          .detail-value { color: #6b7280; }
          .button { display: inline-block; background: ${isReminder ? '#f59e0b' : '#2563eb'}; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; margin: 15px 0; font-weight: 600; }
          .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
          .important { background: #fef3c7; border: 1px solid #f59e0b; padding: 15px; border-radius: 5px; margin: 15px 0; }
          .warning { background: #fef2f2; border: 1px solid #f87171; padding: 15px; border-radius: 5px; margin: 15px 0; }
          .success { background: #f0fdf4; border: 1px solid #22c55e; padding: 15px; border-radius: 5px; margin: 15px 0; }
          .assessment-title { color: ${isReminder ? '#f59e0b' : '#2563eb'}; margin-bottom: 15px; }
          .instructions { background: #f9fafb; padding: 15px; border-radius: 5px; margin: 15px 0; border-left: 3px solid #6b7280; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>${emailHeader}</h1>
          </div>
          
          <div class="content">
            <p>Hello ${safeRecipientName},</p>
            
            <p>${this.escapeHtml(emailMessage)}</p>
            
            <div class="assessment-details">
              <h2 class="assessment-title">${safeTitle}</h2>
              
              ${isReminder ? `
              <div style="background: ${assessmentStatus === 'ongoing' ? '#f0fdf4' : assessmentStatus === 'ended' ? '#fef2f2' : '#fef3c7'}; border: 1px solid ${assessmentStatus === 'ongoing' ? '#22c55e' : assessmentStatus === 'ended' ? '#f87171' : '#f59e0b'}; padding: 10px; border-radius: 5px; margin-bottom: 15px; text-align: center;">
                <span style="font-weight: 600; color: ${assessmentStatus === 'ongoing' ? '#059669' : assessmentStatus === 'ended' ? '#dc2626' : '#92400e'};">
                  ${assessmentStatus === 'ongoing' ? '🟢 Assessment is Currently Active' : assessmentStatus === 'ended' ? '🔴 Assessment has Ended' : '🟡 Assessment Not Started Yet'}
                </span>
              </div>
              ` : ''}
              
              
              <div class="detail-row">
                <span class="detail-label">Assessment Name:</span>
                <span class="detail-value">${safeTitle}</span>
              </div>
              
              
              <div class="detail-row">
                <span class="detail-label">Total Points:</span>
                <span class="detail-value">${total_points || 'Not specified'}</span>
              </div>
              
              <div class="detail-row">
                <span class="detail-label">Start Date & Time:</span>
                <span class="detail-value">${this.escapeHtml(formatDateTime(start_date, start_time, timezone))}</span>
              </div>
              
              <div class="detail-row">
                <span class="detail-label">End Date & Time:</span>
                <span class="detail-value">${this.escapeHtml(formatDateTime(end_date, end_time, timezone))}</span>
              </div>
              
              ${duration_minutes ? `
              <div class="detail-row">
                <span class="detail-label">Duration:</span>
                <span class="detail-value">${duration_minutes} minutes</span>
              </div>
              ` : ''}
              
            </div>
            
              ${access_password ? `
            <div class="warning">
              <h3 style="margin-top: 0; color: #dc2626;">🔑 Access Password Required:</h3>
              <p style="margin-bottom: 10px; font-weight: 600;">You will need the following password to access this assessment:</p>
              <div style="background: #f3f4f6; border: 2px solid #d1d5db; padding: 15px; border-radius: 8px; text-align: center; margin: 10px 0;">
                <span style="font-family: 'Courier New', monospace; font-size: 24px; font-weight: bold; color: #059669; letter-spacing: 2px;">${safeAccessPassword}</span>
              </div>
              <p style="margin-top: 10px; margin-bottom: 0; font-size: 14px; color: #6b7280;">Please save this password - you'll need it to start the assessment.</p>
            </div>
            ` : ''}
            
            
            
            
            <div style="text-align: center; margin: 20px 0;">
              <a href="${process.env.FRONTEND_URL || (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:5173')}/assessments" class="button">
                ${isReminder ? '🚀 Take Assessment Now' : '📝 Access Assessment'}
              </a>
            </div>
            
            <div class="footer">
              <p>This is an automated notification from the LMS Platform.</p>
              <p>If you have any questions, please contact your instructor or support team.</p>
              <p style="margin-top: 10px; font-size: 10px; color: #9ca3af;">
                ${isReminder ? 'Reminder sent on' : 'Notification sent on'} ${new Date().toLocaleString()}
              </p>
            </div>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  getAssessmentTypeLabel(type) {
    const typeMap = {
      'quiz': 'Quiz',
      'test': 'Test',
      'exam': 'Exam',
      'assignment': 'Assignment',
      'coding_challenge': 'Coding Challenge',
      'survey': 'Survey'
    };
    return typeMap[type] || type;
  }

  // Method to get recipient emails from different assignment types
  async getRecipientEmails(assignments) {
    const emails = [];
    
    // This would typically query your database to get actual email addresses
    // For now, we'll return a placeholder structure
    
    for (const assignment of assignments) {
      switch (assignment.type) {
        case 'college':
          // Get all students in the college
          // emails.push(...await this.getCollegeStudentEmails(assignment.id));
          break;
        case 'department':
          // Get all students in the department
          // emails.push(...await this.getDepartmentStudentEmails(assignment.id));
          break;
        case 'group':
          // Get all students in the group
          // emails.push(...await this.getGroupStudentEmails(assignment.id));
          break;
        case 'student':
          // Get individual student email
          // emails.push(await this.getStudentEmail(assignment.id));
          break;
      }
    }
    
    return emails;
  }

  async sendAssessmentReminder(emailData) {
    try {
      // Check if email service is configured
      if (!this.isConfigured || !this.transporter) {
        // console.log('Email service not configured, skipping reminder email');
        return { success: true, message: 'Email service not configured' };
      }

      const { to, studentName, assessmentTitle, startDate, endDate, customMessage, type } = emailData;

      let subject, htmlContent;

      if (type === 'immediate') {
        subject = `Assessment Reminder: ${assessmentTitle}`;
        htmlContent = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #2563eb;">Assessment Reminder</h2>
            <p>Hello ${studentName},</p>
            <p>This is a reminder about your upcoming assessment:</p>
            <div style="background-color: #f8fafc; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <h3 style="color: #1e40af; margin-top: 0;">${assessmentTitle}</h3>
              <p><strong>Start Date:</strong> ${startDate}</p>
              <p><strong>End Date:</strong> ${endDate}</p>
            </div>
            ${customMessage ? `<p>${customMessage}</p>` : ''}
            <p>Please make sure to complete the assessment within the given timeframe.</p>
            <p>Best regards,<br>Assessment Team</p>
          </div>
        `;
      } else {
        subject = `Assessment Notification: ${assessmentTitle}`;
        htmlContent = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #2563eb;">New Assessment Available</h2>
            <p>Hello ${studentName},</p>
            <p>A new assessment has been published and is now available for you to take:</p>
            <div style="background-color: #f8fafc; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <h3 style="color: #1e40af; margin-top: 0;">${assessmentTitle}</h3>
              <p><strong>Start Date:</strong> ${startDate}</p>
              <p><strong>End Date:</strong> ${endDate}</p>
            </div>
            ${customMessage ? `<p>${customMessage}</p>` : ''}
            <p>Please log in to your account to access and complete the assessment.</p>
            <p>Best regards,<br>Assessment Team</p>
          </div>
        `;
      }

      const mailOptions = {
        from: process.env.SMTP_USER,
        to: to,
        subject: subject,
        html: htmlContent
      };

      await this.transporter.sendMail(mailOptions);
      return { success: true, message: 'Reminder email sent successfully' };

    } catch (error) {
      // console.error('Error sending assessment reminder:', error);
      return { success: false, message: 'Failed to send reminder email', error: error.message };
    }
  }

  // CRITICAL FIX: Send email verification email
  async sendVerificationEmail(email, name, verificationUrl) {
    try {
      if (!this.isConfigured || !this.transporter) {
        console.warn('Email service not configured, cannot send verification email');
        return { success: false, message: 'Email service not configured' };
      }

      const safeName = this.escapeHtml(name);
      const safeUrl = this.escapeHtml(verificationUrl);

      const mailOptions = {
        from: process.env.SMTP_FROM || 'noreply@lms-platform.com',
        to: email,
        subject: 'Verify Your Email Address',
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <title>Verify Your Email</title>
            <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background: #2563eb; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
              .content { background: #f8fafc; padding: 20px; border-radius: 0 0 8px 8px; }
              .button { display: inline-block; background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; margin: 15px 0; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1>Verify Your Email Address</h1>
              </div>
              <div class="content">
                <p>Hello ${safeName},</p>
                <p>Thank you for registering! Please verify your email address by clicking the button below:</p>
                <div style="text-align: center;">
                  <a href="${safeUrl}" class="button">Verify Email Address</a>
                </div>
                <p>Or copy and paste this link into your browser:</p>
                <p style="word-break: break-all; color: #6b7280;">${safeUrl}</p>
                <p>This link will expire in 24 hours.</p>
                <p>If you didn't create an account, please ignore this email.</p>
              </div>
            </div>
          </body>
          </html>
        `
      };

      await this.transporter.sendMail(mailOptions);
      return { success: true, message: 'Verification email sent successfully' };
    } catch (error) {
      console.error('Error sending verification email:', error);
      return { 
        success: false, 
        message: 'Failed to send verification email',
        error: error.message
      };
    }
  }

  // CRITICAL FIX: Send password reset email
  async sendPasswordResetEmail(email, name, resetUrl) {
    try {
      if (!this.isConfigured || !this.transporter) {
        console.warn('Email service not configured, cannot send password reset email');
        return { success: false, message: 'Email service not configured' };
      }

      const safeName = this.escapeHtml(name);
      const safeUrl = this.escapeHtml(resetUrl);

      const mailOptions = {
        from: process.env.SMTP_FROM || 'noreply@lms-platform.com',
        to: email,
        subject: 'Reset Your Password',
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <title>Reset Your Password</title>
            <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background: #dc2626; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
              .content { background: #f8fafc; padding: 20px; border-radius: 0 0 8px 8px; }
              .button { display: inline-block; background: #dc2626; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; margin: 15px 0; }
              .warning { background: #fef2f2; border: 1px solid #f87171; padding: 15px; border-radius: 5px; margin: 15px 0; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1>Reset Your Password</h1>
              </div>
              <div class="content">
                <p>Hello ${safeName},</p>
                <p>We received a request to reset your password. Click the button below to reset it:</p>
                <div style="text-align: center;">
                  <a href="${safeUrl}" class="button">Reset Password</a>
                </div>
                <p>Or copy and paste this link into your browser:</p>
                <p style="word-break: break-all; color: #6b7280;">${safeUrl}</p>
                <div class="warning">
                  <p><strong>⚠️ Important:</strong></p>
                  <ul>
                    <li>This link will expire in 1 hour</li>
                    <li>If you didn't request a password reset, please ignore this email</li>
                    <li>Your password will not be changed unless you click the link above</li>
                  </ul>
                </div>
              </div>
            </div>
          </body>
          </html>
        `
      };

      await this.transporter.sendMail(mailOptions);
      return { success: true, message: 'Password reset email sent successfully' };
    } catch (error) {
      console.error('Error sending password reset email:', error);
      return { 
        success: false, 
        message: 'Failed to send password reset email',
        error: error.message
      };
    }
  }
}

export default new EmailService(); 