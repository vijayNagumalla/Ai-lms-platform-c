import { pool as db } from '../config/database.js';
import ExcelJS from 'exceljs';
import fs from 'fs';
import path from 'path';
// CRITICAL FIX: Import input validation utilities
import { safeParseInt, safeString } from '../utils/inputValidation.js';

// CRITICAL FIX: Simple in-memory cache for analytics query results (can be replaced with Redis in production)
const analyticsCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

const getCacheKey = (prefix, ...params) => {
    return `${prefix}_${JSON.stringify(params)}`;
};

// CRITICAL FIX: LRU (Least Recently Used) cache eviction strategy
const setCached = (key, data, ttl = CACHE_TTL) => {
    // Remove existing entry if present (to update access time)
    if (analyticsCache.has(key)) {
        analyticsCache.delete(key);
    }
    
    analyticsCache.set(key, {
        data,
        timestamp: Date.now(),
        ttl,
        lastAccessed: Date.now() // Track last access for LRU
    });
    
    // MEDIUM FIX: Enforce hard limit - evict multiple entries if needed
    const MAX_CACHE_SIZE = 100;
    // Evict entries until cache is within limit (not just one entry)
    while (analyticsCache.size > MAX_CACHE_SIZE) {
        // Find least recently used entry
        let lruKey = null;
        let lruTime = Date.now();
        
        for (const [cacheKey, cached] of analyticsCache.entries()) {
            if (cached.lastAccessed < lruTime) {
                lruTime = cached.lastAccessed;
                lruKey = cacheKey;
            }
        }
        
        if (lruKey) {
            analyticsCache.delete(lruKey);
        } else {
            // If no LRU found (shouldn't happen), clear entire cache as fallback
            console.warn('Analytics cache eviction failed, clearing entire cache');
            analyticsCache.clear();
            break;
        }
    }
};

// CRITICAL FIX: Update last accessed time when retrieving from cache
const getCached = (key) => {
    const cached = analyticsCache.get(key);
    if (cached && Date.now() - cached.timestamp < cached.ttl) {
        // Update last accessed time for LRU
        cached.lastAccessed = Date.now();
        return cached.data;
    }
    // CRITICAL FIX: Remove expired entries immediately
    if (cached) {
        analyticsCache.delete(key);
    }
    return null;
};

const clearCache = (prefix) => {
    for (const key of analyticsCache.keys()) {
        if (key.startsWith(prefix)) {
            analyticsCache.delete(key);
        }
    }
};

// MEDIUM FIX: Invalidate cache for specific student or assessment
const invalidateCache = (studentId = null, assessmentId = null) => {
    if (studentId) {
        // Clear all cache entries for this student
        clearCache(`student_analytics_${studentId}`);
    }
    if (assessmentId) {
        // Clear all cache entries for this assessment
        clearCache(`assessment_analytics_${assessmentId}`);
    }
    // If both null, clear all analytics cache
    if (!studentId && !assessmentId) {
        analyticsCache.clear();
    }
};

class AnalyticsService {
    // MEDIUM FIX: Expose cache invalidation method
    invalidateCache(studentId = null, assessmentId = null) {
        invalidateCache(studentId, assessmentId);
    }
    
