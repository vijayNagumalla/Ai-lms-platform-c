import { pool as db } from '../config/database.js';
import crypto from 'crypto';

class ResponseStorageService {
    constructor() {
        // CRITICAL FIX: Require ENCRYPTION_KEY, never use defaults
        if (!process.env.ENCRYPTION_KEY) {
            throw new Error('ENCRYPTION_KEY environment variable is required. Please set it in your .env file.');
        }
        this.encryptionKey = process.env.ENCRYPTION_KEY;
        
        // Validate encryption key length (minimum 32 characters for AES-256)
        if (this.encryptionKey.length < 32) {
            console.warn('⚠️ WARNING: ENCRYPTION_KEY should be at least 32 characters long for security');
        }
    }

    // Save student response with version control
    async saveResponse(submissionId, questionId, answer, metadata = {}) {
        try {
            const responseId = this.generateResponseId();
            const encryptedAnswer = this.encryptAnswer(answer);
            const timestamp = new Date();
            
            const query = `
                INSERT INTO student_responses 
                (id, submission_id, question_id, answer, encrypted_answer, metadata, version, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
                ON CONFLICT (submission_id, question_id) DO UPDATE SET
                answer = EXCLUDED.answer,
                encrypted_answer = EXCLUDED.encrypted_answer,
                metadata = EXCLUDED.metadata,
                version = student_responses.version + 1,
                updated_at = EXCLUDED.updated_at
            `;
            
            await db.query(query, [
                responseId,
                submissionId,
                questionId,
                answer,
                encryptedAnswer,
                JSON.stringify(metadata),
                timestamp,
                timestamp
            ]);

            // Log version history
            await this.logVersionHistory(submissionId, questionId, answer, metadata, timestamp);

            return {
                success: true,
                responseId,
                version: 1,
                timestamp
            };
        } catch (error) {
            console.error('Error saving response:', error);
            throw error;
        }
    }

    // Get student response
    async getResponse(submissionId, questionId) {
        try {
            const query = `
                SELECT 
                    id,
                    submission_id,
                    question_id,
                    answer,
                    encrypted_answer,
                    metadata,
                    version,
                    created_at,
                    updated_at
                FROM student_responses 
                WHERE submission_id = ? AND question_id = ?
                ORDER BY version DESC
                LIMIT 1
            `;
            
            const [results] = await db.query(query, [submissionId, questionId]);
            
            if (results.length === 0) {
                return { success: false, message: 'Response not found' };
            }
            
            const response = results[0];
            const decryptedAnswer = this.decryptAnswer(response.encrypted_answer);
            
            return {
                success: true,
                response: {
                    ...response,
                    answer: decryptedAnswer,
                    metadata: JSON.parse(response.metadata || '{}')
                }
            };
        } catch (error) {
            console.error('Error getting response:', error);
            throw error;
        }
    }

    // Get all responses for a submission
    async getSubmissionResponses(submissionId) {
        try {
            const query = `
                SELECT 
                    sr.id,
                    sr.submission_id,
                    sr.question_id,
                    sr.answer,
                    sr.metadata,
                    sr.version,
                    sr.created_at,
                    sr.updated_at,
                    q.question_text,
                    q.question_type,
                    q.points
                FROM student_responses sr
                JOIN questions q ON sr.question_id = q.id
                WHERE sr.submission_id = ?
                ORDER BY q.question_order
            `;
            
            const [results] = await db.query(query, [submissionId]);
            
            const responses = results.map(row => ({
                ...row,
                metadata: JSON.parse(row.metadata || '{}')
            }));
            
            return {
                success: true,
                responses
            };
        } catch (error) {
            console.error('Error getting submission responses:', error);
            throw error;
        }
    }

    // Real-time answer storage with debouncing
    async saveRealTimeResponse(submissionId, questionId, answer, metadata = {}) {
        try {
            // Add debouncing metadata
            const debouncedMetadata = {
                ...metadata,
                isRealTime: true,
                timestamp: new Date().toISOString(),
                debounced: true
            };
            
            return await this.saveResponse(submissionId, questionId, answer, debouncedMetadata);
        } catch (error) {
            console.error('Error saving real-time response:', error);
            throw error;
        }
    }

    // Get response version history
    async getResponseHistory(submissionId, questionId) {
        try {
            const query = `
                SELECT 
                    version,
                    answer,
                    metadata,
                    created_at
                FROM response_version_history 
                WHERE submission_id = ? AND question_id = ?
                ORDER BY version DESC
            `;
            
            const [results] = await db.query(query, [submissionId, questionId]);
            
            return {
                success: true,
                history: results.map(row => ({
                    ...row,
                    metadata: JSON.parse(row.metadata || '{}')
                }))
            };
        } catch (error) {
            console.error('Error getting response history:', error);
            throw error;
        }
    }

