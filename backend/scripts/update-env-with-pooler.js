/**
 * Helper script to update .env with pooler connection string
 * Run this after you get the pooler connection string from Supabase
 */

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import readline from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

async function main() {
  console.log('\n🔄 Update .env with Session Pooler Connection String\n');
  console.log('Follow these steps:');
  console.log('1. In Supabase Dashboard, click "Pooler settings" button');
  console.log('2. Copy the Session Pooler connection string');
  console.log('3. Paste it here (it should have port 6543)\n');
  
  const poolerString = await question('Paste the pooler connection string (with [YOUR-PASSWORD] placeholder): ');
  
  if (!poolerString.includes('6543')) {
    console.log('\n⚠️  Warning: This doesn\'t look like a pooler connection string (should have port 6543)');
    const confirm = await question('Continue anyway? (y/n): ');
    if (confirm.toLowerCase() !== 'y') {
      console.log('Cancelled.');
      rl.close();
      return;
    }
  }
  
  // SECURITY FIX: Get password from environment variable or prompt
  let password = process.env.SUPABASE_DB_PASSWORD;
  
  if (!password) {
    password = await question('Enter your Supabase database password (will be URL-encoded): ');
    if (!password) {
      console.log('❌ Password is required');
      rl.close();
      return;
    }
  }
  
  // URL-encode the password
  const encodedPassword = encodeURIComponent(password);
  const finalString = poolerString.replace(/\[YOUR[_-]?PASSWORD\]/gi, encodedPassword);
  
  console.log('\n📝 Final connection string:');
  console.log(`   ${finalString.replace(/:([^:@]+)@/, ':***@')}\n`);
  
  const confirm = await question('Update .env file with this connection string? (y/n): ');
  
  if (confirm.toLowerCase() !== 'y') {
    console.log('Cancelled.');
    rl.close();
    return;
  }
  
  // Update .env file
  const envPath = join(__dirname, '..', '.env');
  let envContent;
  
  try {
    envContent = readFileSync(envPath, 'utf8');
  } catch (error) {
    console.log('❌ Could not read .env file:', error.message);
    rl.close();
    return;
  }
  
  // Replace SUPABASE_DB_URL
  const updatedContent = envContent.replace(
    /SUPABASE_DB_URL=.*/,
    `SUPABASE_DB_URL=${finalString}`
  );
  
  try {
    writeFileSync(envPath, updatedContent, 'utf8');
    console.log('\n✅ .env file updated successfully!\n');
    console.log('📝 Next steps:');
    console.log('   1. Test: node scripts/test-db-connection.js');
    console.log('   2. If test passes, restart your server\n');
  } catch (error) {
    console.log('❌ Could not write .env file:', error.message);
  }
  
  rl.close();
}

main().catch(console.error);

