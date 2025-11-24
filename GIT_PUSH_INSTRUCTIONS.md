# 🔐 Git Push Instructions

## Issue: Authentication Error

You're getting a 403 error because Git is using a different GitHub account (`Nvijaysundar`) than the repository owner (`vijayNagumalla`).

## Solution Options

### Option 1: Use Personal Access Token (Recommended)

1. **Generate a Personal Access Token:**
   - Go to GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)
   - Click "Generate new token (classic)"
   - Give it a name: "AI LMS Platform"
   - Select scopes: `repo` (full control of private repositories)
   - Click "Generate token"
   - **Copy the token** (you won't see it again!)

2. **Push using the token:**
   ```bash
   git push https://YOUR_TOKEN@github.com/vijayNagumalla/Ai-lms-platform.git main
   ```
   Replace `YOUR_TOKEN` with your actual token.

### Option 2: Update Git Credentials

1. **Clear old credentials:**
   ```bash
   git credential-manager erase
   ```
   Then enter:
   ```
   protocol=https
   host=github.com
   ```

2. **Push again:**
   ```bash
   git push -u origin main
   ```
   When prompted, enter:
   - Username: `vijayNagumalla`
   - Password: Your Personal Access Token (not your GitHub password)

### Option 3: Use SSH (Alternative)

1. **Switch to SSH:**
   ```bash
   git remote set-url origin git@github.com:vijayNagumalla/Ai-lms-platform.git
   ```

2. **Set up SSH key** (if not already done):
   - Generate SSH key: `ssh-keygen -t ed25519 -C "your_email@example.com"`
   - Add to GitHub: Settings → SSH and GPG keys → New SSH key
   - Copy public key: `cat ~/.ssh/id_ed25519.pub`

3. **Push:**
   ```bash
   git push -u origin main
   ```

## Quick Fix (Easiest)

Run this command and enter your GitHub credentials when prompted:

```bash
git push -u origin main
```

When asked for credentials:
- **Username:** `vijayNagumalla`
- **Password:** Use a Personal Access Token (not your GitHub password)

## Generate Personal Access Token

1. Go to: https://github.com/settings/tokens
2. Click "Generate new token (classic)"
3. Name: "AI LMS Platform"
4. Expiration: 90 days (or your preference)
5. Scopes: Check `repo`
6. Click "Generate token"
7. Copy the token immediately

## After Successful Push

Your code will be available at:
**https://github.com/vijayNagumalla/Ai-lms-platform**

Then you can deploy to Vercel by:
1. Going to [vercel.com](https://vercel.com)
2. Importing the repository
3. Following the deployment guide

