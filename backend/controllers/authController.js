import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { pool } from '../config/database.js';

const isSupabase = !!process.env.SUPABASE_URL;

// Cache for table existence checks to avoid repeated database queries
const tableCheckCache = {
  emailVerification: false,
  passwordReset: false,
  loginAttempts: false
};

// Generate JWT token
const generateToken = (userId) => {
  return jwt.sign(
    { userId },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
};

// Register new user
export const register = async (req, res) => {
  try {
    const { email, password, name, role, college_id, department, student_id, phone, country } = req.body;

    // Validate required fields
    if (!email || !password || !name || !role) {
      return res.status(400).json({
        success: false,
        message: 'Email, password, name, and role are required'
      });
    }

    // Enhanced password validation (CRITICAL SECURITY FIX)
    if (password.trim().length < 8) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 8 characters long'
      });
    }

    // Password complexity requirements
    const hasUpperCase = /[A-Z]/.test(password);
    const hasLowerCase = /[a-z]/.test(password);
    const hasNumber = /[0-9]/.test(password);
    const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(password);

    if (!hasUpperCase || !hasLowerCase || !hasNumber || !hasSpecialChar) {
      return res.status(400).json({
        success: false,
        message: 'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character'
      });
    }

    // Validate role
    const validRoles = ['student', 'faculty', 'college-admin', 'super-admin'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid role specified'
      });
    }

    // Check if super admin registration is allowed
    if (role === 'super-admin') {
      // Check if there are any existing super admins
      const [existingSuperAdmins] = await pool.execute(
        'SELECT COUNT(*) as count FROM users WHERE role = ? AND is_active = true',
        ['super-admin']
      );

      // CRITICAL FIX: If super admins already exist, require a special registration code
      if (existingSuperAdmins[0].count > 0) {
        const { registrationCode } = req.body;
        // CRITICAL FIX: Require code to be set in environment, never use defaults
        const expectedCode = process.env.SUPER_ADMIN_REGISTRATION_CODE;

        if (!expectedCode) {
          return res.status(403).json({
            success: false,
            message: 'Super admin registration is disabled. SUPER_ADMIN_REGISTRATION_CODE must be set in environment variables.'
          });
        }

        if (!registrationCode || registrationCode !== expectedCode) {
          return res.status(403).json({
            success: false,
            message: 'Super admin registration requires a valid registration code'
          });
        }
      }
    }

    // Check if user already exists
    const [existingUsers] = await pool.execute(
      'SELECT id FROM users WHERE email = ?',
      [email]
    );

    if (existingUsers.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'User with this email already exists'
      });
    }

    // Hash password
    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // CRITICAL FIX: Ensure email_verification_tokens table exists
    await ensureEmailVerificationTable();

    // Create user with email_verified = false and is_active = false (will be activated after verification)
    const userId = uuidv4();
    const [result] = await pool.execute(
      `INSERT INTO users (id, email, password, name, role, college_id, department, student_id, phone, country, is_active, email_verified) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, false, false)`,
      [userId, email, hashedPassword, name, role, college_id || null, department || null, student_id || null, phone || null, country || null]
    );

    // CRITICAL FIX: Generate and send email verification token
    const verificationToken = uuidv4();
    const tokenExpiry = new Date();
    tokenExpiry.setHours(tokenExpiry.getHours() + 24); // 24 hour expiry

    await pool.execute(
      'INSERT INTO email_verification_tokens (user_id, token, expires_at) VALUES (?, ?, ?)',
      [userId, verificationToken, tokenExpiry]
    );

    // CRITICAL FIX: Send verification email
    let emailSent = false;
    let autoVerified = false;

    try {
      const emailService = (await import('../services/emailService.js')).default;

      // In development mode, if email service is not configured, auto-verify the user
      if (process.env.NODE_ENV === 'development' && !emailService.isConfigured) {
        console.log(`⚠️  Development mode: Email service not configured. Auto-verifying user ${userId}`);
        await pool.execute(
          'UPDATE users SET email_verified = true, is_active = true WHERE id = ?',
          [userId]
        );
        autoVerified = true;
      } else {
        // Try to send verification email
        const frontendUrl = process.env.FRONTEND_URL || (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:5173');
        if (!frontendUrl) {
          throw new Error('FRONTEND_URL environment variable is required in production');
        }
        const verificationUrl = `${frontendUrl}/verify-email?token=${verificationToken}`;
        const emailResult = await emailService.sendVerificationEmail(email, name, verificationUrl);
        emailSent = emailResult.success !== false;
      }
    } catch (emailError) {
      console.error('Error sending verification email:', emailError);
      // In development, auto-verify if email fails
      if (process.env.NODE_ENV === 'development') {
        console.log(`⚠️  Development mode: Email sending failed. Auto-verifying user ${userId}`);
        await pool.execute(
          'UPDATE users SET email_verified = true, is_active = true WHERE id = ?',
          [userId]
        );
        autoVerified = true;
      }
    }

    // Get created user (without password)
    const [users] = await pool.execute(
      'SELECT id, email, name, role, college_id, department, student_id, phone, avatar_url, country, is_active, email_verified, created_at FROM users WHERE id = ?',
      [userId]
    );

    const user = users[0];
    // CRITICAL FIX: Generate token
    const token = generateToken(user.id);

    res.status(201).json({
      success: true,
      message: autoVerified
        ? 'User registered successfully. Email auto-verified in development mode.'
        : emailSent
          ? 'User registered successfully. Please check your email to verify your account.'
          : 'User registered successfully. Please verify your email address.',
      data: {
        user,
        token,
        emailVerificationRequired: !autoVerified && !emailSent
      }
    });
  } catch (error) {
    // Registration error
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Login user
export const login = async (req, res) => {
  // Ensure JSON response header is set immediately
  if (!res.headersSent) {
    res.setHeader('Content-Type', 'application/json');
  }
  
  try {
    const { email, password } = req.body;

    // Validate required fields
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required'
      });
    }

    // CRITICAL FIX: Ensure login_attempts table exists
    try {
      await ensureLoginAttemptsTable();
    } catch (tableError) {
      console.error('[Login] Error ensuring login_attempts table:', tableError);
      // Continue anyway - table might already exist
    }

    // OPTIMIZATION: Add LIMIT 1 and ensure email column is indexed
    // Find user by email (optimized query)
    let users;
    try {
      const result = await pool.execute(
        'SELECT id, email, password, name, role, college_id, department, student_id, phone, avatar_url, country, is_active, email_verified FROM users WHERE email = ? LIMIT 1',
        [email]
      );
      // Handle [rows, fields] format
      users = Array.isArray(result) && result.length > 0 ? result[0] : [];
    } catch (dbError) {
      console.error('[Login] Database error fetching user:', dbError);
      throw new Error('Database connection error');
    }

    if (users.length === 0) {
      // CRITICAL FIX: Track failed login attempt even if user doesn't exist (prevent user enumeration)
      await recordFailedLoginAttempt(email, req.ip);
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    const user = users[0];

    // CRITICAL FIX: Check if email is verified
    // In development mode, auto-verify if email service is not configured
    if (!user.email_verified) {
      if (process.env.NODE_ENV === 'development') {
        try {
          const emailService = (await import('../services/emailService.js')).default;
          if (!emailService.isConfigured) {
            console.log(`⚠️  Development mode: Auto-verifying email for user ${user.id}`);
            await pool.execute(
              'UPDATE users SET email_verified = true, is_active = true WHERE id = ?',
              [user.id]
            );
            user.email_verified = true;
            user.is_active = true;
          } else {
            return res.status(403).json({
              success: false,
              message: 'Please verify your email address before logging in. Check your inbox for the verification link.',
              requiresEmailVerification: true
            });
          }
        } catch (error) {
          console.error('Error auto-verifying email:', error);
          return res.status(403).json({
            success: false,
            message: 'Please verify your email address before logging in. Check your inbox for the verification link.',
            requiresEmailVerification: true
          });
        }
      } else {
        return res.status(403).json({
          success: false,
          message: 'Please verify your email address before logging in. Check your inbox for the verification link.',
          requiresEmailVerification: true
        });
      }
    }

    // CRITICAL FIX: Check account lockout before password verification
    const lockoutInfo = await checkAccountLockout(user.id);
    if (lockoutInfo.isLocked) {
      return res.status(423).json({
        success: false,
        message: `Account temporarily locked due to too many failed login attempts. Please try again after ${lockoutInfo.unlockAfterMinutes} minutes.`,
        lockedUntil: lockoutInfo.lockedUntil
      });
    }

    // Check if user is active
    if (!user.is_active) {
      return res.status(401).json({
        success: false,
        message: 'Account is deactivated'
      });
    }

    // Verify password - CRITICAL SECURITY FIX: Auto-migrate plain text passwords
    let isPasswordValid = false;
    let needsPasswordMigration = false;

    if (user.password.startsWith('$2')) {
      // Password is hashed, use bcrypt compare
      isPasswordValid = await bcrypt.compare(password, user.password);
    } else {
      // Legacy plain text passwords - auto-migrate on successful login
      console.warn(`Security: User ${user.id} has plain text password - auto-migrating to hashed`);

      // Check if plain text password matches
      if (user.password === password) {
        isPasswordValid = true;
        needsPasswordMigration = true;
      } else {
        // Password doesn't match, treat as failed login
        isPasswordValid = false;
      }
    }

    if (!isPasswordValid) {
      // CRITICAL FIX: Record failed login attempt
      await recordFailedLoginAttempt(email, req.ip, user.id);

      // Check if account should be locked after this attempt
      const lockoutInfo = await checkAccountLockout(user.id);
      if (lockoutInfo.shouldLock) {
        await lockAccount(user.id, lockoutInfo.lockoutMinutes);
        return res.status(423).json({
          success: false,
          message: `Account locked due to too many failed login attempts. Please try again after ${lockoutInfo.lockoutMinutes} minutes.`,
          lockedUntil: lockoutInfo.lockedUntil
        });
      }

      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
        remainingAttempts: lockoutInfo.remainingAttempts || 0
      });
    }

    // CRITICAL FIX: Clear failed login attempts on successful login
    await clearFailedLoginAttempts(user.id);

    // CRITICAL FIX: Auto-migrate plain text passwords to hashed on successful login
    if (needsPasswordMigration) {
      try {
        const saltRounds = 12;
        const hashedPassword = await bcrypt.hash(password, saltRounds);
        await pool.execute(
          'UPDATE users SET password = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
          [hashedPassword, user.id]
        );
        console.log(`✅ Successfully migrated password for user ${user.id} to hashed format`);
      } catch (migrationError) {
        console.error('Error migrating password:', migrationError);
        // Don't fail login if migration fails, but log it
      }
    }

    // Remove password from user object
    delete user.password;

    // Generate token
    const token = generateToken(user.id);

    // CRITICAL FIX: Set token in httpOnly cookie instead of returning in response body
    // This prevents XSS attacks from stealing tokens
    const isProduction = process.env.NODE_ENV === 'production';
    // VERCEL FIX: Use 'lax' for sameSite to work with Vercel's routing
    // Also ensure domain is not set (let browser handle it) for Vercel compatibility
    res.cookie('authToken', token, {
      httpOnly: true, // CRITICAL: Prevents JavaScript access (XSS protection)
      secure: isProduction, // Only send over HTTPS in production
      sameSite: isProduction ? 'lax' : 'lax', // Use 'lax' for Vercel compatibility
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      path: '/',
      // Don't set domain - let browser handle it for Vercel compatibility
    });

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        user,
        token // Keep for backward compatibility during migration
      }
    });
  } catch (error) {
    // Login error - log the actual error for debugging
    console.error('[Login] Error occurred:', error);
    console.error('[Login] Error message:', error.message);
    console.error('[Login] Error stack:', error.stack);
    console.error('[Login] Error name:', error.name);
    
    // Ensure JSON response header is set even on error
    if (!res.headersSent) {
      res.setHeader('Content-Type', 'application/json');
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    } else {
      console.error('[Login] Response already sent, cannot send error response');
    }
  }
};

