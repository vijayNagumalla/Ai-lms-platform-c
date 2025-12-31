# Vercel Environment Variables Setup Guide

## Critical: Required Environment Variables

Your serverless function is failing because required environment variables are missing. Follow this guide to set them up in Vercel.

## Step-by-Step Setup

### 1. Go to Vercel Project Settings

1. Open your Vercel dashboard: https://vercel.com/dashboard
2. Select your project: `ai-lms-platform-ten` (or your project name)
3. Click on **Settings** → **Environment Variables**

### 2. Add Required Environment Variables

Add each of the following variables. Click **Add** for each one:

#### **CRITICAL - Database Configuration**

```
SUPABASE_URL
```
**Value:** Your Supabase project URL (e.g., `https://xxxxx.supabase.co`)
- Find this in: Supabase Dashboard → Settings → API → Project URL

```
SUPABASE_SERVICE_ROLE_KEY
```
**Value:** Your Supabase service role key
- Find this in: Supabase Dashboard → Settings → API → service_role key (secret)
- ⚠️ **IMPORTANT:** This is a secret key - keep it secure!

```
SUPABASE_DB_URL
```
**Value:** Your Supabase database connection string
- Format: `postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres`
- Find this in: Supabase Dashboard → Settings → Database → Connection pooling → Connection string
- Make sure to URL-encode special characters in the password (e.g., `@` becomes `%40`)

#### **CRITICAL - Security Keys**

```
JWT_SECRET
```
**Value:** A secure random string (minimum 32 characters)
- Generate one: `openssl rand -hex 32` or use an online generator
- Example: `a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6`

```
CSRF_SECRET
```
**Value:** A secure random string (minimum 32 characters)
- Generate one: `openssl rand -hex 32`
- Example: `4c052540c317693173dbd2856a1a6c0d38ea8219a95705e12447826aac5e2a66`

```
ENCRYPTION_KEY
```
**Value:** A secure random string (minimum 32 characters)
- Generate one: `openssl rand -hex 32`
- Example: `b38580412fa3139b2aa1ae36c9d593b067ba277a9704bcb7d6123aac788a5602`

#### **IMPORTANT - Application Configuration**

```
FRONTEND_URL
```
**Value:** Your Vercel frontend URL
- Example: `https://ai-lms-platform-ten.vercel.app`
- For multiple environments: `https://ai-lms-platform-ten.vercel.app,https://your-preview-url.vercel.app`

```
NODE_ENV
```
**Value:** `production`

#### **OPTIONAL - Additional Configuration**

```
JWT_EXPIRES_IN
```
**Value:** `7d` (default: 7 days)

```
SUPER_ADMIN_REGISTRATION_CODE
```
**Value:** A secure random code (minimum 32 characters) for super admin registration
- Generate one: `openssl rand -hex 32`

```
GEMINI_API_KEY
```
**Value:** Your Google Gemini API key (if using AI features)

```
SMTP_HOST
```
**Value:** `smtp.gmail.com` (for Gmail)

```
SMTP_PORT
```
**Value:** `587`

```
SMTP_USER
```
**Value:** Your Gmail address

```
SMTP_PASS
```
**Value:** Your Gmail App Password (16 characters, not your regular password)
- See: [Gmail App Password Setup](GMAIL_EMAIL_SETUP_GUIDE.md)

## Environment Variable Settings

For each variable, set the **Environment** to:
- ✅ **Production**
- ✅ **Preview** 
- ✅ **Development** (optional, for local testing)

## Quick Setup Checklist

- [ ] `SUPABASE_URL` - Your Supabase project URL
- [ ] `SUPABASE_SERVICE_ROLE_KEY` - Service role key from Supabase
- [ ] `SUPABASE_DB_URL` - Database connection string (pooler)
- [ ] `JWT_SECRET` - Random 32+ character string
- [ ] `CSRF_SECRET` - Random 32+ character string
- [ ] `ENCRYPTION_KEY` - Random 32+ character string
- [ ] `FRONTEND_URL` - Your Vercel frontend URL
- [ ] `NODE_ENV` - Set to `production`

## After Adding Variables

1. **Redeploy** your application:
   - Go to **Deployments** tab
   - Click the **⋯** menu on the latest deployment
   - Select **Redeploy**

2. **Verify** the deployment:
   - Check the deployment logs for any errors
   - Visit: `https://your-app.vercel.app/api/health`
   - Should return: `{"status":"OK","database":"connected",...}`

3. **Test** your application:
   - Try logging in
   - Check browser console for errors
   - Verify API calls work

## Troubleshooting

### Still Getting 500 Errors?

1. **Check Vercel Function Logs:**
   - Go to **Deployments** → Click on latest deployment
   - Click **Functions** tab
   - Check for error messages

2. **Verify Environment Variables:**
   - Go to **Settings** → **Environment Variables**
   - Make sure all required variables are set
   - Check that values don't have extra spaces or quotes

3. **Test Health Endpoint:**
   - Visit: `https://your-app.vercel.app/api/health`
   - Check the `missingEnvVars` field in the response
   - Add any missing variables

4. **Check Database Connection:**
   - Verify `SUPABASE_DB_URL` is correct
   - Test connection string format
   - Ensure password is URL-encoded

### Common Issues

**Issue:** "Missing Supabase configuration"
- **Fix:** Add `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`

**Issue:** "Database connection failed"
- **Fix:** Check `SUPABASE_DB_URL` format and password encoding

**Issue:** "JWT_SECRET should be at least 32 characters"
- **Fix:** Generate a longer secret key (32+ characters)

**Issue:** "ENCRYPTION_KEY is required in production"
- **Fix:** Add `ENCRYPTION_KEY` environment variable

## Security Notes

⚠️ **IMPORTANT:**
- Never commit environment variables to Git
- Never share your `SUPABASE_SERVICE_ROLE_KEY` publicly
- Use different secrets for production and development
- Rotate secrets periodically

## Getting Your Supabase Credentials

1. **Go to Supabase Dashboard:** https://app.supabase.com
2. **Select your project**
3. **Settings** → **API:**
   - Copy **Project URL** → Use for `SUPABASE_URL`
   - Copy **service_role key** → Use for `SUPABASE_SERVICE_ROLE_KEY`
4. **Settings** → **Database:**
   - Go to **Connection pooling** section
   - Copy **Connection string** → Use for `SUPABASE_DB_URL`
   - Make sure to use the **pooler** connection string (port 6543)
   - Replace `[YOUR-PASSWORD]` with your actual database password (URL-encoded)

## Generating Secure Random Strings

### Using OpenSSL (Recommended)
```bash
# Generate JWT_SECRET
openssl rand -hex 32

# Generate CSRF_SECRET
openssl rand -hex 32

# Generate ENCRYPTION_KEY
openssl rand -hex 32

# Generate SUPER_ADMIN_REGISTRATION_CODE
openssl rand -hex 32
```

### Using Node.js
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Using Online Generator
- Visit: https://www.random.org/strings/
- Length: 64 characters
- Use hexadecimal characters (0-9, a-f)

## Next Steps

After setting up all environment variables:

1. ✅ Redeploy your application
2. ✅ Test the `/api/health` endpoint
3. ✅ Try logging in
4. ✅ Check Vercel function logs for any remaining errors
5. ✅ Monitor the application for 24 hours

## Need Help?

- Check Vercel Function Logs for detailed error messages
- Review the `/api/health` endpoint response
- See `VERCEL_DEPLOYMENT_FIX.md` for CORS-related issues
- Check Supabase Dashboard for database connection issues


