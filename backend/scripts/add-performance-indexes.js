/**
 * Script to add performance indexes for frequently queried columns
 * Run this to improve query performance for slow routes
 * 
 * Usage: node backend/scripts/add-performance-indexes.js
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

async function addIndexes() {
  console.log('\n🔧 Adding performance indexes...\n');

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
    const sqlPath = join(__dirname, '..', 'database', 'migrate_add_performance_indexes.sql');
    const sql = readFileSync(sqlPath, 'utf8');

    // Execute the entire SQL file
    try {
      await pool.query(sql);
      console.log('✅ Performance indexes created successfully\n');
    } catch (error) {
      // Some errors are expected (like IF NOT EXISTS)
      if (error.message.includes('already exists') || 
          error.message.includes('duplicate') ||
          error.message.includes('IF NOT EXISTS')) {
        console.log(`⚠️  Some indexes already exist: ${error.message.split('\n')[0]}`);
      } else {
        console.error(`❌ Error creating indexes:`, error.message);
        throw error;
      }
    }

    // Verify some key indexes exist
    const indexCheck = await pool.query(`
      SELECT indexname, tablename 
      FROM pg_indexes 
      WHERE schemaname = 'public' 
      AND indexname LIKE 'idx_%'
      ORDER BY tablename, indexname
    `);

    console.log(`📊 Created/verified ${indexCheck.rows.length} performance indexes:`);
    const indexesByTable = {};
    indexCheck.rows.forEach(row => {
      if (!indexesByTable[row.tablename]) {
        indexesByTable[row.tablename] = [];
      }
      indexesByTable[row.tablename].push(row.indexname);
    });

    Object.entries(indexesByTable).forEach(([table, indexes]) => {
      console.log(`   ${table}: ${indexes.length} indexes`);
    });

    console.log('\n✅ Performance optimization completed!\n');
    console.log('📝 Expected improvements:');
    console.log('   - Faster authentication middleware queries');
    console.log('   - Faster college aggregation queries');
    console.log('   - Faster dashboard statistics');
    console.log('   - Faster analytics queries\n');

  } catch (error) {
    console.error('\n❌ Error adding performance indexes:', error.message);
    console.error('\n📝 You can also run the SQL manually in Supabase SQL Editor:');
    console.error('   File: backend/database/migrate_add_performance_indexes.sql\n');
    process.exit(1);
  } finally {
    await pool.end();
  }
}

addIndexes();

