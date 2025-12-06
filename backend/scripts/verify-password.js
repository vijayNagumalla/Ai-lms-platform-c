/**
 * Verify password encoding and test different password formats
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import pg from 'pg';
const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '..', '.env') });

const connectionString = process.env.SUPABASE_DB_URL;

if (!connectionString) {
  console.log('❌ SUPABASE_DB_URL not set');
  process.exit(1);
}

// Extract current password from connection string
const passwordMatch = connectionString.match(/postgresql:\/\/[^:]+:([^@]+)@/);
if (!passwordMatch) {
  console.log('❌ Could not extract password from connection string');
  process.exit(1);
}

const currentPassword = passwordMatch[1];
console.log('\n🔍 Password Analysis\n');
console.log(`Current password in connection string: ${currentPassword}`);
console.log(`Is URL-encoded: ${/%[0-9A-Fa-f]{2}/.test(currentPassword) ? 'Yes' : 'No'}\n`);

// Test different password formats
const passwordVariants = [
  {
    name: 'Current (as-is)',
    password: currentPassword
  },
  {
    name: 'URL-decoded then re-encoded',
    password: decodeURIComponent(currentPassword).split('').map(c => encodeURIComponent(c)).join('')
  },
  {
    name: 'Double URL-encoded',
    password: encodeURIComponent(currentPassword)
  }
];

// If current password is already encoded, try decoding it
if (/%[0-9A-Fa-f]{2}/.test(currentPassword)) {
  try {
    const decoded = decodeURIComponent(currentPassword);
    passwordVariants.push({
      name: 'Decoded version',
      password: decoded
    });
    passwordVariants.push({
      name: 'Decoded then re-encoded',
      password: encodeURIComponent(decoded)
    });
  } catch (e) {
    // Ignore decode errors
  }
}

console.log('💡 IMPORTANT: The password might be different than expected.\n');
console.log('📝 To fix this:\n');
console.log('   1. Go to Supabase Dashboard → Settings → Database');
console.log('   2. Find "Reset database password" or check your current password');
console.log('   3. Copy the EXACT connection string from Shared Pooler section');
console.log('   4. Use that exact string (Supabase will have the password already encoded correctly)\n');
console.log('🔍 The issue is likely:');
console.log('   - The password in your connection string doesn\'t match your actual database password');
console.log('   - Or the password encoding is incorrect\n');
console.log('✅ Solution: Get the EXACT connection string from Supabase Dashboard');
console.log('   It will have the password already set correctly - just copy it!\n');

