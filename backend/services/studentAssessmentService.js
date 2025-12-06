import { pool as db } from '../config/database.js';
import crypto from 'crypto';

// Simple in-memory cache for query results (can be replaced with Redis in production)
const queryCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Cache helper functions
const getCacheKey = (prefix, ...params) => {
    return `${prefix}_${JSON.stringify(params)}`;
};

// CRITICAL FIX: Periodic cleanup of expired cache entries
const cleanupExpiredCache = () => {
    const now = Date.now();
    for (const [key, cached] of queryCache.entries()) {
        if (now - cached.timestamp >= cached.ttl) {
            queryCache.delete(key);
        }
    }
};

// Run cleanup every minute
if (typeof setInterval !== 'undefined') {
    setInterval(cleanupExpiredCache, 60 * 1000); // Every minute
}

// CRITICAL FIX: LRU (Least Recently Used) cache eviction strategy
const setCached = (key, data, ttl = CACHE_TTL) => {
    // Remove existing entry if present (to update access time)
    if (queryCache.has(key)) {
        queryCache.delete(key);
    }

    queryCache.set(key, {
        data,
        timestamp: Date.now(),
        ttl,
        lastAccessed: Date.now() // Track last access for LRU
    });

    // CRITICAL FIX: LRU eviction - remove least recently used entries when cache exceeds limit
    const MAX_CACHE_SIZE = 100;
    if (queryCache.size > MAX_CACHE_SIZE) {
        // Find least recently used entry
        let lruKey = null;
        let lruTime = Date.now();

        for (const [cacheKey, cached] of queryCache.entries()) {
            if (cached.lastAccessed < lruTime) {
                lruTime = cached.lastAccessed;
                lruKey = cacheKey;
            }
        }

        if (lruKey) {
            queryCache.delete(lruKey);
        }
    }
};

// CRITICAL FIX: Update last accessed time when retrieving from cache
const getCached = (key) => {
    const cached = queryCache.get(key);
    if (cached && Date.now() - cached.timestamp < cached.ttl) {
        // Update last accessed time for LRU
        cached.lastAccessed = Date.now();
        return cached.data;
    }
    // CRITICAL FIX: Remove expired entries immediately
    if (cached) {
        queryCache.delete(key);
    }
    return null;
};

// Clear cache for specific prefix
const clearCache = (prefix) => {
    for (const key of queryCache.keys()) {
        if (key.startsWith(prefix)) {
            queryCache.delete(key);
        }
    }
};

class StudentAssessmentService {
    // Get available assessments for a student with filtering
    async getAvailableAssessments(studentId, filters = {}) {
        // Check cache first
        const cacheKey = getCacheKey('assessments', studentId, filters);
        const cached = getCached(cacheKey);
        if (cached) {
            return cached;
        }

        try {
            const {
                status,
                dateFrom,
                dateTo,
                department,
                batch,
                college,
                subject,
                limit = 50,
                offset = 0
            } = filters;

            let query = `
                SELECT DISTINCT
                    a.id,
                    a.title,
                    a.description,
                    a.instructions,
                    a.assessment_type,
                    a.total_points,
                    a.time_limit_minutes,
                    a.max_attempts,
                    a.require_proctoring,
                    a.show_results_immediately,
                    a.scheduling,
                    a.created_at,
                    a.updated_at,
                    c.name as college_name,
                    a.department as department_name,
                    COUNT(DISTINCT s.id) as attempts_made,
                    COUNT(DISTINCT CASE WHEN s.status IN ('submitted', 'graded', 'completed') THEN s.id END) as completed_attempts,
                    MAX(s.submitted_at) as last_attempt_date,
                    MAX(s.percentage_score) as best_percentage,
                    MAX(CASE WHEN s.status = 'in_progress' THEN s.id END) as in_progress_submission_id,
                    MAX(CASE WHEN s.status = 'in_progress' THEN s.started_at END) as in_progress_started_at,
                    MAX(CASE WHEN s.status = 'in_progress' THEN s.answers END) as in_progress_answers,
                    MAX(CASE WHEN s.status IN ('submitted', 'graded', 'completed') THEN s.id END) as last_completed_submission_id
                FROM assessments a
                LEFT JOIN colleges c ON a.college_id = c.id
                LEFT JOIN assessment_submissions s ON a.id = s.assessment_id AND s.student_id = ?
                WHERE a.is_published = true
            `;

            const params = [studentId];

            // Debug logging
            console.log('Filter parameters:', {
                studentId,
                dateFrom,
                dateTo,
                department,
                batch,
                college,
                subject,
                limit,
                offset
            });

            // Add date filtering - use assessment_assignments table instead of JSON parsing for better performance
            // This avoids JSON path extraction in WHERE clause which can't use indexes
            if (dateFrom && dateFrom !== 'undefined' && dateFrom !== 'null') {
                query += ` AND EXISTS (
                    SELECT 1 FROM assessment_assignments aa 
                    WHERE aa.assessment_id = a.id 
                    AND (aa.start_date_only >= ? OR aa.start_date_only IS NULL)
                )`;
                params.push(dateFrom);
            }
            if (dateTo && dateTo !== 'undefined' && dateTo !== 'null') {
                query += ` AND EXISTS (
                    SELECT 1 FROM assessment_assignments aa 
                    WHERE aa.assessment_id = a.id 
                    AND (aa.end_date_only <= ? OR aa.end_date_only IS NULL)
                )`;
                params.push(dateTo);
            }

            // Add other filters
            if (department && department !== 'undefined' && department !== 'null') {
                query += ` AND a.department = ?`;
                params.push(department);
            }
            // Note: batch filtering removed since assessments doesn't have batch_id
            if (college && college !== 'undefined' && college !== 'null') {
                query += ` AND a.college_id = ?`;
                params.push(college);
            }
            // Note: subject filtering removed since assessments doesn't have subject column

            // Ensure limit and offset are numbers
            const safeLimit = parseInt(limit) || 50;
            const safeOffset = parseInt(offset) || 0;

            query += ` GROUP BY a.id ORDER BY a.created_at DESC LIMIT ${safeLimit} OFFSET ${safeOffset}`;

            console.log('Final query params:', params);
            console.log('Final query:', query);

            const [assessments] = await db.execute(query, params);

            // Determine status for each assessment
            const assessmentsWithStatus = assessments.map(assessment => {
                const now = new Date();
                const startDate = assessment.scheduling ? new Date(assessment.scheduling.start_date) : null;
                const endDate = assessment.scheduling ? new Date(assessment.scheduling.end_date) : null;

                let status = 'active'; // Default to active if no scheduling restrictions
                let submission_status = 'not_started';
                let can_resume = false;

                // Get completed attempts count
                const completedAttempts = assessment.completed_attempts || 0;

                // Check if there's an in-progress submission
                if (assessment.in_progress_submission_id) {
                    submission_status = 'in_progress';

                    // Check if the in-progress submission can still be resumed
                    // First check if max attempts haven't been exceeded
                    if (completedAttempts < assessment.max_attempts) {
                        if (assessment.in_progress_started_at) {
                            const startedAt = new Date(assessment.in_progress_started_at);
                            const elapsedMinutes = Math.floor((now - startedAt) / (1000 * 60));

                            // Check if time limit hasn't been exceeded
                            if (!assessment.time_limit_minutes || elapsedMinutes < assessment.time_limit_minutes) {
                                // Check if assessment hasn't ended
                                if (!endDate || now <= endDate) {
                                    can_resume = true;
                                }
                            }
                        }
                    }
                } else if (completedAttempts > 0) {
                    // Has completed submissions (submitted, graded, or completed status)
                    submission_status = 'completed';
                } else if (assessment.attempts_made > 0) {
                    // Has some attempts but may not be completed yet
                    submission_status = 'completed';
                }

                if (startDate && now < startDate) {
                    status = 'upcoming';
                } else if (endDate && now > endDate) {
                    status = 'ended';
                } else if (completedAttempts >= assessment.max_attempts) {
                    status = 'attempted';
                } else if (startDate && now >= startDate && (!endDate || now <= endDate)) {
                    status = 'active';
                } else if (!startDate && !endDate) {
                    // No scheduling restrictions - assessment is always active
                    status = 'active';
                }

                // Override status for retake scenarios
                if (status === 'attempted' && completedAttempts < assessment.max_attempts) {
                    status = 'active'; // Allow retake if under attempt limit
                }

                // Debug logging for retake scenarios
                if (assessment.attempts_made > 0 || completedAttempts > 0) {
                    console.log('Assessment Retake Debug:', {
                        id: assessment.id,
                        title: assessment.title,
                        attempts_made: assessment.attempts_made,
                        completed_attempts: completedAttempts,
                        max_attempts: assessment.max_attempts,
                        status: status,
                        submission_status: submission_status,
                        has_completed_submissions: completedAttempts > 0,
                        can_retake: status === 'active' && completedAttempts < assessment.max_attempts && submission_status === 'completed'
                    });
                }

                const hasCompletedSubmissions = completedAttempts > 0;

                return {
                    ...assessment,
                    status,
                    submission_status,
                    completed_attempts: completedAttempts,
                    has_completed_submissions: hasCompletedSubmissions,
                    can_attempt: status === 'active' && completedAttempts < assessment.max_attempts && !can_resume,
                    can_resume: can_resume && completedAttempts < assessment.max_attempts,
                    can_retake: status === 'active' && completedAttempts < assessment.max_attempts && submission_status === 'completed',
                    in_progress_submission_id: assessment.in_progress_submission_id,
                    in_progress_started_at: assessment.in_progress_started_at,
                    last_completed_submission_id: assessment.last_completed_submission_id
                };
            });

            const result = assessmentsWithStatus;

            // Cache the result
            setCached(cacheKey, result, CACHE_TTL);

            return result;
        } catch (error) {
            console.error('Error getting available assessments:', error);
            throw error;
        }
    }

