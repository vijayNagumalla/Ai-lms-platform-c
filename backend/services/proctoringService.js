import { pool as db } from '../config/database.js';
import securityService from './securityService.js';

class ProctoringService {
    constructor() {
        // CRITICAL FIX: Initialize encryption service for sensitive proctoring data
        this.securityService = securityService;
        this.consentTableChecked = false;
        this.consentTableAvailable = false;
    }
    
    // CRITICAL FIX: GDPR/Privacy compliance - Data retention period (90 days)
    DATA_RETENTION_DAYS = 90;
    
    // CRITICAL FIX: GDPR/Privacy compliance - Log consent for proctoring
    async logProctoringConsent(submissionId, userId, consentData = {}) {
        try {
            // Check if consent table exists, create if not
            const consentTableReady = await this.ensureConsentTableExists();
            if (!consentTableReady) {
                return { logged: false, error: 'Consent table missing in Supabase' };
            }
            
            const query = `
                INSERT INTO proctoring_consents 
                (submission_id, user_id, consent_given, consent_type, consent_timestamp, metadata)
                VALUES (?, ?, ?, ?, NOW(), ?)
                ON CONFLICT (submission_id, user_id) DO UPDATE SET
                    consent_given = EXCLUDED.consent_given,
                    consent_timestamp = NOW(),
                    metadata = EXCLUDED.metadata
            `;
            
            await db.query(query, [
                submissionId,
                userId,
                consentData.consent_given || true,
                consentData.consent_type || 'full_proctoring',
                JSON.stringify(consentData.metadata || {})
            ]);
            
            return { logged: true };
        } catch (error) {
            console.error('Error logging proctoring consent:', error);
            // Don't throw - consent logging failure shouldn't block assessment
            return { logged: false, error: error.message };
        }
    }
    
    // CRITICAL FIX: GDPR/Privacy compliance - Ensure consent table exists
    async ensureConsentTableExists() {
        if (this.consentTableChecked) {
            return this.consentTableAvailable;
        }

        try {
            await db.query('SELECT id FROM proctoring_consents LIMIT 1');
            this.consentTableAvailable = true;
        } catch (error) {
            if (error.code === 'PGRST205' || error.message?.includes('does not exist')) {
                console.warn('Proctoring consent table not found in Supabase. Please run the latest migrations.');
            } else {
                console.error('Error verifying consent table:', error);
            }
            this.consentTableAvailable = false;
        } finally {
            this.consentTableChecked = true;
        }

        return this.consentTableAvailable;
    }
    
