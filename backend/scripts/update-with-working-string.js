/**
 * Update .env with the working connection string
 */

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const envPath = join(__dirname, '..', '.env');

// The working connection string (with double @ in password)
const workingConnectionString = 'postgresql://postgres.zhacsxhsjgfnniefmadh:Vijay@@2607@aws-1-ap-south-1.pooler.supabase.com:5432/postgres';

console.log('\n✅ Updating .env with Working Connection String\n');

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
  `SUPABASE_DB_URL=${workingConnectionString}`
);

try {
  writeFileSync(envPath, updatedContent, 'utf8');
  console.log('✅ .env file updated with working connection string!\n');
  console.log('📝 Connection details:');
  console.log('   - Host: aws-1-ap-south-1.pooler.supabase.com');
  console.log('   - Port: 5432 (Shared Pooler)');
  console.log('   - User: postgres.zhacsxhsjgfnniefmadh');
  console.log('   - Password: Vijay@@2607@ (with double @)\n');
  console.log('💡 Next steps:');
  console.log('   1. Restart your server');
  console.log('   2. You should see: "✅ Direct PostgreSQL connection established"\n');
} catch (error) {
  console.log('❌ Could not write .env file:', error.message);
  process.exit(1);
}

