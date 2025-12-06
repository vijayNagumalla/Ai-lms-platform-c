/**
 * Test different Shared Pooler connection string formats
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import pg from 'pg';
const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '..', '.env') });

const projectRef = 'zhacsxhsjgfnniefmadh';
const region = 'ap-south-1';
const hostname = `aws-1-${region}.pooler.supabase.com`;

// Test different password formats
const passwords = [
  'Vijay%402607%40',  // Current (URL-encoded)
  'Vijay@2607@',      // Raw password (not encoded)
  encodeURIComponent('Vijay@2607@'), // Re-encoded
];

// Test different username formats
const usernames = [
  `postgres.${projectRef}`,  // Current format
  'postgres',                 // Just postgres
];

console.log('\n🔍 Testing Shared Pooler Connection String Formats\n');
console.log('='.repeat(70));

let tested = 0;
let success = false;

for (const username of usernames) {
  for (const password of passwords) {
    tested++;
    const connectionString = `postgresql://${username}:${password}@${hostname}:6543/postgres`;
    
    console.log(`\n🧪 Test ${tested}: username="${username}", password="${password.substring(0, 10)}..."`);
    
    const pool = new Pool({
      connectionString: connectionString,
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
      console.log(`\n🎉 WORKING FORMAT FOUND!\n`);
      console.log(`Add this to your backend/.env file:\n`);
      console.log(`SUPABASE_DB_URL=${connectionString}\n`);
      success = true;
      break;
    } catch (error) {
      await pool.end().catch(() => {});
      const errorMsg = error.message.includes('password') ? 'Password auth failed' : 
                       error.message.includes('Tenant') ? 'Tenant/user not found' :
                       error.message.includes('Timeout') ? 'Connection timeout' : 
                       error.message.substring(0, 50);
      console.log(`   ❌ ${errorMsg}`);
    }
  }
  
  if (success) break;
}

if (!success) {
  console.log(`\n❌ None of the tested formats worked (${tested} combinations tested).\n`);
  console.log('📝 This means:');
  console.log('   1. The database password might be different than expected');
  console.log('   2. The username format for Shared Pooler might be different');
  console.log('   3. You need to get the EXACT connection string from Supabase Dashboard\n');
  console.log('✅ SOLUTION:');
  console.log('   1. Go to Supabase Dashboard → Settings → Database');
  console.log('   2. Find "Shared Pooler" or "Connection pooling" section');
  console.log('   3. Copy the EXACT connection string shown (it will have password already set)');
  console.log('   4. Update your .env file with that exact string\n');
  console.log('💡 The connection string from Supabase will have the correct format and password!\n');
}