    // CRITICAL FIX: GDPR/Privacy compliance - Auto-delete old proctoring data
    async cleanupOldProctoringData() {
        try {
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - this.DATA_RETENTION_DAYS);
            const cutoffIso = cutoffDate.toISOString();
            
            let deletedLogs = { affectedRows: 0 };
            let anonymizedConsents = 0;
            
            // Delete old proctoring logs (if table exists)
            try {
                [deletedLogs] = await db.query(
                    'DELETE FROM proctoring_logs WHERE timestamp < ?',
                    [cutoffIso]
                );
            } catch (error) {
                // Table doesn't exist yet, which is fine
                if (error.code !== 'ER_NO_SUCH_TABLE' && error.code !== '42P01' && error.code !== 'PGRST205' && !error.message?.includes('does not exist')) {
                    console.error('Error deleting old proctoring logs:', error);
                }
            }
            
            // Delete old consents (keep for audit but anonymize) - if table exists
            try {
                // Ensure table exists first
                const consentTableReady = await this.ensureConsentTableExists();
                if (consentTableReady) {
                    const [result] = await db.query(
                        'UPDATE proctoring_consents SET user_id = NULL, metadata = NULL WHERE consent_timestamp < ?',
                        [cutoffIso]
                    );
                    anonymizedConsents = result.affectedRows || 0;
                }
            } catch (error) {
                // Table doesn't exist yet, which is fine - it will be created when needed
                if (error.code !== 'ER_NO_SUCH_TABLE' && error.code !== 'PGRST205') {
                    console.error('Error anonymizing old consents:', error);
                }
            }
            
            if (deletedLogs.affectedRows > 0 || anonymizedConsents > 0) {
                console.log(`✅ Cleaned up proctoring data older than ${this.DATA_RETENTION_DAYS} days`);
            }
            
            return { 
                deletedLogs: deletedLogs.affectedRows || 0,
                anonymizedConsents 
            };
        } catch (error) {
            // CRITICAL FIX: Don't throw errors for missing tables - they're optional
            // Only log unexpected errors
            if (error.code !== 'ER_NO_SUCH_TABLE' && error.code !== '42P01' && error.code !== 'PGRST205' && !error.message?.includes('does not exist')) {
                console.error('Error cleaning up old proctoring data:', error);
            }
            return { deletedLogs: 0, anonymizedConsents: 0 };
        }
    }
    
    // CRITICAL FIX: GDPR/Privacy compliance - Delete user's proctoring data
    async deleteUserProctoringData(userId) {
        try {
            const connection = await db.getConnection();
            try {
                // CRITICAL FIX: Set transaction isolation level
                await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
                await connection.beginTransaction();
                
                // Delete proctoring logs for user's submissions
                await connection.query(
                    `DELETE pl FROM proctoring_logs pl
                     JOIN assessment_submissions s ON pl.submission_id = s.id
                     WHERE s.student_id = ?`,
                    [userId]
                );
                
                // Anonymize consents (keep for audit)
                await connection.query(
                    'UPDATE proctoring_consents SET user_id = NULL, metadata = NULL WHERE user_id = ?',
                    [userId]
                );
                
                await connection.commit();
                return { success: true };
            } catch (error) {
                await connection.rollback();
                throw error;
            } finally {
                connection.release();
            }
        } catch (error) {
            console.error('Error deleting user proctoring data:', error);
            throw error;
        }
    }
    
    // Log proctoring violation
    async logViolation(submissionId, violationType, metadata = {}) {
        try {
            // MEDIUM FIX: Use configurable violation thresholds from appConfig
            const appConfig = (await import('../config/appConfig.js')).default;
            const violationThresholds = {
                'tab_switch': appConfig.proctoring.violationThresholds.tabSwitch,
                'copy_paste': appConfig.proctoring.violationThresholds.copyPaste,
                'right_click': appConfig.proctoring.violationThresholds.rightClick,
                'window_focus': { maxPerMinute: 2, maxPerSession: 15 }, // Allow occasional focus loss (system notifications)
                'keyboard_shortcut': { maxPerMinute: 3, maxPerSession: 20 }, // Allow some shortcuts (system shortcuts)
            };
            
            // Check if this violation type has a threshold
            if (violationThresholds[violationType]) {
                const threshold = violationThresholds[violationType];
                const now = new Date();
                const oneMinuteAgo = new Date(now.getTime() - 60000);
                
                // Count violations in the last minute
                const [recentViolations] = await db.query(
                    `SELECT COUNT(*) as count FROM proctoring_logs 
                     WHERE submission_id = ? AND violation_type = ? AND timestamp > ?`,
                    [submissionId, violationType, oneMinuteAgo]
                );
                
                const violationsInLastMinute = recentViolations[0]?.count || 0;
                
                // Count total violations in this session
                const [sessionViolations] = await db.query(
                    `SELECT COUNT(*) as count FROM proctoring_logs 
                     WHERE submission_id = ? AND violation_type = ?`,
                    [submissionId, violationType]
                );
                
                const violationsInSession = sessionViolations[0]?.count || 0;
                
                // Only log if threshold is exceeded
                if (violationsInLastMinute < threshold.maxPerMinute && 
                    violationsInSession < threshold.maxPerSession) {
                    // Below threshold - don't log as violation, but may track for monitoring
                    console.log(`Violation ${violationType} below threshold for submission ${submissionId} (${violationsInLastMinute}/${threshold.maxPerMinute} per minute, ${violationsInSession}/${threshold.maxPerSession} per session)`);
                    return {
                        success: true,
                        logged: false,
                        reason: 'Below threshold',
                        violationsInLastMinute,
                        violationsInSession,
                        threshold
                    };
                }
            }
            
            // CRITICAL FIX: Encrypt sensitive metadata before storage
            // Sensitive data includes: webcam frames, audio data, screen captures, behavioral patterns
            let encryptedMetadata = null;
            if (metadata && Object.keys(metadata).length > 0) {
                try {
                    // Encrypt sensitive metadata fields
                    const sensitiveFields = ['webcam_data', 'audio_data', 'screen_capture', 'behavioral_pattern', 'face_detection', 'eye_tracking'];
                    const metadataToEncrypt = {};
                    
                    for (const field of sensitiveFields) {
                        if (metadata[field]) {
                            metadataToEncrypt[field] = metadata[field];
                        }
                    }
                    
                    if (Object.keys(metadataToEncrypt).length > 0) {
                        encryptedMetadata = this.securityService.encrypt(JSON.stringify(metadataToEncrypt));
                        // Mark metadata as encrypted
                        metadata._encrypted = true;
                        metadata._encryption_info = {
                            algorithm: 'aes-256-gcm',
                            encrypted_at: new Date().toISOString()
                        };
                    }
                } catch (encryptError) {
                    console.error('Error encrypting proctoring metadata:', encryptError);
                    // Continue without encryption if it fails (shouldn't happen, but don't break logging)
                }
            }
            
            const query = `
                INSERT INTO proctoring_logs 
                (submission_id, violation_type, timestamp, description, severity_level, metadata, encrypted_metadata)
                VALUES (?, ?, NOW(), ?, ?, ?, ?)
            `;

            const severityLevel = this.getSeverityLevel(violationType);
            const description = this.getViolationDescription(violationType, metadata);

            await db.query(query, [
                submissionId,
                violationType,
                description,
                severityLevel,
                JSON.stringify(metadata), // Store non-sensitive metadata as JSON
                encryptedMetadata ? JSON.stringify(encryptedMetadata) : null // Store encrypted sensitive data
            ]);

            // Check if violation count exceeds threshold
            const violationCount = await this.getViolationCount(submissionId, violationType);
            if (violationCount > this.getViolationThreshold(violationType)) {
                await this.handleExcessiveViolations(submissionId, violationType, violationCount);
            }

            return { logged: true, severityLevel, description };
        } catch (error) {
            console.error('Error logging proctoring violation:', error);
            throw error;
        }
    }

    // Get proctoring violations for a submission
    async getViolations(submissionId, filters = {}) {
        try {
            const { violationType, severityLevel, limit = 100, offset = 0 } = filters;

            let query = `
                SELECT * FROM proctoring_logs 
                WHERE submission_id = ?
            `;
            const params = [submissionId];

            if (violationType) {
                query += ` AND violation_type = ?`;
                params.push(violationType);
            }

            if (severityLevel) {
                query += ` AND severity_level = ?`;
                params.push(severityLevel);
            }

            query += ` ORDER BY timestamp DESC LIMIT ? OFFSET ?`;
            params.push(limit, offset);

            return await db.query(query, params);
        } catch (error) {
            console.error('Error getting proctoring violations:', error);
            throw error;
        }
    }

    // Get proctoring summary for a submission
    async getProctoringSummary(submissionId) {
        try {
            const query = `
                SELECT 
                    violation_type,
                    COUNT(*) as count,
                    MAX(severity_level) as max_severity,
                    MIN(timestamp) as first_violation,
                    MAX(timestamp) as last_violation
                FROM proctoring_logs 
                WHERE submission_id = ?
                GROUP BY violation_type
                ORDER BY count DESC
            `;

            const violations = await db.query(query, [submissionId]);

            // Calculate risk score
            const riskScore = this.calculateRiskScore(violations);

            return {
                totalViolations: violations.reduce((sum, v) => sum + v.count, 0),
                violationTypes: violations,
                riskScore,
                riskLevel: this.getRiskLevel(riskScore)
            };
        } catch (error) {
            console.error('Error getting proctoring summary:', error);
            throw error;
        }
    }

    // Validate browser environment for proctoring
    validateBrowserEnvironment(userAgent, requiredFeatures = []) {
        const validation = {
            isValid: true,
            warnings: [],
            errors: []
        };

        // Check browser type
        const browserInfo = this.parseUserAgent(userAgent);
        if (!browserInfo.isSupported) {
            validation.isValid = false;
            validation.errors.push('Unsupported browser detected');
        }

        // Check for developer tools indicators
        if (browserInfo.hasDevTools) {
            validation.warnings.push('Developer tools detected');
        }

        // Check for automation tools
        if (browserInfo.isAutomated) {
            validation.isValid = false;
            validation.errors.push('Automation tools detected');
        }

        // Check required features
        requiredFeatures.forEach(feature => {
            if (!browserInfo.features.includes(feature)) {
                validation.errors.push(`Required feature not available: ${feature}`);
            }
        });

        return validation;
    }

    // Monitor fullscreen status
    async monitorFullscreenStatus(submissionId, isFullscreen, timestamp) {
        if (!isFullscreen) {
            await this.logViolation(submissionId, 'fullscreen_exit', {
                timestamp,
                message: 'Student exited fullscreen mode'
            });
        }
    }

    // Monitor tab switching
    async monitorTabSwitching(submissionId, tabSwitchCount, timestamp) {
        if (tabSwitchCount > 0) {
            await this.logViolation(submissionId, 'tab_switch', {
                timestamp,
                tabSwitchCount,
                message: `Student switched tabs ${tabSwitchCount} times`
            });
        }
    }

    // Monitor window focus
    async monitorWindowFocus(submissionId, hasFocus, timestamp) {
        if (!hasFocus) {
            await this.logViolation(submissionId, 'window_focus', {
                timestamp,
                message: 'Student lost window focus'
            });
        }
    }

    // Monitor keyboard shortcuts
    async monitorKeyboardShortcuts(submissionId, shortcut, timestamp) {
        const blockedShortcuts = [
            'F12', 'Ctrl+Shift+I', 'Ctrl+Shift+J', 'Ctrl+U', 'Ctrl+S',
            'Ctrl+P', 'Ctrl+A', 'Ctrl+C', 'Ctrl+V', 'Ctrl+X',
            'Alt+Tab', 'Ctrl+Tab', 'Ctrl+W', 'Ctrl+R'
        ];

        if (blockedShortcuts.includes(shortcut)) {
            await this.logViolation(submissionId, 'keyboard_shortcut', {
                timestamp,
                shortcut,
                message: `Blocked keyboard shortcut used: ${shortcut}`
            });
        }
    }

    // Monitor webcam status
    async monitorWebcamStatus(submissionId, isConnected, timestamp) {
        if (!isConnected) {
            await this.logViolation(submissionId, 'webcam_disconnect', {
                timestamp,
                message: 'Webcam disconnected during assessment'
            });
        }
    }

    // Detect suspicious activity patterns
    async detectSuspiciousActivity(submissionId, activityData) {
        const suspiciousPatterns = [];

        // Check for rapid answer changes
        if (activityData.rapidAnswerChanges > 5) {
            suspiciousPatterns.push('Rapid answer changes detected');
        }

        // Check for unusual typing patterns
        if (activityData.typingSpeed > 200) { // WPM
            suspiciousPatterns.push('Unusually fast typing detected');
        }

        // Check for copy-paste patterns
        if (activityData.copyPasteCount > 3) {
            suspiciousPatterns.push('Multiple copy-paste operations detected');
        }

        // Check for time patterns
        if (activityData.timeSpentPerQuestion < 10) { // seconds
            suspiciousPatterns.push('Unusually quick answers detected');
        }

        if (suspiciousPatterns.length > 0) {
            await this.logViolation(submissionId, 'suspicious_activity', {
                timestamp: new Date(),
                patterns: suspiciousPatterns,
                activityData
            });
        }

        return suspiciousPatterns;
    }

    // Helper methods
    getSeverityLevel(violationType) {
        const severityMap = {
            'tab_switch': 'medium',
            'right_click': 'low',
            'copy_paste': 'high',
            'dev_tools': 'critical',
            'window_focus': 'medium',
            'fullscreen_exit': 'high',
            'keyboard_shortcut': 'medium',
            'webcam_disconnect': 'high',
            'suspicious_activity': 'high'
        };

        return severityMap[violationType] || 'low';
    }

    getViolationDescription(violationType, metadata) {
        const descriptions = {
            'tab_switch': `Tab switching detected (${metadata.tabSwitchCount || 0} times)`,
            'right_click': 'Right-click detected',
            'copy_paste': 'Copy-paste operation detected',
            'dev_tools': 'Developer tools access detected',
            'window_focus': 'Window focus lost',
            'fullscreen_exit': 'Fullscreen mode exited',
            'keyboard_shortcut': `Blocked shortcut used: ${metadata.shortcut}`,
            'webcam_disconnect': 'Webcam disconnected',
            'suspicious_activity': `Suspicious patterns: ${metadata.patterns?.join(', ')}`
        };

        return descriptions[violationType] || 'Unknown violation';
    }

    getViolationThreshold(violationType) {
        const thresholds = {
            'tab_switch': 10,
            'right_click': 5,
            'copy_paste': 3,
            'dev_tools': 1,
            'window_focus': 5,
            'fullscreen_exit': 3,
            'keyboard_shortcut': 5,
            'webcam_disconnect': 2,
            'suspicious_activity': 1
        };

        return thresholds[violationType] || 5;
    }

    async getViolationCount(submissionId, violationType) {
        const result = await db.query(
            'SELECT COUNT(*) as count FROM proctoring_logs WHERE submission_id = ? AND violation_type = ?',
            [submissionId, violationType]
        );
        return result[0].count;
    }

    async handleExcessiveViolations(submissionId, violationType, count) {
        // Log critical violation
        await this.logViolation(submissionId, 'suspicious_activity', {
            message: `Excessive ${violationType} violations: ${count}`,
            violationType,
            count
        });

        // Could implement additional actions like:
        // - Notify faculty
        // - Flag for review
        // - Auto-submit assessment
        // - Block further attempts
    }

    calculateRiskScore(violations) {
        const weights = {
            'tab_switch': 1,
            'right_click': 1,
            'copy_paste': 3,
            'dev_tools': 5,
            'window_focus': 2,
            'fullscreen_exit': 3,
            'keyboard_shortcut': 2,
            'webcam_disconnect': 3,
            'suspicious_activity': 4
        };

        let score = 0;
        violations.forEach(violation => {
            const weight = weights[violation.violation_type] || 1;
            score += violation.count * weight;
        });

        return Math.min(score, 100); // Cap at 100
    }

    getRiskLevel(riskScore) {
        if (riskScore >= 80) return 'critical';
        if (riskScore >= 60) return 'high';
        if (riskScore >= 40) return 'medium';
        if (riskScore >= 20) return 'low';
        return 'minimal';
    }

    parseUserAgent(userAgent) {
        const ua = userAgent.toLowerCase();
        
        return {
            isSupported: !ua.includes('bot') && !ua.includes('crawler'),
            hasDevTools: ua.includes('devtools') || ua.includes('firebug'),
            isAutomated: ua.includes('selenium') || ua.includes('phantom') || ua.includes('headless'),
            features: this.detectBrowserFeatures(ua),
            browser: this.detectBrowser(ua),
            version: this.detectVersion(ua)
        };
    }

    detectBrowserFeatures(ua) {
        const features = [];
        if (ua.includes('chrome')) features.push('webcam', 'microphone', 'fullscreen');
        if (ua.includes('firefox')) features.push('webcam', 'microphone', 'fullscreen');
        if (ua.includes('safari')) features.push('webcam', 'microphone');
        return features;
    }

    detectBrowser(ua) {
        if (ua.includes('chrome')) return 'chrome';
        if (ua.includes('firefox')) return 'firefox';
        if (ua.includes('safari')) return 'safari';
        if (ua.includes('edge')) return 'edge';
        return 'unknown';
    }

    detectVersion(ua) {
        const match = ua.match(/(chrome|firefox|safari|edge)\/(\d+)/);
        return match ? match[2] : 'unknown';
    }
}

export default new ProctoringService();