    // CRITICAL FIX: Validate analytics filter parameters
    validateFilters(filters) {
        const validated = {};
        
        // Validate and sanitize dateFrom
        if (filters.dateFrom) {
            const date = new Date(filters.dateFrom);
            if (isNaN(date.getTime())) {
                throw new Error('Invalid dateFrom parameter');
            }
            validated.dateFrom = date.toISOString().split('T')[0]; // YYYY-MM-DD format
        }
        
        // Validate and sanitize dateTo
        if (filters.dateTo) {
            const date = new Date(filters.dateTo);
            if (isNaN(date.getTime())) {
                throw new Error('Invalid dateTo parameter');
            }
            validated.dateTo = date.toISOString().split('T')[0]; // YYYY-MM-DD format
        }
        
        // Validate date range (dateTo must be >= dateFrom)
        if (validated.dateFrom && validated.dateTo && validated.dateFrom > validated.dateTo) {
            throw new Error('dateTo must be greater than or equal to dateFrom');
        }
        
        // Validate assessmentIds array
        if (filters.assessmentIds) {
            if (!Array.isArray(filters.assessmentIds)) {
                throw new Error('assessmentIds must be an array');
            }
            if (filters.assessmentIds.length > 100) {
                throw new Error('Too many assessment IDs (maximum 100 allowed)');
            }
            validated.assessmentIds = filters.assessmentIds.filter(id => {
                return typeof id === 'string' && id.length > 0 && id.length <= 50;
            });
            if (validated.assessmentIds.length === 0 && filters.assessmentIds.length > 0) {
                throw new Error('Invalid assessmentIds format');
            }
        }
        
        // Validate batchId
        if (filters.batchId) {
            validated.batchId = safeString(filters.batchId, 50);
            if (!validated.batchId) {
                throw new Error('Invalid batchId parameter');
            }
        }
        
        // Validate departmentId
        if (filters.departmentId) {
            validated.departmentId = safeString(filters.departmentId, 50);
            if (!validated.departmentId) {
                throw new Error('Invalid departmentId parameter');
            }
        }
        
        // Validate collegeId
        if (filters.collegeId) {
            validated.collegeId = safeString(filters.collegeId, 50);
            if (!validated.collegeId) {
                throw new Error('Invalid collegeId parameter');
            }
        }
        
        // Validate pagination parameters
        validated.page = safeParseInt(filters.page, 1);
        validated.limit = safeParseInt(filters.limit, 50);
        
        if (validated.page < 1) {
            validated.page = 1;
        }
        if (validated.limit < 1 || validated.limit > 100) {
            validated.limit = Math.min(Math.max(validated.limit, 1), 100);
        }
        
        return validated;
    }
    
