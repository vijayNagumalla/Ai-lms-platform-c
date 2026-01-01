// Simplified logging with Winston - Console only (no file system operations)
// Removed file-based logging to prevent ENOENT errors in serverless environments

import winston from 'winston';

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

// Create logger instance - Console only, no file system operations
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  format: logFormat,
  defaultMeta: { service: 'lms-platform' },
  transports: []
});

// Always use console transport only
// In production, log warnings and errors; in development, log everything
if (process.env.NODE_ENV === 'production') {
  // In production, only log warnings and errors to console
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

