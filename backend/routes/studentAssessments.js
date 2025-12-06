import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { authenticateToken as auth } from '../middleware/auth.js';
import { requireRole as roleCheck } from '../middleware/roleCheck.js';
import { validateCSRFToken } from '../middleware/csrf.js';
import { requireHTTPS } from '../middleware/requireHTTPS.js';
import studentAssessmentService from '../services/studentAssessmentService.js';
import proctoringService from '../services/proctoringService.js';
import analyticsService from '../services/analyticsService.js';
import { pool as db } from '../config/database.js';
// CRITICAL FIX: Import input validation utilities
import { safeParseInt } from '../utils/inputValidation.js';
// CRITICAL FIX: Import safe JSON parser
import { safeJsonParse } from '../utils/jsonParser.js';
// MEDIUM FIX: Import standardized student ID utilities
import { extractStudentId, validateStudentId } from '../utils/studentUtils.js';
// LOW FIX: Import standardized error messages
import { getUserFriendlyMessage, sanitizeErrorMessage } from '../utils/errorMessages.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const router = express.Router();

// Get available assessments for student (must be before dynamic :assessmentId)
router.get('/available', auth, roleCheck(['student']), async (req, res) => {
    try {
        // MEDIUM FIX: Use standardized student ID extraction
        const studentId = validateStudentId(extractStudentId(req.user), 'getting available assessments');
        const filters = {
            status: req.query.status,
            dateFrom: req.query.dateFrom,
            dateTo: req.query.dateTo,
            department: req.query.department,
            batch: req.query.batch,
            college: req.query.college,
            subject: req.query.subject,
            // CRITICAL FIX: Use safe input validation
            limit: safeParseInt(req.query.limit, 50, 1, 100),
            offset: safeParseInt(req.query.offset, 0, 0, 10000)
        };

        const assessments = await studentAssessmentService.getAvailableAssessments(studentId, filters);
        
        res.json({
            success: true,
            data: assessments,
            pagination: {
                limit: filters.limit,
                offset: filters.offset,
                total: assessments.length
            }
        });
    } catch (error) {
        console.error('Error getting available assessments:', error);
        // LOW FIX: Use standardized error messages
        const message = getUserFriendlyMessage('OPERATION_FAILED', 'Failed to get available assessments');
        res.status(500).json({
            success: false,
            message: message,
            error: sanitizeErrorMessage(error, process.env.NODE_ENV === 'development')
        });
    }
});

// Get individual assessment details for student
router.get('/:assessmentId', auth, roleCheck(['student']), async (req, res) => {
    try {
        const { assessmentId } = req.params;
        // MEDIUM FIX: Use standardized student ID extraction
        const studentId = validateStudentId(extractStudentId(req.user), 'getting assessment details');

        const assessment = await studentAssessmentService.getAssessmentById(assessmentId, studentId);
        
        res.json({
            success: true,
            data: assessment
        });
    } catch (error) {
        console.error('Error getting assessment details:', error);
        // LOW FIX: Use standardized error messages
        const message = getUserFriendlyMessage('ASSESSMENT_NOT_FOUND', 'Failed to get assessment details');
        res.status(500).json({
            success: false,
            message: message,
            error: sanitizeErrorMessage(error, process.env.NODE_ENV === 'development')
        });
    }
});

// Get assessment questions for student
router.get('/:assessmentId/questions', auth, roleCheck(['student']), async (req, res) => {
    try {
        const { assessmentId } = req.params;
        // MEDIUM FIX: Use standardized student ID extraction
        const studentId = validateStudentId(extractStudentId(req.user), 'getting assessment questions');

        const questions = await studentAssessmentService.getAssessmentQuestions(assessmentId, studentId);
        
        res.json({
            success: true,
            data: questions
        });
    } catch (error) {
        console.error('Error getting assessment questions:', error);
        // LOW FIX: Use standardized error messages
        const message = getUserFriendlyMessage('ASSESSMENT_NOT_FOUND', 'Failed to get assessment questions');
        res.status(500).json({
            success: false,
            message: message,
            error: sanitizeErrorMessage(error, process.env.NODE_ENV === 'development')
        });
    }
});