    // Get student performance analytics
    async getStudentPerformanceAnalytics(studentId, filters = {}) {
        try {
            // CRITICAL FIX: Validate all filter parameters
            const validatedFilters = this.validateFilters(filters);
            const { dateFrom, dateTo, assessmentIds, batchId, departmentId, page, limit } = validatedFilters;
            
            // CRITICAL FIX: Validate studentId
            if (!studentId || typeof studentId !== 'string' || studentId.length > 50) {
                throw new Error('Invalid studentId parameter');
            }
            
            // CRITICAL FIX: Check cache first for analytics queries
            const cacheKey = getCacheKey('student_analytics', studentId, validatedFilters);
            const cached = getCached(cacheKey);
            if (cached) {
                return cached;
            }

            // CRITICAL FIX: Add pagination to prevent loading all data at once
            const offset = (page - 1) * limit;
            const maxLimit = Math.min(limit, 100); // Cap at 100 per page

            let query = `
                SELECT 
                    s.id as submission_id,
                    s.assessment_id,
                    s.attempt_number,
                    s.total_score,
                    s.percentage_score,
                    s.grade,
                    s.time_taken_minutes,
                    s.submitted_at,
                    a.title as assessment_title,
                    a.subject,
                    a.total_points,
                    c.name as college_name,
                    d.name as department_name,
                    b.name as batch_name,
                    COUNT(sr.id) as questions_answered,
                    SUM(CASE WHEN sr.is_correct = 1 THEN 1 ELSE 0 END) as correct_answers,
                    AVG(sr.time_spent) as avg_time_per_question
                FROM assessment_submissions s
                LEFT JOIN assessments a ON s.assessment_id = a.id
                LEFT JOIN colleges c ON a.college_id = c.id
                LEFT JOIN departments d ON a.department_id = d.id
                LEFT JOIN batches b ON a.batch_id = b.id
                LEFT JOIN student_responses sr ON s.id = sr.submission_id
                WHERE s.student_id = ? AND (s.status = 'submitted' OR s.status = 'graded')
            `;

            const params = [studentId];

            if (dateFrom) {
                query += ` AND s.submitted_at >= ?`;
                params.push(dateFrom);
            }

            if (dateTo) {
                query += ` AND s.submitted_at <= ?`;
                params.push(dateTo);
            }

            if (assessmentIds && assessmentIds.length > 0) {
                query += ` AND s.assessment_id IN (${assessmentIds.map(() => '?').join(',')})`;
                params.push(...assessmentIds);
            }

            if (batchId) {
                query += ` AND a.batch_id = ?`;
                params.push(batchId);
            }

            if (departmentId) {
                query += ` AND a.department_id = ?`;
                params.push(departmentId);
            }

            query += ` GROUP BY s.id ORDER BY s.submitted_at DESC LIMIT ? OFFSET ?`;
            params.push(maxLimit, offset);

            // CRITICAL FIX: Get total count for pagination
            let countQuery = `
                SELECT COUNT(DISTINCT s.id) as total
                FROM assessment_submissions s
                LEFT JOIN assessments a ON s.assessment_id = a.id
                WHERE s.student_id = ? AND (s.status = 'submitted' OR s.status = 'graded')
            `;
            const countParams = [studentId];
            
            if (dateFrom) {
                countQuery += ` AND s.submitted_at >= ?`;
                countParams.push(dateFrom);
            }
            if (dateTo) {
                countQuery += ` AND s.submitted_at <= ?`;
                countParams.push(dateTo);
            }
            if (assessmentIds && assessmentIds.length > 0) {
                countQuery += ` AND s.assessment_id IN (${assessmentIds.map(() => '?').join(',')})`;
                countParams.push(...assessmentIds);
            }
            if (batchId) {
                countQuery += ` AND a.batch_id = ?`;
                countParams.push(batchId);
            }
            if (departmentId) {
                countQuery += ` AND a.department_id = ?`;
                countParams.push(departmentId);
            }
            
            const [countResult] = await db.execute(countQuery, countParams);
            const total = countResult[0]?.total || 0;

            // CRITICAL FIX: Use database functions for calculations to ensure accuracy
            // Calculate metrics using SQL AVG/SUM/COUNT instead of JavaScript to avoid rounding errors
            let metricsQuery = `
                SELECT 
                    COUNT(*) as total_submissions,
                    ROUND(AVG(s.total_score), 2) as avg_score,
                    ROUND(AVG(s.percentage_score), 2) as avg_percentage,
                    SUM(COALESCE(s.time_taken_minutes, 0)) as total_time_spent,
                    MIN(s.total_score) as min_score,
                    MAX(s.total_score) as max_score,
                    COUNT(CASE WHEN s.grade = 'A' THEN 1 END) as grade_a_count,
                    COUNT(CASE WHEN s.grade = 'B' THEN 1 END) as grade_b_count,
                    COUNT(CASE WHEN s.grade = 'C' THEN 1 END) as grade_c_count,
                    COUNT(CASE WHEN s.grade = 'D' THEN 1 END) as grade_d_count,
                    COUNT(CASE WHEN s.grade = 'F' THEN 1 END) as grade_f_count
                FROM assessment_submissions s
                LEFT JOIN assessments a ON s.assessment_id = a.id
                WHERE s.student_id = ? AND (s.status = 'submitted' OR s.status = 'graded')
            `;
            const metricsParams = [studentId];
            
            // Add same filters to metrics query
            if (dateFrom) {
                metricsQuery += ` AND s.submitted_at >= ?`;
                metricsParams.push(dateFrom);
            }
            if (dateTo) {
                metricsQuery += ` AND s.submitted_at <= ?`;
                metricsParams.push(dateTo);
            }
            if (assessmentIds && assessmentIds.length > 0) {
                metricsQuery += ` AND s.assessment_id IN (${assessmentIds.map(() => '?').join(',')})`;
                assessmentIds.forEach(id => metricsParams.push(id));
            }
            if (batchId) {
                metricsQuery += ` AND a.batch_id = ?`;
                metricsParams.push(batchId);
            }
            if (departmentId) {
                metricsQuery += ` AND a.department_id = ?`;
                metricsParams.push(departmentId);
            }
            
            const [metricsResult] = await db.execute(metricsQuery, metricsParams);
            const metrics = metricsResult[0] || {};
            
            const [submissions] = await db.execute(query, params);
            
            // Use database-calculated metrics instead of JavaScript calculations
            const performanceMetrics = {
                averageScore: parseFloat(metrics.avg_score || 0),
                averagePercentage: parseFloat(metrics.avg_percentage || 0),
                totalTimeSpent: parseInt(metrics.total_time_spent || 0),
                gradeDistribution: {
                    'A': parseInt(metrics.grade_a_count || 0),
                    'B': parseInt(metrics.grade_b_count || 0),
                    'C': parseInt(metrics.grade_c_count || 0),
                    'D': parseInt(metrics.grade_d_count || 0),
                    'F': parseInt(metrics.grade_f_count || 0)
                },
                minScore: parseFloat(metrics.min_score || 0),
                maxScore: parseFloat(metrics.max_score || 0),
                totalAssessments: parseInt(metrics.total_submissions || 0)
            };

            const result = {
                submissions,
                performanceMetrics,
                totalAssessments: total,
                currentPage: page,
                totalPages: Math.ceil(total / maxLimit),
                pageSize: maxLimit,
                averageScore: performanceMetrics.averageScore,
                averagePercentage: performanceMetrics.averagePercentage,
                improvementTrend: this.calculateImprovementTrend(submissions)
            };
            
            // CRITICAL FIX: Cache the result for future requests
            setCached(cacheKey, result);
            
            return result;
        } catch (error) {
            console.error('Error getting student performance analytics:', error);
            throw error;
        }
    }

