import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import compression from 'compression';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

// Load environment variables
dotenv.config();

// Validate required environment variables
const requiredEnvVars = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_DB_URL',
  'JWT_SECRET',
  'CSRF_SECRET',
  'ENCRYPTION_KEY'
];

const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);

const app = express();

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
  crossOriginEmbedderPolicy: false
}));

// CORS configuration
// Allow requests from the same origin (Vercel deployment) or configured frontend URL
const allowedOrigins = process.env.FRONTEND_URL 
  ? process.env.FRONTEND_URL.split(',').map(url => url.trim())
  : [];

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) return callback(null, true);
    
    // Allow same-origin requests (for Vercel deployments where frontend and API are on same domain)
    if (origin.includes('vercel.app') || origin.includes('localhost')) {
      return callback(null, true);
    }
    
    // Check if origin is in allowed list
    if (allowedOrigins.length === 0 || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-CSRF-Token', 'X-XSRF-Token']
}));

// Compression middleware
app.use(compression({
  level: 6,
  threshold: 1024,
  filter: (req, res) => {
    if (req.headers['x-no-compression']) {
      return false;
    }
    return compression.filter(req, res);
  }
}));

// Optimized rate limiting for free tier
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'production' ? 2000 : 10000,
  message: {
    success: false,
    message: 'Too many requests from this IP, please try again later.',
    retryAfter: Math.round(15 * 60 * 1000 / 1000)
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    return req.path === '/health' || req.path === '/api/health';
  }
});

