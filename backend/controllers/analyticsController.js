import { pool } from '../config/database.js';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { getPlatformStatsSnapshot } from '../services/platformStatsService.js';

// Test analytics connection
export const testAnalyticsConnection = async (req, res) => {
  try {
    const [result] = await pool.execute('SELECT 1 as test');
    res.json({
      success: true,
      message: 'Analytics connection successful',
      data: result[0]
    });
  } catch (error) {
    console.error('Analytics connection test failed:', error);
    // Analytics connection test failed
    res.status(500).json({
      success: false,
      message: 'Analytics connection failed',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Get comprehensive analytics data
export const getAnalyticsData = async (req, res) => {
  try {
    const {
      viewType = 'college',
      collegeId,
      departmentId,
      studentId,
      dateRange = '30',
      assessmentType = 'all',
      startDate,
      endDate
    } = req.query;


    // Get user information from authentication middleware
    const currentUser = req.user;
    if (!currentUser) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }

    const userRole = currentUser.role;
    const userCollegeId = currentUser.college_id;
    const userDepartment = currentUser.department;
    const userId = currentUser.id;

    // Apply role-based filtering - create different filters for different contexts
    let roleBasedFilter = '';
    let roleBasedParams = [];
    let roleBasedFilterForTemplates = '';
    let roleBasedFilterForSubmissions = '';
    let roleBasedFilterForUsers = '';

    switch (userRole) {
      case 'student':
        // Students can only see their own data
        roleBasedFilterForSubmissions = 'AND sub.student_id = ?';
        roleBasedFilterForUsers = 'AND u.id = ?';
        roleBasedParams.push(userId);
        break;

      case 'faculty':
        // Faculty can see data from their college and department
        if (userCollegeId) {
          roleBasedFilterForTemplates = 'AND u.college_id = ?';
          roleBasedFilterForSubmissions = 'AND u.college_id = ?';
          roleBasedFilterForUsers = 'AND u.college_id = ?';
          roleBasedParams.push(userCollegeId);
        }
        if (userDepartment) {
          roleBasedFilterForTemplates += ' AND u.department = ?';
          roleBasedFilterForSubmissions += ' AND u.department = ?';
          roleBasedFilterForUsers += ' AND u.department = ?';
          roleBasedParams.push(userDepartment);
        }
        break;

      case 'admin':
        // Admins can see data from their college only
        if (userCollegeId) {
          roleBasedFilterForTemplates = 'AND u.college_id = ?';
          roleBasedFilterForSubmissions = 'AND u.college_id = ?';
          roleBasedFilterForUsers = 'AND u.college_id = ?';
          roleBasedParams.push(userCollegeId);
        }
        break;

      case 'super_admin':
        // Super admins can see all data (no additional filtering)
        break;

      default:
        // For unknown roles, restrict to user's own data
        roleBasedFilterForSubmissions = 'AND sub.student_id = ?';
        roleBasedFilterForUsers = 'AND u.id = ?';
        roleBasedParams.push(userId);
        break;
    }

    // Calculate date range
    let dateFilter = '';
    let dateParams = [];

    if (startDate && endDate && startDate !== 'null' && endDate !== 'null') {
      dateFilter = 'AND sub.submitted_at BETWEEN ? AND ?';
      dateParams = [startDate, endDate];
    } else {
      // CRITICAL FIX: Calculate date on application side - MySQL prepared statements have issues with INTERVAL ? DAY
      const dateRangeNum = parseInt(dateRange) || 30;
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - dateRangeNum);
      const cutoffDateStr = cutoffDate.toISOString().split('T')[0] + ' 00:00:00';

      dateFilter = 'AND (sub.submitted_at >= ? OR sub.submitted_at IS NULL)';
      dateParams = [cutoffDateStr];
    }

    // Assessment type filter removed

    // College filter - build separate params array for college query
    let collegeFilter = '';
    let collegeParams = [];
    if (collegeId && collegeId !== 'all') {
      collegeFilter = 'AND c.id = ?'; // Fix: Use c.id instead of u.college_id for direct college filtering
      const collegeIdNum = parseInt(collegeId);
      if (isNaN(collegeIdNum)) {
        throw new Error(`Invalid collegeId: ${collegeId}`);
      }
      collegeParams.push(collegeIdNum);
    }
    // Add date params to college params in correct order (college filter first, then date)
    // Note: dateFilter is already set above, so we need to match its placeholders exactly
    if (startDate && endDate && startDate !== 'null' && endDate !== 'null') {
      // dateFilter uses BETWEEN ? AND ? (2 placeholders)
      collegeParams.push(startDate, endDate);
    } else {
      // dateFilter now uses a calculated date string (1 placeholder) instead of INTERVAL ? DAY
      const dateRangeNum = parseInt(dateRange) || 30;
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - dateRangeNum);
      const cutoffDateStr = cutoffDate.toISOString().split('T')[0] + ' 00:00:00';
      collegeParams.push(cutoffDateStr);
    }


    // Department filter - build separate params array for department query
    let departmentFilter = '';
    let departmentParams = [];
    if (departmentId && departmentId !== 'all') {
      departmentFilter = 'AND u.department = ?';
      departmentParams.push(departmentId);
    }
    // Note: Department query doesn't have dateFilter placeholders, so don't add date params

    // Student filter
    let studentFilter = '';
    if (studentId && studentId !== 'all') {
      studentFilter = 'AND sub.student_id = ?';
      dateParams.push(studentId);
    }

    // Get summary statistics with role-based filtering
    // Create parameter arrays for each subquery
    const templateParams = roleBasedFilterForTemplates ? [...roleBasedParams] : [];
    const submissionParams = roleBasedFilterForSubmissions ? [...roleBasedParams] : [];


    const [summaryStats] = await pool.execute(`
      SELECT 
        (SELECT COUNT(*) FROM assessments at 
         LEFT JOIN users u ON at.created_by = u.id 
         WHERE at.is_published = true ${roleBasedFilterForTemplates}) as totalAssessments,
        (SELECT COUNT(DISTINCT sub.student_id) FROM assessment_submissions sub
         LEFT JOIN users u ON sub.student_id = u.id 
         WHERE 1=1 ${roleBasedFilterForSubmissions}) as activeStudents,
        (SELECT COALESCE(AVG(sub.percentage_score), 0) FROM assessment_submissions sub
         LEFT JOIN users u ON sub.student_id = u.id 
         WHERE sub.percentage_score IS NOT NULL ${roleBasedFilterForSubmissions}) as averageScore,
        (SELECT 
          CASE 
            WHEN COUNT(*) > 0 THEN 
              COUNT(CASE WHEN sub.status = 'submitted' OR sub.status = 'graded' THEN 1 END) * 100.0 / COUNT(*)
            ELSE 0 
          END 
         FROM assessment_submissions sub
         LEFT JOIN users u ON sub.student_id = u.id 
         WHERE 1=1 ${roleBasedFilterForSubmissions}) as completionRate,
        (SELECT COUNT(*) FROM assessment_submissions sub
         LEFT JOIN users u ON sub.student_id = u.id 
         WHERE 1=1 ${roleBasedFilterForSubmissions}) as totalSubmissions
    `, [
      ...templateParams,
      ...submissionParams,
      ...submissionParams,
      ...submissionParams,
      ...submissionParams
    ]);

    // MEDIUM FIX: Add pagination support for college stats
    const collegeLimit = Math.min(parseInt(req.query.collegeLimit) || 50, 200); // Max 200, default 50
    const collegeOffset = parseInt(req.query.collegeOffset) || 0;

    // Get college-wise statistics with role-based filtering
    // CRITICAL FIX: Use collegeParams array with correct parameter order
    // Build the final params array: college filter (if any) + date filter + pagination
    // collegeParams already includes: [collegeId?] + [dateRange or startDate, endDate]
    // Ensure all parameters are valid (not NaN) and properly typed
    const validCollegeParams = collegeParams.map(p => {
      // If it's already a number, return it
      if (typeof p === 'number' && !isNaN(p)) {
        return p;
      }
      // If it's a date string, keep it as is
      if (typeof p === 'string' && !isNaN(Date.parse(p))) {
        return p;
      }
      // Try to parse as number
      const num = parseInt(p);
      return isNaN(num) ? p : num;
    });

    // Ensure limit and offset are numbers
    const finalLimit = typeof collegeLimit === 'number' && !isNaN(collegeLimit) ? collegeLimit : 50;
    const finalOffset = typeof collegeOffset === 'number' && !isNaN(collegeOffset) ? collegeOffset : 0;

    // Build final parameter array - validCollegeParams already includes college filter (if any) + date filter
    // validCollegeParams should always have at least the date parameter
    if (validCollegeParams.length === 0) {
      throw new Error('validCollegeParams is empty - date parameter should always be present');
    }

    // CRITICAL FIX: MySQL doesn't support parameterized LIMIT/OFFSET, so we need to interpolate them directly
    // Ensure limit and offset are safe integers to prevent SQL injection
    const safeLimit = parseInt(finalLimit);
    const safeOffset = parseInt(finalOffset);
    if (isNaN(safeLimit) || isNaN(safeOffset) || safeLimit < 0 || safeOffset < 0) {
      throw new Error(`Invalid pagination parameters: limit=${finalLimit}, offset=${finalOffset}`);
    }

    const collegeQueryParams = [...validCollegeParams];

    // Final validation - ensure no undefined or null values
    const hasInvalidParams = collegeQueryParams.some(p => p === undefined || p === null || (typeof p === 'number' && isNaN(p)));
    if (hasInvalidParams) {
      throw new Error(`Invalid parameters detected: ${JSON.stringify(collegeQueryParams)}`);
    }

    // Count placeholders vs parameters
    const collegeFilterPlaceholders = (collegeFilter.match(/\?/g) || []).length;
    const dateFilterPlaceholders = (dateFilter.match(/\?/g) || []).length;
    const totalPlaceholders = collegeFilterPlaceholders + dateFilterPlaceholders;

    if (collegeQueryParams.length !== totalPlaceholders) {
      console.error('CRITICAL: Parameter count mismatch in college stats query!', {
        collegeFilter,
        dateFilter,
        collegeFilterPlaceholders,
        dateFilterPlaceholders,
        totalPlaceholders,
        paramsCount: collegeQueryParams.length,
        params: collegeQueryParams,
        collegeParams: collegeParams,
        validCollegeParams: validCollegeParams,
        finalLimit: safeLimit,
        finalOffset: safeOffset
      });
      throw new Error(`Parameter count mismatch: Expected ${totalPlaceholders} parameters but got ${collegeQueryParams.length}. Params: ${JSON.stringify(collegeQueryParams)}`);
    }

    // Build the SQL query string
    let collegeQuerySQL = `
      SELECT 
        c.id,
        c.name,
        COUNT(DISTINCT sub.student_id) as totalStudents,
        COUNT(DISTINCT at.id) as totalAssessments,
        COALESCE(AVG(sub.percentage_score), 0) as averageScore,
        COUNT(CASE WHEN sub.status = 'submitted' OR sub.status = 'graded' THEN 1 END) as completedAssessments,
        COUNT(sub.id) as totalSubmissions
      FROM colleges c
      LEFT JOIN assessments at ON (at.college_id = c.id OR at.college_id IS NULL) AND at.is_published = true
      LEFT JOIN assessment_submissions sub ON at.id = sub.assessment_id
      LEFT JOIN users u ON sub.student_id = u.id
      WHERE c.is_active = true
    `;

    // Add filters in correct order
    if (collegeFilter) {
      collegeQuerySQL += ` ${collegeFilter}`;
    }
    collegeQuerySQL += ` ${dateFilter}`;
    // CRITICAL FIX: Interpolate LIMIT and OFFSET directly (they're validated as safe integers above)
    collegeQuerySQL += `
      GROUP BY c.id, c.name
      ORDER BY averageScore DESC
      LIMIT ${safeLimit} OFFSET ${safeOffset}
    `;

    const [collegeStats] = await pool.execute(collegeQuerySQL, collegeQueryParams);

    // MEDIUM FIX: Add pagination support for department stats
    const departmentLimit = Math.min(parseInt(req.query.departmentLimit) || 50, 200); // Max 200, default 50
    const departmentOffset = parseInt(req.query.departmentOffset) || 0;

    // CRITICAL FIX: MySQL doesn't support parameterized LIMIT/OFFSET, so we need to interpolate them directly
    const safeDepartmentLimit = parseInt(departmentLimit);
    const safeDepartmentOffset = parseInt(departmentOffset);
    if (isNaN(safeDepartmentLimit) || isNaN(safeDepartmentOffset) || safeDepartmentLimit < 0 || safeDepartmentOffset < 0) {
      throw new Error(`Invalid pagination parameters: limit=${departmentLimit}, offset=${departmentOffset}`);
    }

    // Get department-wise statistics with role-based filtering
    // CRITICAL FIX: Department query doesn't have dateFilter, so only pass departmentParams (no date params)
    const [departmentStats] = await pool.execute(`
      SELECT 
        d.id,
        d.name,
        c.name as collegeName,
        COUNT(DISTINCT sub.student_id) as totalStudents,
        COUNT(DISTINCT at.id) as totalAssessments,
        COALESCE(AVG(sub.percentage_score), 0) as averageScore,
        COUNT(CASE WHEN sub.status = 'submitted' OR sub.status = 'graded' THEN 1 END) as completedAssessments
      FROM departments d
      LEFT JOIN colleges c ON d.college_id = c.id
      LEFT JOIN assessments at ON at.college_id = c.id AND at.is_published = true
      LEFT JOIN assessment_submissions sub ON at.id = sub.assessment_id
      LEFT JOIN users u ON sub.student_id = u.id
      WHERE d.is_active = true
      ${collegeFilter}
      GROUP BY d.id, d.name, c.name
      ORDER BY averageScore DESC
      LIMIT ${safeDepartmentLimit} OFFSET ${safeDepartmentOffset}
    `, [...departmentParams]);

    // MEDIUM FIX: Add pagination support for student stats
    const studentLimit = Math.min(parseInt(req.query.studentLimit) || 100, 500); // Max 500, default 100
    const studentOffset = parseInt(req.query.studentOffset) || 0;

    // CRITICAL FIX: MySQL doesn't support parameterized LIMIT/OFFSET, so we need to interpolate them directly
    const safeStudentLimit = parseInt(studentLimit);
    const safeStudentOffset = parseInt(studentOffset);
    if (isNaN(safeStudentLimit) || isNaN(safeStudentOffset) || safeStudentLimit < 0 || safeStudentOffset < 0) {
      throw new Error(`Invalid pagination parameters: limit=${studentLimit}, offset=${studentOffset}`);
    }

    // Get student-wise statistics with role-based filtering and pagination
    const [studentStats] = await pool.execute(`
      SELECT 
        u.id,
        u.name,
        u.email,
        c.name as college,
        u.department,
        COUNT(DISTINCT at.id) as totalAssessments,
        COUNT(CASE WHEN sub.status = 'submitted' OR sub.status = 'graded' THEN 1 END) as completedAssessments,
        COALESCE(AVG(sub.percentage_score), 0) as averageScore,
        COALESCE(SUM(sub.time_taken_minutes), 0) as totalTimeTaken
      FROM users u
      LEFT JOIN colleges c ON u.college_id = c.id
      LEFT JOIN assessment_submissions sub ON sub.student_id = u.id
      LEFT JOIN assessments at ON sub.assessment_id = at.id AND at.is_published = true
      WHERE u.role = 'student' AND u.is_active = true
      ${roleBasedFilterForUsers}
      GROUP BY u.id, u.name, u.email, c.name, u.department
      ORDER BY averageScore DESC
      LIMIT ${safeStudentLimit} OFFSET ${safeStudentOffset}
    `, [...roleBasedParams]);

    // MEDIUM FIX: Add pagination support for assessment stats
    const assessmentLimit = Math.min(parseInt(req.query.assessmentLimit) || 100, 500); // Max 500, default 100
    const assessmentOffset = parseInt(req.query.assessmentOffset) || 0;

    // CRITICAL FIX: MySQL doesn't support parameterized LIMIT/OFFSET, so we need to interpolate them directly
    const safeAssessmentLimit = parseInt(assessmentLimit);
    const safeAssessmentOffset = parseInt(assessmentOffset);
    if (isNaN(safeAssessmentLimit) || isNaN(safeAssessmentOffset) || safeAssessmentLimit < 0 || safeAssessmentOffset < 0) {
      throw new Error(`Invalid pagination parameters: limit=${assessmentLimit}, offset=${assessmentOffset}`);
    }

    // Get assessment-wise statistics with role-based filtering
    const assessmentStatsParams = [];
    if (collegeId && collegeId !== 'all') {
      assessmentStatsParams.push(collegeId, collegeId, collegeId, collegeId, collegeId, collegeId);
    }
    if (startDate && endDate && startDate !== 'null' && endDate !== 'null') {
      assessmentStatsParams.push(startDate, endDate);
    } else {
      // Use the same calculated cutoff date that dateFilter uses
      const dateRangeNum = parseInt(dateRange) || 30;
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - dateRangeNum);
      const cutoffDateStr = cutoffDate.toISOString().split('T')[0] + ' 00:00:00';
      assessmentStatsParams.push(cutoffDateStr);
    }

    const [assessmentStats] = await pool.execute(`
      SELECT 
        at.id,
        at.title,
        COUNT(DISTINCT CASE WHEN ${collegeId && collegeId !== 'all' ? 'u.college_id = ?' : '1=1'} THEN sub.student_id END) as totalStudents,
        COUNT(CASE WHEN (sub.status = 'submitted' OR sub.status = 'graded') AND ${collegeId && collegeId !== 'all' ? 'u.college_id = ?' : '1=1'} THEN 1 END) as completedSubmissions,
        COALESCE(AVG(CASE WHEN ${collegeId && collegeId !== 'all' ? 'u.college_id = ?' : '1=1'} THEN sub.percentage_score END), 0) as averageScore,
        COALESCE(MIN(CASE WHEN ${collegeId && collegeId !== 'all' ? 'u.college_id = ?' : '1=1'} THEN sub.percentage_score END), 0) as lowestScore,
        COALESCE(MAX(CASE WHEN ${collegeId && collegeId !== 'all' ? 'u.college_id = ?' : '1=1'} THEN sub.percentage_score END), 0) as highestScore,
        COALESCE(AVG(CASE WHEN ${collegeId && collegeId !== 'all' ? 'u.college_id = ?' : '1=1'} THEN sub.time_taken_minutes END), 0) as averageTimeTaken
      FROM assessments at
      LEFT JOIN assessment_submissions sub ON at.id = sub.assessment_id
      LEFT JOIN users u ON sub.student_id = u.id
      WHERE at.is_published = true
      ${dateFilter}
      GROUP BY at.id, at.title
      ORDER BY averageScore DESC
      LIMIT ${safeAssessmentLimit} OFFSET ${safeAssessmentOffset}
    `, [...assessmentStatsParams]);

    // Get score distribution with role-based filtering
    const scoreDistributionParams = [];
    if (collegeId && collegeId !== 'all') {
      scoreDistributionParams.push(collegeId);
    }
    if (startDate && endDate && startDate !== 'null' && endDate !== 'null') {
      scoreDistributionParams.push(startDate, endDate);
    } else {
      // Use the same calculated cutoff date that dateFilter uses
      const dateRangeNum = parseInt(dateRange) || 30;
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - dateRangeNum);
      const cutoffDateStr = cutoffDate.toISOString().split('T')[0] + ' 00:00:00';
      scoreDistributionParams.push(cutoffDateStr);
    }

    const [scoreDistribution] = await pool.execute(`
      SELECT 
        CASE 
          WHEN sub.percentage_score >= 90 THEN '90-100%'
          WHEN sub.percentage_score >= 80 THEN '80-89%'
          WHEN sub.percentage_score >= 70 THEN '70-79%'
          WHEN sub.percentage_score >= 60 THEN '60-69%'
          ELSE 'Below 60%'
        END as scoreRange,
        COUNT(*) as count
      FROM assessment_submissions sub
      LEFT JOIN assessments at ON sub.assessment_id = at.id
      LEFT JOIN users u ON sub.student_id = u.id
      WHERE sub.percentage_score IS NOT NULL
      ${collegeId && collegeId !== 'all' ? 'AND u.college_id = ?' : ''}
      ${dateFilter}
      GROUP BY scoreRange
      ORDER BY 
        CASE scoreRange
          WHEN '90-100%' THEN 1
          WHEN '80-89%' THEN 2
          WHEN '70-79%' THEN 3
          WHEN '60-69%' THEN 4
          ELSE 5
        END
    `, scoreDistributionParams);

    // Get submission patterns over time with role-based filtering
    const [submissionPatterns] = await pool.execute(`
      SELECT 
        DATE(sub.submitted_at) as date,
        COUNT(*) as submissions,
        COALESCE(AVG(sub.percentage_score), 0) as averageScore
      FROM assessment_submissions sub
      LEFT JOIN assessments at ON sub.assessment_id = at.id
      LEFT JOIN users u ON sub.student_id = u.id
      WHERE sub.submitted_at IS NOT NULL
      ${collegeId && collegeId !== 'all' ? 'AND u.college_id = ?' : ''}
      GROUP BY DATE(sub.submitted_at)
      ORDER BY date DESC
      LIMIT 30
    `, collegeId && collegeId !== 'all' ? [collegeId] : []);

    // Get assessment type performance with role-based filtering
    const assessmentTypePerformanceParams = [];
    if (collegeId && collegeId !== 'all') {
      assessmentTypePerformanceParams.push(collegeId, collegeId, collegeId);
    }

    // MEDIUM FIX: Assessment type performance removed since assessment_type column no longer exists
    // Return empty array with clear documentation
    const assessmentTypePerformance = []; // Empty array - feature removed due to schema changes since assessment type column no longer exists

    // Helper function to convert numeric fields
    const convertNumericFields = (obj) => {
      const result = { ...obj };
      Object.keys(result).forEach(key => {
        if (typeof result[key] === 'string' && !isNaN(result[key])) {
          result[key] = parseFloat(result[key]);
        }
      });
      return result;
    };

    // Process data
    const processedSummary = convertNumericFields(summaryStats[0] || {});
    const processedCollegeStats = collegeStats.map(convertNumericFields);
    const processedDepartmentStats = departmentStats.map(convertNumericFields);
    const processedStudentStats = studentStats.map(convertNumericFields);
    const processedAssessmentStats = assessmentStats.map(convertNumericFields);
    const processedScoreDistribution = scoreDistribution.map(convertNumericFields);
    const processedSubmissionPatterns = submissionPatterns.map(convertNumericFields);
    const processedAssessmentTypePerformance = assessmentTypePerformance.map(convertNumericFields);

    res.json({
      success: true,
      data: {
        summary: processedSummary,
        collegeStats: processedCollegeStats,
        departmentStats: processedDepartmentStats,
        studentStats: processedStudentStats,
        assessmentStats: processedAssessmentStats,
        charts: {
          scoreDistribution: processedScoreDistribution,
          submissionPatterns: processedSubmissionPatterns,
          assessmentTypePerformance: processedAssessmentTypePerformance
        },
        filters: {
          viewType,
          collegeId,
          departmentId,
          studentId,
          dateRange,
          assessmentType,
          startDate,
          endDate
        }
      }
    });

  } catch (error) {
    console.error('Analytics data error:', error);
    // Error getting analytics data
    res.status(500).json({
      success: false,
      message: 'Failed to get analytics data',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Get course analytics data
export const getCourseAnalyticsData = async (req, res) => {
  try {
    const {
      collegeId,
      departmentId,
      facultyId,
      studentId,
      dateRange = '30',
      courseCategory = 'all',
      startDate,
      endDate
    } = req.query;

    // Calculate date range
    let dateFilter = '';
    let dateParams = [];

    if (startDate && endDate && startDate !== 'null' && endDate !== 'null') {
      dateFilter = 'AND c.created_at BETWEEN ? AND ?';
      dateParams = [startDate, endDate];
    } else {
      // Calculate date on application side - PostgreSQL doesn't support INTERVAL ? DAY in prepared statements
      const dateRangeNum = parseInt(dateRange) || 30;
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - dateRangeNum);
      const cutoffDateStr = cutoffDate.toISOString().split('T')[0] + ' 00:00:00';
      dateFilter = 'AND (c.created_at >= ? OR c.created_at IS NULL)';
      dateParams = [cutoffDateStr];
    }

    // College filter
    let collegeFilter = '';
    if (collegeId && collegeId !== 'all') {
      collegeFilter = 'AND c.college_id = ?';
      dateParams.push(collegeId);
    }

    // Department filter
    let departmentFilter = '';
    if (departmentId && departmentId !== 'all') {
      departmentFilter = 'AND c.department_id = ?';
      dateParams.push(departmentId);
    }

    // Faculty filter
    let facultyFilter = '';
    if (facultyId && facultyId !== 'all') {
      facultyFilter = 'AND c.instructor_id = ?';
      dateParams.push(facultyId);
    }

    // Course category filter - disabled since courses table doesn't have category column
    let categoryFilter = '';
    // if (courseCategory !== 'all') {
    //   categoryFilter = 'AND c.category = ?';
    //   dateParams.push(courseCategory);
    // }

    // Get course summary statistics
    const [courseSummary] = await pool.execute(`
      SELECT 
        COUNT(DISTINCT c.id) as totalCourses,
        COUNT(DISTINCT ce.student_id) as totalEnrollments,
        COUNT(DISTINCT CASE WHEN ce.status = 'completed' THEN ce.student_id END) as completedEnrollments,
        CASE 
          WHEN COUNT(DISTINCT ce.student_id) > 0 THEN COUNT(DISTINCT CASE WHEN ce.status = 'completed' THEN ce.student_id END) * 100.0 / COUNT(DISTINCT ce.student_id)
          ELSE 0 
        END as completionRate
      FROM courses c
      LEFT JOIN course_enrollments ce ON c.id = ce.course_id
      WHERE c.is_published = true
      ${dateFilter}
      ${collegeFilter}
      ${departmentFilter}
      ${facultyFilter}
      ${categoryFilter}
    `, dateParams);

    // Get course-wise statistics
    const [courseStats] = await pool.execute(`
      SELECT 
        c.id,
        c.title,
        c.code as category,
        u.name as instructor,
        COUNT(DISTINCT ce.student_id) as totalEnrollments,
        COUNT(DISTINCT CASE WHEN ce.status = 'completed' THEN ce.student_id END) as completedEnrollments,
        CASE 
          WHEN COUNT(DISTINCT ce.student_id) > 0 THEN COUNT(DISTINCT CASE WHEN ce.status = 'completed' THEN ce.student_id END) * 100.0 / COUNT(DISTINCT ce.student_id)
          ELSE 0 
        END as completionRate
      FROM courses c
      LEFT JOIN users u ON c.instructor_id = u.id
      LEFT JOIN course_enrollments ce ON c.id = ce.course_id
      WHERE c.is_published = true
      ${dateFilter}
      ${collegeFilter}
      ${departmentFilter}
      ${facultyFilter}
      ${categoryFilter}
      GROUP BY c.id, c.title, c.code, u.name
      ORDER BY completionRate DESC
    `, dateParams);

    // Get instructor-wise statistics
    const [instructorStats] = await pool.execute(`
      SELECT 
        u.id,
        u.name as instructor,
        COUNT(DISTINCT c.id) as totalCourses,
        COUNT(DISTINCT ce.student_id) as totalEnrollments,
        COUNT(DISTINCT CASE WHEN ce.status = 'completed' THEN ce.student_id END) as completedEnrollments,
        CASE 
          WHEN COUNT(DISTINCT ce.student_id) > 0 THEN COUNT(DISTINCT CASE WHEN ce.status = 'completed' THEN ce.student_id END) * 100.0 / COUNT(DISTINCT ce.student_id)
          ELSE 0 
        END as completionRate,
        AVG(ce.rating) as averageRating
      FROM users u
      LEFT JOIN courses c ON u.id = c.instructor_id
      LEFT JOIN course_enrollments ce ON c.id = ce.course_id
      WHERE u.role = 'faculty' AND c.is_published = true
      ${dateFilter}
      ${collegeFilter}
      ${departmentFilter}
      ${facultyFilter}
      GROUP BY u.id, u.name
      ORDER BY completionRate DESC
    `, dateParams);

    // Get chapter-wise statistics
    const [chapterStats] = await pool.execute(`
      SELECT 
        cm.title as chapterTitle,
        c.title as courseTitle,
        COUNT(DISTINCT ce.student_id) as totalStudents,
        AVG(cc.time_spent_minutes) as averageTimeSpent,
        COUNT(DISTINCT CASE WHEN cc.is_completed = TRUE THEN ce.student_id END) as completedStudents
      FROM course_modules cm
      LEFT JOIN courses c ON cm.course_id = c.id
      LEFT JOIN course_enrollments ce ON c.id = ce.course_id
      LEFT JOIN course_content cc ON cm.id = cc.module_id
      WHERE c.is_published = true
      ${dateFilter}
      ${collegeFilter}
      ${departmentFilter}
      ${facultyFilter}
      GROUP BY cm.id, cm.title, c.title
      ORDER BY averageTimeSpent DESC
    `, dateParams);

    // Get category-wise statistics
    const [categoryStats] = await pool.execute(`
      SELECT 
        c.category,
        COUNT(DISTINCT c.id) as totalCourses,
        COUNT(DISTINCT ce.student_id) as totalEnrollments,
        COUNT(DISTINCT CASE WHEN ce.status = 'completed' THEN ce.student_id END) as completedEnrollments,
        CASE 
          WHEN COUNT(DISTINCT ce.student_id) > 0 THEN COUNT(DISTINCT CASE WHEN ce.status = 'completed' THEN ce.student_id END) * 100.0 / COUNT(DISTINCT ce.student_id)
          ELSE 0 
        END as completionRate,
        AVG(ce.rating) as averageRating
      FROM courses c
      LEFT JOIN course_enrollments ce ON c.id = ce.course_id
      WHERE c.is_published = true
      ${dateFilter}
      ${collegeFilter}
      ${departmentFilter}
      ${facultyFilter}
      GROUP BY c.category
      ORDER BY completionRate DESC
    `, dateParams);

    // Get engagement trends over time
    const [engagementStats] = await pool.execute(`
      SELECT 
        DATE(ce.enrollment_date) as date,
        COUNT(*) as enrollments,
        COUNT(CASE WHEN ce.status = 'completed' THEN 1 END) as completions,
        AVG(ce.rating) as averageRating
      FROM course_enrollments ce
      LEFT JOIN courses c ON ce.course_id = c.id
      WHERE ce.enrollment_date IS NOT NULL
      ${dateFilter}
      ${collegeFilter}
      ${departmentFilter}
      ${facultyFilter}
      GROUP BY DATE(ce.enrollment_date)
      ORDER BY date DESC
      LIMIT 30
    `, dateParams);

    // Helper function to convert numeric fields
    const convertNumericFields = (obj) => {
      const result = { ...obj };
      Object.keys(result).forEach(key => {
        if (typeof result[key] === 'string' && !isNaN(result[key])) {
          result[key] = parseFloat(result[key]);
        }
      });
      return result;
    };

    // Process data
    const processedSummary = convertNumericFields(courseSummary[0] || {});
    const processedCourseStats = courseStats.map(convertNumericFields);
    const processedInstructorStats = instructorStats.map(convertNumericFields);
    const processedChapterStats = chapterStats.map(convertNumericFields);
    const processedCategoryStats = categoryStats.map(convertNumericFields);
    const processedEngagementStats = engagementStats.map(convertNumericFields);

    res.json({
      success: true,
      data: {
        summary: processedSummary,
        courseStats: processedCourseStats,
        instructorStats: processedInstructorStats,
        chapterStats: processedChapterStats,
        categoryStats: processedCategoryStats,
        engagementStats: processedEngagementStats,
        filters: {
          collegeId,
          departmentId,
          facultyId,
          studentId,
          dateRange,
          courseCategory,
          startDate,
          endDate
        }
      }
    });

  } catch (error) {
    // Error getting course analytics data
    res.status(500).json({
      success: false,
      message: 'Failed to get course analytics data'
    });
  }
};

// Save analytics view
export const saveAnalyticsView = async (req, res) => {
  try {
    const { name, module, filters, userId } = req.body;

    const [result] = await pool.execute(`
      INSERT INTO analytics_views (id, name, module, filters, user_id, created_at)
      VALUES (gen_random_uuid(), ?, ?, ?, ?, NOW())
    `, [name, module, JSON.stringify(filters), userId]);

    res.json({
      success: true,
      data: {
        id: result.insertId,
        name,
        module,
        filters
      }
    });

  } catch (error) {
    // Error saving analytics view
    res.status(500).json({
      success: false,
      message: 'Failed to save analytics view'
    });
  }
};

// Get saved analytics views
export const getSavedAnalyticsViews = async (req, res) => {
  try {
    const { userId } = req.query;

    // Check if userId is provided
    if (!userId) {
      return res.json({
        success: true,
        data: []
      });
    }

    const [views] = await pool.execute(`
      SELECT id, name, module, filters, created_at
      FROM analytics_views
      WHERE user_id = ?
      ORDER BY created_at DESC
    `, [userId]);

    const processedViews = views.map(view => ({
      ...view,
      filters: JSON.parse(view.filters)
    }));

    res.json({
      success: true,
      data: processedViews
    });

  } catch (error) {
    // Error getting saved analytics views
    res.status(500).json({
      success: false,
      message: 'Failed to get saved analytics views'
    });
  }
};

// Get specific saved analytics view
export const getSavedAnalyticsView = async (req, res) => {
  try {
    const { viewId } = req.params;

    const [views] = await pool.execute(`
      SELECT id, name, module, filters, created_at
      FROM analytics_views
      WHERE id = ?
    `, [viewId]);

    if (views.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Analytics view not found'
      });
    }

    const view = {
      ...views[0],
      filters: JSON.parse(views[0].filters)
    };

    res.json({
      success: true,
      data: view
    });

  } catch (error) {
    // Error getting saved analytics view
    res.status(500).json({
      success: false,
      message: 'Failed to get saved analytics view'
    });
  }
};