    // Get assessment performance analytics
    async getAssessmentPerformanceAnalytics(assessmentId, filters = {}) {
        try {
            // CRITICAL FIX: Validate assessmentId
            if (!assessmentId || typeof assessmentId !== 'string' || assessmentId.length > 50) {
                throw new Error('Invalid assessmentId parameter');
            }
            
            // CRITICAL FIX: Validate all filter parameters
            const validatedFilters = this.validateFilters(filters);
            const { batchId, departmentId, collegeId, dateFrom, dateTo, page, limit } = validatedFilters;

            // CRITICAL FIX: Check cache first for analytics queries
            const cacheKey = getCacheKey('assessment_analytics', assessmentId, validatedFilters);
            const cached = getCached(cacheKey);
            if (cached) {
                return cached;
            }

            // CRITICAL FIX: Add pagination to prevent loading all data at once
            const offset = (page - 1) * limit;
            const maxLimit = Math.min(limit, 100); // Cap at 100 per page

            let query = `
                SELECT 
                    s.*,
                    u.name as student_name,
                    u.email as student_email,
                    c.name as college_name,
                    d.name as department_name,
                    b.name as batch_name,
                    COUNT(sr.id) as total_questions,
                    SUM(CASE WHEN sr.is_correct = 1 THEN 1 ELSE 0 END) as correct_answers,
                    AVG(sr.time_spent) as avg_time_per_question,
                    SUM(sr.points_earned) as total_points_earned
                FROM assessment_submissions s
                LEFT JOIN users u ON s.student_id = u.id
                LEFT JOIN colleges c ON s.college_id = c.id
                LEFT JOIN departments d ON s.department_id = d.id
                LEFT JOIN batches b ON s.batch_id = b.id
                LEFT JOIN student_responses sr ON s.id = sr.submission_id
                WHERE s.assessment_id = ? AND (s.status = 'submitted' OR s.status = 'graded')
            `;

            const params = [assessmentId];

            if (batchId) {
                query += ` AND s.batch_id = ?`;
                params.push(batchId);
            }

            if (departmentId) {
                query += ` AND s.department_id = ?`;
                params.push(departmentId);
            }

            if (collegeId) {
                query += ` AND s.college_id = ?`;
                params.push(collegeId);
            }

            if (dateFrom) {
                query += ` AND s.submitted_at >= ?`;
                params.push(dateFrom);
            }

            if (dateTo) {
                query += ` AND s.submitted_at <= ?`;
                params.push(dateTo);
            }

            query += ` GROUP BY s.id ORDER BY s.submitted_at DESC LIMIT ? OFFSET ?`;
            params.push(maxLimit, offset);

            // CRITICAL FIX: Get total count for pagination
            let countQuery = `
                SELECT COUNT(DISTINCT s.id) as total
                FROM assessment_submissions s
                WHERE s.assessment_id = ? AND (s.status = 'submitted' OR s.status = 'graded')
            `;
            const countParams = [assessmentId];
            
            if (batchId) {
                countQuery += ` AND s.batch_id = ?`;
                countParams.push(batchId);
            }
            if (departmentId) {
                countQuery += ` AND s.department_id = ?`;
                countParams.push(departmentId);
            }
            if (collegeId) {
                countQuery += ` AND s.college_id = ?`;
                countParams.push(collegeId);
            }
            if (dateFrom) {
                countQuery += ` AND s.submitted_at >= ?`;
                countParams.push(dateFrom);
            }
            if (dateTo) {
                countQuery += ` AND s.submitted_at <= ?`;
                countParams.push(dateTo);
            }
            
            const [countResult] = await db.execute(countQuery, countParams);
            const total = countResult[0]?.total || 0;

            // CRITICAL FIX: Use database functions for calculations to ensure accuracy
            // Calculate metrics using SQL AVG/SUM/COUNT instead of JavaScript to avoid rounding errors
            let metricsQuery = `
                SELECT 
                    COUNT(*) as total_submissions,
                    ROUND(AVG(s.total_score), 2) as avg_score,
                    ROUND(AVG(s.percentage_score), 2) as avg_percentage,
                    SUM(COALESCE(s.time_taken_minutes, 0)) as total_time_spent,
                    MIN(s.total_score) as min_score,
                    MAX(s.total_score) as max_score,
                    COUNT(CASE WHEN s.grade = 'A' THEN 1 END) as grade_a_count,
                    COUNT(CASE WHEN s.grade = 'B' THEN 1 END) as grade_b_count,
                    COUNT(CASE WHEN s.grade = 'C' THEN 1 END) as grade_c_count,
                    COUNT(CASE WHEN s.grade = 'D' THEN 1 END) as grade_d_count,
                    COUNT(CASE WHEN s.grade = 'F' THEN 1 END) as grade_f_count,
                    AVG(COALESCE(s.time_taken_minutes, 0)) as avg_time_spent,
                    MIN(COALESCE(s.time_taken_minutes, 0)) as min_time_spent,
                    MAX(COALESCE(s.time_taken_minutes, 0)) as max_time_spent
                FROM assessment_submissions s
                WHERE s.assessment_id = ? AND (s.status = 'submitted' OR s.status = 'graded')
            `;
            const metricsParams = [assessmentId];
            
            // Add same filters to metrics query
            if (batchId) {
                metricsQuery += ` AND s.batch_id = ?`;
                metricsParams.push(batchId);
            }
            if (departmentId) {
                metricsQuery += ` AND s.department_id = ?`;
                metricsParams.push(departmentId);
            }
            if (collegeId) {
                metricsQuery += ` AND s.college_id = ?`;
                metricsParams.push(collegeId);
            }
            if (dateFrom) {
                metricsQuery += ` AND s.submitted_at >= ?`;
                metricsParams.push(dateFrom);
            }
            if (dateTo) {
                metricsQuery += ` AND s.submitted_at <= ?`;
                metricsParams.push(dateTo);
            }
            
            const [metricsResult] = await db.execute(metricsQuery, metricsParams);
            const metrics = metricsResult[0] || {};
            
            const [submissions] = await db.execute(query, params);

            // Use database-calculated metrics instead of JavaScript calculations
            const analytics = {
                totalSubmissions: parseInt(metrics.total_submissions || 0),
                averageScore: parseFloat(metrics.avg_score || 0),
                averagePercentage: parseFloat(metrics.avg_percentage || 0),
                minScore: parseFloat(metrics.min_score || 0),
                maxScore: parseFloat(metrics.max_score || 0),
                totalTimeSpent: parseInt(metrics.total_time_spent || 0),
                averageTimeSpent: parseFloat(metrics.avg_time_spent || 0),
                minTimeSpent: parseInt(metrics.min_time_spent || 0),
                maxTimeSpent: parseInt(metrics.max_time_spent || 0)
            };
            
            const gradeDistribution = {
                'A': parseInt(metrics.grade_a_count || 0),
                'B': parseInt(metrics.grade_b_count || 0),
                'C': parseInt(metrics.grade_c_count || 0),
                'D': parseInt(metrics.grade_d_count || 0),
                'F': parseInt(metrics.grade_f_count || 0)
            };
            
            const timeAnalysis = {
                average: parseFloat(metrics.avg_time_spent || 0),
                min: parseInt(metrics.min_time_spent || 0),
                max: parseInt(metrics.max_time_spent || 0),
                total: parseInt(metrics.total_time_spent || 0)
            };

            const result = {
                submissions,
                analytics,
                totalStudents: total,
                currentPage: page,
                totalPages: Math.ceil(total / maxLimit),
                pageSize: maxLimit,
                completionRate: total > 0 ? (parseInt(metrics.total_submissions || 0) / total * 100).toFixed(2) : 0,
                gradeDistribution,
                timeAnalysis,
                questionAnalysis: await this.getQuestionAnalysis(assessmentId)
            };
            
            // CRITICAL FIX: Cache the result for future requests
            setCached(cacheKey, result);
            
            return result;
        } catch (error) {
            console.error('Error getting assessment performance analytics:', error);
            throw error;
        }
    }