app.use(limiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Additional CORS headers (backup - main CORS is handled by cors middleware above)
app.use((req, res, next) => {
  const origin = req.headers.origin;
  // Only set CORS headers if origin is allowed
  if (origin && (
    origin.includes('vercel.app') || 
    origin.includes('localhost') ||
    (process.env.FRONTEND_URL && process.env.FRONTEND_URL.split(',').some(url => origin.includes(url.trim())))
  )) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Credentials', 'true');
  }
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, X-CSRF-Token, X-XSRF-Token');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

// Health check endpoint with database status
app.get('/health', async (req, res) => {
  try {
    const { testConnection } = await import('../backend/config/database.js').catch(() => ({ testConnection: () => false }));
    const cacheService = await import('../backend/services/cacheService.js').catch(() => ({ default: { getStats: () => ({}) } }));
    
    const dbStatus = await testConnection();
    const cacheStats = cacheService.default?.getStats?.() || {};
    
    res.json({ 
      status: missingEnvVars.length > 0 ? 'DEGRADED' : 'OK',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      version: process.env.npm_package_version || '1.0.0',
      database: dbStatus ? 'connected' : 'disconnected',
      cache: cacheStats,
      missingEnvVars: missingEnvVars.length > 0 ? missingEnvVars : undefined
    });
  } catch (error) {
    res.status(500).json({
      status: 'ERROR',
      message: 'Health check failed',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
      missingEnvVars: missingEnvVars.length > 0 ? missingEnvVars : undefined
    });
  }
});

// API health check
app.get('/api/health', async (req, res) => {
  try {
    const { testConnection } = await import('../backend/config/database.js').catch(() => ({ testConnection: () => false }));
    const dbStatus = await testConnection();
    res.json({ 
      status: missingEnvVars.length > 0 ? 'DEGRADED' : 'OK', 
      database: dbStatus ? 'connected' : 'disconnected',
      timestamp: new Date().toISOString(),
      missingEnvVars: missingEnvVars.length > 0 ? missingEnvVars : undefined
    });
  } catch (error) {
    res.status(500).json({
      status: 'ERROR',
      message: 'Health check failed',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
      missingEnvVars: missingEnvVars.length > 0 ? missingEnvVars : undefined
    });
  }
});

// Import and use routes with error handling
let routesLoaded = false;

async function loadRoutes() {
  if (routesLoaded) return;
  
  try {
    // Check for missing environment variables before loading routes
    if (missingEnvVars.length > 0) {
      console.error('Missing required environment variables:', missingEnvVars);
      // Don't throw - allow routes to load but they'll fail gracefully
    }

    const [
      authRoutes,
      assessmentRoutes,
      questionBankRoutes,
      userManagementRoutes,
      collegeRoutes,
      analyticsRoutes,
      emailRoutes,
      codingRoutes,
      superAdminRoutes,
      batchRoutes
    ] = await Promise.all([
      import('../backend/routes/auth.js').catch(err => {
        console.error('Failed to load auth routes:', err.message);
        return { default: (req, res) => res.status(500).json({ success: false, message: 'Route not available - check server logs' }) };
      }),
      import('../backend/routes/assessments.js').catch(err => {
        console.error('Failed to load assessment routes:', err.message);
        return { default: (req, res) => res.status(500).json({ success: false, message: 'Route not available - check server logs' }) };
      }),
      import('../backend/routes/questionBank.js').catch(err => {
        console.error('Failed to load questionBank routes:', err.message);
        return { default: (req, res) => res.status(500).json({ success: false, message: 'Route not available - check server logs' }) };
      }),
      import('../backend/routes/userManagement.js').catch(err => {
        console.error('Failed to load userManagement routes:', err.message);
        return { default: (req, res) => res.status(500).json({ success: false, message: 'Route not available - check server logs' }) };
      }),
      import('../backend/routes/colleges.js').catch(err => {
        console.error('Failed to load college routes:', err.message);
        return { default: (req, res) => res.status(500).json({ success: false, message: 'Route not available - check server logs' }) };
      }),
      import('../backend/routes/analytics.js').catch(err => {
        console.error('Failed to load analytics routes:', err.message);
        return { default: (req, res) => res.status(500).json({ success: false, message: 'Route not available - check server logs' }) };
      }),
      import('../backend/routes/email.js').catch(err => {
        console.error('Failed to load email routes:', err.message);
        return { default: (req, res) => res.status(500).json({ success: false, message: 'Route not available - check server logs' }) };
      }),
      import('../backend/routes/coding.js').catch(err => {
        console.error('Failed to load coding routes:', err.message);
        return { default: (req, res) => res.status(500).json({ success: false, message: 'Route not available - check server logs' }) };
      }),
      import('../backend/routes/superAdmin.js').catch(err => {
        console.error('Failed to load superAdmin routes:', err.message);
        return { default: (req, res) => res.status(500).json({ success: false, message: 'Route not available - check server logs' }) };
      }),
      import('../backend/routes/batches.js').catch(err => {
        console.error('Failed to load batch routes:', err.message);
        return { default: (req, res) => res.status(500).json({ success: false, message: 'Route not available - check server logs' }) };
      })
    ]);

    app.use('/api/auth', authRoutes.default);
    app.use('/api/assessments', assessmentRoutes.default);
    app.use('/api/question-bank', questionBankRoutes.default);
    app.use('/api/users', userManagementRoutes.default);
    app.use('/api/colleges', collegeRoutes.default);
    app.use('/api/analytics', analyticsRoutes.default);
    app.use('/api/email', emailRoutes.default);
    app.use('/api/coding', codingRoutes.default);
    app.use('/api/super-admin', superAdminRoutes.default);
    app.use('/api/batches', batchRoutes.default);
    
    routesLoaded = true;
  } catch (error) {
    console.error('Critical error loading routes:', error);
    // Add a catch-all route that provides helpful error message
    app.use('/api/*', (req, res) => {
      res.status(500).json({
        success: false,
        message: 'Server configuration error',
        error: 'Failed to initialize routes. Please check server logs and environment variables.',
        missingEnvVars: missingEnvVars.length > 0 ? missingEnvVars : undefined
      });
    });
  }
}

// Load routes asynchronously
loadRoutes();

// Error handling middleware - must be after all routes
app.use((error, req, res, next) => {
  console.error('Express error handler:', error);
  console.error('Error stack:', error.stack);
  console.error('Request path:', req.path);
  console.error('Request method:', req.method);
  
  // Ensure JSON response
  if (!res.headersSent) {
    res.setHeader('Content-Type', 'application/json');
  }
  
  // Check if it's a missing env var error
  if (missingEnvVars.length > 0 && !res.headersSent) {
    return res.status(500).json({ 
      success: false, 
      message: 'Server configuration error',
      error: 'Missing required environment variables',
      missingEnvVars: missingEnvVars,
      hint: 'Please set all required environment variables in Vercel project settings'
    });
  }
  
  if (!res.headersSent) {
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
      path: req.path
    });
  }
});

// 404 handler
app.use('*', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.status(404).json({
    success: false,
    message: 'API endpoint not found',
    path: req.path
  });
});

// Export handler for Vercel serverless functions
export default async (req, res) => {
  try {
    // Ensure routes are loaded before handling request
    if (!routesLoaded) {
      await loadRoutes();
    }
    
    // If critical env vars are missing, return helpful error
    if (missingEnvVars.length > 0 && !req.path.startsWith('/health')) {
      return res.status(500).json({
        success: false,
        message: 'Server configuration error',
        error: 'Missing required environment variables',
        missingEnvVars: missingEnvVars,
        hint: 'Please configure all required environment variables in Vercel project settings. See VERCEL_ENV_SETUP.md for details.'
      });
    }
    
    // Handle the request with Express app
    return app(req, res);
  } catch (error) {
    // Catch any unhandled errors and return proper JSON response
    console.error('Unhandled error in serverless function:', error);
    console.error('Error stack:', error.stack);
    
    // Make sure we haven't already sent a response
    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: process.env.NODE_ENV === 'development' ? error.message : 'An unexpected error occurred',
        missingEnvVars: missingEnvVars.length > 0 ? missingEnvVars : undefined
      });
    }
  }
};
