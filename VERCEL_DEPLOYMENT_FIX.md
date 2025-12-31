# Vercel Deployment Fix - Login 500 Error

## Problem
After deploying to Vercel, the login endpoint was returning a 500 error with "A server error has occurred" instead of a proper JSON error response.

## Root Cause
1. **Process Exit on Missing Config**: The database configuration was calling `process.exit(1)` when Supabase environment variables were missing, which killed the serverless function immediately.
2. **Missing Error Handling**: Errors weren't being properly caught and returned as JSON responses.

## Fixes Applied

### 1. Database Configuration (`backend/config/database.js`)
- **Removed `process.exit(1)`**: Changed to gracefully handle missing configuration instead of exiting the process
- **Added Configuration Check**: Added early validation in the `query()` function to return helpful errors when configuration is missing
- **Preserved Error Properties**: Ensured error properties (isConfigError, code, etc.) are preserved through the error chain

### 2. Login Controller (`backend/controllers/authController.js`)
- **Added Config Error Handling**: Added specific handling for missing configuration errors
- **Improved Error Messages**: Returns helpful JSON error responses with hints about missing environment variables

### 3. Serverless Function (`api/index.js`)
- **Already had proper error handling**: The serverless function wrapper already catches errors and returns JSON responses

## Required Environment Variables in Vercel

Make sure these environment variables are set in your Vercel project settings:

### Critical (Required)
- `SUPABASE_URL` - Your Supabase project URL (e.g., `https://xxxxx.supabase.co`)
- `SUPABASE_SERVICE_ROLE_KEY` - Your Supabase service role key (from Settings → API)
- `SUPABASE_DB_URL` - Direct PostgreSQL connection string (optional but recommended for better performance)
- `JWT_SECRET` - Secret key for JWT tokens (minimum 32 characters)
- `CSRF_SECRET` - Secret key for CSRF protection (minimum 32 characters)
- `ENCRYPTION_KEY` - Encryption key for sensitive data (minimum 32 characters)

### Optional (Recommended)
- `FRONTEND_URL` - Your frontend URL (for CORS)
- `NODE_ENV` - Set to `production` for production deployments
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` - For email functionality

## How to Set Environment Variables in Vercel

1. Go to your Vercel project dashboard
2. Navigate to **Settings** → **Environment Variables**
3. Add each variable with its value
4. Make sure to select the correct environment (Production, Preview, Development)
5. Redeploy your application after adding variables

## Testing the Fix

After setting environment variables and redeploying:

1. **Check Health Endpoint**: 
   ```
   GET https://your-app.vercel.app/api/health
   ```
   Should return status and database connection info

2. **Test Login**:
   ```
   POST https://your-app.vercel.app/api/auth/login
   Content-Type: application/json
   
   {
     "email": "test@example.com",
     "password": "password123"
   }
   ```
   Should return proper JSON response (success or error), not "A server error has occurred"

## Error Response Format

All errors now return proper JSON:

```json
{
  "success": false,
  "message": "Server configuration error",
  "error": "Database configuration is missing. Please check environment variables.",
  "hint": "Ensure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set in Vercel project settings"
}
```

## Additional Notes

- The serverless function now handles missing configuration gracefully
- Errors are logged to Vercel function logs for debugging
- All responses are properly formatted as JSON
- The application won't crash if environment variables are missing (will return helpful error messages instead)
