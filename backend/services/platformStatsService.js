/**
 * Fetches the key platform-wide stats that power the Super Admin dashboard
 * and the public landing page hero counters.
 * Uses direct Supabase queries for better reliability in production.
 * Falls back to direct SQL queries if Supabase is unavailable.
 * 
 * PERFORMANCE FIX: Added caching to reduce database load
 */
import cache from '../utils/cache.js';

export const getPlatformStatsSnapshot = async () => {
  // Check cache first
  const cacheKey = 'platform_stats_snapshot';
  const cached = cache.get(cacheKey);
  if (cached !== null) {
    console.log('[PlatformStats] Returning cached stats');
    return cached;
  }

  try {
    // Dynamically import supabase and pool to ensure they're initialized
    let supabase;
    let pool;
    try {
      const dbModule = await import('../config/database.js');
      supabase = dbModule.supabase;
      pool = dbModule.pool;
      
      if (!supabase) {
        console.error('[PlatformStats] Supabase client not available, trying direct SQL fallback');
        // Fall through to SQL fallback
      }
    } catch (importError) {
      console.error('[PlatformStats] Failed to import database module:', importError);
      // Fall through to SQL fallback
    }

    // PERFORMANCE FIX: Prefer direct SQL for COUNT queries (faster than Supabase)
    // Only use Supabase if direct SQL pool is not available
    if (!pool && supabase) {
      try {
        console.log('[PlatformStats] Starting to fetch stats with Supabase...');
      
        // Use direct Supabase queries for better reliability
        // This avoids SQL parsing issues with boolean values
        const [
          userResult,
          collegeResult,
          departmentResult,
          assessmentResult,
          submissionResult,
        ] = await Promise.all([
      // Active users count
      supabase
        .from('users')
        .select('*', { count: 'exact', head: true })
        .eq('is_active', true)
        .then(({ count, error }) => {
          if (error) {
            console.error('Error fetching active users:', error);
            return { count: 0 };
          }
          return { count: count || 0 };
        })
        .catch((err) => {
          console.error('Exception fetching active users:', err);
          return { count: 0 };
        }),
      
      // Active colleges count
      supabase
        .from('colleges')
        .select('*', { count: 'exact', head: true })
        .eq('is_active', true)
        .then(({ count, error }) => {
          if (error) {
            console.error('Error fetching active colleges:', error);
            return { count: 0 };
          }
          return { count: count || 0 };
        })
        .catch((err) => {
          console.error('Exception fetching active colleges:', err);
          return { count: 0 };
        }),
      
      // Active departments count
      supabase
        .from('departments')
        .select('*', { count: 'exact', head: true })
        .eq('is_active', true)
        .then(({ count, error }) => {
          if (error) {
            console.error('Error fetching active departments:', error);
            return { count: 0 };
          }
          return { count: count || 0 };
        })
        .catch((err) => {
          console.error('Exception fetching active departments:', err);
          return { count: 0 };
        }),
      
      // Published assessments count
      supabase
        .from('assessments')
        .select('*', { count: 'exact', head: true })
        .eq('is_published', true)
        .then(({ count, error }) => {
          if (error) {
            console.error('Error fetching published assessments:', error);
            return { count: 0 };
          }
          return { count: count || 0 };
        })
        .catch((err) => {
          console.error('Exception fetching published assessments:', err);
          return { count: 0 };
        }),
      
      // Total submissions count
      supabase
        .from('assessment_submissions')
        .select('*', { count: 'exact', head: true })
        .then(({ count, error }) => {
          if (error) {
            console.error('Error fetching submissions:', error);
            return { count: 0 };
          }
          return { count: count || 0 };
        })
        .catch((err) => {
          console.error('Exception fetching submissions:', err);
          return { count: 0 };
        }),
    ]);

        const stats = {
          activeUsers: userResult?.count ?? 0,
          totalColleges: collegeResult?.count ?? 0,
          totalDepartments: departmentResult?.count ?? 0,
          totalAssessments: assessmentResult?.count ?? 0,
          totalSubmissions: submissionResult?.count ?? 0,
        };
        
        // Cache for 2 minutes (stats don't change frequently)
        cache.set(cacheKey, stats, 2 * 60 * 1000);
        
        console.log('[PlatformStats] Successfully fetched stats via Supabase:', stats);
        return stats;
      } catch (supabaseError) {
        console.error('[PlatformStats] Supabase query failed:', supabaseError);
        console.error('[PlatformStats] Error details:', {
          message: supabaseError?.message,
          code: supabaseError?.code,
          details: supabaseError?.details,
          hint: supabaseError?.hint
        });
        // Fall through to SQL fallback
      }
    }

    // PERFORMANCE FIX: Use direct SQL queries (preferred - faster than Supabase for COUNT queries)
    // This is the primary path when pool is available, or fallback if Supabase failed
    if (!pool) {
      console.error('[PlatformStats] Neither Supabase nor SQL pool available');
      return {
        activeUsers: 0,
        totalColleges: 0,
        totalDepartments: 0,
        totalAssessments: 0,
        totalSubmissions: 0,
      };
    }

    try {
      console.log('[PlatformStats] Using direct SQL for stats (fastest method)...');
      // PERFORMANCE FIX: Use direct SQL queries in parallel for maximum speed
      // Direct SQL is typically faster than Supabase for simple COUNT queries
      // Handle both MySQL [rows, fields] and PostgreSQL [rows] formats
      const [userResult, collegeResult, departmentResult, assessmentResult, submissionResult] = await Promise.all([
        pool.execute('SELECT COUNT(*) as count FROM users WHERE is_active = true'),
        pool.execute('SELECT COUNT(*) as count FROM colleges WHERE is_active = true'),
        pool.execute('SELECT COUNT(*) as count FROM departments WHERE is_active = true'),
        pool.execute('SELECT COUNT(*) as count FROM assessments WHERE is_published = true'),
        pool.execute('SELECT COUNT(*) as count FROM assessment_submissions')
      ]);

      // Extract rows from result (handles both [rows, fields] and [rows] formats)
      const getUserCount = (result) => {
        const rows = Array.isArray(result) && result.length > 0 ? result[0] : result;
        if (Array.isArray(rows) && rows.length > 0) {
          const row = rows[0];
          return Number(row?.count || row?.COUNT || Object.values(row || {})[0] || 0);
        }
        return 0;
      };

      const stats = {
        activeUsers: getUserCount(userResult),
        totalColleges: getUserCount(collegeResult),
        totalDepartments: getUserCount(departmentResult),
        totalAssessments: getUserCount(assessmentResult),
        totalSubmissions: getUserCount(submissionResult),
      };

      // Cache for 2 minutes (stats don't change frequently)
      cache.set(cacheKey, stats, 2 * 60 * 1000);

      console.log('[PlatformStats] Successfully fetched stats via direct SQL:', stats);
      return stats;
    } catch (sqlError) {
      console.error('[PlatformStats] SQL query failed:', sqlError);
      console.error('[PlatformStats] SQL error message:', sqlError?.message);
      console.error('[PlatformStats] SQL error stack:', sqlError?.stack);
      
      // Return default values instead of throwing
      return {
        activeUsers: 0,
        totalColleges: 0,
        totalDepartments: 0,
        totalAssessments: 0,
        totalSubmissions: 0,
      };
    }
  } catch (error) {
    console.error('[PlatformStats] Critical error in getPlatformStatsSnapshot:', error);
    console.error('[PlatformStats] Error stack:', error.stack);
    console.error('[PlatformStats] Error message:', error.message);
    console.error('[PlatformStats] Error name:', error.name);
    
    // Return default values instead of throwing
    return {
      activeUsers: 0,
      totalColleges: 0,
      totalDepartments: 0,
      totalAssessments: 0,
      totalSubmissions: 0,
    };
  }
};

