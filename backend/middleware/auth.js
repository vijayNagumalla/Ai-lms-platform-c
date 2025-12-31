import jwt from 'jsonwebtoken';
import { pool } from '../config/database.js';
import cache from '../utils/cache.js';

export const authenticateToken = async (req, res, next) => {
  try {
    // CRITICAL FIX: Support both Bearer token and cookie-based authentication
    // This ensures compatibility with both old and new authentication methods
    const authHeader = req.headers['authorization'];
    let token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN
    
    // If no Bearer token, try to get from cookie (for Vercel/serverless compatibility)
    if (!token && req.cookies && req.cookies.authToken) {
      token = req.cookies.authToken;
    }

    if (!token) {
      return res.status(401).json({ 
        success: false, 
        message: 'Access token required' 
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // PERFORMANCE FIX: Cache user data to avoid database query on every request
    const userCacheKey = `auth_user_${decoded.userId}`;
    let user = cache.get(userCacheKey);
    
    if (!user) {
      // Get user from database to ensure they still exist and are active
      const [users] = await pool.execute(
        'SELECT id, email, name, role, college_id, department, student_id, phone, avatar_url, country, is_active FROM users WHERE id = ? AND is_active = TRUE',
        [decoded.userId]
      );

      if (users.length === 0) {
        return res.status(401).json({ 
          success: false, 
          message: 'User not found or inactive' 
        });
      }

      user = users[0];
      // Cache for 1 minute (user data doesn't change frequently)
      cache.set(userCacheKey, user, 60 * 1000);
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ 
        success: false, 
        message: 'Token expired' 
      });
    }
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid token' 
      });
    }
    console.error('Auth middleware error:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
};

export const authorizeRoles = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ 
        success: false, 
        message: 'Authentication required' 
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ 
        success: false, 
        message: 'Insufficient permissions' 
      });
    }

    next();
  };
};

export const authorizeCollegeAccess = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ 
      success: false, 
      message: 'Authentication required' 
    });
  }

  // Super admin can access everything (handle both formats)
  if (req.user.role === 'super_admin' || req.user.role === 'super-admin') {
    return next();
  }

  // For other roles, check if they're accessing their own college
  const requestedCollegeId = req.params.collegeId || req.body.college_id;
  
  if (requestedCollegeId && req.user.college_id !== requestedCollegeId) {
    return res.status(403).json({ 
      success: false, 
      message: 'Access denied to this college' 
    });
  }

  next();
}; 