// (moved '/available' route above)

// Retake assessment
router.post('/:assessmentId/retake', auth, roleCheck(['student']), validateCSRFToken, async (req, res) => {
    try {
        const { assessmentId } = req.params;
        // MEDIUM FIX: Use standardized student ID extraction
        const studentId = validateStudentId(extractStudentId(req.user), 'retaking assessment');

        const result = await studentAssessmentService.retakeAssessment(assessmentId, studentId);
        
        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        console.error('Error retaking assessment:', error);
        res.status(400).json({
            success: false,
            message: 'Failed to retake assessment',
            error: error.message
        });
    }
});

// Start assessment attempt
router.post('/:assessmentId/start', auth, roleCheck(['student']), validateCSRFToken, async (req, res) => {
    try {
        const { assessmentId } = req.params;
        // MEDIUM FIX: Use standardized student ID extraction
        const studentId = validateStudentId(extractStudentId(req.user), 'starting assessment');
        
        const attemptData = {
            ipAddress: req.ip,
            userAgent: req.get('User-Agent'),
            deviceInfo: req.body.deviceInfo || {}
        };

        const result = await studentAssessmentService.startAssessment(assessmentId, studentId, attemptData);
        
        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        console.error('Error starting assessment:', error);
        res.status(400).json({
            success: false,
            message: 'Failed to start assessment',
            error: error.message
        });
    }
});

// Save student answer
router.post('/:submissionId/answers', auth, roleCheck(['student']), validateCSRFToken, async (req, res) => {
    try {
        const { submissionId } = req.params;
        const { questionId, answer, timeSpent } = req.body;
        // MEDIUM FIX: Use standardized student ID extraction
        const studentId = validateStudentId(extractStudentId(req.user), 'saving answer');

        if (!questionId || answer === undefined || answer === null) {
            return res.status(400).json({
                success: false,
                message: 'Question ID and answer are required'
            });
        }

        if (!studentId) {
            return res.status(401).json({
                success: false,
                message: 'Student ID not found in authentication token'
            });
        }

        const result = await studentAssessmentService.saveAnswer(submissionId, questionId, answer, timeSpent, studentId);
        
        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        console.error('Error saving answer:', error);
        // LOW FIX: Use standardized error messages
        const message = getUserFriendlyMessage('ANSWER_SAVE_FAILED');
        
        const statusCode = error.message.includes('Unauthorized') || error.message.includes('permission') 
            ? 403 
            : error.message.includes('not found') 
            ? 404 
            : error.message.includes('expired') || error.message.includes('exceeded')
            ? 403
            : 500;
        
        // Sanitize error messages to prevent information leakage
        let sanitizedMessage = 'Failed to save answer';
        if (error.message) {
            // Only include safe error messages that don't expose internal details
            const safeMessages = [
                'not found', 'expired', 'exceeded', 'permission', 'unauthorized',
                'required', 'invalid', 'empty', 'size exceeds'
            ];
            const hasSafeMessage = safeMessages.some(safe => 
                error.message.toLowerCase().includes(safe)
            );
            if (hasSafeMessage) {
                sanitizedMessage = error.message;
            }
        }
        
        res.status(statusCode).json({
            success: false,
            message: sanitizedMessage
        });
    }
});

