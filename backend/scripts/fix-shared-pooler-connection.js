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
const hostname = 'aws-1-ap-south-1.pooler.supabase.com';
const port = '5432';  // Shared Pooler uses 5432, not 6543!
const database = 'postgres';
const user = 'postgres.zhacsxhsjgfnniefmadh';
const password = 'Vijay@2607@';  // Raw password
const encodedPassword = 'Vijay%402607%40';  // URL-encoded

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

