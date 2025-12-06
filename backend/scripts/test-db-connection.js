/**
 * Test if the PostgreSQL connection is working
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import pg from 'pg';
const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env
const envPath = join(__dirname, '..', '.env');
dotenv.config({ path: envPath });

const connectionString = process.env.SUPABASE_DB_URL;

if (!connectionString) {
  console.log('❌ SUPABASE_DB_URL not set in .env file');
  process.exit(1);
}

console.log('\n🧪 Testing PostgreSQL Connection...\n');
console.log(`Connection string: ${connectionString.replace(/:([^:@]+)@/, ':***@')}\n`);

const pool = new Pool({
  connectionString: connectionString,
  ssl: connectionString.includes('supabase') ? { rejectUnauthorized: false } : false,
  connectionTimeoutMillis: 20000,
});

try {
  console.log('⏳ Connecting...');
  const client = await Promise.race([
    pool.connect(),
    new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Connection timeout after 20 seconds')), 20000)
    )
  ]);
  
  console.log('✅ Connected successfully!\n');
  
  console.log('⏳ Testing query...');
  const result = await client.query('SELECT version(), current_database()');
  client.release();
  
  console.log('✅ Query executed successfully!\n');
  console.log('Database Info:');
  console.log(`  Database: ${result.rows[0].current_database}`);
  console.log(`  PostgreSQL: ${result.rows[0].version.substring(0, 60)}...\n`);
  
  await pool.end();
  console.log('✅ Connection test PASSED! Your database connection is working.\n');
  process.exit(0);
} catch (error) {
  await pool.end().catch(() => {});
  console.log('❌ Connection test FAILED!\n');
  console.log(`Error: ${error.message}\n`);
  
  if (error.message.includes('password authentication failed')) {
    console.log('💡 This usually means:');
    console.log('   1. The password in your connection string is incorrect');
    console.log('   2. The password needs to be URL-encoded');
    console.log('   3. Get the correct password from Supabase Dashboard → Settings → Database\n');
  } else if (error.message.includes('Tenant or user not found')) {
    console.log('💡 This usually means:');
    console.log('   1. The username format is incorrect for connection pooling');
    console.log('   2. Try using direct connection instead (port 5432)');
    console.log('   3. Get the exact connection string from Supabase Dashboard\n');
  } else if (error.message.includes('timeout')) {
    console.log('💡 This usually means:');
    console.log('   1. Network/firewall is blocking the connection');
    console.log('   2. Try connection pooling (port 6543) instead of direct (port 5432)');
    console.log('   3. Check if your Supabase project is active (not paused)\n');
  }
  
  process.exit(1);
}

