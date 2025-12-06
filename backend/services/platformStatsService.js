import { pool } from '../config/database.js';
import { supabase } from '../config/database.js';

/**
 * Fetches the key platform-wide stats that power the Super Admin dashboard
 * and the public landing page hero counters.
 * Uses direct Supabase queries for better reliability in production.
 */
export const getPlatformStatsSnapshot = async () => {
  try {
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

    return {
      activeUsers: userResult?.count ?? 0,
      totalColleges: collegeResult?.count ?? 0,
      totalDepartments: departmentResult?.count ?? 0,
      totalAssessments: assessmentResult?.count ?? 0,
      totalSubmissions: submissionResult?.count ?? 0,
    };
  } catch (error) {
    console.error('Error in getPlatformStatsSnapshot:', error);
    console.error('Error stack:', error.stack);
    console.error('Error message:', error.message);
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