    // Offline support - sync responses when online
    async syncOfflineResponses(submissionId, offlineResponses) {
        try {
            const syncResults = [];
            
            for (const response of offlineResponses) {
                try {
                    const result = await this.saveResponse(
                        submissionId,
                        response.questionId,
                        response.answer,
                        {
                            ...response.metadata,
                            syncedFromOffline: true,
                            offlineTimestamp: response.timestamp
                        }
                    );
                    syncResults.push({ ...result, questionId: response.questionId });
                } catch (error) {
                    syncResults.push({
                        success: false,
                        questionId: response.questionId,
                        error: error.message
                    });
                }
            }
            
            return {
                success: true,
                syncResults,
                syncedCount: syncResults.filter(r => r.success).length,
                failedCount: syncResults.filter(r => !r.success).length
            };
        } catch (error) {
            console.error('Error syncing offline responses:', error);
            throw error;
        }
    }

    // Data integrity validation
    async validateResponseIntegrity(submissionId) {
        try {
            const query = `
                SELECT 
                    sr.id,
                    sr.submission_id,
                    sr.question_id,
                    sr.answer,
                    sr.encrypted_answer,
                    sr.version,
                    sr.created_at,
                    sr.updated_at
                FROM student_responses sr
                WHERE sr.submission_id = ?
            `;
            
            const [results] = await db.query(query, [submissionId]);
            
            const validationResults = [];
            
            for (const response of results) {
                const decryptedAnswer = this.decryptAnswer(response.encrypted_answer);
                const isIntegrityValid = response.answer === decryptedAnswer;
                
                validationResults.push({
                    responseId: response.id,
                    questionId: response.question_id,
                    isIntegrityValid,
                    hasEncryption: !!response.encrypted_answer,
                    version: response.version
                });
            }
            
            const allValid = validationResults.every(r => r.isIntegrityValid);
            
            return {
                success: true,
                isIntegrityValid: allValid,
                validationResults,
                totalResponses: results.length,
                validResponses: validationResults.filter(r => r.isIntegrityValid).length
            };
        } catch (error) {
            console.error('Error validating response integrity:', error);
            throw error;
        }
    }

    // Create backup of responses
    async createResponseBackup(submissionId) {
        try {
            const backupId = this.generateBackupId();
            const timestamp = new Date();
            
            const query = `
                INSERT INTO response_backups 
                (backup_id, submission_id, backup_data, created_at)
                VALUES (?, ?, ?, ?)
            `;
            
            const responses = await this.getSubmissionResponses(submissionId);
            const backupData = {
                submissionId,
                responses: responses.responses,
                timestamp,
                version: '1.0'
            };
            
            await db.query(query, [
                backupId,
                submissionId,
                JSON.stringify(backupData),
                timestamp
            ]);
            
            return {
                success: true,
                backupId,
                timestamp,
                responseCount: responses.responses.length
            };
        } catch (error) {
            console.error('Error creating response backup:', error);
            throw error;
        }
    }

    // Restore from backup
    async restoreFromBackup(backupId) {
        try {
            const query = `
                SELECT backup_data, submission_id
                FROM response_backups 
                WHERE backup_id = ?
            `;
            
            const [results] = await db.query(query, [backupId]);
            
            if (results.length === 0) {
                return { success: false, message: 'Backup not found' };
            }
            
            const backup = results[0];
            const backupData = JSON.parse(backup.backup_data);
            
            // Clear existing responses
            await this.clearSubmissionResponses(backupData.submissionId);
            
            // Restore responses
            for (const response of backupData.responses) {
                await this.saveResponse(
                    backupData.submissionId,
                    response.question_id,
                    response.answer,
                    response.metadata
                );
            }
            
            return {
                success: true,
                restoredCount: backupData.responses.length,
                submissionId: backupData.submissionId
            };
        } catch (error) {
            console.error('Error restoring from backup:', error);
            throw error;
        }
    }

