/**
 * Script to create login_attempts table and add locked_until column
 * Run this to fix the warnings about missing table and column
 * 
 * Usage: node backend/scripts/create-login-attempts-and-locked-until.js
 */

import dotenv from 'dotenv';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import pg from 'pg';
const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, '..', '.env') });

async function runMigration() {
  console.log('\n🔧 Creating login_attempts table and adding locked_until column...\n');

  const supabaseDbUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
  
  if (!supabaseDbUrl) {
    console.error('❌ ERROR: SUPABASE_DB_URL or DATABASE_URL environment variable is required');
    console.error('   Set it in your backend/.env file');
    process.exit(1);
  }

  // Create direct PostgreSQL connection
  const pool = new Pool({
    connectionString: supabaseDbUrl,
    ssl: supabaseDbUrl.includes('supabase') ? { rejectUnauthorized: false } : false,
    max: 2,
    connectionTimeoutMillis: 10000,
  });

  try {
    // Read the migration SQL file
    const sqlPath = join(__dirname, '..', 'database', 'migrate_add_login_attempts_and_locked_until.sql');
    const sql = readFileSync(sqlPath, 'utf8');

    // Execute the entire SQL file
    try {
      await pool.query(sql);
      console.log('✅ Migration SQL executed successfully');
    } catch (error) {
      // Some errors are expected (like IF NOT EXISTS)
      if (error.message.includes('already exists') || 
          error.message.includes('duplicate') ||
          error.message.includes('IF NOT EXISTS')) {
        console.log(`⚠️  Some objects already exist: ${error.message.split('\n')[0]}`);
      } else {
        console.error(`❌ Error executing migration:`, error.message);
        throw error;
      }
    }

    // Verify login_attempts table exists
    const tableResult = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'login_attempts'
      )
    `);

    if (tableResult.rows[0].exists) {
      console.log('✅ login_attempts table created successfully');
      
      // Check if table has any data
      const countResult = await pool.query('SELECT COUNT(*) as count FROM login_attempts');
      console.log(`📊 Current records in login_attempts: ${countResult.rows[0].count}`);
    } else {
      console.error('❌ login_attempts table was not created');
    }

    // Verify locked_until column exists
    const columnResult = await pool.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'users' 
        AND column_name = 'locked_until'
      )
    `);

    if (columnResult.rows[0].exists) {
      console.log('✅ locked_until column added to users table successfully');
    } else {
      console.error('❌ locked_until column was not added');
    }

    console.log('\n✅ Migration completed successfully!\n');
    console.log('📝 The following warnings should now be resolved:');
    console.log('   - "Supabase detected - ensureLoginAttemptsTable skipped"');
    console.log('   - "ALTER TABLE queries are not supported via PostgREST"\n');

  } catch (error) {
    console.error('\n❌ Error running migration:', error.message);
    console.error('\n📝 You can also run the SQL manually in Supabase SQL Editor:');
    console.error('   File: backend/database/migrate_add_login_attempts_and_locked_until.sql\n');
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigration();