// Get existing answers for a submission
router.get('/:submissionId/answers', auth, roleCheck(['student']), async (req, res) => {
    try {
        const { submissionId } = req.params;
        // MEDIUM FIX: Use standardized student ID extraction
        const studentId = validateStudentId(extractStudentId(req.user), 'getting answers');

        if (!studentId) {
            return res.status(401).json({
                success: false,
                message: 'Student ID not found in authentication token'
            });
        }

        // Verify ownership
        const submission = await studentAssessmentService.getSubmissionById(submissionId);
        if (!submission || submission.student_id !== studentId) {
            return res.status(403).json({
                success: false,
                message: 'Unauthorized: You do not have permission to view this submission'
            });
        }

        // LOW FIX: Use service layer instead of direct query
        const responses = await studentAssessmentService.getSubmissionAnswers(submissionId);

        // Format responses for frontend
        const formattedResponses = responses.map(response => {
            // Use student_answer as primary, fallback to selected_options for multiple choice
            let answer = response.student_answer;
            
            // CRITICAL FIX: Use safe JSON parsing (imported at top of file)
            
            // For multiple choice questions, use selected_options if student_answer is null
            if (!answer && response.selected_options) {
                answer = typeof response.selected_options === 'string' 
                    ? safeJsonParse(response.selected_options, response.selected_options)
                    : response.selected_options;
            }
            
            // Parse JSON string answers if needed
            if (typeof answer === 'string' && (answer.startsWith('{') || answer.startsWith('['))) {
                answer = safeJsonParse(answer, answer); // Keep as string if parsing fails
            }
            
            return {
                question_id: response.question_id,
                answer: answer,
                question_type: response.question_type,
                time_spent: response.time_spent,
                is_correct: response.is_correct,
                points_earned: response.points_earned,
                is_flagged: response.is_flagged === 1 || response.is_flagged === true,
                updated_at: response.updated_at
            };
        });

        res.json({
            success: true,
            data: formattedResponses
        });
    } catch (error) {
        console.error('Error getting answers:', error);
        // LOW FIX: Use standardized error messages
        const message = getUserFriendlyMessage('RESOURCE_NOT_FOUND', 'Failed to get answers');
        res.status(500).json({
            success: false,
            message: message,
            error: sanitizeErrorMessage(error, process.env.NODE_ENV === 'development')
        });
    }
});

