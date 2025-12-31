import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { checkEmailConfiguration, testEmailService, sendContactEmail } from '../controllers/emailController.js';

const router = express.Router();

// Check email configuration (Admin only)
router.get('/config', authenticateToken, checkEmailConfiguration);

// Test email service (Admin only)
router.post('/test', authenticateToken, testEmailService);

// Send contact information via email (Authenticated users)
router.post('/send-contact', authenticateToken, sendContactEmail);

export default router; 