// Add chart annotation
export const addChartAnnotation = async (req, res) => {
  try {
    const { chartType, dataPoint, title, comment, filters, userId } = req.body;

    const [result] = await pool.execute(`
      INSERT INTO chart_annotations (id, chart_type, data_point, title, comment, filters, user_id, created_at)
      VALUES (gen_random_uuid(), ?, ?, ?, ?, ?, ?, NOW())
    `, [chartType, JSON.stringify(dataPoint), title, comment, JSON.stringify(filters), userId]);

    res.json({
      success: true,
      data: {
        id: result.insertId,
        chartType,
        dataPoint,
        title,
        comment,
        filters,
        createdAt: new Date(),
        createdBy: userId
      }
    });

  } catch (error) {
    // Error adding chart annotation
    res.status(500).json({
      success: false,
      message: 'Failed to add chart annotation'
    });
  }
};

// Get chart annotations
export const getChartAnnotations = async (req, res) => {
  try {
    const { module, filters, userId } = req.query;

    // Check if required parameters are provided
    if (!module || !userId) {
      return res.json({
        success: true,
        data: []
      });
    }

    const [annotations] = await pool.execute(`
      SELECT ca.id, ca.chart_type, ca.data_point, ca.title, ca.comment, ca.filters, ca.created_at, u.name as created_by
      FROM chart_annotations ca
      LEFT JOIN users u ON ca.user_id = u.id
      WHERE ca.module = ? AND ca.user_id = ?
      ORDER BY ca.created_at DESC
    `, [module, userId]);

    const processedAnnotations = annotations.map(annotation => ({
      ...annotation,
      dataPoint: JSON.parse(annotation.data_point),
      filters: JSON.parse(annotation.filters)
    }));

    res.json({
      success: true,
      data: processedAnnotations
    });

  } catch (error) {
    // Error getting chart annotations
    res.status(500).json({
      success: false,
      message: 'Failed to get chart annotations'
    });
  }
};

