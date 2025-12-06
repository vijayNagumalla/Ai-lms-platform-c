import csrf from 'csrf';
import { pool as db } from '../config/database.js';

// Initialize CSRF token generator
const tokens = new csrf();

// CSRF secret - should be stored in environment variable
const CSRF_SECRET = process.env.CSRF_SECRET || 'csrf-secret-change-in-production';

/**
 * Generate CSRF token for authenticated users
 * This middleware should be used after authentication
 */
export const generateCSRFToken = async (req, res, next) => {
  try {
    // Only generate CSRF tokens for authenticated users
    if (!req.user || !req.user.id) {
      return next();
    }

    // Generate token using user ID + secret for uniqueness
    const userSecret = `${CSRF_SECRET}-${req.user.id}`;
    const token = tokens.create(userSecret);

    // Store token in database with user association (for validation)
    // Token expires in 24 hours
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    
    try {
      await db.execute(
        `INSERT INTO csrf_tokens (user_id, token, expires_at, created_at) 
         VALUES (?, ?, ?, NOW())
         ON CONFLICT (user_id) DO UPDATE SET token = EXCLUDED.token, expires_at = EXCLUDED.expires_at, created_at = NOW()`,
        [req.user.id, token, expiresAt]
      );
    } catch (dbError) {
      // If table doesn't exist, create it
      if (dbError.code === 'ER_NO_SUCH_TABLE') {
        console.warn('CSRF tokens table not found. Creating...');
        await createCSRFTokensTable();
        await db.execute(
          `INSERT INTO csrf_tokens (user_id, token, expires_at, created_at) 
           VALUES (?, ?, ?, NOW())`,
          [req.user.id, token, expiresAt]
        );
      } else {
        throw dbError;
      }
    }

    // Set token in response header
    res.setHeader('X-CSRF-Token', token);
    
    // Also set as cookie for automatic inclusion in requests
    res.cookie('XSRF-TOKEN', token, {
      httpOnly: false, // Must be accessible to JavaScript for header inclusion
      secure: process.env.NODE_ENV === 'production', // HTTPS only in production
      sameSite: 'strict', // Prevent CSRF attacks
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    });

    // Make token available to next middleware
    req.csrfToken = token;
    next();
  } catch (error) {
    console.error('Error generating CSRF token:', error);
    // Don't block request, but log error
    next();
  }
};

/**
 * Validate CSRF token for state-changing requests
 */
export const validateCSRFToken = async (req, res, next) => {
  try {
    // Skip CSRF validation for GET, HEAD, OPTIONS requests
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      return next();
    }

    // Skip CSRF validation for health check and public endpoints
    if (req.path === '/health' || req.path === '/api/health' || 
        req.path.startsWith('/api/auth/login') || 
        req.path.startsWith('/api/auth/register') ||
        req.path === '/api/csrf-token') {
      return next();
    }

    // Get token from header (preferred) or cookie
    const token = req.headers['x-csrf-token'] || 
                  req.headers['x-xsrf-token'] || 
                  (req.cookies && req.cookies['XSRF-TOKEN']) ||
                  (req.body && req.body._csrf);

    if (!token) {
      return res.status(403).json({
        success: false,
        message: 'CSRF token missing. Please refresh the page and try again.'
      });
    }

    // Get user ID from authenticated request
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    // Verify token from database
    const [tokenRows] = await db.execute(
      `SELECT token, expires_at FROM csrf_tokens 
       WHERE user_id = ? AND token = ? AND expires_at > NOW()`,
      [req.user.id, token]
    );

    if (!tokenRows || tokenRows.length === 0) {
      // Clean up expired tokens
      await db.execute(
        'DELETE FROM csrf_tokens WHERE expires_at <= NOW()'
      );

      return res.status(403).json({
        success: false,
        message: 'Invalid or expired CSRF token. Please refresh the page and try again.'
      });
    }

    // Validate token using secret
    const userSecret = `${CSRF_SECRET}-${req.user.id}`;
    if (!tokens.verify(userSecret, token)) {
      return res.status(403).json({
        success: false,
        message: 'Invalid CSRF token. Please refresh the page and try again.'
      });
    }

    // Token is valid, proceed
    next();
  } catch (error) {
    console.error('Error validating CSRF token:', error);
    
    // If table doesn't exist, create it and allow request (first-time setup)
    if (error.code === 'ER_NO_SUCH_TABLE' || error.code === '42P01' || error.code === 'PGRST205' || error.message?.includes('does not exist')) {
      console.warn('CSRF tokens table not found. Creating...');
      await createCSRFTokensTable();
      // Allow first request after table creation
      return next();
    }

    res.status(500).json({
      success: false,
      message: 'CSRF validation error'
    });
  }
};

/**
 * Create CSRF tokens table if it doesn't exist
 */
async function createCSRFTokensTable() {
  try {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS csrf_tokens (
        id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR(36) NOT NULL,
        token VARCHAR(255) NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (user_id, token),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
    // Create indexes separately (PostgreSQL syntax)
    await db.execute(`CREATE INDEX IF NOT EXISTS idx_csrf_tokens_user_token ON csrf_tokens(user_id, token)`);
    await db.execute(`CREATE INDEX IF NOT EXISTS idx_csrf_tokens_expires_at ON csrf_tokens(expires_at)`);
    console.log('CSRF tokens table created successfully');
  } catch (error) {
    // Table might already exist, ignore if so
    if (!error.message.includes('already exists')) {
      console.error('Error creating CSRF tokens table:', error);
      throw error;
    }
  }
}

/**
 * Cleanup expired CSRF tokens (run periodically)
 */
export const cleanupExpiredTokens = async () => {
  try {
    const [result] = await db.execute(
      'DELETE FROM csrf_tokens WHERE expires_at <= NOW()'
    );
    console.log(`Cleaned up ${result.affectedRows} expired CSRF tokens`);
  } catch (error) {
    console.error('Error cleaning up expired CSRF tokens:', error);
  }
};

// Run cleanup every hour
if (typeof setInterval !== 'undefined') {
  setInterval(cleanupExpiredTokens, 60 * 60 * 1000); // 1 hour
}