    // Start an assessment attempt
    async startAssessment(assessmentId, studentId, attemptData = {}) {
        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();

            // Check if assessment exists and is available
            const assessment = await this.getAssessmentById(assessmentId);
            if (!assessment) {
                throw new Error('Assessment not found');
            }

            // Check if student can attempt
            const canAttempt = await this.canStudentAttempt(assessmentId, studentId);
            if (!canAttempt.allowed) {
                throw new Error(canAttempt.reason);
            }

            // Get next attempt number
            const attemptNumber = await this.getNextAttemptNumber(assessmentId, studentId);

            // Create submission record (detect schema and insert only existing columns)
            const submissionId = crypto.randomUUID();
            // PostgreSQL: Query information_schema instead of SHOW COLUMNS
            const [columnsRows] = await connection.query(`
                SELECT column_name as Field 
                FROM information_schema.columns 
                WHERE table_name = 'assessment_submissions'
            `);
            const columnNames = new Set(columnsRows.map(c => c.Field));

            const fields = ['id', 'assessment_id', 'student_id'];
            const values = [submissionId, assessmentId, studentId];

            if (columnNames.has('attempt_number')) {
                fields.push('attempt_number');
                values.push(attemptNumber);
            }
            if (columnNames.has('status')) {
                fields.push('status');
                values.push('in_progress');
            }
            // Prefer started_at; fallback to start_time
            let timeFieldSql = null;
            if (columnNames.has('started_at')) {
                fields.push('started_at');
                timeFieldSql = 'NOW()';
            } else if (columnNames.has('start_time')) {
                fields.push('start_time');
                timeFieldSql = 'NOW()';
            }
            if (columnNames.has('ip_address')) {
                fields.push('ip_address');
                values.push(attemptData.ipAddress || null);
            }
            if (columnNames.has('user_agent')) {
                fields.push('user_agent');
                values.push(attemptData.userAgent || null);
            }
            if (columnNames.has('device_info')) {
                fields.push('device_info');
                values.push(JSON.stringify(attemptData.deviceInfo || {}));
            }
            // Column may be named require_proctoring or proctoring_enabled
            if (columnNames.has('require_proctoring')) {
                fields.push('require_proctoring');
                values.push(assessment.require_proctoring);
            } else if (columnNames.has('proctoring_enabled')) {
                fields.push('proctoring_enabled');
                values.push(assessment.require_proctoring);
            }

            // Build placeholders; inject NOW() directly if time field used
            const placeholders = fields.map(f => (f === 'started_at' || f === 'start_time') && timeFieldSql ? timeFieldSql : '?');
            const insertSql = `INSERT INTO assessment_submissions (${fields.join(', ')}) VALUES (${placeholders.join(', ')})`;

            // Filter out the non-bound NOW() from values alignment
            const boundValues = [];
            for (let i = 0; i < fields.length; i++) {
                const f = fields[i];
                const isNow = (f === 'started_at' || f === 'start_time') && timeFieldSql;
                if (!isNow) {
                    boundValues.push(values.shift());
                }
            }

            try {
                await connection.query(insertSql, boundValues);
            } catch (e) {
                if (e && e.code === 'ER_DUP_ENTRY') {
                    // Unique constraint likely on (assessment_id, student_id)
                    // Reuse existing latest submission (in-progress or last attempt)
                    const [existingRows] = await connection.query(
                        `SELECT id, attempt_number, status, started_at FROM assessment_submissions 
                         WHERE assessment_id = ? AND student_id = ? 
                         ORDER BY started_at DESC, id DESC LIMIT 1`,
                        [assessmentId, studentId]
                    );
                    if (existingRows && existingRows.length > 0) {
                        const existing = existingRows[0];
                        await this.logAssessmentAccess(assessmentId, studentId, 'start', attemptData);
                        await connection.commit();
                        return {
                            submissionId: existing.id,
                            assessmentId,
                            attemptNumber: existing.attempt_number || 1,
                            assessment: {
                                id: assessment.id,
                                title: assessment.title,
                                duration_minutes: assessment.time_limit_minutes,
                                total_points: assessment.total_points,
                                proctoring_enabled: assessment.require_proctoring,
                                instructions: assessment.instructions
                            }
                        };
                    }
                }
                throw e;
            }

            // Log access
            await this.logAssessmentAccess(assessmentId, studentId, 'start', attemptData);

            await connection.commit();

            return {
                submissionId,
                assessmentId,
                attemptNumber,
                assessment: {
                    id: assessment.id,
                    title: assessment.title,
                    duration_minutes: assessment.time_limit_minutes,
                    total_points: assessment.total_points,
                    proctoring_enabled: assessment.require_proctoring,
                    instructions: assessment.instructions
                }
            };
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    // Save student answer
    async saveAnswer(submissionId, questionId, answer, timeSpent = 0, studentId = null) {
        try {
            const connection = await db.getConnection();
            try {
                await connection.beginTransaction();

                // CRITICAL SECURITY: Verify submission ownership
                if (studentId) {
                    const [ownershipCheck] = await connection.query(
                        'SELECT student_id, assessment_id, status FROM assessment_submissions WHERE id = ?',
                        [submissionId]
                    );

                    if (ownershipCheck.length === 0) {
                        throw new Error('Submission not found');
                    }

                    if (ownershipCheck[0].student_id !== studentId) {
                        throw new Error('Unauthorized: You do not have permission to modify this submission');
                    }

                    if (ownershipCheck[0].status !== 'in_progress') {
                        throw new Error('Cannot modify answers for a submission that is not in progress');
                    }

                    // Validate time limits server-side
                    const [timeCheck] = await connection.query(`
                        SELECT 
                            aa.end_date_only,
                            aa.end_time_only,
                            a.time_limit_minutes,
                            s.started_at
                        FROM assessment_submissions s
                        JOIN assessment_assignments aa ON s.assessment_id = aa.assessment_id
                        JOIN assessments a ON aa.assessment_id = a.id
                        WHERE s.id = ?
                    `, [submissionId]);

                    if (timeCheck.length > 0) {
                        const timeInfo = timeCheck[0];
                        const now = new Date();

                        // Check if assessment end time has passed
                        if (timeInfo.end_date_only && timeInfo.end_time_only) {
                            const endDateTime = new Date(`${timeInfo.end_date_only}T${timeInfo.end_time_only}`);
                            if (now > endDateTime) {
                                throw new Error('Assessment time has expired');
                            }
                        }

                        // Check if time limit has been exceeded
                        if (timeInfo.started_at && timeInfo.time_limit_minutes) {
                            const startedAt = new Date(timeInfo.started_at);
                            const elapsedMinutes = (now - startedAt) / (1000 * 60);
                            if (elapsedMinutes > timeInfo.time_limit_minutes) {
                                throw new Error('Assessment time limit has been exceeded');
                            }
                        }
                    }
                }

                // Standardize empty answer handling - consistent across all code paths
                // This function handles null, undefined, empty strings, and empty objects consistently
                const isEmptyAnswer = (ans) => {
                    if (ans === null || ans === undefined) return true;
                    if (typeof ans === 'string') {
                        const trimmed = ans.trim();
                        return trimmed === '' || trimmed === 'null' || trimmed === 'undefined';
                    }
                    if (typeof ans === 'object') {
                        // Check for empty object
                        if (Array.isArray(ans)) {
                            return ans.length === 0;
                        }
                        // Check if object has any meaningful properties
                        const keys = Object.keys(ans);
                        if (keys.length === 0) return true;
                        // Check if all values are empty/null/undefined
                        return keys.every(key => {
                            const val = ans[key];
                            return val === null || val === undefined ||
                                (typeof val === 'string' && val.trim() === '') ||
                                (typeof val === 'object' && Object.keys(val).length === 0);
                        });
                    }
                    return false;
                };

                // Get question details first (needed for validation and type checking)
                const question = await this.getQuestionById(questionId);
                if (!question) {
                    throw new Error('Question not found');
                }

                // Validate answer format and sanitize
                // Allow empty answers only for non-required questions
                const questionIsRequired = question.is_required !== false;
                if (isEmptyAnswer(answer) && questionIsRequired) {
                    throw new Error('Answer cannot be empty for required questions');
                }

                // Validate answer size limits based on question type
                const questionType = question.question_type || question.type || 'multiple_choice';
                const MAX_CODING_SIZE = 10 * 1024 * 1024; // 10MB
                const MAX_ESSAY_SIZE = 500 * 1024; // 500KB
                const MAX_OTHER_SIZE = 100 * 1024; // 100KB for other types

                let answerSize = 0;
                if (typeof answer === 'string') {
                    answerSize = answer.length;
                } else if (typeof answer === 'object') {
                    answerSize = JSON.stringify(answer).length;
                }

                const maxSize = questionType === 'coding' ? MAX_CODING_SIZE :
                    questionType === 'essay' ? MAX_ESSAY_SIZE :
                        MAX_OTHER_SIZE;

                if (answerSize > maxSize) {
                    throw new Error(`Answer size exceeds maximum allowed (${Math.round(maxSize / 1024)}KB)`);
                }

                // Calculate server-side time spent instead of trusting client-provided time
                // Get submission started_at to calculate actual time spent
                const [submissionTime] = await connection.query(
                    'SELECT started_at FROM assessment_submissions WHERE id = ?',
                    [submissionId]
                );

                const maxAllowedSeconds = 3600 * 24; // Max 24 hours
                const clientReportedTime = Math.max(0, Number(timeSpent) || 0);
                let validatedTimeSpent = Math.min(clientReportedTime, maxAllowedSeconds);

                if (submissionTime.length > 0 && submissionTime[0].started_at) {
                    // Calculate time from submission start to now (server time) and use as an upper bound only
                    const startedAt = new Date(submissionTime[0].started_at);
                    const now = new Date();
                    const serverCalculatedTime = Math.floor((now - startedAt) / 1000); // seconds

                    if (serverCalculatedTime > 0 && validatedTimeSpent > serverCalculatedTime) {
                        validatedTimeSpent = Math.min(serverCalculatedTime, maxAllowedSeconds);
                    }
                }

                // Verify question belongs to the assessment and assessment still exists
                if (studentId) {
                    const [submissionInfo] = await connection.query(
                        'SELECT assessment_id FROM assessment_submissions WHERE id = ?',
                        [submissionId]
                    );

                    if (submissionInfo.length > 0) {
                        const assessmentId = submissionInfo[0].assessment_id;

                        // Check if assessment still exists (not deleted)
                        const [assessmentExists] = await connection.query(
                            'SELECT id, status FROM assessments WHERE id = ?',
                            [assessmentId]
                        );

                        if (assessmentExists.length === 0) {
                            throw new Error('Assessment has been deleted and is no longer available');
                        }

                        if (assessmentExists[0].status !== 'published') {
                            throw new Error('Assessment is no longer available');
                        }

                        // Verify question belongs to assessment
                        // Check assessment_questions table (questions are linked via many-to-many relationship)
                        const [questionInAssessment] = await connection.query(
                            'SELECT question_id FROM assessment_questions WHERE assessment_id = ? AND question_id = ?',
                            [assessmentId, questionId]
                        );

                        // If question not found in assessment, check if it was previously answered
                        // This handles cases where question was removed from assessment after student started
                        if (questionInAssessment.length === 0) {
                            const [previousResponse] = await connection.query(
                                'SELECT question_id FROM student_responses WHERE submission_id = ? AND question_id = ? LIMIT 1',
                                [submissionId, questionId]
                            );

                            if (previousResponse.length === 0) {
                                // Question doesn't belong to assessment and was never answered
                                // This is a security check - only allow if question exists in system
                                const [questionExists] = await connection.query(
                                    'SELECT id FROM questions WHERE id = ?',
                                    [questionId]
                                );

                                if (questionExists.length === 0) {
                                    throw new Error('Question does not belong to this assessment');
                                }

                                // Question exists but not in this assessment - log warning but allow
                                console.warn(`Question ${questionId} not found in assessment ${assessmentId} but exists in system. Submission: ${submissionId}`);
                            }
                            // If previous response exists, allow update (question might have been removed from assessment)
                        }
                    }
                }

                // Normalize answer format - handle different answer structures
                // Note: questionType is already declared above at line 507
                let normalizedAnswer = answer;
                let studentAnswerText = null;
                let selectedOptions = null;

                // Sanitize and validate answer input with proper JSON escaping
                const sanitizeString = (str) => {
                    if (typeof str !== 'string') return str;
                    // Remove control characters but preserve legitimate content
                    // Keep newlines and tabs for essay/coding questions
                    return str.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '').trim();
                };

                // Proper JSON escaping function
                const safeJsonStringify = (obj) => {
                    try {
                        return JSON.stringify(obj);
                    } catch (e) {
                        // If JSON.stringify fails, try to escape manually
                        if (typeof obj === 'string') {
                            return JSON.stringify(obj); // JSON.stringify handles escaping
                        }
                        throw new Error('Failed to serialize answer data');
                    }
                };

                if (typeof answer === 'string') {
                    // Simple string answer - sanitize
                    studentAnswerText = sanitizeString(answer);
                } else if (answer && typeof answer === 'object') {
                    // Object answer - could be various formats
                    if (answer.student_answer !== undefined) {
                        studentAnswerText = typeof answer.student_answer === 'string'
                            ? answer.student_answer
                            : JSON.stringify(answer.student_answer);
                        selectedOptions = answer.selected_options || null;
                    } else if (answer.value !== undefined) {
                        // Format: { value: '...', notes: '...' }
                        studentAnswerText = typeof answer.value === 'string'
                            ? answer.value
                            : JSON.stringify(answer.value);
                        selectedOptions = answer.selected_options || null;
                    } else if (answer.code !== undefined) {
                        // Coding question format: { code: '...', language: '...', testResults: [...] }
                        studentAnswerText = safeJsonStringify({
                            code: answer.code,
                            language: answer.language,
                            testResults: answer.testResults || [],
                            executionTime: answer.executionTime || 0,
                            memoryUsage: answer.memoryUsage || 0
                        });
                    } else {
                        // Generic object - stringify it with proper escaping
                        studentAnswerText = safeJsonStringify(answer);
                    }
                }

                // Determine question type
                // questionType is already declared above at line 507, no need to redeclare

                // Check if answer already exists
                const [existingRows] = await connection.query(
                    'SELECT id FROM student_responses WHERE submission_id = ? AND question_id = ?',
                    [submissionId, questionId]
                );

                let isCorrect = null;
                let pointsEarned = 0;

                // Calculate correctness and points
                if (questionType === 'coding' && answer && typeof answer === 'object' && answer.testResults) {
                    // Calculate partial credit for coding questions based on test cases passed
                    try {
                        const testResultsRaw = answer.testResults;

                        if (!Array.isArray(testResultsRaw)) {
                            throw new Error('Invalid testResults format');
                        }

                        const testResults = testResultsRaw;
                        const passedTests = testResults.filter(result =>
                            result.result?.verdict?.status === 'accepted' ||
                            result.status === 'accepted' ||
                            (result.result && result.result.verdict && result.result.verdict.status === 'accepted')
                        ).length;
                        const totalTests = testResults.length;

                        if (totalTests > 0) {
                            // Partial credit: points based on percentage of tests passed
                            const questionPoints = parseFloat(question.points) || 1;
                            pointsEarned = (passedTests / totalTests) * questionPoints;
                            isCorrect = passedTests === totalTests && totalTests > 0;
                        } else {
                            // No test results available
                            isCorrect = false;
                            pointsEarned = 0;
                        }
                    } catch (e) {
                        console.error('Error calculating coding question score:', e);
                        isCorrect = false;
                        pointsEarned = 0;
                        // Don't throw - log error but continue
                    }
                } else if (questionType !== 'coding' && studentAnswerText && question.correct_answer) {
                    // Non-coding questions
                    try {
                        const result = this.calculateAnswerScore(question, normalizedAnswer);
                        isCorrect = result.isCorrect;
                        pointsEarned = result.pointsEarned;
                    } catch (e) {
                        console.error('Error calculating answer score:', e);
                        // Don't throw - log error but continue with null/0 values
                    }
                }

                // Check if existing answer found - mysql2 returns [rows, fields]
                const hasExistingAnswer = existingRows && Array.isArray(existingRows) && existingRows.length > 0;

                // Use INSERT ... ON DUPLICATE KEY UPDATE to handle race conditions
                // Check if is_flagged column exists
                // PostgreSQL: Query information_schema instead of SHOW COLUMNS
                const [columns] = await connection.query(`
                    SELECT column_name as Field 
                    FROM information_schema.columns 
                    WHERE table_name = 'student_responses'
                `);
                const hasFlaggedColumn = columns.some(col => col.Field === 'is_flagged');

                const insertFields = [
                    'submission_id', 'question_id', 'section_id', 'question_type',
                    'student_answer', 'selected_options', 'time_spent', 'is_correct', 'points_earned',
                    'updated_at'
                ];
                // Ensure points don't exceed question points
                const questionPoints = parseFloat(question.points) || 0;
                const cappedPointsEarned = Math.min(Math.max(0, pointsEarned), questionPoints);

                const insertValues = [
                    submissionId, questionId, question.section_id || null, questionType,
                    studentAnswerText, selectedOptions ? JSON.stringify(selectedOptions) : null,
                    validatedTimeSpent, isCorrect, cappedPointsEarned,
                    new Date() // updated_at timestamp for conflict resolution
                ];

                if (hasFlaggedColumn) {
                    insertFields.push('is_flagged');
                    insertValues.push(false); // Default to not flagged when saving answer
                }

                const placeholders = insertFields.map(() => '?').join(', ');
                // Update all fields except submission_id and question_id (primary key)
                // Use updated_at to track when answer was last modified (for conflict resolution)
                const updateFields = insertFields
                    .filter(f => f !== 'submission_id' && f !== 'question_id')
                    .map(f => {
                        if (f === 'updated_at') {
                            return `${f} = NOW()`; // Always use current timestamp on update
                        }
                        return `${f} = EXCLUDED.${f}`;
                    })
                    .join(', ');

                await connection.query(`
                    INSERT INTO student_responses (${insertFields.join(', ')})
                    VALUES (${placeholders})
                    ON CONFLICT (submission_id, question_id) DO UPDATE SET
                        ${updateFields}
                `, insertValues);

                await connection.commit();
                return { success: true, isCorrect, pointsEarned };
            } catch (error) {
                await connection.rollback();
                throw error;
            } finally {
                connection.release();
            }
        } catch (error) {
            console.error('Error saving answer:', error);
            throw error;
        }
    }