    // Get batch/department analytics
    async getBatchDepartmentAnalytics(filters = {}) {
        try {
            // CRITICAL FIX: Validate all filter parameters
            const validatedFilters = this.validateFilters(filters);
            const { batchId, departmentId, collegeId, dateFrom, dateTo } = validatedFilters;
            const groupBy = filters.groupBy || 'batch';
            
            // CRITICAL FIX: Check cache first for analytics queries
            const cacheKey = getCacheKey('batch_department_analytics', validatedFilters, groupBy);
            const cached = getCached(cacheKey);
            if (cached) {
                return cached;
            }
            
            // CRITICAL FIX: Validate groupBy parameter
            if (!['batch', 'department', 'college'].includes(groupBy)) {
                throw new Error('Invalid groupBy parameter. Must be one of: batch, department, college');
            }

            let groupByField = 'b.id, b.name';
            if (groupBy === 'department') {
                groupByField = 'd.id, d.name';
            } else if (groupBy === 'college') {
                groupByField = 'c.id, c.name';
            }

            // CRITICAL FIX: Use database functions for calculations to ensure accuracy
            let query = `
                SELECT 
                    ${groupByField},
                    COUNT(DISTINCT s.student_id) as total_students,
                    COUNT(s.id) as total_submissions,
                    ROUND(AVG(s.percentage_score), 2) as average_percentage,
                    ROUND(AVG(s.total_score), 2) as average_score,
                    ROUND(AVG(COALESCE(s.time_taken_minutes, 0)), 2) as average_time_spent,
                    COUNT(CASE WHEN s.grade = 'A' THEN 1 END) as grade_a_count,
                    COUNT(CASE WHEN s.grade = 'B' THEN 1 END) as grade_b_count,
                    COUNT(CASE WHEN s.grade = 'C' THEN 1 END) as grade_c_count,
                    COUNT(CASE WHEN s.grade = 'D' THEN 1 END) as grade_d_count,
                    COUNT(CASE WHEN s.grade = 'F' THEN 1 END) as grade_f_count
                FROM assessment_submissions s
                LEFT JOIN assessments a ON s.assessment_id = a.id
                LEFT JOIN colleges c ON a.college_id = c.id
                LEFT JOIN departments d ON a.department_id = d.id
                LEFT JOIN batches b ON a.batch_id = b.id
                WHERE (s.status = 'submitted' OR s.status = 'graded')
            `;

            const params = [];

            if (batchId) {
                query += ` AND a.batch_id = ?`;
                params.push(batchId);
            }

            if (departmentId) {
                query += ` AND a.department_id = ?`;
                params.push(departmentId);
            }

            if (collegeId) {
                query += ` AND a.college_id = ?`;
                params.push(collegeId);
            }

            if (dateFrom) {
                query += ` AND s.submitted_at >= ?`;
                params.push(dateFrom);
            }

            if (dateTo) {
                query += ` AND s.submitted_at <= ?`;
                params.push(dateTo);
            }

            query += ` GROUP BY ${groupByField} ORDER BY average_percentage DESC`;

            const [analytics] = await db.execute(query, params);

            const result = {
                analytics,
                summary: this.calculateSummaryAnalytics(analytics),
                trends: await this.calculateTrends(filters)
            };
            
            // CRITICAL FIX: Cache the result for future requests
            setCached(cacheKey, result);
            
            return result;
        } catch (error) {
            console.error('Error getting batch/department analytics:', error);
            throw error;
        }
    }