// Get current user profile
export const getProfile = async (req, res) => {
  try {
    const [users] = await pool.execute(
      'SELECT id, email, name, role, college_id, department, student_id, phone, avatar_url, country, is_active, email_verified, created_at, updated_at FROM users WHERE id = ?',
      [req.user.id]
    );

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      data: users[0]
    });
  } catch (error) {
    // Get profile error
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Update user profile
export const updateProfile = async (req, res) => {
  try {
    const { name, phone, avatar_url, country } = req.body;
    const userId = req.user.id;

    // Update user
    const [result] = await pool.execute(
      'UPDATE users SET name = ?, phone = ?, avatar_url = ?, country = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [name, phone, avatar_url, country, userId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Get updated user
    const [users] = await pool.execute(
      'SELECT id, email, name, role, college_id, department, student_id, phone, avatar_url, country, is_active, email_verified, created_at, updated_at FROM users WHERE id = ?',
      [userId]
    );

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: users[0]
    });
  } catch (error) {
    // Update profile error
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Change password
export const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user.id;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Current password and new password are required'
      });
    }

    // Enhanced password validation (CRITICAL SECURITY FIX)
    if (newPassword.trim().length < 8) {
      return res.status(400).json({
        success: false,
        message: 'New password must be at least 8 characters long'
      });
    }

    // Password complexity requirements
    const hasUpperCase = /[A-Z]/.test(newPassword);
    const hasLowerCase = /[a-z]/.test(newPassword);
    const hasNumber = /[0-9]/.test(newPassword);
    const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(newPassword);

    if (!hasUpperCase || !hasLowerCase || !hasNumber || !hasSpecialChar) {
      return res.status(400).json({
        success: false,
        message: 'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character'
      });
    }

    // Get current user with password
    const [users] = await pool.execute(
      'SELECT password FROM users WHERE id = ?',
      [userId]
    );

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Verify current password
    const isCurrentPasswordValid = await bcrypt.compare(currentPassword, users[0].password);
    if (!isCurrentPasswordValid) {
      return res.status(400).json({
        success: false,
        message: 'Current password is incorrect'
      });
    }

    // Hash new password
    const saltRounds = 12;
    const hashedNewPassword = await bcrypt.hash(newPassword, saltRounds);

    // Update password
    await pool.execute(
      'UPDATE users SET password = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [hashedNewPassword, userId]
    );

    res.json({
      success: true,
      message: 'Password changed successfully'
    });
  } catch (error) {
    // Change password error
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Logout (client-side token removal)
export const logout = async (req, res) => {
  // VERCEL FIX: Clear httpOnly cookie on logout with same settings as login
  const isProduction = process.env.NODE_ENV === 'production';
  res.clearCookie('authToken', {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax', // VERCEL FIX: Use 'lax' for Vercel compatibility
    path: '/'
  });

  res.json({
    success: true,
    message: 'Logged out successfully'
  });
};

// CRITICAL FIX: Ensure email_verification_tokens table exists
async function ensureEmailVerificationTable() {
  // Skip if already checked (performance optimization)
  if (tableCheckCache.emailVerification) {
    return;
  }

  try {
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS email_verification_tokens (
        id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR(36) NOT NULL,
        token VARCHAR(255) NOT NULL UNIQUE,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
    // Create indexes separately (PostgreSQL syntax)
    await pool.execute(`CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_user_id ON email_verification_tokens(user_id)`);
    await pool.execute(`CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_token ON email_verification_tokens(token)`);
    await pool.execute(`CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_expires_at ON email_verification_tokens(expires_at)`);
    // Mark as checked after successful creation/verification
    tableCheckCache.emailVerification = true;
  } catch (error) {
    if (!error.message.includes('already exists')) {
      console.error('Error creating email_verification_tokens table:', error);
    } else {
      // Table exists, mark as checked
      tableCheckCache.emailVerification = true;
    }
  }
}

// CRITICAL FIX: Verify email with token
export const verifyEmail = async (req, res) => {
  try {
    // Support both POST body and GET query parameter
    const token = req.body?.token || req.query?.token;

    if (!token) {
      return res.status(400).json({
        success: false,
        message: 'Verification token is required'
      });
    }

    // Ensure table exists
    await ensureEmailVerificationTable();

    // Find valid token
    const [tokens] = await pool.execute(
      'SELECT user_id, expires_at FROM email_verification_tokens WHERE token = ? AND expires_at > NOW()',
      [token]
    );

    if (tokens.length === 0) {
      // Check if token exists but is expired
      const [expiredTokens] = await pool.execute(
        'SELECT user_id, expires_at FROM email_verification_tokens WHERE token = ?',
        [token]
      );

      if (expiredTokens.length > 0) {
        console.log(`Email verification attempt with expired token: ${token.substring(0, 8)}...`);
        return res.status(400).json({
          success: false,
          message: 'Verification token has expired. Please request a new verification email.'
        });
      }

      console.log(`Email verification attempt with invalid token: ${token.substring(0, 8)}...`);
      return res.status(400).json({
        success: false,
        message: 'Invalid verification token. Please check your email for the correct verification link.'
      });
    }

    const tokenData = tokens[0];

    // Update user email_verified status and activate account
    const [updateResult] = await pool.execute(
      'UPDATE users SET email_verified = true, is_active = true WHERE id = ?',
      [tokenData.user_id]
    );

    if (updateResult.affectedRows === 0) {
      console.error(`Failed to update user ${tokenData.user_id} email verification status`);
      return res.status(500).json({
        success: false,
        message: 'Failed to verify email. Please try again or contact support.'
      });
    }

    // Delete used token
    await pool.execute(
      'DELETE FROM email_verification_tokens WHERE token = ?',
      [token]
    );

    console.log(`Email verified successfully for user ${tokenData.user_id}`);

    res.json({
      success: true,
      message: 'Email verified successfully'
    });
  } catch (error) {
    console.error('Email verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Resend email verification
export const resendVerificationEmail = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required'
      });
    }

    // Ensure email_verification_tokens table exists
    await ensureEmailVerificationTable();

    // OPTIMIZATION: Add index hint and limit query to single row
    // Find user by email (optimized query)
    const [users] = await pool.execute(
      'SELECT id, email, name, email_verified FROM users WHERE email = ? LIMIT 1',
      [email]
    );

    // Always return success to prevent email enumeration
    if (users.length === 0) {
      return res.json({
        success: true,
        message: 'If an account with that email exists and is not verified, a verification link has been sent'
      });
    }

    const user = users[0];

    // If email is already verified, return success (don't reveal verification status)
    if (user.email_verified) {
      return res.json({
        success: true,
        message: 'If an account with that email exists and is not verified, a verification link has been sent'
      });
    }

    // Generate new verification token
    const verificationToken = uuidv4();
    const tokenExpiry = new Date();
    tokenExpiry.setHours(tokenExpiry.getHours() + 24); // 24 hour expiry

    // Delete any existing tokens for this user
    await pool.execute(
      'DELETE FROM email_verification_tokens WHERE user_id = ?',
      [user.id]
    );

    // Store new verification token
    await pool.execute(
      'INSERT INTO email_verification_tokens (user_id, token, expires_at) VALUES (?, ?, ?)',
      [user.id, verificationToken, tokenExpiry]
    );

    // Send verification email asynchronously (don't await - return response immediately)
    // This improves response time significantly
    (async () => {
      try {
        const emailService = (await import('../services/emailService.js')).default;
        const frontendUrl = process.env.FRONTEND_URL || (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:5173');
        if (!frontendUrl) {
          throw new Error('FRONTEND_URL environment variable is required in production');
        }
        const verificationUrl = `${frontendUrl}/verify-email?token=${verificationToken}`;

        await emailService.sendVerificationEmail(user.email, user.name, verificationUrl);
      } catch (emailError) {
        console.error('Error sending verification email:', emailError);
        // In development, if email service is not configured, don't fail
        if (process.env.NODE_ENV === 'development') {
          console.log(`⚠️  Development mode: Email service not configured. Verification email not sent.`);
        }
      }
    })().catch(err => {
      // Silently handle any errors in the async email sending
      console.error('Background email sending error:', err);
    });

    // Return response immediately without waiting for email to be sent
    res.json({
      success: true,
      message: 'If an account with that email exists and is not verified, a verification link has been sent'
    });
  } catch (error) {
    console.error('Resend verification email error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// CRITICAL FIX: Request password reset (forgot password)
export const requestPasswordReset = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required'
      });
    }

    // Ensure password_reset_tokens table exists
    await ensurePasswordResetTable();

    // Find user by email
    const [users] = await pool.execute(
      'SELECT id, email, name FROM users WHERE email = ?',
      [email]
    );

    // Always return success to prevent email enumeration
    if (users.length === 0) {
      return res.json({
        success: true,
        message: 'If an account with that email exists, a password reset link has been sent'
      });
    }

    const user = users[0];

    // Generate reset token
    const resetToken = uuidv4();
    const tokenExpiry = new Date();
    tokenExpiry.setHours(tokenExpiry.getHours() + 1); // 1 hour expiry

    // Delete any existing tokens for this user
    await pool.execute(
      'DELETE FROM password_reset_tokens WHERE user_id = ?',
      [user.id]
    );

    // Store reset token
    await pool.execute(
      'INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES (?, ?, ?)',
      [user.id, resetToken, tokenExpiry]
    );

    // Send password reset email
    try {
      const emailService = (await import('../services/emailService.js')).default;
      const frontendUrl = process.env.FRONTEND_URL || (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:5173');
      if (!frontendUrl) {
        throw new Error('FRONTEND_URL environment variable is required in production');
      }
      const resetUrl = `${frontendUrl}/reset-password?token=${resetToken}`;

      await emailService.sendPasswordResetEmail(user.email, user.name, resetUrl);
    } catch (emailError) {
      console.error('Error sending password reset email:', emailError);
      // Don't fail if email fails, but log it
    }

    res.json({
      success: true,
      message: 'If an account with that email exists, a password reset link has been sent'
    });
  } catch (error) {
    console.error('Password reset request error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// CRITICAL FIX: Reset password with token
export const resetPasswordWithToken = async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Token and new password are required'
      });
    }

    // Enhanced password validation
    if (newPassword.trim().length < 8) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 8 characters long'
      });
    }

    const hasUpperCase = /[A-Z]/.test(newPassword);
    const hasLowerCase = /[a-z]/.test(newPassword);
    const hasNumber = /[0-9]/.test(newPassword);
    const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(newPassword);

    if (!hasUpperCase || !hasLowerCase || !hasNumber || !hasSpecialChar) {
      return res.status(400).json({
        success: false,
        message: 'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character'
      });
    }

    // Find valid token
    const [tokens] = await pool.execute(
      'SELECT user_id, expires_at FROM password_reset_tokens WHERE token = ? AND expires_at > NOW()',
      [token]
    );

    if (tokens.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired reset token'
      });
    }

    const tokenData = tokens[0];

    // Hash new password
    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(newPassword, saltRounds);

    // Update password
    await pool.execute(
      'UPDATE users SET password = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [hashedPassword, tokenData.user_id]
    );

    // Delete used token
    await pool.execute(
      'DELETE FROM password_reset_tokens WHERE token = ?',
      [token]
    );

    res.json({
      success: true,
      message: 'Password reset successfully'
    });
  } catch (error) {
    console.error('Password reset error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// CRITICAL FIX: Ensure password_reset_tokens table exists
async function ensurePasswordResetTable() {
  try {
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR(36) NOT NULL,
        token VARCHAR(255) NOT NULL UNIQUE,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
    // Create indexes separately (PostgreSQL syntax)
    await pool.execute(`CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id ON password_reset_tokens(user_id)`);
    await pool.execute(`CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_token ON password_reset_tokens(token)`);
    await pool.execute(`CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expires_at ON password_reset_tokens(expires_at)`);
  } catch (error) {
    if (!error.message.includes('already exists')) {
      console.error('Error creating password_reset_tokens table:', error);
    }
  }
}

// CRITICAL FIX: Ensure login_attempts table exists
async function ensureLoginAttemptsTable() {
  if (isSupabase) {
    if (!tableCheckCache.loginAttempts) {
      console.warn('Supabase detected - ensureLoginAttemptsTable skipped. Make sure login_attempts exists via migration.');
      tableCheckCache.loginAttempts = true;
    }
    return;
  }

  if (tableCheckCache.loginAttempts) {
    return;
  }

  try {
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS login_attempts (
        id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR(36),
        email VARCHAR(255) NOT NULL,
        ip_address VARCHAR(45),
        success BOOLEAN DEFAULT FALSE,
        attempted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
    // Create indexes separately (PostgreSQL syntax)
    await pool.execute(`CREATE INDEX IF NOT EXISTS idx_login_attempts_user_id ON login_attempts(user_id)`);
    await pool.execute(`CREATE INDEX IF NOT EXISTS idx_login_attempts_email ON login_attempts(email)`);
    await pool.execute(`CREATE INDEX IF NOT EXISTS idx_login_attempts_ip_address ON login_attempts(ip_address)`);
    await pool.execute(`CREATE INDEX IF NOT EXISTS idx_login_attempts_attempted_at ON login_attempts(attempted_at)`);
    tableCheckCache.loginAttempts = true;
  } catch (error) {
    if (!error.message.includes('already exists')) {
      console.error('Error creating login_attempts table:', error);
    }
  }
}

// CRITICAL FIX: Record failed login attempt
async function recordFailedLoginAttempt(email, ipAddress, userId = null) {
  try {
    await ensureLoginAttemptsTable();
    await pool.execute(
      'INSERT INTO login_attempts (user_id, email, ip_address, success) VALUES (?, ?, ?, FALSE)',
      [userId, email, ipAddress]
    );
  } catch (error) {
    console.error('Error recording failed login attempt:', error);
    // Don't throw - failure recording shouldn't break login flow
  }
}

// CRITICAL FIX: Check account lockout status
async function checkAccountLockout(userId) {
  try {
    await ensureLoginAttemptsTable();

    // Get failed attempts in the last 15 minutes
    // Calculate date on application side - PostgreSQL compatible
    const cutoffDate = new Date();
    cutoffDate.setMinutes(cutoffDate.getMinutes() - 15);
    const cutoffDateStr = cutoffDate.toISOString();
    
    const [recentAttempts] = await pool.execute(
      `SELECT COUNT(*) as count FROM login_attempts 
       WHERE user_id = ? AND success = false 
       AND attempted_at > ?`,
      [userId, cutoffDateStr]
    );

    const failedAttempts = recentAttempts[0]?.count || 0;
    const MAX_ATTEMPTS = 5;
    const LOCKOUT_MINUTES = 15;

    // Check if account is currently locked
    // First ensure locked_until column exists (MySQL doesn't support IF NOT EXISTS in ALTER)
    try {
      await pool.execute(`
        ALTER TABLE users 
        ADD COLUMN locked_until TIMESTAMP NULL
      `);
    } catch (error) {
      // Column might already exist, ignore duplicate column errors
      if (!error.message.includes('Duplicate column name') &&
        !error.message.includes('already exists') &&
        error.code !== 'ER_DUP_FIELDNAME' && error.code !== '42701' && !error.message?.includes('already exists')) {
        // Only log if it's not a duplicate column error
        console.error('Error adding locked_until column:', error);
      }
    }

    const [lockoutInfo] = await pool.execute(
      `SELECT locked_until FROM users WHERE id = ? AND locked_until > NOW()`,
      [userId]
    );

    if (lockoutInfo.length > 0 && lockoutInfo[0].locked_until) {
      const lockedUntil = new Date(lockoutInfo[0].locked_until);
      const unlockAfterMinutes = Math.ceil((lockedUntil.getTime() - Date.now()) / (1000 * 60));
      return {
        isLocked: true,
        unlockAfterMinutes,
        lockedUntil: lockedUntil.toISOString()
      };
    }

    // Check if account should be locked
    if (failedAttempts >= MAX_ATTEMPTS) {
      return {
        isLocked: false,
        shouldLock: true,
        lockoutMinutes: LOCKOUT_MINUTES,
        remainingAttempts: 0
      };
    }

    return {
      isLocked: false,
      shouldLock: false,
      remainingAttempts: MAX_ATTEMPTS - failedAttempts
    };
  } catch (error) {
    console.error('Error checking account lockout:', error);
    // Return safe defaults on error
    return {
      isLocked: false,
      shouldLock: false,
      remainingAttempts: 5
    };
  }
}

// CRITICAL FIX: Lock account
async function lockAccount(userId, lockoutMinutes) {
  try {
    // Ensure locked_until column exists (MySQL doesn't support IF NOT EXISTS in ALTER)
    try {
      await pool.execute(`
        ALTER TABLE users 
        ADD COLUMN locked_until TIMESTAMP NULL
      `);
    } catch (error) {
      // Column might already exist, ignore duplicate column errors
      if (!error.message.includes('Duplicate column name') &&
        !error.message.includes('already exists') &&
        error.code !== 'ER_DUP_FIELDNAME' && error.code !== '42701' && !error.message?.includes('already exists')) {
        // Only log if it's not a duplicate column error
        console.error('Error adding locked_until column:', error);
      }
    }

    const lockedUntil = new Date();
    lockedUntil.setMinutes(lockedUntil.getMinutes() + lockoutMinutes);

    await pool.execute(
      'UPDATE users SET locked_until = ? WHERE id = ?',
      [lockedUntil, userId]
    );
  } catch (error) {
    console.error('Error locking account:', error);
    // Don't throw - locking failure shouldn't break login flow
  }
}

// CRITICAL FIX: Clear failed login attempts
async function clearFailedLoginAttempts(userId) {
  try {
    await ensureLoginAttemptsTable();
    await pool.execute(
      'DELETE FROM login_attempts WHERE user_id = ?',
      [userId]
    );

    // Also clear lockout
    await pool.execute(
      'UPDATE users SET locked_until = NULL WHERE id = ?',
      [userId]
    );
  } catch (error) {
    console.error('Error clearing failed login attempts:', error);
    // Don't throw - clearing failure shouldn't break login flow
  }
} 