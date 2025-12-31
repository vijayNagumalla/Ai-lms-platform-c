# Vercel Serverless Function Dependencies Fix

## Problem
Vercel serverless functions were failing with:
```
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'express' imported from /var/task/api/index.js
```

## Root Cause
- Vercel serverless functions only install dependencies from the root `package.json`
- Backend dependencies (express, cors, dotenv, etc.) were in `backend/package.json`
- The `api/index.js` file imports these packages but they weren't available in the serverless function environment

## Fixes Applied

### 1. Added Backend Dependencies to Root `package.json`
Added all critical backend dependencies to the root `package.json`:
- `express` - Web framework
- `cors` - CORS middleware
- `dotenv` - Environment variable loading
- `compression` - Response compression
- `helmet` - Security headers
- `express-rate-limit` - Rate limiting
- `cookie-parser` - Cookie parsing
- `csrf` - CSRF protection
- `jsonwebtoken` - JWT tokens
- `bcryptjs` - Password hashing
- `axios` - HTTP client
- `nodemailer` - Email sending
- `winston` - Logging
- `uuid` - UUID generation
- `@supabase/supabase-js` - Supabase client
- `@google/generative-ai` - Gemini AI
- `pg` - PostgreSQL client (already present)

### 2. Updated `vercel.json`
- Added `installCommand` to install backend dependencies: `npm install && npm install --prefix backend`
- Added `includeFiles: "backend/**"` to ensure backend files are included in the function bundle
- Updated `buildCommand` to install backend dependencies before building

### 3. Updated Build Script
- Modified `vercel-build` script to install backend dependencies: `npm install --prefix backend && vite build`

## Files Changed
- `package.json` - Added backend dependencies
- `vercel.json` - Added installCommand and includeFiles
- `package.json` scripts - Updated vercel-build command

## How It Works

1. **Install Phase**: Vercel runs `npm install && npm install --prefix backend`
   - Installs root dependencies (including newly added backend deps)
   - Installs backend dependencies in backend/ directory

2. **Build Phase**: Vercel runs `npm run vercel-build`
   - Installs backend dependencies again (safety measure)
   - Builds the frontend with Vite

3. **Function Bundle**: Vercel bundles the serverless function
   - Includes `api/index.js`
   - Includes `backend/**` files (via includeFiles)
   - Includes `node_modules` with all dependencies

## Verification

After deployment, check:
1. Serverless function logs should not show "Cannot find package" errors
2. API endpoints should respond correctly
3. Login endpoint should work without 500 errors

## Alternative Approach (if issues persist)

If the above doesn't work, you can:
1. Move all backend code to the root directory (not recommended - breaks structure)
2. Use a monorepo setup with proper workspace configuration
3. Bundle backend dependencies using a bundler like esbuild or webpack

## Notes

- Backend dependencies are now duplicated in both root and backend package.json
- This is intentional to ensure Vercel can resolve them
- The backend can still use its own package.json for local development
- Vercel will use the root package.json for serverless functions