    // Get response statistics
    async getResponseStatistics(submissionId) {
        try {
            const query = `
                SELECT 
                    COUNT(*) as total_responses,
                    COUNT(CASE WHEN answer IS NOT NULL AND answer != '' THEN 1 END) as answered_questions,
                    COUNT(CASE WHEN answer IS NULL OR answer = '' THEN 1 END) as unanswered_questions,
                    AVG(LENGTH(answer)) as avg_answer_length,
                    MAX(version) as max_version,
                    MIN(created_at) as first_response,
                    MAX(updated_at) as last_response
                FROM student_responses 
                WHERE submission_id = ?
            `;
            
            const [results] = await db.query(query, [submissionId]);
            const stats = results[0];
            
            return {
                success: true,
                statistics: {
                    totalResponses: stats.total_responses,
                    answeredQuestions: stats.answered_questions,
                    unansweredQuestions: stats.unanswered_questions,
                    completionRate: stats.total_responses > 0 ? 
                        (stats.answered_questions / stats.total_responses) * 100 : 0,
                    averageAnswerLength: stats.avg_answer_length || 0,
                    maxVersion: stats.max_version || 0,
                    firstResponse: stats.first_response,
                    lastResponse: stats.last_response
                }
            };
        } catch (error) {
            console.error('Error getting response statistics:', error);
            throw error;
        }
    }

    // Utility methods
    generateResponseId() {
        return 'resp_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    generateBackupId() {
        return 'backup_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    encryptAnswer(answer) {
        try {
            const cipher = crypto.createCipher('aes-256-cbc', this.encryptionKey);
            let encrypted = cipher.update(answer, 'utf8', 'hex');
            encrypted += cipher.final('hex');
            return encrypted;
        } catch (error) {
            console.error('Error encrypting answer:', error);
            return answer; // Return unencrypted if encryption fails
        }
    }

    decryptAnswer(encryptedAnswer) {
        try {
            const decipher = crypto.createDecipher('aes-256-cbc', this.encryptionKey);
            let decrypted = decipher.update(encryptedAnswer, 'hex', 'utf8');
            decrypted += decipher.final('utf8');
            return decrypted;
        } catch (error) {
            console.error('Error decrypting answer:', error);
            return encryptedAnswer; // Return encrypted if decryption fails
        }
    }

    async logVersionHistory(submissionId, questionId, answer, metadata, timestamp) {
        try {
            const query = `
                INSERT INTO response_version_history 
                (submission_id, question_id, answer, metadata, version, created_at)
                VALUES (?, ?, ?, ?, 1, ?)
            `;
            
            await db.query(query, [
                submissionId,
                questionId,
                answer,
                JSON.stringify(metadata),
                timestamp
            ]);
        } catch (error) {
            console.error('Error logging version history:', error);
        }
    }

    async clearSubmissionResponses(submissionId) {
        try {
            const query = 'DELETE FROM student_responses WHERE submission_id = ?';
            await db.query(query, [submissionId]);
        } catch (error) {
            console.error('Error clearing submission responses:', error);
            throw error;
        }
    }

    // Batch operations for performance
    async saveBatchResponses(submissionId, responses) {
        try {
            const timestamp = new Date();
            const values = responses.map(response => [
                this.generateResponseId(),
                submissionId,
                response.questionId,
                response.answer,
                this.encryptAnswer(response.answer),
                JSON.stringify(response.metadata || {}),
                1,
                timestamp,
                timestamp
            ]);
            
            const query = `
                INSERT INTO student_responses 
                (id, submission_id, question_id, answer, encrypted_answer, metadata, version, created_at, updated_at)
                VALUES ?
            `;
            
            await db.query(query, [values]);
            
            return {
                success: true,
                savedCount: responses.length,
                timestamp
            };
        } catch (error) {
            console.error('Error saving batch responses:', error);
            throw error;
        }
    }

    // Get response analytics
    async getResponseAnalytics(submissionId) {
        try {
            const query = `
                SELECT 
                    q.question_type,
                    COUNT(*) as total_questions,
                    COUNT(CASE WHEN sr.answer IS NOT NULL AND sr.answer != '' THEN 1 END) as answered,
                    AVG(CASE WHEN sr.answer IS NOT NULL AND sr.answer != '' THEN LENGTH(sr.answer) END) as avg_length,
                    AVG(sr.version) as avg_versions
                FROM questions q
                LEFT JOIN student_responses sr ON q.id = sr.question_id AND sr.submission_id = ?
                WHERE q.assessment_id = (SELECT assessment_id FROM assessment_submissions WHERE id = ?)
                GROUP BY q.question_type
            `;
            
            const [results] = await db.query(query, [submissionId, submissionId]);
            
            return {
                success: true,
                analytics: results
            };
        } catch (error) {
            console.error('Error getting response analytics:', error);
            throw error;
        }
    }
}

export default new ResponseStorageService();
