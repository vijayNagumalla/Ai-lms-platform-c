import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import compression from 'compression';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { testConnection } from '../backend/config/database.js';
import cacheService from '../backend/services/cacheService.js';

// Load environment variables
dotenv.config();

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
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
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

// CORS headers
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

// Health check endpoint with database status
app.get('/health', async (req, res) => {
  const dbStatus = await testConnection();
  const cacheStats = cacheService.getStats();
  
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    version: process.env.npm_package_version || '1.0.0',
    database: dbStatus ? 'connected' : 'disconnected',
    cache: cacheStats
  });
});

// API health check
app.get('/api/health', async (req, res) => {
  const dbStatus = await testConnection();
  res.json({ 
    status: 'OK', 
    database: dbStatus ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString()
  });
});

// Import and use routes
import authRoutes from '../backend/routes/auth.js';
import assessmentRoutes from '../backend/routes/assessments.js';
import questionBankRoutes from '../backend/routes/questionBank.js';
import userManagementRoutes from '../backend/routes/userManagement.js';
import collegeRoutes from '../backend/routes/colleges.js';
import analyticsRoutes from '../backend/routes/analytics.js';
import emailRoutes from '../backend/routes/email.js';
import codingRoutes from '../backend/routes/coding.js';
import superAdminRoutes from '../backend/routes/superAdmin.js';
import batchRoutes from '../backend/routes/batches.js';

app.use('/api/auth', authRoutes);
app.use('/api/assessments', assessmentRoutes);
app.use('/api/question-bank', questionBankRoutes);
app.use('/api/users', userManagementRoutes);
app.use('/api/colleges', collegeRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/email', emailRoutes);
app.use('/api/coding', codingRoutes);
app.use('/api/super-admin', superAdminRoutes);
app.use('/api/batches', batchRoutes);

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Error:', error);
  res.status(500).json({ 
    success: false, 
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? error.message : undefined
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'API endpoint not found',
    path: req.path
  });
});

// Export handler for Vercel serverless functions
export default (req, res) => {
  return app(req, res);
};
