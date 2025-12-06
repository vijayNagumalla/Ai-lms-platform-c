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

    // pool.execute() returns [rows, fields] format
    const [
      userResult,
      collegeResult,
      departmentResult,
      assessmentResult,
      submissionResult,
    ] = await Promise.all([
      pool.execute('SELECT COUNT(*) as count FROM users WHERE is_active = true').catch(() => [[{ count: 0 }], []]),
      pool.execute('SELECT COUNT(*) as count FROM colleges WHERE is_active = true').catch(() => [[{ count: 0 }], []]),
      pool.execute('SELECT COUNT(*) as count FROM departments WHERE is_active = true').catch(() => [[{ count: 0 }], []]),
      pool.execute('SELECT COUNT(*) as count FROM assessments WHERE is_published = true').catch(() => [[{ count: 0 }], []]),
      pool.execute('SELECT COUNT(*) as count FROM assessment_submissions').catch(() => [[{ count: 0 }], []]),
    ]);

    // Extract rows from [rows, fields] format
    const userRows = userResult?.[0] || [];
    const collegeRows = collegeResult?.[0] || [];
    const departmentRows = departmentResult?.[0] || [];
    const assessmentRows = assessmentResult?.[0] || [];
    const submissionRows = submissionResult?.[0] || [];

    return {
      activeUsers: userRows?.[0]?.count ?? 0,
      totalColleges: collegeRows?.[0]?.count ?? 0,
      totalDepartments: departmentRows?.[0]?.count ?? 0,
      totalAssessments: assessmentRows?.[0]?.count ?? 0,
      totalSubmissions: submissionRows?.[0]?.count ?? 0,
    };
  } catch (error) {
    console.error('Error in getPlatformStatsSnapshot:', error);
    console.error('Error stack:', error.stack);
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

