/**
 * Test different connection string formats to find the working one
 */

import pg from 'pg';
const { Pool } = pg;

const projectRef = 'zhacsxhsjgfnniefmadh';
const password = 'Vijay%402607%40';
const region = 'ap-south-1';

const connectionStrings = [
  {
    name: 'Connection Pooling (postgres.[project-ref])',
    url: `postgresql://postgres.${projectRef}:${password}@aws-0-${region}.pooler.supabase.com:6543/postgres`
  },
  {
    name: 'Connection Pooling (aws-1 instead of aws-0)',
    url: `postgresql://postgres.${projectRef}:${password}@aws-1-${region}.pooler.supabase.com:6543/postgres`
  },
  {
    name: 'Direct Connection (port 5432)',
    url: `postgresql://postgres:${password}@db.${projectRef}.supabase.co:5432/postgres`
  },
  {
    name: 'Connection Pooling (just postgres username)',
    url: `postgresql://postgres:${password}@aws-0-${region}.pooler.supabase.com:6543/postgres`
  }
];

async function testConnection(name, connectionString) {
  console.log(`\n🧪 Testing: ${name}`);
  console.log(`   ${connectionString.replace(/:([^:@]+)@/, ':***@')}`);
  
  const pool = new Pool({
    connectionString: connectionString,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
  });

  try {
    const client = await Promise.race([
      pool.connect(),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Connection timeout')), 10000)
      )
    ]);
    
    // Test a simple query
    const result = await client.query('SELECT version()');
    client.release();
    await pool.end();
    
    console.log(`   ✅ SUCCESS! Connected successfully`);
    console.log(`   PostgreSQL version: ${result.rows[0].version.substring(0, 50)}...`);
    return true;
  } catch (error) {
    await pool.end().catch(() => {});
    console.log(`   ❌ FAILED: ${error.message}`);
    return false;
  }
}

async function main() {
  console.log('\n🔍 Testing Supabase Connection Strings\n');
  console.log('='.repeat(70));
  
  // First, try to read from .env if available
  const dotenv = await import('dotenv');
  const { fileURLToPath } = await import('url');
  const { dirname, join } = await import('path');
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  
  dotenv.config({ path: join(__dirname, '..', '.env') });
  const envConnectionString = process.env.SUPABASE_DB_URL;
  
  if (envConnectionString) {
    console.log('\n📋 Testing connection string from .env file:');
    const success = await testConnection('From .env file', envConnectionString);
    if (success) {
      console.log(`\n✅ YOUR .ENV CONNECTION STRING WORKS!\n`);
      console.log('The connection string in your .env file is correct.');
      console.log('The issue might be with how it\'s being loaded. Check server logs.\n');
      return;
    }
    console.log('\n⚠️  Connection string from .env file failed. Testing alternatives...\n');
  }
  
  for (const conn of connectionStrings) {
    const success = await testConnection(conn.name, conn.url);
    if (success) {
      console.log(`\n✅ WORKING CONNECTION STRING FOUND!\n`);
      console.log(`Add this to your backend/.env file:\n`);
      console.log(`SUPABASE_DB_URL=${conn.url}\n`);
      console.log('='.repeat(70));
      return;
    }
  }
  
  console.log(`\n❌ None of the connection strings worked.\n`);
  console.log('📝 NEXT STEPS:');
  console.log('1. Go to Supabase Dashboard → Settings → Database');
  console.log('2. Copy the EXACT connection string from "Connection pooling" section');
  console.log('3. Replace [YOUR-PASSWORD] with your URL-encoded password');
  console.log('4. Update your backend/.env file with the exact string');
  console.log('5. See GET_EXACT_CONNECTION_STRING.md for detailed instructions\n');
  console.log('💡 The connection string format might be different than expected.');
  console.log('   Supabase provides the exact format in their dashboard.\n');
}

main().catch(console.error);

