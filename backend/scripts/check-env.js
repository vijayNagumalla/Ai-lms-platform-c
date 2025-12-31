/**
 * Helper script to check .env file configuration
 * 
 * Usage:
 * node backend/scripts/check-env.js
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, readFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Path to .env file in backend directory
const envPath = join(__dirname, '..', '.env');

console.log('\n🔍 Checking .env file configuration...\n');
console.log(`Looking for .env file at: ${envPath}\n`);

// Check if .env file exists
if (!existsSync(envPath)) {
  console.log('❌ .env file NOT FOUND!');
  console.log(`\n📝 To fix this:\n`);
  console.log(`1. Create a .env file in the backend directory:`);
  console.log(`   ${envPath}`);
  console.log(`\n2. Copy from env.example:`);
  console.log(`   cp backend/env.example backend/.env`);
  console.log(`\n3. Add your SUPABASE_DB_URL (get it from Supabase Dashboard):`);
  console.log(`   SUPABASE_DB_URL=postgresql://postgres.[PROJECT_REF]:[YOUR_PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres`);
  console.log(`   Replace [PROJECT_REF], [YOUR_PASSWORD], and [REGION] with your actual values`);
  process.exit(1);
}

console.log('✅ .env file found!\n');

// Load .env file
const envResult = dotenv.config({ path: envPath });

if (envResult.error) {
  console.log('❌ Error loading .env file:');
  console.log(`   ${envResult.error.message}\n`);
  process.exit(1);
}

console.log('✅ .env file loaded successfully!\n');

// Check for SUPABASE_DB_URL
const supabaseDbUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;

console.log('📊 Environment Variables Check:\n');

if (supabaseDbUrl) {
  // Mask password in connection string
  const maskedUrl = supabaseDbUrl.replace(/:([^:@]+)@/, ':***@');
  console.log('✅ SUPABASE_DB_URL is set');
  console.log(`   ${maskedUrl}\n`);
  
  // Check if password might need encoding
  const urlMatch = supabaseDbUrl.match(/postgresql:\/\/[^:]+:([^@]+)@/);
  if (urlMatch && urlMatch[1]) {
    const passwordInUrl = urlMatch[1];
    const isAlreadyEncoded = /%[0-9A-Fa-f]{2}/.test(passwordInUrl);
    
    if (!isAlreadyEncoded && (passwordInUrl.includes('@') || passwordInUrl.includes('#') || 
        passwordInUrl.includes('&') || passwordInUrl.includes('+') || passwordInUrl.includes('=') ||
        passwordInUrl.includes('/') || passwordInUrl.includes('?'))) {
      console.log('⚠️  WARNING: Password contains special characters that may need URL encoding!');
      console.log(`   Current password: ${passwordInUrl}`);
      console.log(`   Should be: ${encodeURIComponent(passwordInUrl)}\n`);
    } else {
      console.log('✅ Password appears to be properly encoded\n');
    }
  }
} else {
  console.log('❌ SUPABASE_DB_URL is NOT set!');
  console.log('\n📝 To fix this, add to your .env file:');
  console.log('\n   SUPABASE_DB_URL=postgresql://postgres.[PROJECT_REF]:[YOUR_PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres');
  console.log('\n   Get the exact connection string from Supabase Dashboard → Settings → Database');
  console.log('   Copy the entire connection string (it will have the password already set)\n');
}

// Check other Supabase variables
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

console.log('📋 Other Supabase Variables:');
console.log(`   SUPABASE_URL: ${supabaseUrl ? '✅ Set' : '❌ Not set'}`);
console.log(`   SUPABASE_SERVICE_ROLE_KEY: ${process.env.SUPABASE_SERVICE_ROLE_KEY ? '✅ Set' : '❌ Not set'}`);
console.log(`   SUPABASE_ANON_KEY: ${process.env.SUPABASE_ANON_KEY ? '✅ Set' : '❌ Not set'}\n`);

if (!supabaseDbUrl) {
  console.log('💡 Tip: Run this script after adding SUPABASE_DB_URL to verify it\'s loaded correctly.\n');
  process.exit(1);
}

console.log('✅ All checks passed! Your .env file is configured correctly.\n');
console.log('💡 Restart your server to apply changes.\n');