// Get faculty for analytics
export const getFacultyForAnalytics = async (req, res) => {
  try {
    const { collegeId, departmentId } = req.query;

    let query = `
      SELECT u.id, u.name, u.email, c.name as college, u.department
      FROM users u
      LEFT JOIN colleges c ON u.college_id = c.id
      WHERE u.role = 'faculty' AND u.is_active = true
    `;

    const params = [];
    if (collegeId && collegeId !== 'all') {
      query += ' AND u.college_id = ?';
      params.push(collegeId);
    }

    if (departmentId && departmentId !== 'all') {
      query += ' AND u.department = ?';
      params.push(departmentId);
    }

    query += ' ORDER BY u.name';

    const [faculty] = await pool.execute(query, params);

    res.json({
      success: true,
      data: faculty
    });
  } catch (error) {
    // Error getting faculty for analytics
    res.status(500).json({
      success: false,
      message: 'Failed to get faculty'
    });
  }
};

// Get assessment types
// Get assessment types - removed since assessment_type column no longer exists

// Get detailed assessment data
export const getAssessmentDetails = async (req, res) => {
  try {
    const { assessmentId } = req.params;
    const {
      collegeId,
      departmentId,
      dateRange = '30',
      startDate,
      endDate
    } = req.query;

    // Calculate date range
    let dateFilter = '';
    let dateParams = [];

    if (startDate && endDate && startDate !== 'null' && endDate !== 'null') {
      dateFilter = 'AND sub.submitted_at BETWEEN ? AND ?';
      dateParams = [startDate, endDate];
    } else {
      // Calculate date on application side - PostgreSQL doesn't support INTERVAL ? DAY in prepared statements
      const dateRangeNum = parseInt(dateRange) || 30;
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - dateRangeNum);
      const cutoffDateStr = cutoffDate.toISOString().split('T')[0] + ' 00:00:00';
      dateFilter = 'AND (sub.submitted_at >= ? OR sub.submitted_at IS NULL)';
      dateParams = [cutoffDateStr];
    }

    // College filter
    let collegeFilter = '';
    if (collegeId && collegeId !== 'all') {
      collegeFilter = 'AND u.college_id = ?';
      dateParams.push(collegeId);
    }

    // Department filter
    let departmentFilter = '';
    if (departmentId && departmentId !== 'all') {
      departmentFilter = 'AND u.department = ?';
      dateParams.push(departmentId);
    }

    // Get assessment basic info
    const [assessmentInfo] = await pool.execute(`
      SELECT 
        at.id,
        at.title,
        at.description,
        at.difficulty_level,
        at.time_limit_minutes,
        at.total_points,
        at.passing_score,
        at.is_published as status,
        at.created_at,
        c.name as college_name,
        u.name as created_by_name
      FROM assessments at
      LEFT JOIN colleges c ON at.college_id = c.id
      LEFT JOIN users u ON at.created_by = u.id
      WHERE at.id = ?
    `, [assessmentId]);

    if (assessmentInfo.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Assessment not found'
      });
    }

    // Get detailed submission data
    const [submissionDetails] = await pool.execute(`
      SELECT 
        sub.id as submission_id,
        sub.student_id,
        u.name as student_name,
        u.email as student_email,
        c.name as college_name,
        u.department,
        COALESCE(sub.score, 0) as score,
        CASE 
          WHEN sub.max_score > 0 THEN sub.max_score
          ELSE at.total_points
        END as max_score,
        sub.percentage_score,
        sub.time_taken_minutes,
        sub.started_at,
        sub.submitted_at,
        sub.status,
        sub.attempt_number,
        sub.feedback,
        CASE 
          WHEN sub.percentage_score >= 90 THEN 'Excellent'
          WHEN sub.percentage_score >= 80 THEN 'Good'
          WHEN sub.percentage_score >= 70 THEN 'Average'
          WHEN sub.percentage_score >= 60 THEN 'Below Average'
          ELSE 'Needs Improvement'
        END as performance_level
      FROM assessment_submissions sub
      LEFT JOIN users u ON sub.student_id = u.id
      LEFT JOIN colleges c ON u.college_id = c.id
      LEFT JOIN assessments at ON sub.assessment_id = at.id
      WHERE sub.assessment_id = ?
      ${dateFilter}
      ${collegeFilter}
      ${departmentFilter}
      ORDER BY sub.submitted_at DESC
    `, [assessmentId, ...dateParams]);

    // Get assessment statistics
    const [assessmentStats] = await pool.execute(`
      SELECT 
        COUNT(DISTINCT sub.student_id) as total_students,
        COUNT(CASE WHEN sub.status = 'submitted' OR sub.status = 'graded' THEN 1 END) as total_submissions,
        COALESCE(AVG(sub.percentage_score), 0) as average_score,
        COALESCE(MIN(sub.percentage_score), 0) as lowest_score,
        COALESCE(MAX(sub.percentage_score), 0) as highest_score,
        COALESCE(AVG(sub.time_taken_minutes), 0) as average_time_taken,
        COUNT(CASE WHEN sub.percentage_score >= at.passing_score THEN 1 END) as passed_count,
        COUNT(CASE WHEN sub.percentage_score < at.passing_score THEN 1 END) as failed_count
      FROM assessments at
      LEFT JOIN assessment_submissions sub ON at.id = sub.assessment_id
      WHERE at.id = ?
      ${dateFilter}
      ${collegeFilter}
      ${departmentFilter}
    `, [assessmentId, ...dateParams]);

    // Get score distribution
    const [scoreDistribution] = await pool.execute(`
      SELECT 
        CASE 
          WHEN sub.percentage_score >= 90 THEN '90-100%'
          WHEN sub.percentage_score >= 80 THEN '80-89%'
          WHEN sub.percentage_score >= 70 THEN '70-79%'
          WHEN sub.percentage_score >= 60 THEN '60-69%'
          ELSE 'Below 60%'
        END as score_range,
        COUNT(*) as count
      FROM assessment_submissions sub
      WHERE sub.assessment_id = ? AND sub.percentage_score IS NOT NULL
      ${dateFilter}
      ${collegeFilter}
      ${departmentFilter}
      GROUP BY score_range
      ORDER BY 
        CASE score_range
          WHEN '90-100%' THEN 1
          WHEN '80-89%' THEN 2
          WHEN '70-79%' THEN 3
          WHEN '60-69%' THEN 4
          ELSE 5
        END
    `, [assessmentId, ...dateParams]);

    // Helper function to convert numeric fields
    const convertNumericFields = (obj) => {
      const result = { ...obj };
      Object.keys(result).forEach(key => {
        if (typeof result[key] === 'string' && !isNaN(result[key])) {
          result[key] = parseFloat(result[key]);
        }
      });
      return result;
    };

    res.json({
      success: true,
      data: {
        assessment: convertNumericFields(assessmentInfo[0]),
        submissions: submissionDetails.map(convertNumericFields),
        statistics: convertNumericFields(assessmentStats[0] || {}),
        scoreDistribution: scoreDistribution.map(convertNumericFields),
        filters: {
          collegeId,
          departmentId,
          dateRange,
          startDate,
          endDate
        }
      }
    });

  } catch (error) {
    // Error getting assessment details
    res.status(500).json({
      success: false,
      message: 'Failed to get assessment details'
    });
  }
};

