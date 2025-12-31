/**
 * Script to check if a user can login
 * Helps diagnose login issues
 * 
 * Usage: 
 *   node backend/scripts/check-user-login.js <email>
 *   node backend/scripts/check-user-login.js --list (to list all users)
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import pg from 'pg';
const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, '..', '.env') });

const supabaseDbUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;

async function listAllUsers() {
  if (!supabaseDbUrl) {
    console.error('❌ ERROR: SUPABASE_DB_URL or DATABASE_URL environment variable is required');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: supabaseDbUrl,
    ssl: supabaseDbUrl.includes('supabase') ? { rejectUnauthorized: false } : false,
    max: 1,
    connectionTimeoutMillis: 10000,
  });

  try {
    console.log('\n📋 Listing all users:\n');
    const result = await pool.query(
      'SELECT id, email, name, role, is_active, email_verified FROM users ORDER BY email LIMIT 50'
    );
    
    if (result.rows.length === 0) {
      console.log('   No users found in database');
    } else {
      console.log(`   Found ${result.rows.length} user(s):\n`);
      result.rows.forEach((user, index) => {
        console.log(`   ${index + 1}. ${user.email}`);
        console.log(`      Name: ${user.name || 'N/A'}`);
        console.log(`      Role: ${user.role || 'N/A'}`);
        console.log(`      Active: ${user.is_active ? '✅' : '❌'}`);
        console.log(`      Verified: ${user.email_verified ? '✅' : '❌'}`);
        console.log('');
      });
    }
  } catch (error) {
    console.error('❌ Error listing users:', error.message);
  } finally {
    await pool.end();
  }
}

async function checkUserLogin(email) {
  if (!supabaseDbUrl) {
    console.error('❌ ERROR: SUPABASE_DB_URL or DATABASE_URL environment variable is required');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: supabaseDbUrl,
    ssl: supabaseDbUrl.includes('supabase') ? { rejectUnauthorized: false } : false,
    max: 1,
    connectionTimeoutMillis: 10000,
  });

  console.log(`\n🔍 Checking login status for: ${email}\n`);

  try {
    // Find user
    const result = await pool.query(
      'SELECT id, email, password, name, role, is_active, email_verified, locked_until FROM users WHERE email = $1 LIMIT 1',
      [email]
    );

    if (result.rows.length === 0) {
      console.log('❌ User not found');
      console.log('\n💡 Tip: Use --list to see all available users');
      return;
    }

    const user = result.rows[0];
    console.log('✅ User found:');
    console.log(`   ID: ${user.id}`);
    console.log(`   Name: ${user.name}`);
    console.log(`   Email: ${user.email}`);
    console.log(`   Role: ${user.role}`);
    console.log(`   Active: ${user.is_active ? '✅' : '❌'}`);
    console.log(`   Email Verified: ${user.email_verified ? '✅' : '❌'}`);
    console.log(`   Locked Until: ${user.locked_until || 'Not locked'}`);

    // Check password
    if (!user.password) {
      console.log('\n❌ Password: NOT SET (user has no password)');
      console.log('   Fix: Set a password for this user');
    } else if (user.password.startsWith('$2')) {
      console.log('\n✅ Password: Hashed (bcrypt)');
    } else {
      console.log('\n⚠️  Password: Plain text (needs migration)');
    }

    // Check login attempts
    try {
      const attemptsResult = await pool.query(
        `SELECT COUNT(*) as count FROM login_attempts 
         WHERE email = $1 AND success = false 
         AND attempted_at > NOW() - INTERVAL '15 minutes'`,
        [email]
      );
      const failedAttempts = parseInt(attemptsResult.rows[0]?.count || 0);
      console.log(`\n📊 Failed login attempts (last 15 min): ${failedAttempts}`);
      if (failedAttempts >= 5) {
        console.log('   ⚠️  Account may be locked due to too many failed attempts');
      }
    } catch (error) {
      console.log('\n⚠️  Could not check login attempts:', error.message);
    }

    // Summary
    console.log('\n📋 Login Status Summary:');
    const issues = [];
    if (!user.is_active) issues.push('Account is deactivated');
    if (!user.email_verified) issues.push('Email not verified');
    if (!user.password) issues.push('No password set');
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      issues.push(`Account locked until ${user.locked_until}`);
    }

    if (issues.length === 0) {
      console.log('   ✅ User should be able to login');
    } else {
      console.log('   ❌ Issues preventing login:');
      issues.forEach(issue => console.log(`      - ${issue}`));
    }

  } catch (error) {
    console.error('❌ Error checking user:', error.message);
    console.error(error);
  } finally {
    await pool.end();
    // Give a small delay for cleanup
    setTimeout(() => process.exit(0), 100);
  }
}

// Get email from command line
const email = process.argv[2];

if (!email) {
  console.error('Usage: node backend/scripts/check-user-login.js <email>');
  console.error('   or: node backend/scripts/check-user-login.js --list');
  process.exit(1);
}

if (email === '--list') {
  listAllUsers().then(() => process.exit(0)).catch(() => process.exit(1));
} else {
  checkUserLogin(email);
}
