// LOW PRIORITY FIX: Helper functions for consistent error handling
// Makes it easier to use standardized error responses in controllers

import { createErrorResponse, getStatusCode, ErrorCodes } from './errorCodes.js';
import logger from './logger.js';

/**
 * Send standardized error response
 * @param {Object} res - Express response object
 * @param {string} errorCode - Error code from ErrorCodes
 * @param {Object} details - Additional error details
 * @param {number} customStatusCode - Optional custom status code
 */
export function sendErrorResponse(res, errorCode, details = null, customStatusCode = null) {
  const statusCode = customStatusCode || getStatusCode(errorCode);
  const response = createErrorResponse(errorCode, details);
  
  if (statusCode >= 500) {
    logger.error('Server error response', { errorCode, details });
  } else if (statusCode >= 400) {
    logger.warn('Client error response', { errorCode, details });
  }
  
  return res.status(statusCode).json(response);
}

/**
 * Handle database errors consistently
 * @param {Object} res - Express response object
 * @param {Error} error - Database error
 * @param {string} requestId - Request ID for tracking
 */
export function handleDatabaseError(res, error, requestId = null) {
  logger.logError(error, { context: 'database', requestId });
  
  if (error.code === 'ER_DUP_ENTRY' || error.code === '23505' || error.message?.includes('duplicate key') || error.message?.includes('unique constraint')) {
    return sendErrorResponse(res, 'RESOURCE_ALREADY_EXISTS', { requestId });
  }
  
  if (error.code === 'ER_NO_REFERENCED_ROW_2' || error.code === '23503' || error.message?.includes('foreign key') || error.message?.includes('violates foreign key constraint')) {
    return sendErrorResponse(res, 'VALIDATION_INVALID_INPUT', { 
      message: 'Invalid reference',
      requestId 
    });
  }
  
  if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
    return sendErrorResponse(res, 'SERVER_DATABASE_ERROR', { 
      message: 'Database connection failed',
      requestId 
    });
  }
  
  return sendErrorResponse(res, 'SERVER_DATABASE_ERROR', { requestId });
}

/**
 * Handle validation errors consistently
 * @param {Object} res - Express response object
 * @param {Array|string} errors - Validation errors
 * @param {string} requestId - Request ID for tracking
 */
export function handleValidationError(res, errors, requestId = null) {
  const errorList = Array.isArray(errors) ? errors : [errors];
  return sendErrorResponse(res, 'VALIDATION_INVALID_INPUT', {
    errors: errorList,
    requestId
  });
}

/**
 * Handle authentication errors consistently
 * @param {Object} res - Express response object
 * @param {string} message - Error message
 * @param {string} requestId - Request ID for tracking
 */
export function handleAuthError(res, message = 'Authentication required', requestId = null) {
  return sendErrorResponse(res, 'AUTH_REQUIRED', { message, requestId });
}

/**
 * Handle authorization errors consistently
 * @param {Object} res - Express response object
 * @param {string} message - Error message
 * @param {string} requestId - Request ID for tracking
 */
export function handleAuthorizationError(res, message = 'Insufficient permissions', requestId = null) {
  return sendErrorResponse(res, 'AUTH_INSUFFICIENT_PERMISSIONS', { message, requestId });
}

/**
 * Handle not found errors consistently
 * @param {Object} res - Express response object
 * @param {string} resource - Resource name
 * @param {string} requestId - Request ID for tracking
 */
export function handleNotFoundError(res, resource = 'Resource', requestId = null) {
  return sendErrorResponse(res, 'RESOURCE_NOT_FOUND', {
    message: `${resource} not found`,
    requestId
  });
}

export default {
  sendErrorResponse,
  handleDatabaseError,
  handleValidationError,
  handleAuthError,
  handleAuthorizationError,
  handleNotFoundError,
  ErrorCodes
};

