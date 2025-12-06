import { pool as db } from '../config/database.js';
import fs from 'fs';
import path from 'path';

class PerformanceService {
    constructor() {
        this.cache = new Map();
        this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
        this.queryCache = new Map();
        this.performanceMetrics = {
            queryTimes: [],
            cacheHits: 0,
            cacheMisses: 0,
            totalRequests: 0,
            averageResponseTime: 0
        };
    }

    // Optimize database queries with caching
    async optimizedQuery(query, params = [], useCache = true) {
        const startTime = Date.now();
        const cacheKey = `${query}:${JSON.stringify(params)}`;
        
        try {
            // Check cache first
            if (useCache && this.queryCache.has(cacheKey)) {
                const cached = this.queryCache.get(cacheKey);
                if (Date.now() - cached.timestamp < this.cacheTimeout) {
                    this.performanceMetrics.cacheHits++;
                    return cached.data;
                }
            }
            
            // Execute query
            const [results] = await db.query(query, params);
            const executionTime = Date.now() - startTime;
            
            // Cache the results
            if (useCache) {
                this.queryCache.set(cacheKey, {
                    data: results,
                    timestamp: Date.now()
                });
            }
            
            this.performanceMetrics.cacheMisses++;
            this.performanceMetrics.queryTimes.push(executionTime);
            this.updateAverageResponseTime();
            
            return results;
        } catch (error) {
            console.error('Optimized query error:', error);
            throw error;
        }
    }

    // Get assessment with optimized loading
    async getAssessmentOptimized(assessmentId) {
        const query = `
            SELECT 
                a.*,
                COUNT(q.id) as question_count,
                AVG(q.points) as avg_points
            FROM assessments a
            LEFT JOIN questions q ON a.id = q.assessment_id
            WHERE a.id = ? AND a.is_active = TRUE
            GROUP BY a.id
        `;
        
        return await this.optimizedQuery(query, [assessmentId]);
    }

    // Get student submissions with pagination
    async getStudentSubmissionsOptimized(studentId, page = 1, limit = 20) {
        const offset = (page - 1) * limit;
        
        const query = `
            SELECT 
                s.*,
                a.title as assessment_title,
                a.duration,
                a.total_points
            FROM assessment_submissions s
            JOIN assessments a ON s.assessment_id = a.id
            WHERE s.student_id = ?
            ORDER BY s.submitted_at DESC
            LIMIT ? OFFSET ?
        `;
        
        return await this.optimizedQuery(query, [studentId, limit, offset]);
    }

    // Batch load questions for assessment
    async loadQuestionsBatch(assessmentId) {
        const query = `
            SELECT 
                q.*,
                qo.option_text,
                qo.is_correct,
                qo.option_order
            FROM questions q
            LEFT JOIN question_options qo ON q.id = qo.question_id
            WHERE q.assessment_id = ?
            ORDER BY q.question_order, qo.option_order
        `;
        
        const results = await this.optimizedQuery(query, [assessmentId]);
        
        // Group options by question
        const questions = {};
        results.forEach(row => {
            if (!questions[row.id]) {
                questions[row.id] = {
                    id: row.id,
                    question_text: row.question_text,
                    question_type: row.question_type,
                    points: row.points,
                    question_order: row.question_order,
                    options: []
                };
            }
            
            if (row.option_text) {
                questions[row.id].options.push({
                    text: row.option_text,
                    is_correct: row.is_correct,
                    order: row.option_order
                });
            }
        });
        
        return Object.values(questions);
    }

    // Optimized analytics queries
    async getAnalyticsOptimized(filters = {}) {
        const { assessmentId, batchId, departmentId, dateFrom, dateTo } = filters;
        
        let query = `
            SELECT 
                COUNT(*) as total_submissions,
                AVG(percentage) as average_score,
                MIN(percentage) as min_score,
                MAX(percentage) as max_score,
                COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_count,
                COUNT(CASE WHEN status = 'in_progress' THEN 1 END) as in_progress_count,
                AVG(time_spent) as average_time_spent
            FROM assessment_submissions s
            JOIN users u ON s.student_id = u.id
            WHERE 1=1
        `;
        
        const params = [];
        
        if (assessmentId) {
            query += ' AND s.assessment_id = ?';
            params.push(assessmentId);
        }
        
        if (batchId) {
            query += ' AND u.batch_id = ?';
            params.push(batchId);
        }
        
        if (departmentId) {
            query += ' AND u.department_id = ?';
            params.push(departmentId);
        }
        
        if (dateFrom) {
            query += ' AND s.submitted_at >= ?';
            params.push(dateFrom);
        }
        
        if (dateTo) {
            query += ' AND s.submitted_at <= ?';
            params.push(dateTo);
        }
        
        return await this.optimizedQuery(query, params);
    }

    // Lazy load questions for large assessments
    async loadQuestionsLazy(assessmentId, page = 1, limit = 10) {
        const offset = (page - 1) * limit;
        
        const query = `
            SELECT 
                q.id,
                q.question_text,
                q.question_type,
                q.points,
                q.question_order
            FROM questions q
            WHERE q.assessment_id = ?
            ORDER BY q.question_order
            LIMIT ? OFFSET ?
        `;
        
        return await this.optimizedQuery(query, [assessmentId, limit, offset]);
    }

