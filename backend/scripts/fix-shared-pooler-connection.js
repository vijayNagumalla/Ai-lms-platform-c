/**
 * Fix Shared Pooler connection string with correct port and password
 */

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const envPath = join(__dirname, '..', '.env');

console.log('\n🔧 Fixing Shared Pooler Connection String\n');

// Connection details from Supabase
// SECURITY FIX: Read from environment variables instead of hardcoding
const hostname = process.env.SUPABASE_POOLER_HOST || 'aws-1-ap-south-1.pooler.supabase.com';
const port = process.env.SUPABASE_POOLER_PORT || '5432';  // Shared Pooler uses 5432, not 6543!
const database = process.env.SUPABASE_DB_NAME || 'postgres';
const user = process.env.SUPABASE_DB_USER || 'postgres.zhacsxhsjgfnniefmadh';
// SECURITY FIX: Password must be provided via environment variable
const password = process.env.SUPABASE_DB_PASSWORD;
if (!password) {
  console.error('❌ ERROR: SUPABASE_DB_PASSWORD environment variable is required');
  console.error('   Set it in your .env file or export it before running this script');
  process.exit(1);
}
const encodedPassword = encodeURIComponent(password);  // URL-encode the password

// Build correct connection string
const connectionString = `postgresql://${user}:${encodedPassword}@${hostname}:${port}/${database}`;

console.log('Connection details from Supabase:');
console.log(`  Host: ${hostname}`);
console.log(`  Port: ${port} (Shared Pooler uses 5432, not 6543!)`);
console.log(`  User: ${user}`);
console.log(`  Database: ${database}`);
console.log(`  Password: ${password} (will be URL-encoded)\n`);

console.log('Correct connection string:');
console.log(`  ${connectionString.replace(/:([^:@]+)@/, ':***@')}\n`);

// Read current .env file
let envContent;
try {
  envContent = readFileSync(envPath, 'utf8');
} catch (error) {
  console.log('❌ Could not read .env file:', error.message);
  process.exit(1);
}

// Update .env file
const updatedContent = envContent.replace(
  /SUPABASE_DB_URL=.*/,
  `SUPABASE_DB_URL=${connectionString}`
);

try {
  writeFileSync(envPath, updatedContent, 'utf8');
  console.log('✅ .env file updated successfully!\n');
  console.log('📝 Important: Shared Pooler uses port 5432 (not 6543)\n');
  console.log('💡 Next steps:');
  console.log('   1. Test: node scripts/test-db-connection.js');
  console.log('   2. If test passes, restart your server\n');
} catch (error) {
  console.log('❌ Could not write .env file:', error.message);
  process.exit(1);
}

