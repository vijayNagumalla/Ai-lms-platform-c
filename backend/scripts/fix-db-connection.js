/**
 * Helper script to fix Supabase database connection string
 * 
 * This script helps you:
 * 1. URL-encode passwords with special characters
 * 2. Convert direct connection to connection pooling (recommended)
 * 
 * Usage:
 * node backend/scripts/fix-db-connection.js
 */

import readline from 'readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function urlEncodePassword(password) {
  // URL encode special characters
  return encodeURIComponent(password);
}

function question(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

async function main() {
  console.log('\n🔧 Supabase Database Connection String Fixer\n');
  console.log('This tool will help you create a properly formatted connection string.\n');

  // Get project reference
  const projectRef = await question('Enter your Supabase project reference (e.g., zhacsxhsjgfnniefmadh): ');
  
  // Get password
  const password = await question('Enter your database password (will be URL-encoded automatically): ');
  
  // Get region (for connection pooling)
  const usePooling = await question('\nUse connection pooling? (recommended - works through firewalls) [Y/n]: ');
  const usePool = usePooling.toLowerCase() !== 'n';

  let region = '';
  if (usePool) {
    region = await question('Enter your Supabase region (e.g., us-east-1, ap-south-1, eu-west-1): ');
    console.log('\n💡 Tip: Find your region in Supabase Dashboard → Settings → Database → Connection pooling\n');
  }

  // URL encode password
  const encodedPassword = urlEncodePassword(password);

  // Generate connection strings
  console.log('\n' + '='.repeat(70));
  console.log('✅ Your Connection Strings:\n');

  if (usePool && region) {
    // Connection pooling (recommended)
    const poolingUrl = `postgresql://postgres.${projectRef}:${encodedPassword}@aws-0-${region}.pooler.supabase.com:6543/postgres`;
    console.log('📌 RECOMMENDED: Connection Pooling (port 6543)');
    console.log('   Works better through firewalls and is more stable.\n');
    console.log(`SUPABASE_DB_URL=${poolingUrl}\n`);
  }

  // Direct connection (fallback)
  const directUrl = `postgresql://postgres:${encodedPassword}@db.${projectRef}.supabase.co:5432/postgres`;
  console.log('📌 Alternative: Direct Connection (port 5432)');
  console.log('   Use this if connection pooling doesn\'t work.\n');
  console.log(`SUPABASE_DB_URL=${directUrl}\n`);

  console.log('='.repeat(70));
  console.log('\n📝 Instructions:');
  console.log('1. Copy one of the connection strings above');
  console.log('2. Add it to your backend/.env file');
  console.log('3. Restart your server');
  console.log('\n✅ Password has been automatically URL-encoded!');
  console.log(`   Original: ${password}`);
  console.log(`   Encoded:  ${encodedPassword}\n`);

  rl.close();
}

main().catch(console.error);