    // Optimize assessment start time
    async optimizeAssessmentStart(assessmentId, studentId) {
        const startTime = Date.now();
        
        try {
            // Parallel loading of essential data
            const [
                assessment,
                questions,
                studentInfo,
                previousAttempts
            ] = await Promise.all([
                this.getAssessmentOptimized(assessmentId),
                this.loadQuestionsBatch(assessmentId),
                this.getStudentInfo(studentId),
                this.getPreviousAttempts(studentId, assessmentId)
            ]);
            
            const loadTime = Date.now() - startTime;
            
            // Log performance metrics
            this.logPerformanceMetric('assessment_start', loadTime, {
                assessmentId,
                studentId,
                questionCount: questions.length
            });
            
            return {
                assessment: assessment[0],
                questions,
                studentInfo,
                previousAttempts,
                loadTime
            };
        } catch (error) {
            console.error('Assessment start optimization error:', error);
            throw error;
        }
    }

    // Get student info with caching
    async getStudentInfo(studentId) {
        const query = `
            SELECT 
                u.*,
                b.name as batch_name,
                d.name as department_name
            FROM users u
            LEFT JOIN batches b ON u.batch_id = b.id
            LEFT JOIN departments d ON u.department_id = d.id
            WHERE u.id = ?
        `;
        
        return await this.optimizedQuery(query, [studentId]);
    }

    // Get previous attempts
    async getPreviousAttempts(studentId, assessmentId) {
        const query = `
            SELECT 
                id,
                attempt_number,
                status,
                score,
                percentage,
                submitted_at
            FROM assessment_submissions
            WHERE student_id = ? AND assessment_id = ?
            ORDER BY attempt_number DESC
        `;
        
        return await this.optimizedQuery(query, [studentId, assessmentId]);
    }

    // Optimize question rendering
    async optimizeQuestionRender(questionId) {
        const query = `
            SELECT 
                q.*,
                qo.option_text,
                qo.is_correct,
                qo.option_order
            FROM questions q
            LEFT JOIN question_options qo ON q.id = qo.question_id
            WHERE q.id = ?
            ORDER BY qo.option_order
        `;
        
        const results = await this.optimizedQuery(query, [questionId]);
        
        if (results.length === 0) {
            return null;
        }
        
        const question = {
            id: results[0].id,
            question_text: results[0].question_text,
            question_type: results[0].question_type,
            points: results[0].points,
            question_order: results[0].question_order,
            options: []
        };
        
        results.forEach(row => {
            if (row.option_text) {
                question.options.push({
                    text: row.option_text,
                    is_correct: row.is_correct,
                    order: row.option_order
                });
            }
        });
        
        return question;
    }

    // Batch save responses
    async batchSaveResponses(responses) {
        if (responses.length === 0) return { success: true, saved: 0 };
        
        const startTime = Date.now();
        
        try {
            const values = responses.map(response => [
                response.id || this.generateId(),
                response.submissionId,
                response.questionId,
                response.answer,
                response.metadata ? JSON.stringify(response.metadata) : null,
                response.version || 1,
                new Date(),
                new Date()
            ]);
            
            const query = `
                INSERT INTO student_responses 
                (id, submission_id, question_id, answer, metadata, version, created_at, updated_at)
                VALUES ?
                ON CONFLICT (submission_id, question_id) DO UPDATE SET
                answer = EXCLUDED.answer,
                metadata = EXCLUDED.metadata,
                version = student_responses.version + 1,
                updated_at = EXCLUDED.updated_at
            `;
            
            await db.query(query, [values]);
            
            const executionTime = Date.now() - startTime;
            this.logPerformanceMetric('batch_save_responses', executionTime, {
                responseCount: responses.length
            });
            
            return {
                success: true,
                saved: responses.length,
                executionTime
            };
        } catch (error) {
            console.error('Batch save responses error:', error);
            throw error;
        }
    }

    // Optimize analytics calculations
    async calculateAnalyticsOptimized(assessmentId, filters = {}) {
        const startTime = Date.now();
        
        try {
            // Use materialized views or pre-calculated data if available
            const query = `
                SELECT 
                    assessment_id,
                    total_students,
                    completed_count,
                    average_score,
                    min_score,
                    max_score,
                    completion_rate,
                    last_updated
                FROM assessment_analytics_cache
                WHERE assessment_id = ?
            `;
            
            const cached = await this.optimizedQuery(query, [assessmentId]);
            
            if (cached.length > 0 && this.isCacheValid(cached[0].last_updated)) {
                return cached[0];
            }
            
            // Calculate fresh analytics
            const analytics = await this.calculateFreshAnalytics(assessmentId, filters);
            
            // Update cache
            await this.updateAnalyticsCache(assessmentId, analytics);
            
            const executionTime = Date.now() - startTime;
            this.logPerformanceMetric('analytics_calculation', executionTime, {
                assessmentId,
                filters
            });
            
            return analytics;
        } catch (error) {
            console.error('Analytics calculation error:', error);
            throw error;
        }
    }