    // Export analytics to Excel
    async exportAnalyticsToExcel(exportType, filters = {}) {
        try {
            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet('Analytics Report');

            let data = [];
            let headers = [];

            switch (exportType) {
                case 'student_performance':
                    data = await this.getStudentPerformanceData(filters);
                    headers = [
                        'Student Name', 'Assessment', 'Score', 'Percentage', 'Grade',
                        'Time Spent', 'Questions Answered', 'Correct Answers', 'Submitted At'
                    ];
                    break;

                case 'assessment_performance':
                    data = await this.getAssessmentPerformanceData(filters);
                    headers = [
                        'Student Name', 'Email', 'College', 'Department', 'Batch',
                        'Score', 'Percentage', 'Grade', 'Time Spent', 'Submitted At'
                    ];
                    break;

                case 'batch_analytics':
                    data = await this.getBatchAnalyticsData(filters);
                    headers = [
                        'Batch', 'Department', 'College', 'Total Students',
                        'Total Submissions', 'Average Percentage', 'Average Score',
                        'Grade A', 'Grade B', 'Grade C', 'Grade D', 'Grade F'
                    ];
                    break;

                default:
                    throw new Error('Invalid export type');
            }

            // Add headers
            worksheet.addRow(headers);

            // Style headers
            const headerRow = worksheet.getRow(1);
            headerRow.font = { bold: true };
            headerRow.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFE0E0E0' }
            };

            // Add data
            data.forEach(row => {
                worksheet.addRow(row);
            });

            // Auto-fit columns
            worksheet.columns.forEach(column => {
                column.width = 15;
            });

            // Generate file path
            const fileName = `${exportType}_${Date.now()}.xlsx`;
            const filePath = path.join(__dirname, '../temp', fileName);

            // Ensure temp directory exists
            const tempDir = path.dirname(filePath);
            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir, { recursive: true });
            }

            // Save file
            await workbook.xlsx.writeFile(filePath);

            return {
                fileName,
                filePath,
                size: fs.statSync(filePath).size
            };
        } catch (error) {
            console.error('Error exporting analytics to Excel:', error);
            throw error;
        }
    }

    // Generate PDF report
    async generatePDFReport(reportType, filters = {}) {
        try {
            // This would integrate with a PDF generation library like Puppeteer or PDFKit
            // For now, return a placeholder
            return {
                fileName: `${reportType}_${Date.now()}.pdf`,
                filePath: `/temp/${reportType}_${Date.now()}.pdf`,
                size: 0
            };
        } catch (error) {
            console.error('Error generating PDF report:', error);
            throw error;
        }
    }

    // Helper methods
    calculatePerformanceMetrics(submissions) {
        // CRITICAL FIX: Handle case where submissions might be wrapped in array from db.query
        const actualSubmissions = Array.isArray(submissions) && submissions.length > 0 && Array.isArray(submissions[0]) 
            ? submissions[0] 
            : submissions;
        
        if (!Array.isArray(actualSubmissions) || actualSubmissions.length === 0) {
            return {
                averageScore: 0,
                averagePercentage: 0,
                totalTimeSpent: 0,
                gradeDistribution: {}
            };
        }

        const totalScore = actualSubmissions.reduce((sum, s) => sum + (s.total_score || 0), 0);
        const totalPercentage = actualSubmissions.reduce((sum, s) => sum + (s.percentage_score || s.percentage || 0), 0);
        const totalTimeSpent = actualSubmissions.reduce((sum, s) => sum + (s.time_taken_minutes || s.total_time_spent || 0), 0);

        const gradeDistribution = actualSubmissions.reduce((dist, s) => {
            const grade = s.grade || 'F';
            dist[grade] = (dist[grade] || 0) + 1;
            return dist;
        }, {});

        return {
            averageScore: totalScore / actualSubmissions.length,
            averagePercentage: totalPercentage / actualSubmissions.length,
            totalTimeSpent,
            gradeDistribution,
            totalAssessments: actualSubmissions.length
        };
    }

    calculateImprovementTrend(submissions) {
        // CRITICAL FIX: Handle case where submissions might be wrapped in array from db.query
        const actualSubmissions = Array.isArray(submissions) && submissions.length > 0 && Array.isArray(submissions[0]) 
            ? submissions[0] 
            : submissions;
        
        if (!Array.isArray(actualSubmissions) || actualSubmissions.length < 2) return null;

        const sortedSubmissions = actualSubmissions.sort((a, b) => 
            new Date(a.submitted_at) - new Date(b.submitted_at)
        );

        const firstHalf = sortedSubmissions.slice(0, Math.ceil(sortedSubmissions.length / 2));
        const secondHalf = sortedSubmissions.slice(Math.ceil(sortedSubmissions.length / 2));

        const firstHalfAvg = firstHalf.reduce((sum, s) => sum + (s.percentage_score || s.percentage || 0), 0) / firstHalf.length;
        const secondHalfAvg = secondHalf.reduce((sum, s) => sum + (s.percentage_score || s.percentage || 0), 0) / secondHalf.length;

        return {
            trend: secondHalfAvg > firstHalfAvg ? 'improving' : 'declining',
            improvement: secondHalfAvg - firstHalfAvg,
            firstHalfAverage: firstHalfAvg,
            secondHalfAverage: secondHalfAvg
        };
    }

    calculateAssessmentAnalytics(submissions) {
        // CRITICAL FIX: Handle case where submissions might be wrapped in array from db.query
        const actualSubmissions = Array.isArray(submissions) && submissions.length > 0 && Array.isArray(submissions[0]) 
            ? submissions[0] 
            : submissions;
        
        if (!Array.isArray(actualSubmissions) || actualSubmissions.length === 0) {
            return {
                averageScore: 0,
                averagePercentage: 0,
                completionRate: 0,
                gradeDistribution: {}
            };
        }

        const totalScore = actualSubmissions.reduce((sum, s) => sum + (s.total_score || 0), 0);
        const totalPercentage = actualSubmissions.reduce((sum, s) => sum + (s.percentage_score || s.percentage || 0), 0);

        const gradeDistribution = actualSubmissions.reduce((dist, s) => {
            const grade = s.grade || 'F';
            dist[grade] = (dist[grade] || 0) + 1;
            return dist;
        }, {});

        return {
            averageScore: totalScore / actualSubmissions.length,
            averagePercentage: totalPercentage / actualSubmissions.length,
            totalSubmissions: actualSubmissions.length,
            gradeDistribution
        };
    }

    calculateCompletionRate(assessmentId, completedCount) {
        // This would need to be calculated based on total enrolled students
        // For now, return a placeholder
        return 85; // 85% completion rate
    }

    calculateGradeDistribution(submissions) {
        return submissions.reduce((dist, s) => {
            const grade = s.grade || 'F';
            dist[grade] = (dist[grade] || 0) + 1;
            return dist;
        }, {});
    }

    calculateTimeAnalysis(submissions) {
        const timeSpent = submissions.map(s => s.total_time_spent || 0);
        return {
            average: timeSpent.reduce((sum, time) => sum + time, 0) / timeSpent.length,
            min: Math.min(...timeSpent),
            max: Math.max(...timeSpent),
            median: this.calculateMedian(timeSpent)
        };
    }

    async getQuestionAnalysis(assessmentId) {
        const query = `
            SELECT 
                q.id,
                q.question_text,
                q.type,
                q.points,
                COUNT(sr.id) as total_attempts,
                SUM(CASE WHEN sr.is_correct = 1 THEN 1 ELSE 0 END) as correct_attempts,
                AVG(sr.time_spent) as avg_time_spent,
                AVG(sr.points_earned) as avg_points_earned
            FROM questions q
            LEFT JOIN student_responses sr ON q.id = sr.question_id
            LEFT JOIN assessment_submissions s ON sr.submission_id = s.id
            WHERE q.assessment_id = ? AND (s.status = 'submitted' OR s.status = 'graded')
            GROUP BY q.id
            ORDER BY q.order_index
        `;

        const [results] = await db.execute(query, [assessmentId]);
        return results;
    }

    calculateMedian(numbers) {
        const sorted = numbers.sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 === 0 
            ? (sorted[mid - 1] + sorted[mid]) / 2 
            : sorted[mid];
    }

    calculateSummaryAnalytics(analytics) {
        if (analytics.length === 0) return null;

        const totalStudents = analytics.reduce((sum, a) => sum + a.total_students, 0);
        const totalSubmissions = analytics.reduce((sum, a) => sum + a.total_submissions, 0);
        const avgPercentage = analytics.reduce((sum, a) => sum + a.average_percentage, 0) / analytics.length;

        return {
            totalStudents,
            totalSubmissions,
            averagePercentage: avgPercentage,
            totalBatches: analytics.length
        };
    }

    async calculateTrends(filters) {
        // This would calculate trends over time
        // For now, return placeholder data
        return {
            performanceTrend: 'stable',
            completionTrend: 'increasing',
            engagementTrend: 'stable'
        };
    }

    async getStudentPerformanceData(filters) {
        const analytics = await this.getStudentPerformanceAnalytics(filters.studentId, filters);
        return analytics.submissions.map(s => [
            s.student_name || 'Unknown',
            s.assessment_title,
            s.total_score,
            s.percentage_score || s.percentage,
            s.grade,
            s.time_taken_minutes || s.total_time_spent,
            s.questions_answered,
            s.correct_answers,
            s.submitted_at
        ]);
    }

    async getAssessmentPerformanceData(filters) {
        const analytics = await this.getAssessmentPerformanceAnalytics(filters.assessmentId, filters);
        return analytics.submissions.map(s => [
            s.student_name,
            s.student_email,
            s.college_name,
            s.department_name,
            s.batch_name,
            s.total_score,
            s.percentage_score || s.percentage,
            s.grade,
            s.time_taken_minutes || s.total_time_spent,
            s.submitted_at
        ]);
    }

    async getBatchAnalyticsData(filters) {
        const analytics = await this.getBatchDepartmentAnalytics(filters);
        return analytics.analytics.map(a => [
            a.name,
            a.department_name || 'N/A',
            a.college_name || 'N/A',
            a.total_students,
            a.total_submissions,
            a.average_percentage,
            a.average_score,
            a.grade_a_count,
            a.grade_b_count,
            a.grade_c_count,
            a.grade_d_count,
            a.grade_f_count
        ]);
    }
}

export default new AnalyticsService();
