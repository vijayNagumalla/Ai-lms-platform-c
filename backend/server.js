import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { validateCSRFToken, generateCSRFToken } from './middleware/csrf.js';
import { authenticateToken } from './middleware/auth.js';
// CRITICAL FIX: Import services for cleanup
import exportService from './services/exportService.js';
import dockerCodeService from './services/dockerCodeService.js';
import browserScraperService from './services/browserScraperService.js';
// CRITICAL FIX: Import input sanitization middleware
import { sanitizeInput } from './middleware/validation.js';
// CRITICAL FIX: Import request tracking and timeout middleware
import { requestTracking } from './middleware/requestTracking.js';
import { requestTimeout } from './middleware/requestTimeout.js';
import { errorHandler } from './middleware/errorHandler.js';
// LOW PRIORITY FIX: Import structured logger
import logger from './utils/logger.js';
// LOW PRIORITY FIX: Import Swagger setup for API documentation
import swaggerSetup from './utils/swaggerSetup.js';
// LOW PRIORITY FIX: Import request monitoring middleware
import { requestMonitoring } from './middleware/monitoring.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config();

// CRITICAL FIX: Validate required environment variables on startup
const requiredEnvVars = [
  'DB_HOST',
  'DB_USER',
  'DB_PASSWORD',
  'DB_NAME',
  'JWT_SECRET',
  'CSRF_SECRET'
];

const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingEnvVars.length > 0) {
  logger.error('CRITICAL: Missing required environment variables', { missingVars: missingEnvVars });
  process.exit(1);
}

// CRITICAL FIX: Validate JWT_SECRET length
if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32) {
  logger.warn('JWT_SECRET should be at least 32 characters long for security');
}

// CRITICAL FIX: Validate CSRF_SECRET length
if (process.env.CSRF_SECRET && process.env.CSRF_SECRET.length < 32) {
  logger.warn('CSRF_SECRET should be at least 32 characters long for security');
}

// CRITICAL FIX: Warn about default encryption key usage
if (process.env.NODE_ENV === 'production' && !process.env.ENCRYPTION_KEY) {
  logger.error('CRITICAL: ENCRYPTION_KEY is required in production. Please set it in your .env file.');
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 5000;

// Security middleware (CRITICAL SECURITY FIX)
// Build connectSrc array from environment variables
const frontendUrls = process.env.FRONTEND_URL 
  ? process.env.FRONTEND_URL.split(',').map(url => url.trim())
  : (process.env.NODE_ENV === 'production' ? [] : ['http://localhost:5173', 'http://localhost:5174']);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"], // 'unsafe-eval' needed for some React features
      imgSrc: ["'self'", "data:", "https:", "blob:"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      connectSrc: ["'self'", ...frontendUrls, "https:"], // Allow HTTPS connections
      frameSrc: ["'none'"], // Prevent iframe embedding
      objectSrc: ["'none'"], // Prevent object/embed tags
      baseUri: ["'self'"], // Restrict base tag
      formAction: ["'self'"], // Restrict form submission
      upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null, // Upgrade HTTP to HTTPS in production
    },
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" }, // Allow cross-origin resources
  // Additional security headers
  hsts: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true
  },
  noSniff: true, // Prevent MIME type sniffing
  xssFilter: true, // Enable XSS filter
  referrerPolicy: { policy: "strict-origin-when-cross-origin" }
}));

// CRITICAL FIX: CORS must be applied early to handle preflight OPTIONS requests
// CORS configuration (CRITICAL SECURITY FIX)
const allowedOrigins = process.env.FRONTEND_URL 
  ? process.env.FRONTEND_URL.split(',').map(url => url.trim())
  : (process.env.NODE_ENV === 'production' 
      ? [] // No localhost in production - must set FRONTEND_URL
      : ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:3000']);

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) return callback(null, true);
    
    // In development, allow all localhost origins
    if (process.env.NODE_ENV === 'development') {
      if (origin.startsWith('http://localhost:') || origin.startsWith('https://localhost:')) {
        return callback(null, true);
      }
    }
    
    // Check if origin is in allowed list
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-CSRF-Token', 'X-XSRF-Token'],
  preflightContinue: false,
  optionsSuccessStatus: 204
}));

// Global rate limiting (CRITICAL SECURITY FIX)
// More lenient in development to handle React StrictMode double requests
const isDevelopment = process.env.NODE_ENV === 'development';
const GLOBAL_RATE_LIMIT = parseInt(process.env.GLOBAL_RATE_LIMIT) || (isDevelopment ? 1000 : 100);
const GLOBAL_RATE_LIMIT_WINDOW = parseInt(process.env.GLOBAL_RATE_LIMIT_WINDOW_MS) || (15 * 60 * 1000); // 15 minutes