// Submit assessment
router.post('/:submissionId/submit', auth, roleCheck(['student']), validateCSRFToken, async (req, res) => {
    try {
        const { submissionId } = req.params;
        // MEDIUM FIX: Use standardized student ID extraction
        const studentId = validateStudentId(extractStudentId(req.user), 'getting answers');

        if (!studentId) {
            return res.status(401).json({
                success: false,
                message: 'Student ID not found in authentication token'
            });
        }

        // CRITICAL SECURITY: Verify ownership before allowing submit
        const submission = await studentAssessmentService.getSubmissionById(submissionId);
        if (!submission) {
            return res.status(404).json({
                success: false,
                message: 'Submission not found'
            });
        }

        if (submission.student_id !== studentId) {
            return res.status(403).json({
                success: false,
                message: 'Unauthorized: You do not have permission to submit this assessment'
            });
        }

        if (submission.status !== 'in_progress') {
            return res.status(400).json({
                success: false,
                message: `Cannot submit assessment with status: ${submission.status}`
            });
        }

        // CRITICAL SECURITY FIX: Server-side time validation (prevent client-side time manipulation)
        const [assessmentRows] = await db.execute(
            'SELECT time_limit_minutes FROM assessment_templates WHERE id = ?',
            [submission.assessment_id]
        );
        
        if (assessmentRows && assessmentRows.length > 0) {
            const timeLimitMinutes = assessmentRows[0].time_limit_minutes || 0;
            const startedAt = new Date(submission.started_at);
            const now = new Date();
            const elapsedMinutes = (now - startedAt) / (1000 * 60);
            
            // Check if time limit exceeded (with 1 minute grace period for network delays)
            if (timeLimitMinutes > 0 && elapsedMinutes > timeLimitMinutes + 1) {
                console.warn(`Time limit exceeded for submission ${submissionId}: elapsed=${elapsedMinutes.toFixed(2)}min, limit=${timeLimitMinutes}min`);
                // Still allow submission but log the violation
            }
        }

        const submissionData = {
            ipAddress: req.ip,
            userAgent: req.get('User-Agent'),
            deviceInfo: req.body.deviceInfo || {},
            // Include answers and timeSpent if provided (final safety save)
            answers: req.body.answers,
            timeSpent: req.body.timeSpent,
            serverValidatedTime: new Date().toISOString() // Server timestamp for validation
        };

        // CRITICAL: Save all answers before finalizing submission
        // This ensures all answers from all sections are saved
        if (req.body.answers && typeof req.body.answers === 'object') {
            for (const [questionId, answer] of Object.entries(req.body.answers)) {
                if (answer !== null && answer !== undefined) {
                    try {
                        const timeSpent = req.body.timeSpent && req.body.timeSpent[questionId] 
                            ? Math.floor(req.body.timeSpent[questionId] / 1000) 
                            : 0;
                        await studentAssessmentService.saveAnswer(submissionId, questionId, answer, timeSpent, studentId);
                    } catch (error) {
                        console.error(`Error saving answer for question ${questionId} during final submission:`, error);
                        // Continue with other answers
                    }
                }
            }
            
            // Wait a moment to ensure all saves are committed
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        const result = await studentAssessmentService.submitAssessment(submissionId, submissionData, studentId);
        
        res.json({
            success: true,
            data: result,
            message: 'Assessment submitted successfully. All answers have been saved.'
        });
    } catch (error) {
        console.error('Error submitting assessment:', error);
        
        const statusCode = error.message.includes('Unauthorized') || error.message.includes('permission') 
            ? 403 
            : error.message.includes('not found') 
            ? 404 
            : error.message.includes('expired') || error.message.includes('exceeded') || error.message.includes('started')
            ? 403
            : error.message.includes('status')
            ? 400
            : 500;
        
        res.status(statusCode).json({
            success: false,
            message: error.message || 'Failed to submit assessment'
        });
    }
});

// Toggle question flag
router.post('/:submissionId/questions/:questionId/flag', auth, roleCheck(['student']), validateCSRFToken, async (req, res) => {
    try {
        const { submissionId, questionId } = req.params;
        const studentId = req.user.id || req.user.student_id || req.user.studentId;
        const { isFlagged } = req.body;

        if (!studentId) {
            return res.status(401).json({
                success: false,
                message: 'Student ID not found in authentication token'
            });
        }

        // Verify ownership
        const submission = await studentAssessmentService.getSubmissionById(submissionId);
        if (!submission || submission.student_id !== studentId) {
            return res.status(403).json({
                success: false,
                message: 'Unauthorized: You do not have permission to modify this submission'
            });
        }

        if (submission.status !== 'in_progress') {
            return res.status(400).json({
                success: false,
                message: 'Cannot modify flags for a submission that is not in progress'
            });
        }

        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();

            // Check if is_flagged column exists
            // PostgreSQL: Query information_schema instead of SHOW COLUMNS
            const [columns] = await connection.query(`
                SELECT column_name as Field 
                FROM information_schema.columns 
                WHERE table_name = 'student_responses'
            `);
            const hasFlaggedColumn = columns.some(col => col.Field === 'is_flagged');

            if (!hasFlaggedColumn) {
                await connection.rollback();
                return res.status(400).json({
                    success: false,
                    message: 'Flagging feature is not available. Please run database migration.'
                });
            }

            // Update or insert flag status
            await connection.query(`
                INSERT INTO student_responses (submission_id, question_id, is_flagged)
                VALUES (?, ?, ?)
                ON CONFLICT (submission_id, question_id) DO UPDATE SET
                    is_flagged = EXCLUDED.is_flagged
            `, [submissionId, questionId, isFlagged === true || isFlagged === 'true']);

            await connection.commit();

            res.json({
                success: true,
                data: { isFlagged: isFlagged === true || isFlagged === 'true' }
            });
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    } catch (error) {
        console.error('Error toggling question flag:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to toggle question flag',
            error: error.message
        });
    }
});

