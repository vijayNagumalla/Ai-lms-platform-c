import emailService from '../services/emailService.js';

// Check email service configuration
export const checkEmailConfiguration = async (req, res) => {
  try {
    const isConfigured = emailService.isConfigured;
    const hasTransporter = !!emailService.transporter;
    
    res.json({
      success: true,
      data: {
        isConfigured,
        hasTransporter,
        smtpHost: process.env.SMTP_HOST || 'smtp.gmail.com',
        smtpPort: process.env.SMTP_PORT || 587,
        smtpUser: process.env.SMTP_USER ? 'Configured' : 'Not configured',
        smtpPass: process.env.SMTP_PASS ? 'Configured' : 'Not configured',
        smtpFrom: process.env.SMTP_FROM || 'noreply@lms-platform.com'
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to check email configuration'
    });
  }
};

// Test email service
export const testEmailService = async (req, res) => {
  try {
    const { testEmail } = req.body;
    
    if (!testEmail) {
      return res.status(400).json({
        success: false,
        message: 'Test email address is required'
      });
    }
    
    if (!emailService.isConfigured) {
      return res.status(400).json({
        success: false,
        message: 'Email service is not configured. Please set SMTP_USER and SMTP_PASS environment variables.'
      });
    }
    
    // Send a test email
    const testResult = await emailService.sendAssessmentNotification(
      [{ email: testEmail, name: 'Test User' }],
      {
        title: 'Test Assessment',
        type: 'test',
        start_date: new Date().toISOString(),
        end_date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        instructions: 'This is a test email to verify email service configuration.',
        total_points: 100
      }
    );
    
    if (testResult.success) {
      res.json({
        success: true,
        message: 'Test email sent successfully'
      });
    } else {
      res.status(500).json({
        success: false,
        message: testResult.message
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to test email service'
    });
  }
};

// Send contact information via email
export const sendContactEmail = async (req, res) => {
  try {
    const { recipientEmail, contactInfo } = req.body;
    
    if (!recipientEmail) {
      return res.status(400).json({
        success: false,
        message: 'Recipient email address is required'
      });
    }
    
    if (!contactInfo || !contactInfo.name) {
      return res.status(400).json({
        success: false,
        message: 'Contact information is required'
      });
    }
    
    if (!emailService.isConfigured) {
      return res.status(400).json({
        success: false,
        message: 'Email service is not configured. Please set SMTP_USER and SMTP_PASS environment variables.'
      });
    }
    
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(recipientEmail)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid email address format'
      });
    }
    
    // Generate email content
    const subject = `Contact Information - ${contactInfo.name}`;
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #4F46E5; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
          .content { background-color: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
          .contact-card { background-color: white; padding: 20px; border-radius: 8px; margin: 20px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
          .contact-item { margin: 10px 0; padding: 10px; background-color: #f3f4f6; border-radius: 4px; }
          .contact-label { font-weight: bold; color: #4F46E5; }
          .footer { text-align: center; margin-top: 20px; color: #6b7280; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h2>Contact Information</h2>
          </div>
          <div class="content">
            <p>Hi,</p>
            <p>Here's the contact information you requested:</p>
            
            <div class="contact-card">
              <div class="contact-item">
                <span class="contact-label">Name:</span> ${contactInfo.name}
              </div>
              ${contactInfo.phone ? `
              <div class="contact-item">
                <span class="contact-label">Phone:</span> ${contactInfo.phone}
              </div>
              ` : ''}
              ${contactInfo.email ? `
              <div class="contact-item">
                <span class="contact-label">Email:</span> <a href="mailto:${contactInfo.email}">${contactInfo.email}</a>
              </div>
              ` : ''}
              ${contactInfo.designation ? `
              <div class="contact-item">
                <span class="contact-label">Designation:</span> ${contactInfo.designation}
              </div>
              ` : ''}
            </div>
            
            <p>Best regards,<br>LMS Platform</p>
          </div>
          <div class="footer">
            <p>This email was sent from the LMS Platform</p>
          </div>
        </div>
      </body>
      </html>
    `;
    
    const textContent = `Hi,\n\nHere's the contact information for ${contactInfo.name}:\n\nName: ${contactInfo.name}\n${contactInfo.phone ? `Phone: ${contactInfo.phone}\n` : ''}${contactInfo.email ? `Email: ${contactInfo.email}\n` : ''}${contactInfo.designation ? `Designation: ${contactInfo.designation}\n` : ''}\n\nBest regards,\nLMS Platform`;
    
    // Send email
    const result = await emailService.sendCustomEmail(recipientEmail, subject, htmlContent, textContent);
    
    if (result.success) {
      res.json({
        success: true,
        message: 'Email sent successfully'
      });
    } else {
      res.status(500).json({
        success: false,
        message: result.message || 'Failed to send email'
      });
    }
  } catch (error) {
    console.error('Error sending contact email:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send contact email',
      error: error.message
    });
  }
}; 