/**
 * Test the exact connection string format from Supabase
 */

import pg from 'pg';
const { Pool } = pg;

// The exact connection string format you showed from Supabase
// Note: You showed "Vijay@@2607@" which might be a typo or the actual format
const connectionStrings = [
  // Option 1: Use the exact string you showed (with double @)
  'postgresql://postgres.zhacsxhsjgfnniefmadh:Vijay@@2607@aws-1-ap-south-1.pooler.supabase.com:5432/postgres',
  
  // Option 2: Single @ (correct password)
  'postgresql://postgres.zhacsxhsjgfnniefmadh:Vijay@2607@aws-1-ap-south-1.pooler.supabase.com:5432/postgres',
  
  // Option 3: URL-encoded (what we've been using)
  'postgresql://postgres.zhacsxhsjgfnniefmadh:Vijay%402607%40@aws-1-ap-south-1.pooler.supabase.com:5432/postgres',
  
  // Option 4: Double @ URL-encoded
  'postgresql://postgres.zhacsxhsjgfnniefmadh:Vijay%40%402607%40@aws-1-ap-south-1.pooler.supabase.com:5432/postgres',
];

console.log('\n🔍 Testing Connection String Formats\n');
console.log('='.repeat(70));

for (let i = 0; i < connectionStrings.length; i++) {
  const connStr = connectionStrings[i];
  const masked = connStr.replace(/:([^:@]+)@/, ':***@');
  
  console.log(`\n🧪 Test ${i + 1}:`);
  console.log(`   ${masked}`);
  
  const pool = new Pool({
    connectionString: connStr,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
  });

  try {
    const client = await Promise.race([
      pool.connect(),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Timeout')), 10000)
      )
    ]);
    
    const result = await client.query('SELECT version()');
    client.release();
    await pool.end();
    
    console.log(`   ✅ SUCCESS!`);
    console.log(`\n🎉 WORKING CONNECTION STRING FOUND!\n`);
    console.log(`Add this to your backend/.env file:\n`);
    console.log(`SUPABASE_DB_URL=${connStr}\n`);
    process.exit(0);
  } catch (error) {
    await pool.end().catch(() => {});
    const errorMsg = error.message.includes('password') ? 'Password auth failed' : 
                     error.message.includes('Tenant') ? 'Tenant/user not found' :
                     error.message.includes('Timeout') ? 'Connection timeout' : 
                     error.message.substring(0, 50);
    console.log(`   ❌ ${errorMsg}`);
  }
}

console.log(`\n❌ None of the formats worked.\n`);
console.log('📝 The password in your Supabase connection string might be different.\n');
console.log('💡 IMPORTANT:');
console.log('   When Supabase shows the connection string, it might have the password');
console.log('   already set. Copy the ENTIRE string exactly as shown, including the password part.\n');
console.log('✅ SOLUTION:');
console.log('   1. In Supabase Dashboard, look for a "Copy" or "Reveal" button');
console.log('   2. Click it to get the connection string with the actual password');
console.log('   3. Copy that ENTIRE string (don\'t modify anything)');
console.log('   4. Paste it into your .env file\n');