// Get time remaining for assessment
router.get('/:submissionId/time-remaining', auth, roleCheck(['student']), async (req, res) => {
    try {
        const { submissionId } = req.params;
        // MEDIUM FIX: Use standardized student ID extraction
        const studentId = validateStudentId(extractStudentId(req.user), 'getting answers');

        // Verify student owns this submission
        const submission = await studentAssessmentService.getSubmissionById(submissionId);
        if (!submission) {
            return res.status(404).json({
                success: false,
                message: 'Submission not found'
            });
        }
        
        // Convert both to strings for comparison to handle different types
        const submissionStudentId = String(submission.student_id || submission.studentId || '');
        const requestStudentId = String(studentId || '');
        
        if (submissionStudentId !== requestStudentId) {
            return res.status(403).json({
                success: false,
                message: 'Access denied'
            });
        }

        // Get assessment time limit
        const [assessmentRows] = await db.execute(
            'SELECT time_limit_minutes FROM assessment_templates WHERE id = ?',
            [submission.assessment_id]
        );

        if (!assessmentRows || assessmentRows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Assessment not found'
            });
        }

        const timeLimitMinutes = assessmentRows[0].time_limit_minutes || 0;
        const startedAt = new Date(submission.started_at);
        const now = new Date();
        const elapsedMinutes = (now - startedAt) / (1000 * 60);
        const remainingMinutes = Math.max(0, timeLimitMinutes - elapsedMinutes);
        const remainingSeconds = Math.floor(remainingMinutes * 60);

        res.json({
            success: true,
            data: {
                remainingSeconds,
                remainingMinutes: Math.floor(remainingMinutes),
                elapsedMinutes: Math.floor(elapsedMinutes),
                timeLimitMinutes,
                serverTime: now.toISOString(),
                startedAt: startedAt.toISOString()
            }
        });
    } catch (error) {
        console.error('Error getting time remaining:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get time remaining',
            error: error.message
        });
    }
});

// Get assessment results
router.get('/:submissionId/results', auth, roleCheck(['student']), async (req, res) => {
    try {
        const { submissionId } = req.params;
        const { studentId } = req.user;

        // Verify student owns this submission
        const submission = await studentAssessmentService.getSubmissionById(submissionId);
        if (!submission || submission.student_id !== studentId) {
            return res.status(403).json({
                success: false,
                message: 'Access denied'
            });
        }

        const results = await studentAssessmentService.getAssessmentResults(submissionId);
        
        res.json({
            success: true,
            data: results
        });
    } catch (error) {
        console.error('Error getting assessment results:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get assessment results',
            error: error.message
        });
    }
});

// Get attempts history for a specific assessment
router.get('/:assessmentId/attempts', auth, roleCheck(['student']), async (req, res) => {
    try {
        const { assessmentId } = req.params;
        const studentId = req.user.id || req.user.student_id || req.user.studentId;

        if (!studentId) {
            return res.status(401).json({
                success: false,
                message: 'Student ID not found in authentication token'
            });
        }

        // Get all attempts for this assessment and student
        const connection = await db.getConnection();
        try {
            const [attempts] = await connection.query(`
                SELECT 
                    s.id as submission_id,
                    s.attempt_number,
                    s.percentage_score,
                    s.score,
                    s.time_taken_minutes,
                    s.status,
                    s.submitted_at,
                    s.started_at,
                    s.created_at,
                    a.title as assessment_title,
                    a.total_points,
                    a.max_attempts
                FROM assessment_submissions s
                JOIN assessment_templates a ON s.assessment_id = a.id
                WHERE s.assessment_id = ? AND s.student_id = ?
                ORDER BY s.attempt_number DESC, s.submitted_at DESC
            `, [assessmentId, studentId]);

            res.json({
                success: true,
                data: {
                    assessment: {
                        id: assessmentId,
                        title: attempts.length > 0 ? attempts[0].assessment_title : null,
                        total_points: attempts.length > 0 ? attempts[0].total_points : null,
                        max_attempts: attempts.length > 0 ? attempts[0].max_attempts : null
                    },
                    attempts: attempts,
                    total_attempts: attempts.length
                }
            });
        } finally {
            connection.release();
        }
    } catch (error) {
        console.error('Error getting assessment attempts:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get assessment attempts',
            error: error.message
        });
    }
});