const globalLimiter = rateLimit({
  windowMs: GLOBAL_RATE_LIMIT_WINDOW,
  max: GLOBAL_RATE_LIMIT,
  message: {
    success: false,
    message: `Too many requests from this IP, please try again after ${Math.round(GLOBAL_RATE_LIMIT_WINDOW / 60000)} minutes`
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip rate limiting for health check and OPTIONS requests (preflight)
    return req.path === '/health' || req.path === '/api/health' || req.method === 'OPTIONS';
  }
});

app.use(globalLimiter);

// CRITICAL FIX: Request tracking middleware (adds request ID)
app.use(requestTracking);

// LOW PRIORITY FIX: Request monitoring middleware (tracks metrics)
app.use(requestMonitoring);

// CRITICAL FIX: Request timeout middleware (30 seconds default)
app.use(requestTimeout(30000));

// CRITICAL FIX: Input sanitization middleware (applied globally)
app.use(sanitizeInput);

// Cookie parser for CSRF token cookies
app.use(cookieParser());

// Add request size limits to prevent DOS attacks
app.use(express.json({ limit: '10mb' })); // 10MB for JSON (covers coding answers)
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve static files
app.use('/uploads', express.static('uploads'));
app.use('/uploads/exports', express.static('uploads/exports'));

// CORS headers are now handled by cors middleware above

// LOW PRIORITY FIX: Enhanced comprehensive health check endpoint
app.get('/health', async (req, res) => {
  const startTime = Date.now();
  const health = {
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
    version: process.env.npm_package_version || '1.0.0',
    checks: {
      database: 'unknown',
      memory: {
        used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
        limit: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
        rss: Math.round(process.memoryUsage().rss / 1024 / 1024),
        external: Math.round(process.memoryUsage().external / 1024 / 1024)
      },
      cpu: {
        usage: process.cpuUsage()
      },
      disk: {
        // Basic disk space check would require additional package
        available: 'not_checked'
      }
    }
  };

  const checkResults = {
    database: false,
    allPassed: true
  };

  // Check database connectivity
  try {
    const { pool } = await import('./config/database.js');
    const connection = await pool.getConnection();
    const dbStartTime = Date.now();
    await connection.query('SELECT 1');
    const dbResponseTime = Date.now() - dbStartTime;
    connection.release();
    health.checks.database = 'connected';
    health.checks.databaseResponseTime = `${dbResponseTime}ms`;
    checkResults.database = true;
    
    // Get pool status
    health.checks.databasePool = {
      active: pool.pool._allConnections ? pool.pool._allConnections.length : 0,
      idle: pool.pool._freeConnections ? pool.pool._freeConnections.length : 0,
      limit: pool.pool.config.connectionLimit || 10,
      queueLength: pool.pool._connectionQueue ? pool.pool._connectionQueue.length : 0
    };
  } catch (error) {
    health.status = 'degraded';
    health.checks.database = 'disconnected';
    health.checks.databaseError = process.env.NODE_ENV === 'development' ? error.message : 'Database connection failed';
    checkResults.database = false;
    checkResults.allPassed = false;
    logger.error('Health check: Database connection failed', { error: error.message });
  }

  // Check if memory usage is high (warning threshold: 80%)
  const memoryUsagePercent = (health.checks.memory.used / health.checks.memory.total) * 100;
  if (memoryUsagePercent > 80) {
    health.checks.memory.warning = `High memory usage: ${memoryUsagePercent.toFixed(2)}%`;
    logger.warn('Health check: High memory usage detected', { usagePercent: memoryUsagePercent });
  }

  const statusCode = health.status === 'OK' && checkResults.allPassed ? 200 : 503;
  health.responseTime = `${Date.now() - startTime}ms`;
  
  res.status(statusCode).json(health);
});

// LOW PRIORITY FIX: Metrics endpoint for monitoring
app.get('/metrics', async (req, res) => {
  try {
    const { getMetrics } = await import('./middleware/monitoring.js');
    const metrics = getMetrics();
    res.json({
      success: true,
      data: metrics
    });
  } catch (error) {
    logger.error('Error getting metrics', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Failed to get metrics'
    });
  }
});

// Note: CSRF validation is applied per-route, not globally
// This allows login/register to work without CSRF tokens

// CRITICAL FIX: Add convenience route for CSRF token at root level
// This allows frontend to access /api/csrf-token directly
app.get('/api/csrf-token', authenticateToken, generateCSRFToken, (req, res) => {
  res.json({
    success: true,
    csrfToken: req.csrfToken || req.headers['x-csrf-token']
  });
});

