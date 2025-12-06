import { pool } from '../config/database.js';

/**
 * Fetches the key platform-wide stats that power the Super Admin dashboard
 * and the public landing page hero counters.
 */
export const getPlatformStatsSnapshot = async () => {
  try {
    // Check if pool is available
    if (!pool) {
      throw new Error('Database pool not initialized');
    }

    const [
      [userRows],
      [collegeRows],
      [departmentRows],
      [assessmentRows],
      [submissionRows],
    ] = await Promise.all([
      pool.execute('SELECT COUNT(*) as count FROM users WHERE is_active = true').catch(() => [[{ count: 0 }]]),
      pool.execute('SELECT COUNT(*) as count FROM colleges WHERE is_active = true').catch(() => [[{ count: 0 }]]),
      pool.execute('SELECT COUNT(*) as count FROM departments WHERE is_active = true').catch(() => [[{ count: 0 }]]),
      pool.execute('SELECT COUNT(*) as count FROM assessments WHERE is_published = true').catch(() => [[{ count: 0 }]]),
      pool.execute('SELECT COUNT(*) as count FROM assessment_submissions').catch(() => [[{ count: 0 }]]),
    ]);

    return {
      activeUsers: userRows?.[0]?.count ?? 0,
      totalColleges: collegeRows?.[0]?.count ?? 0,
      totalDepartments: departmentRows?.[0]?.count ?? 0,
      totalAssessments: assessmentRows?.[0]?.count ?? 0,
      totalSubmissions: submissionRows?.[0]?.count ?? 0,
    };
  } catch (error) {
    console.error('Error in getPlatformStatsSnapshot:', error);
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