// Get course categories
export const getCourseCategories = async (req, res) => {
  try {
    // Since courses table doesn't have a category column, return empty array for now
    // This can be enhanced later when course categories are implemented
    res.json({
      success: true,
      data: []
    });
  } catch (error) {
    // Error getting course categories
    res.status(500).json({
      success: false,
      message: 'Failed to get course categories'
    });
  }
};

// Get colleges list for filter dropdown
export const getCollegesForAnalytics = async (req, res) => {
  try {
    const [colleges] = await pool.execute(`
      SELECT id, name, code
      FROM colleges 
      WHERE is_active = true 
      ORDER BY name
    `);

    res.json({
      success: true,
      data: colleges
    });
  } catch (error) {
    // Error getting colleges for analytics
    res.status(500).json({
      success: false,
      message: 'Failed to get colleges'
    });
  }
};

// Get departments list for filter dropdown
export const getDepartmentsForAnalytics = async (req, res) => {
  try {
    const { collegeId } = req.query;

    let query = `
      SELECT d.id, d.name, d.code, c.name as collegeName
      FROM departments d
      JOIN colleges c ON d.college_id = c.id
      WHERE d.is_active = true
    `;

    const params = [];
    if (collegeId && collegeId !== 'all') {
      query += ' AND d.college_id = ?';
      params.push(collegeId);
    }

    query += ' ORDER BY d.name';

    const [departments] = await pool.execute(query, params);

    res.json({
      success: true,
      data: departments
    });
  } catch (error) {
    // Error getting departments for analytics
    res.status(500).json({
      success: false,
      message: 'Failed to get departments'
    });
  }
};