    // Submit assessment
    async submitAssessment(submissionId, submissionData = {}, studentId = null) {
        const connection = await db.getConnection();
        try {
            // CRITICAL FIX: Set transaction isolation level for consistency
            await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
            await connection.beginTransaction();

            // CRITICAL SECURITY: Verify submission ownership
            const submission = await this.getSubmissionById(submissionId);
            if (!submission) {
                throw new Error('Submission not found');
            }

            if (studentId && submission.student_id !== studentId) {
                throw new Error('Unauthorized: You do not have permission to submit this assessment');
            }

            if (submission.status !== 'in_progress') {
                throw new Error(`Cannot submit assessment with status: ${submission.status}`);
            }

            // Verify time limits server-side before submission
            const [timeCheck] = await connection.query(`
                SELECT 
                    aa.start_date_only,
                    aa.start_time_only,
                    aa.end_date_only,
                    aa.end_time_only,
                    a.time_limit_minutes
                FROM assessment_submissions s
                JOIN assessment_assignments aa ON s.assessment_id = aa.assessment_id
                JOIN assessments a ON aa.assessment_id = a.id
                WHERE s.id = ?
            `, [submissionId]);

            if (timeCheck.length > 0) {
                const timeInfo = timeCheck[0];
                const now = new Date();

                // Check if assessment has started
                if (timeInfo.start_date_only && timeInfo.start_time_only) {
                    const startDateTime = new Date(`${timeInfo.start_date_only}T${timeInfo.start_time_only}`);
                    if (now < startDateTime) {
                        throw new Error('Assessment has not started yet');
                    }
                }

                // Check if assessment has ended
                if (timeInfo.end_date_only && timeInfo.end_time_only) {
                    const endDateTime = new Date(`${timeInfo.end_date_only}T${timeInfo.end_time_only}`);
                    if (now > endDateTime) {
                        throw new Error('Assessment time has expired. Cannot submit after deadline.');
                    }
                }

                // Check if time limit has been exceeded
                if (submission.started_at && timeInfo.time_limit_minutes) {
                    const startedAt = new Date(submission.started_at);
                    const elapsedMinutes = (now - startedAt) / (1000 * 60);
                    if (elapsedMinutes > timeInfo.time_limit_minutes) {
                        throw new Error('Assessment time limit has been exceeded');
                    }
                }
            }

            // CRITICAL: Use SELECT FOR UPDATE to prevent duplicate submissions
            const [lockedSubmission] = await connection.query(
                'SELECT id, status FROM assessment_submissions WHERE id = ? FOR UPDATE',
                [submissionId]
            );

            if (lockedSubmission.length === 0) {
                throw new Error('Submission not found');
            }

            if (lockedSubmission[0].status !== 'in_progress') {
                await connection.rollback();
                throw new Error(`Assessment already submitted. Current status: ${lockedSubmission[0].status}`);
            }

            // Calculate final score (allow in-progress status during submission)
            // Pass existing connection to avoid nested transactions
            const scoreData = await this.calculateFinalScore(submissionId, true, connection);

            // Update submission - Use correct column names based on schema
            // Check if columns exist to handle different schema versions
            // PostgreSQL: Query information_schema instead of SHOW COLUMNS
            const [columns] = await connection.query(`
                SELECT column_name as Field 
                FROM information_schema.columns 
                WHERE table_name = 'assessment_submissions'
            `);
            const columnNames = columns.map(col => col.Field);

            let updateFields = [];
            let updateValues = [];

            // Always set submitted_at and status
            updateFields.push('submitted_at = NOW()');
            updateFields.push('status = ?');
            // Use 'submitted' status (checking ENUM: 'in_progress', 'submitted', 'graded', 'late', 'disqualified')
            updateValues.push('submitted');

            // Set end_time if column exists, otherwise use submitted_at
            if (columnNames.includes('end_time')) {
                updateFields.push('end_time = NOW()');
            }

            // Set total_score if column exists, otherwise use score
            if (columnNames.includes('total_score')) {
                updateFields.push('total_score = ?');
                updateValues.push(scoreData.totalScore || 0);
            } else if (columnNames.includes('score')) {
                updateFields.push('score = ?');
                updateValues.push(scoreData.totalScore || 0);
            }

            // Set percentage if column exists, otherwise use percentage_score
            const percentageValue = scoreData.percentage && !isNaN(scoreData.percentage) ? scoreData.percentage : 0;
            if (columnNames.includes('percentage')) {
                updateFields.push('percentage = ?');
                updateValues.push(percentageValue);
            } else if (columnNames.includes('percentage_score')) {
                updateFields.push('percentage_score = ?');
                updateValues.push(percentageValue);
            }

            // Set grade if column exists
            if (columnNames.includes('grade') && scoreData.grade) {
                updateFields.push('grade = ?');
                updateValues.push(scoreData.grade);
            }

            // CRITICAL FIX: Store time_taken_minutes (convert seconds to minutes)
            if (columnNames.includes('time_taken_minutes') && scoreData.timeSpent) {
                const timeTakenMinutes = Math.ceil(scoreData.timeSpent / 60); // Convert seconds to minutes
                updateFields.push('time_taken_minutes = ?');
                updateValues.push(timeTakenMinutes);
            }

            updateValues.push(submissionId);

            const updateQuery = `
                UPDATE assessment_submissions 
                SET ${updateFields.join(', ')}
                WHERE id = ?
            `;

            await connection.query(updateQuery, updateValues);

            // Log submission
            await this.logAssessmentAccess(submission.assessment_id, submission.student_id, 'submit', submissionData);

            // MEDIUM FIX: Invalidate analytics cache after submission
            try {
                const analyticsService = (await import('./analyticsService.js')).default;
                analyticsService.invalidateCache(submission.student_id, submission.assessment_id);
            } catch (e) {
                // Non-critical, log but don't fail submission
                console.warn('Failed to invalidate analytics cache:', e.message);
            }

            await connection.commit();

            return {
                submissionId,
                totalScore: scoreData.totalScore,
                percentage: scoreData.percentage,
                grade: scoreData.grade,
                timeSpent: scoreData.timeSpent
            };
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    // Get submission answers (for route handlers)
    async getSubmissionAnswers(submissionId) {
        // LOW FIX: Move direct query from route to service layer
        const connection = await db.getConnection();
        try {
            const [responses] = await connection.execute(`
                SELECT 
                    question_id,
                    student_answer,
                    selected_options,
                    question_type,
                    time_spent,
                    is_correct,
                    points_earned,
                    is_flagged,
                    updated_at
                FROM student_responses
                WHERE submission_id = ?
                ORDER BY updated_at ASC
            `, [submissionId]);

            return responses;
        } finally {
            connection.release();
        }
    }

    // Get assessment results
    async getAssessmentResults(submissionId) {
        try {
            const query = `
                SELECT 
                    s.*,
                    a.title as assessment_title,
                    a.show_results_immediately,
                    u.name as student_name,
                    COUNT(sr.id) as total_questions,
                    SUM(CASE WHEN sr.is_correct = 1 THEN 1 ELSE 0 END) as correct_answers,
                    SUM(sr.points_earned) as total_points_earned,
                    SUM(sr.time_spent) as total_time_spent_seconds,
                    COALESCE(
                        s.time_taken_minutes,
                        EXTRACT(EPOCH FROM (s.submitted_at - s.started_at)) / 60,
                        FLOOR(SUM(sr.time_spent) / 60)
                    ) as time_taken_minutes
                FROM assessment_submissions s
                LEFT JOIN assessments a ON s.assessment_id = a.id
                LEFT JOIN users u ON s.student_id = u.id
                LEFT JOIN student_responses sr ON s.id = sr.submission_id
                WHERE s.id = ?
                GROUP BY s.id
            `;

            const [results] = await db.execute(query, [submissionId]);
            if (results.length === 0) {
                throw new Error('Results not found');
            }

            const result = results[0];

            // Get detailed answers
            const answersQuery = `
                SELECT 
                    sr.*,
                    q.question_text,
                    q.type as question_type,
                    q.points,
                    q.correct_answer,
                    q.explanation
                FROM student_responses sr
                LEFT JOIN questions q ON sr.question_id = q.id
                WHERE sr.submission_id = ?
                ORDER BY q.section_id, q.order_index
            `;

            const [answers] = await db.execute(answersQuery, [submissionId]);

            return {
                ...result,
                answers: answers
            };
        } catch (error) {
            console.error('Error getting assessment results:', error);
            throw error;
        }
    }

    // Get student assessment history
    async getStudentAssessmentHistory(studentId, filters = {}) {
        try {
            const { limit = 20, offset = 0, status, dateFrom, dateTo } = filters;

            let query = `
                SELECT 
                    s.*,
                    a.title as assessment_title,
                    a.subject,
                    c.name as college_name,
                    d.name as department_name,
                    b.name as batch_name
                FROM assessment_submissions s
                LEFT JOIN assessments a ON s.assessment_id = a.id
                LEFT JOIN colleges c ON a.college_id = c.id
                LEFT JOIN departments d ON a.department_id = d.id
                LEFT JOIN batches b ON a.batch_id = b.id
                WHERE s.student_id = ?
            `;

            const params = [studentId];

            if (status) {
                query += ` AND s.status = ?`;
                params.push(status);
            }

            if (dateFrom) {
                query += ` AND s.created_at >= ?`;
                params.push(dateFrom);
            }

            if (dateTo) {
                query += ` AND s.created_at <= ?`;
                params.push(dateTo);
            }

            query += ` ORDER BY s.created_at DESC LIMIT ? OFFSET ?`;
            params.push(limit, offset);

            const [results] = await db.execute(query, params);
            return results;
        } catch (error) {
            console.error('Error getting student assessment history:', error);
            throw error;
        }
    }

    // Helper methods
    async getAssessmentById(assessmentId, studentId = null) {
        const query = `
            SELECT a.*, c.name as college_name
            FROM assessments a
            LEFT JOIN colleges c ON a.college_id = c.id
            WHERE a.id = ?
        `;
        const [results] = await db.execute(query, [assessmentId]);
        return results.length > 0 ? results[0] : null;
    }

    async getAssessmentQuestions(assessmentId, studentId = null) {
        // Check cache first
        const cacheKey = getCacheKey('questions', assessmentId, studentId);
        const cached = getCached(cacheKey);
        if (cached) {
            return cached;
        }

        try {
            // Get assessment details
            const assessment = await this.getAssessmentById(assessmentId, studentId);
            if (!assessment) {
                throw new Error('Assessment not found');
            }

            // CRITICAL FIX: Use safe JSON parsing utility
            const { safeJsonParse } = await import('../utils/jsonParser.js');
            const parseJsonField = (field) => {
                if (!field) return null;
                if (typeof field === 'string') {
                    return safeJsonParse(field, null);
                }
                return field;
            };

            // Get sections from assessment_sections table
            let sectionsFromTable = [];
            try {
                const sectionsQuery = `
                    SELECT * FROM assessment_sections 
                    WHERE assessment_id = ? 
                    ORDER BY order_index ASC
                `;
                const [sectionRows] = await db.execute(sectionsQuery, [assessmentId]);
                sectionsFromTable = sectionRows || [];
            } catch (e) {
                // Fallback: older schema without sections table
                sectionsFromTable = [];
            }

            // Get questions from assessment_questions linking table
            let questionsFromTable = [];
            try {
                const questionsQuery = `
                    SELECT 
                        q.*,
                        aq.section_id,
                        aq.question_order,
                        aq.points,
                        aq.time_limit_seconds,
                        aq.is_required,
                        s.name as section_name,
                        s.description as section_description
                    FROM assessment_questions aq
                    JOIN questions q ON aq.question_id = q.id
                    LEFT JOIN assessment_sections s ON aq.section_id = s.id
                    WHERE aq.assessment_id = ?
                    ORDER BY aq.section_id ASC, aq.question_order ASC
                `;
                const [questionRows] = await db.execute(questionsQuery, [assessmentId]);

                // OPTIMIZATION: Fetch all coding questions in a single query to avoid N+1 problem
                const codingQuestionIds = questionRows.filter(q => q.question_type === 'coding').map(q => q.id);
                let allCodingRows = [];
                if (codingQuestionIds.length > 0) {
                    const placeholders = codingQuestionIds.map(() => '?').join(',');
                    const [codingRows] = await db.execute(
                        `SELECT * FROM coding_questions WHERE question_id IN (${placeholders}) ORDER BY question_id ASC, language ASC`,
                        codingQuestionIds
                    );
                    allCodingRows = codingRows || [];
                }

                // Group coding rows by question_id
                const codingRowsByQuestionId = {};
                allCodingRows.forEach(row => {
                    if (!codingRowsByQuestionId[row.question_id]) {
                        codingRowsByQuestionId[row.question_id] = [];
                    }
                    codingRowsByQuestionId[row.question_id].push(row);
                });

                // For each question, process coding details from pre-fetched data
                for (let q of questionRows) {
                    const parsedOptions = parseJsonField(q.options);
                    const parsedTags = parseJsonField(q.tags);
                    const parsedMetadata = parseJsonField(q.metadata);
                    const parsedHints = parseJsonField(q.hints);
                    const parsedCorrectAnswer = parseJsonField(q.correct_answer);
                    const parsedCorrectAnswers = parseJsonField(q.correct_answers);

                    // Start with base question data
                    const questionData = {
                        ...q,
                        options: parsedOptions,
                        tags: parsedTags || [],
                        metadata: parsedMetadata || {},
                        hints: parsedHints || [],
                        correct_answer: parsedCorrectAnswer,
                        correct_answers: parsedCorrectAnswers,
                        question_text: q.content || q.question_text || q.title || q.text || 'Question'
                    };

                    // If coding question, use pre-fetched coding details
                    if (q.question_type === 'coding') {
                        try {
                            const codingRows = codingRowsByQuestionId[q.id] || [];

                            if (codingRows.length > 0) {
                                // Parse test cases - check if they differ by language, otherwise use first entry
                                // Test cases are typically the same across languages, but we check for consistency
                                const testCasesByLanguage = {};
                                const timeLimitsByLanguage = {};
                                const memoryLimitsByLanguage = {};

                                codingRows.forEach(row => {
                                    const parsedTestCases = parseJsonField(row.test_cases);
                                    testCasesByLanguage[row.language] = parsedTestCases || [];
                                    timeLimitsByLanguage[row.language] = row.time_limit || 1000;
                                    memoryLimitsByLanguage[row.language] = row.memory_limit || 256;
                                });

                                // Use test cases from first entry (typically same across all languages)
                                const parsedCodingTestCases = parseJsonField(codingRows[0].test_cases);

                                // Build coding_details with multi-language support
                                const codingDetails = {
                                    languages: codingRows.map(row => row.language),
                                    starter_codes: {},
                                    solution_codes: {},
                                    test_cases: parsedCodingTestCases || [],
                                    test_cases_by_language: testCasesByLanguage,
                                    time_limit: codingRows[0]?.time_limit || 1000,
                                    memory_limit: codingRows[0]?.memory_limit || 256,
                                    time_limits_by_language: timeLimitsByLanguage,
                                    memory_limits_by_language: memoryLimitsByLanguage,
                                    difficulty: codingRows[0]?.difficulty || 'medium'
                                };

                                // Populate starter_codes and solution_codes for each language
                                codingRows.forEach(row => {
                                    codingDetails.starter_codes[row.language] = row.starter_code || '';
                                    codingDetails.solution_codes[row.language] = row.solution_code || '';
                                });

                                questionData.coding_details = codingDetails;
                                questionData.test_cases = parsedCodingTestCases || [];

                                // Merge metadata - ensure we preserve existing metadata and add coding details
                                const existingMetadata = parsedMetadata && typeof parsedMetadata === 'object' ? parsedMetadata : {};
                                questionData.metadata = {
                                    ...existingMetadata, // Preserve original metadata
                                    test_cases: parsedCodingTestCases || existingMetadata.test_cases || [],
                                    test_cases_by_language: testCasesByLanguage,
                                    languages: codingDetails.languages,
                                    starter_codes: codingDetails.starter_codes,
                                    solution_codes: codingDetails.solution_codes,
                                    time_limit: codingDetails.time_limit || existingMetadata.time_limit,
                                    memory_limit: codingDetails.memory_limit || existingMetadata.memory_limit,
                                    time_limits_by_language: timeLimitsByLanguage,
                                    memory_limits_by_language: memoryLimitsByLanguage
                                };
                            } else {
                                // No coding_questions entries found, but check if metadata has coding data
                                const existingMetadata = parsedMetadata && typeof parsedMetadata === 'object' ? parsedMetadata : {};
                                if (existingMetadata.test_cases || existingMetadata.starter_codes || existingMetadata.languages) {
                                    // Metadata already has coding data, ensure it's properly structured
                                    questionData.metadata = {
                                        ...existingMetadata,
                                        test_cases: existingMetadata.test_cases || [],
                                        languages: existingMetadata.languages || [],
                                        starter_codes: existingMetadata.starter_codes || {},
                                        solution_codes: existingMetadata.solution_codes || {}
                                    };
                                    questionData.coding_details = {
                                        languages: existingMetadata.languages || [],
                                        starter_codes: existingMetadata.starter_codes || {},
                                        solution_codes: existingMetadata.solution_codes || {},
                                        test_cases: existingMetadata.test_cases || []
                                    };
                                }
                            }
                        } catch (e) {
                            console.error('Error fetching coding details:', e);
                            // On error, still try to use metadata if available
                            const existingMetadata = parsedMetadata && typeof parsedMetadata === 'object' ? parsedMetadata : {};
                            if (existingMetadata.test_cases || existingMetadata.starter_codes) {
                                questionData.metadata = existingMetadata;
                                questionData.coding_details = {
                                    languages: existingMetadata.languages || [],
                                    starter_codes: existingMetadata.starter_codes || {},
                                    test_cases: existingMetadata.test_cases || []
                                };
                            }
                        }
                    } else {
                        // Not a coding question, but ensure metadata is properly set
                        const existingMetadata = parsedMetadata && typeof parsedMetadata === 'object' ? parsedMetadata : {};
                        questionData.metadata = existingMetadata;
                    }

                    questionsFromTable.push(questionData);
                }
            } catch (e) {
                // Fallback: schema without section_id; still join to questions table
                try {
                    const fallbackQuery = `
                    SELECT 
                        q.*,
                        aq.question_order,
                        aq.points
                    FROM assessment_questions aq
                    JOIN questions q ON aq.question_id = q.id
                    WHERE aq.assessment_id = ?
                    ORDER BY IFNULL(aq.question_order, 0) ASC, q.id ASC
                `;
                    const [questionRows] = await db.execute(fallbackQuery, [assessmentId]);
                    // Parse JSON fields for questions from table (fallback query)
                    questionsFromTable = (questionRows || []).map(q => {
                        const parsedOptions = parseJsonField(q.options);
                        const parsedTags = parseJsonField(q.tags);
                        const parsedMetadata = parseJsonField(q.metadata);
                        const parsedHints = parseJsonField(q.hints);
                        const parsedCorrectAnswer = parseJsonField(q.correct_answer);
                        const parsedCorrectAnswers = parseJsonField(q.correct_answers);

                        return {
                            ...q,
                            options: parsedOptions,
                            tags: parsedTags || [],
                            metadata: parsedMetadata || {},
                            hints: parsedHints || [],
                            correct_answer: parsedCorrectAnswer,
                            correct_answers: parsedCorrectAnswers,
                            question_text: q.content || q.question_text || q.title || q.text || 'Question'
                        };
                    });
                } catch (e2) {
                    questionsFromTable = [];
                }
            }

            // Also check if questions are stored in assessment.sections JSON field
            let questionsFromJson = [];
            let sectionsFromJson = [];

            if (assessment.sections) {
                try {
                    const sectionsData = parseJsonField(assessment.sections);

                    if (Array.isArray(sectionsData) && sectionsData.length > 0) {
                        sectionsFromJson = sectionsData.map((section, index) => ({
                            id: section.id || `section-${index + 1}`,
                            name: section.name || `Section ${index + 1}`,
                            description: section.description || '',
                            order_index: section.order_index || index + 1,
                            time_limit_minutes: section.time_limit_minutes || null,
                            instructions: section.instructions || ''
                        }));

                        // Extract questions from sections JSON
                        sectionsData.forEach((section, sectionIndex) => {
                            if (section.questions && Array.isArray(section.questions)) {
                                section.questions.forEach((question, questionIndex) => {
                                    // Parse JSON fields in question
                                    const parsedOptions = parseJsonField(question.options);
                                    const parsedCorrectAnswer = parseJsonField(question.correct_answer);
                                    const parsedTags = parseJsonField(question.tags);
                                    const parsedMetadata = parseJsonField(question.metadata);

                                    const questionWithSection = {
                                        id: question.id || question.question_id || `q-${sectionIndex}-${questionIndex}`,
                                        question_text: question.content || question.question_text || question.title || question.text || 'Question',
                                        question_type: question.question_type || question.type || 'multiple_choice',
                                        points: question.points || 1,
                                        options: parsedOptions,
                                        correct_answer: parsedCorrectAnswer,
                                        tags: parsedTags,
                                        metadata: parsedMetadata,
                                        explanation: question.explanation || null,
                                        difficulty_level: question.difficulty_level || question.difficulty || 'medium',
                                        section_id: section.id || `section-${sectionIndex + 1}`,
                                        section_name: section.name || `Section ${sectionIndex + 1}`,
                                        section_order: sectionIndex + 1,
                                        question_order: question.order_index || questionIndex + 1,
                                        is_required: question.is_required !== false,
                                        time_limit_seconds: question.time_limit_seconds || null
                                    };

                                    questionsFromJson.push(questionWithSection);
                                });
                            }
                        });
                    }
                } catch (e) {
                    console.error('Error parsing sections JSON:', e);
                }
            }

            // Combine sections - prefer table data, fallback to JSON
            const sections = sectionsFromTable.length > 0 ? sectionsFromTable : sectionsFromJson;

            // Combine questions - prefer table data, fallback to JSON
            let questions = questionsFromTable.length > 0 ? questionsFromTable : questionsFromJson;

            // MEDIUM FIX: Validate questions - filter out deleted/invalid questions
            questions = questions.filter(q => {
                // Ensure question has required fields
                if (!q.id || !q.question_text) {
                    console.warn(`Invalid question found (missing id or text): ${JSON.stringify(q)}`);
                    return false;
                }
                // Verify question belongs to assessment (if from table)
                // Questions from JSON are already validated by structure
                return true;
            });

            // MEDIUM FIX: Check for minimum question count
            if (questions.length === 0) {
                console.warn(`No valid questions found for assessment ${assessmentId}`);
                // Return empty array with warning rather than throwing error
                // This allows graceful handling in frontend
            }

            // Remove correct answers for security (students shouldn't see them)
            const sanitizedQuestions = questions.map(q => {
                const { correct_answer, correct_answers, ...sanitized } = q;
                return sanitized;
            });

            return {
                assessment,
                sections: sections,
                questions: sanitizedQuestions
            };
        } catch (error) {
            console.error('Error getting assessment questions:', error);
            throw error;
        }
    }

    async retakeAssessment(assessmentId, studentId) {
        try {
            // Check if student can retake
            const canAttempt = await this.canStudentAttempt(assessmentId, studentId);
            if (!canAttempt.allowed) {
                throw new Error(canAttempt.reason);
            }

            // Check retake eligibility
            const attemptsQuery = `
                SELECT COUNT(*) as attempt_count, MAX(submitted_at) as last_submission
                FROM assessment_submissions 
                WHERE assessment_id = ? AND student_id = ? AND (status = 'submitted' OR status = 'graded')
            `;
            const [attempts] = await db.execute(attemptsQuery, [assessmentId, studentId]);
            const attemptCount = attempts[0].attempt_count;

            const assessment = await this.getAssessmentById(assessmentId, studentId);
            if (attemptCount >= assessment.max_attempts) {
                throw new Error('Maximum attempts reached');
            }

            // Check time between attempts
            if (assessment.time_between_attempts_hours > 0 && attempts[0].last_submission) {
                const lastSubmission = new Date(attempts[0].last_submission);
                const now = new Date();
                const hoursSinceLastAttempt = (now - lastSubmission) / (1000 * 60 * 60);

                if (hoursSinceLastAttempt < assessment.time_between_attempts_hours) {
                    const remainingHours = assessment.time_between_attempts_hours - hoursSinceLastAttempt;
                    throw new Error(`Must wait ${Math.ceil(remainingHours)} hours before retaking`);
                }
            }

            // Start new attempt
            return await this.startAssessment(assessmentId, studentId, {
                ipAddress: 'N/A',
                userAgent: 'N/A',
                deviceInfo: {},
                isRetake: true
            });

        } catch (error) {
            console.error('Error retaking assessment:', error);
            throw error;
        }
    }

    async canStudentAttempt(assessmentId, studentId) {
        // Check if assessment exists and is published
        const assessment = await this.getAssessmentById(assessmentId, studentId);
        if (!assessment || assessment.status !== 'published') {
            return { allowed: false, reason: 'Assessment not available' };
        }

        // Check date restrictions
        const now = new Date();
        if (assessment.scheduling) {
            const startDate = new Date(assessment.scheduling.start_date);
            const endDate = new Date(assessment.scheduling.end_date);

            if (now < startDate) {
                return { allowed: false, reason: 'Assessment not yet started' };
            }
            if (now > endDate) {
                return { allowed: false, reason: 'Assessment has ended' };
            }
        }

        // Check attempt limits
        const [attemptCount] = await db.execute(
            'SELECT COUNT(*) as count FROM assessment_submissions WHERE assessment_id = ? AND student_id = ?',
            [assessmentId, studentId]
        );

        if (attemptCount[0].count >= assessment.max_attempts) {
            return { allowed: false, reason: 'Maximum attempts reached' };
        }

        return { allowed: true };
    }

    async getNextAttemptNumber(assessmentId, studentId) {
        // MEDIUM FIX: Use transaction with SELECT FOR UPDATE to prevent race conditions
        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();

            // Lock the row to prevent concurrent access
            const [result] = await connection.execute(
                'SELECT MAX(attempt_number) as max_attempt FROM assessment_submissions WHERE assessment_id = ? AND student_id = ? FOR UPDATE',
                [assessmentId, studentId]
            );

            const nextAttempt = (result[0]?.max_attempt || 0) + 1;

            await connection.commit();
            return nextAttempt;
        } catch (error) {
            await connection.rollback();
            // If duplicate key error, retry once
            if (error.code === 'ER_DUP_ENTRY' || error.code === '23505' || error.message?.includes('duplicate key') || error.message?.includes('unique constraint')) {
                console.warn('Duplicate attempt number detected, retrying...');
                // Retry with a small delay
                await new Promise(resolve => setTimeout(resolve, 100));
                return this.getNextAttemptNumber(assessmentId, studentId);
            }
            throw error;
        } finally {
            connection.release();
        }
    }

    async getQuestionById(questionId) {
        const query = 'SELECT * FROM questions WHERE id = ?';
        const [results] = await db.execute(query, [questionId]);
        return results.length > 0 ? results[0] : null;
    }

    async getSubmissionById(submissionId) {
        const query = 'SELECT * FROM assessment_submissions WHERE id = ?';
        const [results] = await db.execute(query, [submissionId]);
        return results.length > 0 ? results[0] : null;
    }

    calculateAnswerScore(question, answer) {
        let isCorrect = false;
        let pointsEarned = 0;
        const questionType = question.type || question.question_type || 'multiple_choice';
        const questionPoints = parseFloat(question.points) || 0;

        switch (questionType) {
            case 'multiple_choice':
            case 'single_choice':
                isCorrect = answer.selected_options &&
                    answer.selected_options.includes(question.correct_answer);
                break;
            case 'true_false':
                isCorrect = answer.student_answer === question.correct_answer ||
                    (typeof answer === 'string' && answer.trim() === question.correct_answer);
                break;
            case 'short_answer':
            case 'essay':
                // For text answers, we might need manual grading
                // For now, we'll mark as null and let faculty grade
                isCorrect = null;
                break;
            case 'fill_blanks':
            case 'fill_blank': // Support both for backward compatibility
                const studentAnswer = answer.student_answer || (typeof answer === 'string' ? answer : '');
                const correctAnswer = question.correct_answer || '';
                isCorrect = studentAnswer &&
                    studentAnswer.toLowerCase().trim() ===
                    correctAnswer.toLowerCase().trim();
                break;
            case 'coding':
                // Coding questions handled separately with partial credit
                // This is a fallback for cases where testResults aren't available
                if (answer && typeof answer === 'object' && answer.testResults) {
                    const testResults = answer.testResults || [];
                    const passedTests = testResults.filter(result =>
                        result.result?.verdict?.status === 'accepted' ||
                        result.status === 'accepted'
                    ).length;
                    const totalTests = testResults.length;

                    if (totalTests > 0) {
                        pointsEarned = (passedTests / totalTests) * questionPoints;
                        isCorrect = passedTests === totalTests && totalTests > 0;
                    } else {
                        isCorrect = false;
                        pointsEarned = 0;
                    }
                } else {
                    isCorrect = false;
                    pointsEarned = 0;
                }
                break;
            case 'matching':
                // Matching: compare student's matching pairs with correct pairs
                if (answer && typeof answer === 'object' && answer.matches) {
                    const studentMatches = answer.matches || [];
                    const correctMatches = question.correct_answer || question.correct_matches || [];

                    if (Array.isArray(correctMatches) && Array.isArray(studentMatches)) {
                        // Count correct matches
                        let correctCount = 0;
                        correctMatches.forEach(correctMatch => {
                            const found = studentMatches.find(sm =>
                                sm.left === correctMatch.left && sm.right === correctMatch.right
                            );
                            if (found) correctCount++;
                        });

                        // Partial credit: points based on percentage of correct matches
                        if (correctMatches.length > 0) {
                            pointsEarned = (correctCount / correctMatches.length) * questionPoints;
                            isCorrect = correctCount === correctMatches.length;
                        } else {
                            isCorrect = false;
                            pointsEarned = 0;
                        }
                    } else {
                        isCorrect = null; // Manual grading needed
                        pointsEarned = 0;
                    }
                } else {
                    isCorrect = null;
                    pointsEarned = 0;
                }
                break;
            case 'ordering':
                // Ordering: compare student's sequence with correct sequence
                if (answer && typeof answer === 'object' && answer.sequence) {
                    const studentSequence = Array.isArray(answer.sequence) ? answer.sequence : [];
                    const correctSequence = Array.isArray(question.correct_answer)
                        ? question.correct_answer
                        : (question.correct_sequence || []);

                    if (correctSequence.length > 0 && studentSequence.length === correctSequence.length) {
                        // Count items in correct position
                        let correctPositions = 0;
                        studentSequence.forEach((item, index) => {
                            if (item === correctSequence[index]) {
                                correctPositions++;
                            }
                        });

                        // Partial credit: points based on percentage of correct positions
                        pointsEarned = (correctPositions / correctSequence.length) * questionPoints;
                        isCorrect = correctPositions === correctSequence.length;
                    } else {
                        isCorrect = false;
                        pointsEarned = 0;
                    }
                } else {
                    isCorrect = null;
                    pointsEarned = 0;
                }
                break;
            case 'hotspot':
                // Hotspot: compare clicked coordinates with correct region
                if (answer && typeof answer === 'object' && answer.coordinates) {
                    const studentCoords = answer.coordinates;
                    const correctRegion = question.correct_answer || question.correct_region || {};

                    // Check if coordinates are within correct region
                    if (correctRegion.x && correctRegion.y && correctRegion.width && correctRegion.height) {
                        const inRegion =
                            studentCoords.x >= correctRegion.x &&
                            studentCoords.x <= (correctRegion.x + correctRegion.width) &&
                            studentCoords.y >= correctRegion.y &&
                            studentCoords.y <= (correctRegion.y + correctRegion.height);

                        isCorrect = inRegion;
                        pointsEarned = inRegion ? questionPoints : 0;
                    } else {
                        isCorrect = null; // Manual grading needed
                        pointsEarned = 0;
                    }
                } else {
                    isCorrect = null;
                    pointsEarned = 0;
                }
                break;
            case 'file_upload':
                // File upload: always requires manual grading
                isCorrect = null;
                pointsEarned = 0;
                break;
            default:
                // Unknown question type
                isCorrect = null;
                pointsEarned = 0;
        }

        // Cap points at question points
        if (isCorrect === true && pointsEarned === 0) {
            pointsEarned = questionPoints;
        }

        // Support partial credit - pointsEarned may already be calculated as partial
        // Only override if isCorrect is true but pointsEarned is still 0
        if (isCorrect === true && pointsEarned === 0 && questionPoints > 0) {
            pointsEarned = questionPoints;
        }

        // Ensure points don't exceed question points
        pointsEarned = Math.min(Math.max(0, pointsEarned), questionPoints);

        return { isCorrect, pointsEarned };
    }

    async calculateFinalScore(submissionId, allowInProgress = false, providedConnection = null) {
        // CRITICAL FIX: Add concurrency protection using SELECT FOR UPDATE
        // This prevents race conditions when calculateFinalScore is called concurrently
        const useOwnConnection = !providedConnection;
        const connection = providedConnection || await db.getConnection();

        try {
            if (useOwnConnection) {
                await connection.beginTransaction();
            }

            // Lock the submission row to prevent concurrent calculations
            const [lockedSubmission] = await connection.execute(
                'SELECT id, status FROM assessment_submissions WHERE id = ? FOR UPDATE',
                [submissionId]
            );

            if (lockedSubmission.length === 0) {
                if (useOwnConnection) {
                    await connection.rollback();
                }
                throw new Error('Submission not found');
            }

            const submission = lockedSubmission[0];

            // Only calculate score for submitted or graded assessments
            // Allow in-progress submissions when explicitly requested (e.g., during submission)
            if (submission.status === 'in_progress' && !allowInProgress) {
                if (useOwnConnection) {
                    await connection.rollback();
                }
                throw new Error('Cannot calculate final score for in-progress submissions');
            }

            // Get all answers with question details to calculate total points correctly
            const [answers] = await connection.execute(`
            SELECT 
                sr.points_earned, 
                sr.time_spent,
                sr.question_id,
                q.points as question_points
            FROM student_responses sr
            LEFT JOIN questions q ON sr.question_id = q.id
            WHERE sr.submission_id = ?
        `, [submissionId]);

            // Calculate total score from earned points
            const totalScore = answers.reduce((sum, answer) => sum + (parseFloat(answer.points_earned) || 0), 0);
            const totalTimeSpent = answers.reduce((sum, answer) => sum + (parseInt(answer.time_spent) || 0), 0);

            // Calculate total points by summing ALL question points for this assessment
            // This is more accurate than using assessment.total_points which may be outdated
            const [allQuestions] = await connection.execute(`
            SELECT DISTINCT q.points, aq.points as assessment_question_points
            FROM assessment_questions aq
            JOIN questions q ON aq.question_id = q.id
            JOIN assessment_submissions s ON aq.assessment_id = s.assessment_id
            WHERE s.id = ?
        `, [submissionId]);

            // Use assessment_question_points if available (overrides question points), otherwise use question points
            let totalPoints = allQuestions.reduce((sum, q) => {
                const qPoints = parseFloat(q.assessment_question_points) || parseFloat(q.points) || 0;
                return sum + qPoints;
            }, 0);

            // Fallback to assessment total_points only if no questions found
            if (totalPoints === 0 || isNaN(totalPoints) || allQuestions.length === 0) {
                const [assessment] = await connection.execute(`
                SELECT a.total_points FROM assessments a
                JOIN assessment_submissions s ON a.id = s.assessment_id
                WHERE s.id = ?
            `, [submissionId]);
                const assessmentTotalPoints = parseFloat(assessment[0]?.total_points) || 0;

                // MEDIUM FIX: Validate total_points is positive
                if (assessmentTotalPoints <= 0) {
                    console.warn(`Invalid total_points (${assessmentTotalPoints}) for submission ${submissionId}, using default 100`);
                    totalPoints = 100; // Default to 100 if invalid
                } else {
                    totalPoints = assessmentTotalPoints;
                }
            }

            // MEDIUM FIX: Final validation - ensure totalPoints is positive
            if (totalPoints <= 0 || isNaN(totalPoints) || !isFinite(totalPoints)) {
                console.error(`Invalid totalPoints (${totalPoints}) for submission ${submissionId}, defaulting to 100`);
                totalPoints = 100;
            }

            // Calculate percentage with safeguards against division by zero and NaN
            let percentage = 0;
            if (totalPoints > 0 && !isNaN(totalScore) && isFinite(totalScore)) {
                percentage = (totalScore / totalPoints) * 100;
            }

            // Ensure percentage is valid and capped at 100
            if (isNaN(percentage) || !isFinite(percentage)) {
                percentage = 0;
            } else {
                percentage = Math.min(100, Math.max(0, percentage));
            }

            // Calculate grade
            let grade = 'F';
            if (percentage >= 90) grade = 'A';
            else if (percentage >= 80) grade = 'B';
            else if (percentage >= 70) grade = 'C';
            else if (percentage >= 60) grade = 'D';

            if (useOwnConnection) {
                await connection.commit();
            }

            return {
                totalScore: isNaN(totalScore) ? 0 : Math.max(0, totalScore),
                totalPoints: isNaN(totalPoints) ? 0 : Math.max(0, totalPoints),
                percentage: Math.round(percentage * 100) / 100,
                grade,
                timeSpent: isNaN(totalTimeSpent) ? 0 : Math.max(0, totalTimeSpent),
                answersCount: answers.length
            };
        } catch (error) {
            if (useOwnConnection) {
                await connection.rollback();
            }
            throw error;
        } finally {
            if (useOwnConnection) {
                connection.release();
            }
        }
    }

    async logAssessmentAccess(assessmentId, studentId, accessType, accessData = {}) {
        // Try multiple schemas progressively
        try {
            // Schema 1: student_id + access_type
            const q1 = `
                INSERT INTO assessment_access_logs 
                (assessment_id, student_id, access_type, ip_address, user_agent, device_info)
                VALUES (?, ?, ?, ?, ?, ?)
            `;
            await db.execute(q1, [
                assessmentId,
                studentId,
                accessType,
                accessData.ipAddress || null,
                accessData.userAgent || null,
                JSON.stringify(accessData.deviceInfo || {})
            ]);
            return;
        } catch (_) { /* try next */ }

        try {
            // Schema 2: student_id without access_type
            const q2 = `
                INSERT INTO assessment_access_logs 
                (assessment_id, student_id, ip_address, user_agent, device_info)
                VALUES (?, ?, ?, ?, ?)
            `;
            await db.execute(q2, [
                assessmentId,
                studentId,
                accessData.ipAddress || null,
                accessData.userAgent || null,
                JSON.stringify(accessData.deviceInfo || {})
            ]);
            return;
        } catch (_) { /* try next */ }

        try {
            // Schema 3: user_id minimal
            const q3 = `
                INSERT INTO assessment_access_logs 
                (assessment_id, user_id, ip_address, user_agent)
                VALUES (?, ?, ?, ?)
            `;
            await db.execute(q3, [
                assessmentId,
                studentId,
                accessData.ipAddress || null,
                accessData.userAgent || null
            ]);
            return;
        } catch (e3) {
            // Last resort: do nothing instead of failing start
            console.warn('Skipping access log insert due to schema mismatch');
        }
    }
}

export default new StudentAssessmentService();