// LOW PRIORITY FIX: API Versioning - Support both /api/v1/ and /api/ for backward compatibility
// Import v1 routes (versioned API)
import('./routes/v1/index.js').then(module => {
  app.use('/api/v1', module.default);
  // Also mount at /api for backward compatibility (deprecated, will be removed in v2)
  app.use('/api', module.default);
});

// LOW PRIORITY FIX: Note about route registration
// Dynamic imports are used to handle ES module compatibility and allow routes to be loaded
// asynchronously. This is intentional and helps with startup performance.
// For production, consider using static imports if startup time is not a concern.

// LOW PRIORITY FIX: Setup Swagger/OpenAPI documentation
// Swagger UI will be available at /api-docs
// JSON spec will be available at /api-docs.json
swaggerSetup(app);

app.use((error, req, res, next) => {
  res.status(500).json({ 
    success: false, 
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? error.message : undefined
  });
});

const server = app.listen(PORT, () => {
  logger.info(`Server is running on port ${PORT}`, { 
    port: PORT, 
    environment: process.env.NODE_ENV || 'development' 
  });
  
  // CRITICAL FIX: Schedule automatic export file cleanup (every 6 hours)
  setInterval(async () => {
    try {
      await exportService.cleanupOldExports(24); // Clean files older than 24 hours
      logger.info('Export files cleaned up successfully');
    } catch (error) {
      logger.error('Error cleaning up export files', { error: error.message });
    }
  }, 6 * 60 * 60 * 1000); // Run every 6 hours
  
  // Run cleanup once on startup
  exportService.cleanupOldExports(24).catch(err => {
    logger.error('Error during initial export cleanup', { error: err.message });
  });
  
  // CRITICAL FIX: Schedule automatic proctoring data cleanup (daily)
  import('./services/proctoringService.js').then(proctoringService => {
    setInterval(async () => {
      try {
        await proctoringService.default.cleanupOldProctoringData();
        logger.info('Proctoring data cleaned up successfully');
      } catch (error) {
        logger.error('Error cleaning up proctoring data', { error: error.message });
      }
    }, 24 * 60 * 60 * 1000); // Run daily
    
    // Run proctoring cleanup once on startup
    proctoringService.default.cleanupOldProctoringData().catch(err => {
      logger.error('Error during initial proctoring cleanup', { error: err.message });
    });
  });
});

// CRITICAL FIX: Graceful shutdown handler
const gracefulShutdown = async (signal) => {
  logger.info(`${signal} received. Starting graceful shutdown...`);
  
  // Stop accepting new connections
  server.close(() => {
    logger.info('HTTP server closed');
  });
  
  // Cleanup resources
  try {
    logger.info('Cleaning up resources...');
    
    // Close all browser instances
    await browserScraperService.closeAllBrowsers();
    logger.info('Browser instances closed');
    
    // Cleanup Docker containers
    await dockerCodeService.cleanupAllPooledContainers();
    logger.info('Docker containers cleaned up');
    
    // Cleanup old export files
    await exportService.cleanupOldExports(24);
    logger.info('Export files cleaned up');
    
    logger.info('Graceful shutdown complete');
    process.exit(0);
  } catch (error) {
    logger.error('Error during graceful shutdown', { error: error.message, stack: error.stack });
    process.exit(1);
  }
};

// Handle uncaught exceptions
process.on('uncaughtException', async (error) => {
  logger.error('Uncaught Exception', { error: error.message, stack: error.stack });
  // Cleanup before exit
  try {
    await browserScraperService.closeAllBrowsers();
    await dockerCodeService.cleanupAllPooledContainers();
  } catch (cleanupError) {
    logger.error('Error during cleanup', { error: cleanupError.message });
  }
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  // Check if it's a network/DNS error (common with Supabase when URL is invalid)
  const isNetworkError = 
    (reason instanceof Error && (
      reason.message?.includes('ENOTFOUND') ||
      reason.message?.includes('getaddrinfo') ||
      reason.message?.includes('fetch failed') ||
      reason.message?.includes('ECONNREFUSED') ||
      reason.message?.includes('ETIMEDOUT')
    )) ||
    (typeof reason === 'object' && reason?.details?.includes('ENOTFOUND'));
  
  if (isNetworkError) {
    // Network errors are usually temporary - log at debug level
    logger.debug('Unhandled network error (likely temporary):', { 
      reason: reason instanceof Error ? reason.message?.substring(0, 150) : String(reason).substring(0, 150),
      hint: 'This is usually a temporary network issue or incorrect SUPABASE_URL configuration'
    });
  } else {
    logger.error('Unhandled Rejection', { 
      promise: promise.toString(), 
      reason: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined
    });
  }
});

// Register shutdown handlers
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT')); 
process.on('SIGINT', () => gracefulShutdown('SIGINT')); 