    // Calculate fresh analytics
    async calculateFreshAnalytics(assessmentId, filters) {
        const query = `
            SELECT 
                COUNT(DISTINCT s.student_id) as total_students,
                COUNT(CASE WHEN s.status = 'completed' THEN 1 END) as completed_count,
                AVG(s.percentage) as average_score,
                MIN(s.percentage) as min_score,
                MAX(s.percentage) as max_score,
                (COUNT(CASE WHEN s.status = 'completed' THEN 1 END) / COUNT(DISTINCT s.student_id)) * 100 as completion_rate
            FROM assessment_submissions s
            JOIN users u ON s.student_id = u.id
            WHERE s.assessment_id = ?
        `;
        
        const results = await this.optimizedQuery(query, [assessmentId]);
        return results[0];
    }

    // Update analytics cache
    async updateAnalyticsCache(assessmentId, analytics) {
        const query = `
            INSERT INTO assessment_analytics_cache 
            (assessment_id, total_students, completed_count, average_score, min_score, max_score, completion_rate, last_updated)
            VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
            ON CONFLICT (assessment_id) DO UPDATE SET
            total_students = EXCLUDED.total_students,
            completed_count = EXCLUDED.completed_count,
            average_score = EXCLUDED.average_score,
            min_score = EXCLUDED.min_score,
            max_score = EXCLUDED.max_score,
            completion_rate = EXCLUDED.completion_rate,
            last_updated = NOW()
        `;
        
        await db.query(query, [
            assessmentId,
            analytics.total_students,
            analytics.completed_count,
            analytics.average_score,
            analytics.min_score,
            analytics.max_score,
            analytics.completion_rate
        ]);
    }

    // Check if cache is valid
    isCacheValid(lastUpdated, maxAge = 300000) { // 5 minutes
        return Date.now() - new Date(lastUpdated).getTime() < maxAge;
    }

    // Log performance metrics
    logPerformanceMetric(operation, executionTime, metadata = {}) {
        const metric = {
            operation,
            executionTime,
            timestamp: new Date(),
            metadata
        };
        
        this.performanceMetrics.queryTimes.push(executionTime);
        this.updateAverageResponseTime();
        
        // Log to file for analysis
        const logEntry = JSON.stringify(metric) + '\n';
        fs.appendFileSync('performance.log', logEntry);
    }

    // Update average response time
    updateAverageResponseTime() {
        const total = this.performanceMetrics.queryTimes.reduce((sum, time) => sum + time, 0);
        this.performanceMetrics.averageResponseTime = total / this.performanceMetrics.queryTimes.length;
    }

    // Get performance metrics
    getPerformanceMetrics() {
        return {
            ...this.performanceMetrics,
            cacheHitRate: this.performanceMetrics.cacheHits / 
                (this.performanceMetrics.cacheHits + this.performanceMetrics.cacheMisses) * 100,
            totalQueries: this.performanceMetrics.queryTimes.length
        };
    }

    // Clear cache
    clearCache() {
        this.cache.clear();
        this.queryCache.clear();
        this.performanceMetrics = {
            queryTimes: [],
            cacheHits: 0,
            cacheMisses: 0,
            totalRequests: 0,
            averageResponseTime: 0
        };
    }

    // Generate unique ID
    generateId() {
        return 'perf_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    // Optimize database connections
    async optimizeConnections() {
        try {
            // Set connection pool settings
            const query = `
                -- PostgreSQL: These MySQL-specific session variables don't apply
                -- PostgreSQL uses different configuration (shared_buffers, work_mem, etc.)
                -- These are configured at the database level, not per-session
            `;
            
            await db.query(query);
            return true;
        } catch (error) {
            console.error('Connection optimization error:', error);
            return false;
        }
    }

    // Create database indexes for performance
    async createPerformanceIndexes() {
        try {
            const indexes = [
                'CREATE INDEX idx_assessment_submissions_student ON assessment_submissions(student_id)',
                'CREATE INDEX idx_assessment_submissions_assessment ON assessment_submissions(assessment_id)',
                'CREATE INDEX idx_assessment_submissions_status ON assessment_submissions(status)',
                'CREATE INDEX idx_student_responses_submission ON student_responses(submission_id)',
                'CREATE INDEX idx_student_responses_question ON student_responses(question_id)',
                'CREATE INDEX idx_questions_assessment ON questions(assessment_id)',
                'CREATE INDEX idx_users_batch ON users(batch_id)',
                'CREATE INDEX idx_users_department ON users(department_id)'
            ];
            
            for (const indexQuery of indexes) {
                try {
                    await db.query(indexQuery);
                } catch (error) {
                    // Index might already exist
                    console.log('Index creation skipped:', error.message);
                }
            }
            
            return true;
        } catch (error) {
            console.error('Index creation error:', error);
            return false;
        }
    }
}

export default new PerformanceService();
