/**
 * Test the exact connection string format from Supabase
 */

import pg from 'pg';
const { Pool } = pg;

// SECURITY FIX: Read from environment variables
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '..', '.env') });

const password = process.env.SUPABASE_DB_PASSWORD;
const projectRef = process.env.SUPABASE_PROJECT_REF || 'zhacsxhsjgfnniefmadh';
const region = process.env.SUPABASE_REGION || 'ap-south-1';

if (!password) {
  console.error('❌ ERROR: SUPABASE_DB_PASSWORD environment variable is required');
  console.error('   Set it in your backend/.env file');
  process.exit(1);
}

// Test different password encoding formats
const encodedPassword = encodeURIComponent(password);
const connectionStrings = [
  // Option 1: URL-encoded (recommended)
  `postgresql://postgres.${projectRef}:${encodedPassword}@aws-1-${region}.pooler.supabase.com:5432/postgres`,
  
  // Option 2: Raw password (not encoded)
  `postgresql://postgres.${projectRef}:${password}@aws-1-${region}.pooler.supabase.com:5432/postgres`,
  
  // Option 3: Try with aws-0 instead of aws-1
  `postgresql://postgres.${projectRef}:${encodedPassword}@aws-0-${region}.pooler.supabase.com:6543/postgres`,
];

console.log('\n🔍 Testing Connection String Formats\n');
console.log('='.repeat(70));

for (let i = 0; i < connectionStrings.length; i++) {
  const connStr = connectionStrings[i];
  const masked = connStr.replace(/:([^:@]+)@/, ':***@');
  
  console.log(`\n🧪 Test ${i + 1}:`);
  console.log(`   ${masked}`);
  
  const pool = new Pool({
    connectionString: connStr,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
  });

  try {
    const client = await Promise.race([
      pool.connect(),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Timeout')), 10000)
      )
    ]);
    
    const result = await client.query('SELECT version()');
    client.release();
    await pool.end();
    
    console.log(`   ✅ SUCCESS!`);
    console.log(`\n🎉 WORKING CONNECTION STRING FOUND!\n`);
    console.log(`Add this to your backend/.env file:\n`);
    console.log(`SUPABASE_DB_URL=${connStr}\n`);
    process.exit(0);
  } catch (error) {
    await pool.end().catch(() => {});
    const errorMsg = error.message.includes('password') ? 'Password auth failed' : 
                     error.message.includes('Tenant') ? 'Tenant/user not found' :
                     error.message.includes('Timeout') ? 'Connection timeout' : 
                     error.message.substring(0, 50);
    console.log(`   ❌ ${errorMsg}`);
  }
}

console.log(`\n❌ None of the formats worked.\n`);
console.log('📝 The password in your Supabase connection string might be different.\n');
console.log('💡 IMPORTANT:');
console.log('   When Supabase shows the connection string, it might have the password');
console.log('   already set. Copy the ENTIRE string exactly as shown, including the password part.\n');
console.log('✅ SOLUTION:');
console.log('   1. In Supabase Dashboard, look for a "Copy" or "Reveal" button');
console.log('   2. Click it to get the connection string with the actual password');
console.log('   3. Copy that ENTIRE string (don\'t modify anything)');
console.log('   4. Paste it into your .env file\n');

