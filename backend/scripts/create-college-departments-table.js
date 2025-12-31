/**
 * Script to create college_departments table in PostgreSQL/Supabase
 * Run this if you get the error: relation "college_departments" does not exist
 * 
 * Usage: node backend/scripts/create-college-departments-table.js
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

async function createCollegeDepartmentsTable() {
  console.log('\n🔧 Creating college_departments table...\n');

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
    const sqlPath = join(__dirname, '..', 'database', 'migrate_create_college_departments_postgresql.sql');
    const sql = readFileSync(sqlPath, 'utf8');

    // Execute the entire SQL file
    // PostgreSQL allows multiple statements in one query
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

    // Verify table exists
    const result = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'college_departments'
      )
    `);

    if (result.rows[0].exists) {
      console.log('\n✅ college_departments table created successfully!\n');
      
      // Check if table has any data
      const countResult = await pool.query('SELECT COUNT(*) as count FROM college_departments');
      console.log(`📊 Current records in table: ${countResult.rows[0].count}\n`);
    } else {
      console.error('\n❌ Table was not created. Please check the error messages above.\n');
      process.exit(1);
    }

  } catch (error) {
    console.error('\n❌ Error creating college_departments table:', error.message);
    console.error('\n📝 You can also run the SQL manually in Supabase SQL Editor:');
    console.error('   File: backend/database/migrate_create_college_departments_postgresql.sql\n');
    process.exit(1);
  } finally {
    await pool.end();
  }
}

createCollegeDepartmentsTable();

