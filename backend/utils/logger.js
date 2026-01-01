// LOW PRIORITY FIX: Structured logging with Winston
// Replaces console.log/error/warn with proper structured logging
// VERCEL FIX: Entire module wrapped to prevent any errors during import

import winston from 'winston';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

// VERCEL FIX: Wrap entire initialization in try-catch to prevent import errors
let __filename, __dirname, isServerless, logsDir;

try {
  __filename = fileURLToPath(import.meta.url);
  __dirname = path.dirname(__filename);
  
  // VERCEL/SERVERLESS FIX: Detect serverless environment
  // Vercel and other serverless platforms have read-only filesystems
  isServerless = process.env.VERCEL === '1' || 
                 process.env.AWS_LAMBDA_FUNCTION_NAME || 
                 process.env.FUNCTION_NAME ||
                 (typeof __dirname !== 'undefined' && __dirname.includes('/var/task')) ||
                 (typeof process !== 'undefined' && process.cwd().includes('/var/task'));

  // Create logs directory if it doesn't exist (only in non-serverless environments)
  // VERCEL FIX: Never throw errors - always fall back to console-only logging
  logsDir = null;
  if (!isServerless && __dirname) {
    try {
      const potentialLogsDir = path.join(__dirname, '../logs');
      // Only try to create if we can check existence first
      if (!fs.existsSync(potentialLogsDir)) {
        fs.mkdirSync(potentialLogsDir, { recursive: true });
      }
      logsDir = potentialLogsDir;
    } catch (error) {
      // Silently fail - use console-only logging
      logsDir = null;
    }
  }
} catch (error) {
  // If ANY error occurs during initialization, use safe defaults
  // Never throw - this would break route imports
  isServerless = true; // Assume serverless if we can't determine
  logsDir = null;
}

// Define log format
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json()
);

// Console format for development
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let msg = `${timestamp} [${level}]: ${message}`;
    if (Object.keys(meta).length > 0) {
      msg += ` ${JSON.stringify(meta)}`;
    }
    return msg;
  })
);

// Create logger instance
// VERCEL/SERVERLESS FIX: Only use file transports if logs directory is available
const transports = [];
const exceptionHandlers = [];
const rejectionHandlers = [];

// Add file transports only if logs directory is available (not in serverless)
if (logsDir) {
  transports.push(
    // Write all logs to combined.log
    new winston.transports.File({
      filename: path.join(logsDir, 'combined.log'),
      maxsize: 10485760, // 10MB
      maxFiles: 5,
      tailable: true
    }),
    // Write errors to error.log
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      maxsize: 10485760, // 10MB
      maxFiles: 5,
      tailable: true
    })
  );
  
  exceptionHandlers.push(
    new winston.transports.File({
      filename: path.join(logsDir, 'exceptions.log'),
      maxsize: 10485760, // 10MB
      maxFiles: 5
    })
  );
  
  rejectionHandlers.push(
    new winston.transports.File({
      filename: path.join(logsDir, 'rejections.log'),
      maxsize: 10485760, // 10MB
      maxFiles: 5
    })
  );
}

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  format: logFormat,
  defaultMeta: { service: 'lms-platform' },
  transports: transports,
  exceptionHandlers: exceptionHandlers.length > 0 ? exceptionHandlers : undefined,
  rejectionHandlers: rejectionHandlers.length > 0 ? rejectionHandlers : undefined
});

// VERCEL/SERVERLESS FIX: Always add console transport
// In serverless environments, console is the only way to see logs
// In production, log warnings and errors; in development, log everything
if (isServerless || process.env.NODE_ENV === 'production') {
  // In serverless/production, only log warnings and errors to console
  logger.add(new winston.transports.Console({
    format: consoleFormat,
    level: 'warn'
  }));
} else {
  // In development, log everything to console
  logger.add(new winston.transports.Console({
    format: consoleFormat
  }));
}

// Helper methods for common logging patterns
logger.logRequest = (req, res, responseTime) => {
  logger.info('HTTP Request', {
    method: req.method,
    url: req.url,
    ip: req.ip,
    userAgent: req.get('user-agent'),
    userId: req.user?.id,
    statusCode: res.statusCode,
    responseTime: `${responseTime}ms`
  });
};

logger.logError = (error, context = {}) => {
  logger.error('Error occurred', {
    message: error.message,
    stack: error.stack,
    ...context
  });
};

logger.logSecurityEvent = (event, details = {}) => {
  logger.warn('Security Event', {
    event,
    ...details,
    timestamp: new Date().toISOString()
  });
};

logger.logDatabaseQuery = (query, params, duration) => {
  if (process.env.LOG_LEVEL === 'debug') {
    logger.debug('Database Query', {
      query: query.substring(0, 200), // Truncate long queries
      params,
      duration: `${duration}ms`
    });
  }
};

export default logger;