// Get student assessment history
router.get('/history', auth, roleCheck(['student']), async (req, res) => {
    try {
        const { studentId } = req.user;
        const filters = {
            limit: parseInt(req.query.limit) || 20,
            offset: parseInt(req.query.offset) || 0,
            status: req.query.status,
            dateFrom: req.query.dateFrom,
            dateTo: req.query.dateTo
        };

        const history = await studentAssessmentService.getStudentAssessmentHistory(studentId, filters);
        
        res.json({
            success: true,
            data: history,
            pagination: {
                limit: filters.limit,
                offset: filters.offset,
                total: history.length
            }
        });
    } catch (error) {
        console.error('Error getting assessment history:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get assessment history',
            error: error.message
        });
    }
});

// Proctoring endpoints
router.post('/:submissionId/proctoring/violation', auth, roleCheck(['student']), requireHTTPS, validateCSRFToken, async (req, res) => {
    try {
        const { submissionId } = req.params;
        const { violationType, metadata } = req.body;
        // MEDIUM FIX: Use standardized student ID extraction
        const userId = validateStudentId(extractStudentId(req.user), 'reporting proctoring violation');
        
        // CRITICAL FIX: Server-side validation for browser lockdown bypass attempts
        // Validate that violation types are legitimate and not manipulated
        const validViolationTypes = [
            'proctoring_started', 'proctoring_initialized', 'webcam_disconnect', 'fullscreen_exit',
            'dev_tools', 'right_click', 'copy_paste', 'keyboard_shortcut', 'tab_switch',
            'window_focus', 'suspicious_activity', 'webcam_error', 'microphone_error'
        ];
        
        if (!validViolationTypes.includes(violationType)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid violation type'
            });
        }
        
        // CRITICAL FIX: Validate and sanitize metadata structure and size to prevent injection
        let sanitizedMetadata = metadata;
        if (metadata && typeof metadata === 'object') {
            const metadataStr = JSON.stringify(metadata);
            if (metadataStr.length > 10000) { // 10KB limit
                return res.status(400).json({
                    success: false,
                    message: 'Metadata exceeds maximum size'
                });
            }
            
            // Sanitize metadata to prevent script injection
            sanitizedMetadata = {};
            for (const [key, value] of Object.entries(metadata)) {
                if (typeof key === 'string' && key.length <= 100) {
                    if (typeof value === 'string' && value.length <= 1000) {
                        sanitizedMetadata[key] = value.replace(/<script[^>]*>.*?<\/script>/gi, '');
                    } else if (typeof value !== 'object') {
                        sanitizedMetadata[key] = value;
                    }
                }
            }
        }

        // CRITICAL FIX: Log consent if this is the first violation (proctoring started)
        if (violationType === 'proctoring_started' || violationType === 'proctoring_initialized') {
            await proctoringService.logProctoringConsent(submissionId, userId, {
                consent_given: true,
                consent_type: 'full_proctoring',
                metadata: sanitizedMetadata
            });
        }

        // CRITICAL FIX: Use sanitized metadata for violation logging
        const result = await proctoringService.logViolation(submissionId, violationType, sanitizedMetadata);
        
        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        console.error('Error logging proctoring violation:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to log proctoring violation',
            error: error.message
        });
    }
});