// Get students list for filter dropdown
export const getStudentsForAnalytics = async (req, res) => {
  try {
    const { collegeId, departmentId } = req.query;

    let query = `
      SELECT u.id, u.name, u.email, c.name as college, u.department
      FROM users u
      LEFT JOIN colleges c ON u.college_id = c.id
      WHERE u.role = 'student' AND u.is_active = true
    `;

    const params = [];
    if (collegeId && collegeId !== 'all') {
      query += ' AND u.college_id = ?';
      params.push(collegeId);
    }

    if (departmentId && departmentId !== 'all') {
      query += ' AND u.department = ?';
      params.push(departmentId);
    }

    query += ' ORDER BY u.name';

    const [students] = await pool.execute(query, params);

    res.json({
      success: true,
      data: students
    });
  } catch (error) {
    // Error getting students for analytics
    res.status(500).json({
      success: false,
      message: 'Failed to get students'
    });
  }
};

// Export analytics data
export const exportAnalyticsData = async (req, res) => {
  try {
    const { filters, format = 'excel', exportId } = req.body;

    // MEDIUM FIX: Create progress tracker if exportId provided
    const exportProgressService = (await import('../services/exportProgressService.js')).default;
    const progressId = exportId || (await import('uuid')).v4();
    if (!exportId) {
      exportProgressService.createProgress(progressId, 100);
    }

    exportProgressService.updateProgress(progressId, 10, 'Fetching analytics data...');

    // Get analytics data
    const analyticsResponse = await getAnalyticsData({ query: filters }, { json: (data) => data });
    const analyticsData = analyticsResponse.data;

    exportProgressService.updateProgress(progressId, 50, 'Generating export file...');

    if (format === 'excel') {
      await exportToExcel(analyticsData, res);
    } else if (format === 'pdf') {
      await exportToPDF(analyticsData, res);
    } else if (format === 'csv') {
      await exportToCSV(analyticsData, res);
    } else {
      exportProgressService.failProgress(progressId, 'Unsupported export format');
      res.status(400).json({
        success: false,
        message: 'Unsupported export format',
        exportId: progressId
      });
      return;
    }

    exportProgressService.completeProgress(progressId, 'Export completed successfully');

    // Include exportId in response for progress tracking
    if (res.headersSent === false) {
      res.json({
        success: true,
        exportId: progressId,
        message: 'Export completed'
      });
    }

  } catch (error) {
    // Error exporting analytics data
    const exportProgressService = (await import('../services/exportProgressService.js')).default;
    if (req.body.exportId) {
      exportProgressService.failProgress(req.body.exportId, error.message);
    }
    res.status(500).json({
      success: false,
      message: 'Failed to export analytics data'
    });
  }
};

