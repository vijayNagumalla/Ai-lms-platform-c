/**
 * Update .env file to use connection pooling instead of direct connection
 */

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const envPath = join(__dirname, '..', '.env');

console.log('\n🔄 Updating .env file to use Connection Pooling...\n');

// Read current .env file
let envContent;
try {
  envContent = readFileSync(envPath, 'utf8');
} catch (error) {
  console.log('❌ Could not read .env file:', error.message);
  process.exit(1);
}

// Extract current connection string details
const currentMatch = envContent.match(/SUPABASE_DB_URL=(.+)/);
if (!currentMatch) {
  console.log('❌ SUPABASE_DB_URL not found in .env file');
  process.exit(1);
}

const currentUrl = currentMatch[1].trim();
console.log('Current connection string:');
console.log(`  ${currentUrl.replace(/:([^:@]+)@/, ':***@')}\n`);

// Check if already using pooling
if (currentUrl.includes('pooler.supabase.com') && currentUrl.includes(':6543')) {
  console.log('✅ Already using connection pooling!');
  console.log('   If you\'re still getting errors, the format might be incorrect.');
  console.log('   Please get the EXACT connection string from Supabase Dashboard.\n');
  process.exit(0);
}

// Extract password from current URL
const passwordMatch = currentUrl.match(/postgresql:\/\/[^:]+:([^@]+)@/);
if (!passwordMatch) {
  console.log('❌ Could not extract password from connection string');
  process.exit(1);
}

const password = passwordMatch[1];
const projectRef = 'zhacsxhsjgfnniefmadh';
const region = 'ap-south-1';

// Create connection pooling string
const poolingUrl = `postgresql://postgres.${projectRef}:${password}@aws-0-${region}.pooler.supabase.com:6543/postgres`;

console.log('New connection pooling string:');
console.log(`  ${poolingUrl.replace(/:([^:@]+)@/, ':***@')}\n`);

// Update .env file
const updatedContent = envContent.replace(
  /SUPABASE_DB_URL=.*/,
  `SUPABASE_DB_URL=${poolingUrl}`
);

try {
  writeFileSync(envPath, updatedContent, 'utf8');
  console.log('✅ .env file updated successfully!\n');
  console.log('📝 Next steps:');
  console.log('   1. Restart your server');
  console.log('   2. Run: node scripts/test-db-connection.js');
  console.log('   3. If it still fails, get the EXACT connection string from Supabase Dashboard\n');
} catch (error) {
  console.log('❌ Could not write .env file:', error.message);
  process.exit(1);
}

