/**
 * Fix Shared Pooler connection string - change port from 5432 to 6543
 */

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const envPath = join(__dirname, '..', '.env');

console.log('\n🔧 Fixing Shared Pooler Connection String\n');

// Read current .env file
let envContent;
try {
  envContent = readFileSync(envPath, 'utf8');
} catch (error) {
  console.log('❌ Could not read .env file:', error.message);
  process.exit(1);
}

// Find SUPABASE_DB_URL
const urlMatch = envContent.match(/SUPABASE_DB_URL=(.+)/);
if (!urlMatch) {
  console.log('❌ SUPABASE_DB_URL not found in .env file');
  process.exit(1);
}

const currentUrl = urlMatch[1].trim();
console.log('Current connection string:');
console.log(`  ${currentUrl.replace(/:([^:@]+)@/, ':***@')}\n`);

// Check if it's using pooler hostname but wrong port
if (currentUrl.includes('pooler.supabase.com') && currentUrl.includes(':5432')) {
  console.log('⚠️  Found issue: Using pooler hostname but direct connection port (5432)');
  console.log('   Shared Pooler should use port 6543\n');
  
  // Fix: Change port from 5432 to 6543
  const fixedUrl = currentUrl.replace(':5432/', ':6543/');
  
  console.log('Fixed connection string:');
  console.log(`  ${fixedUrl.replace(/:([^:@]+)@/, ':***@')}\n`);
  
  // Update .env file
  const updatedContent = envContent.replace(
    /SUPABASE_DB_URL=.*/,
    `SUPABASE_DB_URL=${fixedUrl}`
  );
  
  try {
    writeFileSync(envPath, updatedContent, 'utf8');
    console.log('✅ .env file updated successfully!\n');
    console.log('📝 The connection string now uses port 6543 (correct for Shared Pooler)\n');
    console.log('💡 Next steps:');
    console.log('   1. Restart your server');
    console.log('   2. Run: node scripts/test-db-connection.js\n');
  } catch (error) {
    console.log('❌ Could not write .env file:', error.message);
    process.exit(1);
  }
} else if (currentUrl.includes('pooler.supabase.com') && currentUrl.includes(':6543')) {
  console.log('✅ Connection string already uses correct port 6543');
  console.log('   If you\'re still getting errors, the password might be incorrect.\n');
} else {
  console.log('ℹ️  Connection string doesn\'t appear to be using Shared Pooler format');
  console.log('   Current format might be correct, or you need to get the exact string from Supabase Dashboard\n');
}