// Export to Excel with pivot tables
async function exportToExcel(data, res) {
  try {
    const workbook = new ExcelJS.Workbook();

    // Summary sheet
    const summarySheet = workbook.addWorksheet('Summary');
    summarySheet.columns = [
      { header: 'Metric', key: 'metric', width: 20 },
      { header: 'Value', key: 'value', width: 15 }
    ];

    summarySheet.addRows([
      { metric: 'Total Assessments', value: data.summary.totalAssessments || 0 },
      { metric: 'Active Students', value: data.summary.activeStudents || 0 },
      { metric: 'Average Score', value: `${(data.summary.averageScore || 0).toFixed(2)}%` },
      { metric: 'Completion Rate', value: `${(data.summary.completionRate || 0).toFixed(2)}%` }
    ]);

    // College Performance sheet
    const collegeSheet = workbook.addWorksheet('College Performance');
    collegeSheet.columns = [
      { header: 'College', key: 'name', width: 30 },
      { header: 'Total Students', key: 'totalStudents', width: 15 },
      { header: 'Total Assessments', key: 'totalAssessments', width: 15 },
      { header: 'Average Score', key: 'averageScore', width: 15 },
      { header: 'Completed Assessments', key: 'completedAssessments', width: 20 }
    ];

    collegeSheet.addRows(data.collegeStats || []);

    // Department Performance sheet
    const departmentSheet = workbook.addWorksheet('Department Performance');
    departmentSheet.columns = [
      { header: 'Department', key: 'name', width: 25 },
      { header: 'College', key: 'collegeName', width: 25 },
      { header: 'Total Students', key: 'totalStudents', width: 15 },
      { header: 'Total Assessments', key: 'totalAssessments', width: 15 },
      { header: 'Average Score', key: 'averageScore', width: 15 },
      { header: 'Completed Assessments', key: 'completedAssessments', width: 20 }
    ];

    departmentSheet.addRows(data.departmentStats || []);

    // Student Performance sheet
    const studentSheet = workbook.addWorksheet('Student Performance');
    studentSheet.columns = [
      { header: 'Student Name', key: 'name', width: 25 },
      { header: 'Email', key: 'email', width: 30 },
      { header: 'College', key: 'college', width: 20 },
      { header: 'Department', key: 'department', width: 20 },
      { header: 'Total Assessments', key: 'totalAssessments', width: 15 },
      { header: 'Completed Assessments', key: 'completedAssessments', width: 20 },
      { header: 'Average Score', key: 'averageScore', width: 15 },
      { header: 'Total Time Taken (min)', key: 'totalTimeTaken', width: 20 }
    ];

    studentSheet.addRows(data.studentStats || []);

    // Assessment Performance sheet
    const assessmentSheet = workbook.addWorksheet('Assessment Performance');
    assessmentSheet.columns = [
      { header: 'Assessment Title', key: 'title', width: 35 },
      { header: 'Total Students', key: 'totalStudents', width: 15 },
      { header: 'Completed Submissions', key: 'completedSubmissions', width: 20 },
      { header: 'Average Score', key: 'averageScore', width: 15 },
      { header: 'Lowest Score', key: 'lowestScore', width: 15 },
      { header: 'Highest Score', key: 'highestScore', width: 15 },
      { header: 'Average Time (min)', key: 'averageTimeTaken', width: 18 }
    ];

    assessmentSheet.addRows(data.assessmentStats || []);

    // Score Distribution sheet
    const scoreSheet = workbook.addWorksheet('Score Distribution');
    scoreSheet.columns = [
      { header: 'Score Range', key: 'scoreRange', width: 15 },
      { header: 'Count', key: 'count', width: 15 }
    ];

    scoreSheet.addRows(data.charts.scoreDistribution || []);

    // Add pivot tables
    if (data.collegeStats && data.collegeStats.length > 0) {
      const pivotSheet = workbook.addWorksheet('Pivot Tables');

      // College vs Assessment Type pivot
      pivotSheet.addRow(['College vs Assessment Type Analysis']);
      pivotSheet.addRow([]);

      // Add pivot table data here
      // This would require additional queries to get the cross-tabulation data
    }

    // Generate file
    const fileName = `analytics-report-${new Date().toISOString().split('T')[0]}.xlsx`;
    const filePath = path.join(process.cwd(), 'uploads', 'exports', fileName);

    // Ensure directory exists
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    await workbook.xlsx.writeFile(filePath);

    res.json({
      success: true,
      data: {
        fileUrl: `/uploads/exports/${fileName}`,
        fileName: fileName
      }
    });

  } catch (error) {
    // Error creating Excel file
    res.status(500).json({
      success: false,
      message: 'Failed to create Excel file'
    });
  }
}

