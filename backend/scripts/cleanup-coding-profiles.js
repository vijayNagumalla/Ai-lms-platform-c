import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createClient } from '@supabase/supabase-js';
import { Pool } from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env file
const envPath = join(__dirname, '..', '.env');
dotenv.config({ path: envPath });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const supabaseDbUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase configuration. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your .env file');
  process.exit(1);
}

// Initialize Supabase client
const supabase = createClient(supabaseUrl, supabaseKey);

// Initialize PostgreSQL pool for direct queries
let pool;
if (supabaseDbUrl) {
  pool = new Pool({
    connectionString: supabaseDbUrl,
    ssl: { rejectUnauthorized: false }
  });
}

async function cleanupCodingProfiles() {
  console.log('🧹 Starting cleanup of coding profiles data...\n');

  try {
    // Step 1: Delete coding_achievements (references profile_id)
    console.log('📋 Step 1: Deleting coding_achievements...');
    const { data: achievementsData, error: achievementsError } = await supabase
      .from('coding_achievements')
      .select('id')
      .limit(1);
    
    if (achievementsError && achievementsError.code !== 'PGRST116') {
      console.error('   Error checking achievements:', achievementsError);
    } else {
      // Use direct SQL for bulk delete
      if (pool) {
        const result = await pool.query('DELETE FROM coding_achievements');
        console.log(`   ✅ Deleted ${result.rowCount} achievement records`);
      } else {
        // Fallback: Delete in batches using Supabase
        let deleted = 0;
        let hasMore = true;
        while (hasMore) {
          const { data, error } = await supabase
            .from('coding_achievements')
            .select('id')
            .limit(1000);
          
          if (error || !data || data.length === 0) {
            hasMore = false;
            if (error && error.code !== 'PGRST116') {
              console.error('   Error:', error);
            }
          } else {
            const ids = data.map(r => r.id);
            const { error: deleteError } = await supabase
              .from('coding_achievements')
              .delete()
              .in('id', ids);
            
            if (deleteError) {
              console.error('   Error deleting batch:', deleteError);
              hasMore = false;
            } else {
              deleted += ids.length;
              console.log(`   Deleted ${deleted} achievement records...`);
            }
          }
        }
        console.log(`   ✅ Deleted ${deleted} achievement records`);
      }
    }

    // Step 2: Delete coding_platform_data (references profile_id)
    console.log('\n📋 Step 2: Deleting coding_platform_data...');
    if (pool) {
      const result = await pool.query('DELETE FROM coding_platform_data');
      console.log(`   ✅ Deleted ${result.rowCount} platform data records`);
    } else {
      let deleted = 0;
      let hasMore = true;
      while (hasMore) {
        const { data, error } = await supabase
          .from('coding_platform_data')
          .select('id')
          .limit(1000);
        
        if (error || !data || data.length === 0) {
          hasMore = false;
          if (error && error.code !== 'PGRST116') {
            console.error('   Error:', error);
          }
        } else {
          const ids = data.map(r => r.id);
          const { error: deleteError } = await supabase
            .from('coding_platform_data')
            .delete()
            .in('id', ids);
          
          if (deleteError) {
            console.error('   Error deleting batch:', deleteError);
            hasMore = false;
          } else {
            deleted += ids.length;
            console.log(`   Deleted ${deleted} platform data records...`);
          }
        }
      }
      console.log(`   ✅ Deleted ${deleted} platform data records`);
    }

    // Step 3: Delete batch_platform_statistics_cache
    console.log('\n📋 Step 3: Deleting batch_platform_statistics_cache...');
    if (pool) {
      const result = await pool.query('DELETE FROM batch_platform_statistics_cache');
      console.log(`   ✅ Deleted ${result.rowCount} cached statistics records`);
    } else {
      let deleted = 0;
      let hasMore = true;
      while (hasMore) {
        const { data, error } = await supabase
          .from('batch_platform_statistics_cache')
          .select('id')
          .limit(1000);
        
        if (error || !data || data.length === 0) {
          hasMore = false;
          if (error && error.code !== 'PGRST116') {
            console.error('   Error:', error);
          }
        } else {
          const ids = data.map(r => r.id);
          const { error: deleteError } = await supabase
            .from('batch_platform_statistics_cache')
            .delete()
            .in('id', ids);
          
          if (deleteError) {
            console.error('   Error deleting batch:', deleteError);
            hasMore = false;
          } else {
            deleted += ids.length;
            console.log(`   Deleted ${deleted} cached statistics records...`);
          }
        }
      }
      console.log(`   ✅ Deleted ${deleted} cached statistics records`);
    }

    // Step 4: Delete student_coding_profiles (main table)
    console.log('\n📋 Step 4: Deleting student_coding_profiles...');
    if (pool) {
      const result = await pool.query('DELETE FROM student_coding_profiles');
      console.log(`   ✅ Deleted ${result.rowCount} coding profile records`);
    } else {
      let deleted = 0;
      let hasMore = true;
      while (hasMore) {
        const { data, error } = await supabase
          .from('student_coding_profiles')
          .select('id')
          .limit(1000);
        
        if (error || !data || data.length === 0) {
          hasMore = false;
          if (error && error.code !== 'PGRST116') {
            console.error('   Error:', error);
          }
        } else {
          const ids = data.map(r => r.id);
          const { error: deleteError } = await supabase
            .from('student_coding_profiles')
            .delete()
            .in('id', ids);
          
          if (deleteError) {
            console.error('   Error deleting batch:', deleteError);
            hasMore = false;
          } else {
            deleted += ids.length;
            console.log(`   Deleted ${deleted} coding profile records...`);
          }
        }
      }
      console.log(`   ✅ Deleted ${deleted} coding profile records`);
    }

    // Optional: Delete sync logs if the table exists
    console.log('\n📋 Step 5: Checking for coding_profile_sync_logs...');
    if (pool) {
      try {
        const result = await pool.query('DELETE FROM coding_profile_sync_logs');
        console.log(`   ✅ Deleted ${result.rowCount} sync log records`);
      } catch (error) {
        if (error.code === '42P01') {
          console.log('   ℹ️  Table coding_profile_sync_logs does not exist (skipping)');
        } else {
          console.error('   Error:', error.message);
        }
      }
    }

    console.log('\n✅ Cleanup completed successfully!');
    console.log('   All coding profile data has been removed.');
    console.log('   You can now start fresh by adding new profiles.\n');

  } catch (error) {
    console.error('\n❌ Error during cleanup:', error);
    console.error('   Stack:', error.stack);
    process.exit(1);
  } finally {
    if (pool) {
      await pool.end();
    }
  }
}

// Run the cleanup
cleanupCodingProfiles()
  .then(() => {
    console.log('✨ Script completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Script failed:', error);
    process.exit(1);
  });