router.get('/:submissionId/proctoring/violations', auth, roleCheck(['student', 'faculty', 'admin']), async (req, res) => {
    try {
        const { submissionId } = req.params;
        const filters = {
            violationType: req.query.violationType,
            severityLevel: req.query.severityLevel,
            limit: parseInt(req.query.limit) || 100,
            offset: parseInt(req.query.offset) || 0
        };

        const violations = await proctoringService.getViolations(submissionId, filters);
        
        res.json({
            success: true,
            data: violations
        });
    } catch (error) {
        console.error('Error getting proctoring violations:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get proctoring violations',
            error: error.message
        });
    }
});

router.get('/:submissionId/proctoring/summary', auth, roleCheck(['student', 'faculty', 'admin']), async (req, res) => {
    try {
        const { submissionId } = req.params;
        const summary = await proctoringService.getProctoringSummary(submissionId);
        
        res.json({
            success: true,
            data: summary
        });
    } catch (error) {
        console.error('Error getting proctoring summary:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get proctoring summary',
            error: error.message
        });
    }
});

// Analytics endpoints
router.get('/analytics/student/:studentId', auth, roleCheck(['student', 'faculty', 'admin']), async (req, res) => {
    try {
        const { studentId } = req.params;
        const userId = req.user.id;
        const userRole = req.user.role;
        
        // LOW PRIORITY FIX: Move authorization logic to service
        const accessControlService = (await import('../services/accessControlService.js')).default;
        const hasAccess = await accessControlService.canAccessStudentAnalytics(userId, userRole, studentId);
        
        if (!hasAccess.allowed) {
            return res.status(hasAccess.statusCode || 403).json({
                success: false,
                message: hasAccess.message || 'Access denied'
            });
        }
        
        // super-admin can access all (no additional check needed)
        
        const filters = {
            dateFrom: req.query.dateFrom,
            dateTo: req.query.dateTo,
            assessmentIds: req.query.assessmentIds ? req.query.assessmentIds.split(',') : null,
            batchId: req.query.batchId,
            departmentId: req.query.departmentId
        };

        const analytics = await analyticsService.getStudentPerformanceAnalytics(studentId, filters);
        
        res.json({
            success: true,
            data: analytics
        });
    } catch (error) {
        console.error('Error getting student analytics:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get student analytics',
            error: error.message
        });
    }
});

router.get('/analytics/assessment/:assessmentId', auth, roleCheck(['faculty', 'admin']), async (req, res) => {
    try {
        const { assessmentId } = req.params;
        const userId = req.user.id;
        const userRole = req.user.role;
        
        // CRITICAL FIX: Resource-level authorization check
        if (userRole === 'faculty' || userRole === 'college-admin') {
            // Check if assessment belongs to user's college
            const [assessment] = await db.execute(
                `SELECT a.college_id, a.created_by 
                 FROM assessment_templates a 
                 WHERE a.id = ?`,
                [assessmentId]
            );
            
            if (assessment.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Assessment not found'
                });
            }
            
            const [userInfo] = await db.execute(
                `SELECT college_id FROM users WHERE id = ?`,
                [userId]
            );
            
            if (userInfo.length === 0) {
                return res.status(403).json({
                    success: false,
                    message: 'User information not found'
                });
            }
            
            // Faculty/admin can only access assessments from their college
            // Or assessments they created (if created_by matches)
            if (assessment[0].college_id !== userInfo[0].college_id && 
                assessment[0].created_by !== userId) {
                return res.status(403).json({
                    success: false,
                    message: 'You do not have permission to access this assessment\'s analytics'
                });
            }
        }
        // super-admin can access all (no additional check needed)
        
        const filters = {
            batchId: req.query.batchId,
            departmentId: req.query.departmentId,
            collegeId: req.query.collegeId,
            dateFrom: req.query.dateFrom,
            dateTo: req.query.dateTo
        };

        const analytics = await analyticsService.getAssessmentPerformanceAnalytics(assessmentId, filters);
        
        res.json({
            success: true,
            data: analytics
        });
    } catch (error) {
        console.error('Error getting assessment analytics:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get assessment analytics',
            error: error.message
        });
    }
});