// Export to PDF
async function exportToPDF(data, res) {
  try {
    const doc = new PDFDocument();
    const fileName = `analytics-report-${new Date().toISOString().split('T')[0]}.pdf`;
    const filePath = path.join(process.cwd(), 'uploads', 'exports', fileName);

    // Ensure directory exists
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    // Add content to PDF
    doc.fontSize(24).text('Analytics Report', { align: 'center' });
    doc.moveDown();
    doc.fontSize(12).text(`Generated on: ${new Date().toLocaleDateString()}`);
    doc.moveDown();

    // Summary section
    doc.fontSize(16).text('Summary Statistics');
    doc.fontSize(12).text(`Total Assessments: ${data.summary.totalAssessments || 0}`);
    doc.text(`Active Students: ${data.summary.activeStudents || 0}`);
    doc.text(`Average Score: ${(data.summary.averageScore || 0).toFixed(2)}%`);
    doc.text(`Completion Rate: ${(data.summary.completionRate || 0).toFixed(2)}%`);
    doc.moveDown();

    // College Performance section
    doc.fontSize(16).text('College Performance');
    (data.collegeStats || []).forEach(college => {
      doc.fontSize(12).text(`${college.name}: ${(college.averageScore || 0).toFixed(2)}%`);
    });
    doc.moveDown();

    doc.end();

    stream.on('finish', () => {
      res.json({
        success: true,
        data: {
          fileUrl: `/uploads/exports/${fileName}`,
          fileName: fileName
        }
      });
    });

  } catch (error) {
    // Error creating PDF file
    res.status(500).json({
      success: false,
      message: 'Failed to create PDF file'
    });
  }
}

