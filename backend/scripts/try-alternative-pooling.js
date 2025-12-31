/**
 * Try alternative connection pooling formats
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import pg from 'pg';
const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '..', '.env') });

// SECURITY FIX: Read from environment variables
const password = process.env.SUPABASE_DB_PASSWORD;
const projectRef = process.env.SUPABASE_PROJECT_REF || 'zhacsxhsjgfnniefmadh';
const region = process.env.SUPABASE_REGION || 'ap-south-1';

if (!password) {
  console.error('❌ ERROR: SUPABASE_DB_PASSWORD environment variable is required');
  console.error('   Set it in your backend/.env file');
  process.exit(1);
}

const encodedPassword = encodeURIComponent(password);

// Try different connection pooling formats
const formats = [
  {
    name: 'Format 1: postgres.[project-ref] with aws-0',
    url: `postgresql://postgres.${projectRef}:${encodedPassword}@aws-0-${region}.pooler.supabase.com:6543/postgres`
  },
  {
    name: 'Format 2: postgres.[project-ref] with aws-1',
    url: `postgresql://postgres.${projectRef}:${encodedPassword}@aws-1-${region}.pooler.supabase.com:6543/postgres`
  },
  {
    name: 'Format 3: Just postgres username with aws-0',
    url: `postgresql://postgres:${encodedPassword}@aws-0-${region}.pooler.supabase.com:6543/postgres`
  },
  {
    name: 'Format 4: Just postgres username with aws-1',
    url: `postgresql://postgres:${encodedPassword}@aws-1-${region}.pooler.supabase.com:6543/postgres`
  },
  {
    name: 'Format 5: postgres.[project-ref] with transaction mode',
    url: `postgresql://postgres.${projectRef}:${encodedPassword}@aws-0-${region}.pooler.supabase.com:6543/postgres?pgbouncer=true`
  }
];

async function testFormat(name, url) {
  console.log(`\n🧪 Testing: ${name}`);
  console.log(`   ${url.replace(/:([^:@]+)@/, ':***@')}`);
  
  const pool = new Pool({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
  });

  try {
    const client = await Promise.race([
      pool.connect(),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Timeout')), 15000)
      )
    ]);
    
    const result = await client.query('SELECT version()');
    client.release();
    await pool.end();
    
    console.log(`   ✅ SUCCESS!`);
    console.log(`\n🎉 WORKING FORMAT FOUND!\n`);
    console.log(`Add this to your backend/.env file:\n`);
    console.log(`SUPABASE_DB_URL=${url}\n`);
    return true;
  } catch (error) {
    await pool.end().catch(() => {});
    const errorMsg = error.message.includes('Tenant') ? 'Tenant/user not found' : 
                     error.message.includes('password') ? 'Password auth failed' :
                     error.message.includes('Timeout') ? 'Connection timeout' : error.message;
    console.log(`   ❌ ${errorMsg}`);
    return false;
  }
}

async function main() {
  console.log('\n🔍 Testing Alternative Connection Pooling Formats\n');
  console.log('='.repeat(70));
  
  for (const format of formats) {
    const success = await testFormat(format.name, format.url);
    if (success) {
      return;
    }
  }
  
  console.log(`\n❌ None of the standard formats worked.\n`);
  console.log('📝 You need to get the EXACT connection string from Supabase Dashboard:\n');
  console.log('   1. Go to Supabase Dashboard → Settings → Database');
  console.log('   2. Find "Connection pooling" section');
  console.log('   3. Copy the EXACT connection string shown');
  console.log('   4. Replace [YOUR-PASSWORD] with your URL-encoded password');
  console.log('   5. Update your .env file\n');
  console.log('💡 The format might be different than standard formats.\n');
}

main().catch(console.error);