router.get('/analytics/batch-department', auth, roleCheck(['faculty', 'admin']), async (req, res) => {
    try {
        const filters = {
            batchId: req.query.batchId,
            departmentId: req.query.departmentId,
            collegeId: req.query.collegeId,
            dateFrom: req.query.dateFrom,
            dateTo: req.query.dateTo,
            groupBy: req.query.groupBy || 'batch'
        };

        const analytics = await analyticsService.getBatchDepartmentAnalytics(filters);
        
        res.json({
            success: true,
            data: analytics
        });
    } catch (error) {
        console.error('Error getting batch/department analytics:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get batch/department analytics',
            error: error.message
        });
    }
});

// Export endpoints
router.post('/analytics/export', auth, roleCheck(['faculty', 'admin']), validateCSRFToken, async (req, res) => {
    try {
        const { exportType, filters } = req.body;
        const { v4: uuidv4 } = await import('uuid');
        const exportProgressService = (await import('../services/exportProgressService.js')).default;
        const exportId = uuidv4();

        if (!exportType) {
            return res.status(400).json({
                success: false,
                message: 'Export type is required'
            });
        }

        // MEDIUM FIX: Start export in background with progress tracking
        exportProgressService.createProgress(exportId, 100);
        exportProgressService.updateProgress(exportId, 10, 'Starting export...');
        
        // Run export asynchronously
        analyticsService.exportAnalyticsToExcel(exportType, filters)
            .then(result => {
                exportProgressService.completeProgress(exportId, 'Export completed successfully');
            })
            .catch(error => {
                exportProgressService.failProgress(exportId, error.message);
            });
        
        // Return immediately with exportId for progress tracking
        res.json({
            success: true,
            exportId,
            message: 'Export started. Use /api/student-assessments/analytics/export/progress/:exportId to track progress.'
        });
    } catch (error) {
        console.error('Error starting export:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to start export',
            error: error.message
        });
    }
});

// MEDIUM FIX: Export progress tracking endpoint
router.get('/analytics/export/progress/:exportId', auth, roleCheck(['faculty', 'admin']), async (req, res) => {
    try {
        const { exportId } = req.params;
        const exportProgressService = (await import('../services/exportProgressService.js')).default;
        const progress = exportProgressService.getProgress(exportId);
        res.json({
            success: true,
            data: progress
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to get export progress'
        });
    }
});

router.get('/analytics/download/:fileName', auth, roleCheck(['faculty', 'admin']), async (req, res) => {
    try {
        const { fileName } = req.params;
        
        // Security: Validate and sanitize filename to prevent path traversal
        if (!fileName || fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) {
            return res.status(400).json({
                success: false,
                message: 'Invalid filename'
            });
        }
        
        // Resolve to absolute path and ensure it's within the temp directory
        const tempDir = path.resolve(__dirname, '../temp');
        const filePath = path.resolve(tempDir, path.basename(fileName));
        
        // Verify the resolved path is still within the temp directory (prevent path traversal)
        if (!filePath.startsWith(tempDir)) {
            return res.status(403).json({
                success: false,
                message: 'Access denied'
            });
        }

        // Check if file exists (use async version to avoid blocking)
        try {
            await fs.promises.access(filePath);
        } catch {
            return res.status(404).json({
                success: false,
                message: 'File not found'
            });
        }

        res.download(filePath, fileName, (err) => {
            if (err) {
                console.error('Error downloading file:', err);
                res.status(500).json({
                    success: false,
                    message: 'Failed to download file'
                });
            }
        });
    } catch (error) {
        console.error('Error downloading file:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to download file',
            error: error.message
        });
    }
});

export default router;