// Export to CSV
async function exportToCSV(data, res) {
  try {
    const fileName = `analytics-report-${new Date().toISOString().split('T')[0]}.csv`;
    const filePath = path.join(process.cwd(), 'uploads', 'exports', fileName);

    // Ensure directory exists
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    let csvContent = '';

    // Summary
    csvContent += 'Summary Statistics\n';
    csvContent += 'Metric,Value\n';
    csvContent += `Total Assessments,${data.summary.totalAssessments || 0}\n`;
    csvContent += `Active Students,${data.summary.activeStudents || 0}\n`;
    csvContent += `Average Score,${(data.summary.averageScore || 0).toFixed(2)}%\n`;
    csvContent += `Completion Rate,${(data.summary.completionRate || 0).toFixed(2)}%\n\n`;

    // College Performance
    csvContent += 'College Performance\n';
    csvContent += 'College,Total Students,Total Assessments,Average Score,Completed Assessments\n';
    (data.collegeStats || []).forEach(college => {
      csvContent += `${college.name},${college.totalStudents || 0},${college.totalAssessments || 0},${(college.averageScore || 0).toFixed(2)}%,${college.completedAssessments || 0}\n`;
    });
    csvContent += '\n';

    // Student Performance
    csvContent += 'Student Performance\n';
    csvContent += 'Student Name,Email,College,Department,Total Assessments,Completed Assessments,Average Score,Total Time Taken\n';
    (data.studentStats || []).forEach(student => {
      csvContent += `${student.name},${student.email},${student.college},${student.department},${student.totalAssessments || 0},${student.completedAssessments || 0},${(student.averageScore || 0).toFixed(2)}%,${student.totalTimeTaken || 0}\n`;
    });

    fs.writeFileSync(filePath, csvContent);

    res.json({
      success: true,
      data: {
        fileUrl: `/uploads/exports/${fileName}`,
        fileName: fileName
      }
    });

  } catch (error) {
    // Error creating CSV file
    res.status(500).json({
      success: false,
      message: 'Failed to create CSV file'
    });
  }
}

// Get all student submissions for a specific assessment
export const getAssessmentStudentSubmissions = async (req, res) => {
  try {
    const { assessmentId } = req.params;
    const { collegeId, departmentId } = req.query;

    // Build filters
    let filters = '';
    let params = [assessmentId];

    if (collegeId && collegeId !== 'all') {
      filters += ' AND u.college_id = ?';
      params.push(collegeId);
    }

    if (departmentId && departmentId !== 'all') {
      filters += ' AND u.department = ?';
      params.push(departmentId);
    }

    // Get student submissions with detailed information
    const [submissions] = await pool.execute(`
      SELECT 
        sub.id,
        sub.student_id,
        u.name as student_name,
        u.email as student_email,
        u.student_id as student_id_number,
        c.name as college_name,
        u.department as department_name,
        sub.status,
        sub.submitted_at,
        sub.percentage_score as score,
        sub.time_taken_minutes,
        sub.attempt_number
      FROM assessment_submissions sub
      JOIN users u ON sub.student_id = u.id
      JOIN colleges c ON u.college_id = c.id
      WHERE sub.assessment_id = ? ${filters}
      ORDER BY sub.submitted_at DESC
    `, params);

    res.json({
      success: true,
      data: submissions
    });

  } catch (error) {
    // Error getting assessment student submissions
    res.status(500).json({
      success: false,
      message: 'Failed to get assessment student submissions'
    });
  }
};

// Get public stats for landing page
export const getPublicStats = async (req, res) => {
  try {
    // Ensure JSON response header is set
    res.setHeader('Content-Type', 'application/json');
    
    const stats = await getPlatformStatsSnapshot();
    
    // Ensure we have valid stats object
    if (!stats || typeof stats !== 'object') {
      throw new Error('Invalid stats returned from getPlatformStatsSnapshot');
    }
    
    const {
      activeUsers = 0,
      totalColleges = 0,
      totalAssessments = 0,
      totalSubmissions = 0
    } = stats;
    
    res.json({
      success: true,
      data: {
        activeUsers: Number(activeUsers) || 0,
        institutions: Number(totalColleges) || 0,
        assessments: Number(totalAssessments) || 0,
        submissions: Number(totalSubmissions) || 0
      }
    });
  } catch (error) {
    console.error('Public stats error:', error);
    console.error('Error stack:', error.stack);
    
    // Ensure JSON response header is set even on error
    if (!res.headersSent) {
      res.setHeader('Content-Type', 'application/json');
    }
    
    // Return default values instead of error for public endpoint
    // This ensures the landing page still loads even if stats fail
    res.json({
      success: true,
      data: {
        activeUsers: 0,
        institutions: 0,
        assessments: 0,
        submissions: 0
      }
    });
  }
};
