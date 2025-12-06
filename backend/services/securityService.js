import crypto from 'crypto';
import { pool as db } from '../config/database.js';

class SecurityService {
    constructor() {
        this.algorithm = 'aes-256-gcm';
        this.keyLength = 32; // 256 bits
        this.ivLength = 16; // 128 bits
        this.tagLength = 16; // 128 bits
        this.encryptionKey = this.getEncryptionKey();
    }

    // Get or generate encryption key
    getEncryptionKey() {
        // CRITICAL FIX: Require ENCRYPTION_KEY, never use defaults
        const key = process.env.ENCRYPTION_KEY;
        if (!key) {
            throw new Error('ENCRYPTION_KEY environment variable is required. Please set it in your .env file.');
        }
        return crypto.scryptSync(key, 'salt', this.keyLength);
    }

    // Encrypt sensitive data
    encrypt(data) {
        try {
            if (!data) return null;
            
            const dataString = typeof data === 'string' ? data : JSON.stringify(data);
            const iv = crypto.randomBytes(this.ivLength);
            const cipher = crypto.createCipher(this.algorithm, this.encryptionKey);
            cipher.setAAD(Buffer.from('assessment-data', 'utf8'));
            
            let encrypted = cipher.update(dataString, 'utf8', 'hex');
            encrypted += cipher.final('hex');
            
            const tag = cipher.getAuthTag();
            
            return {
                encrypted: encrypted,
                iv: iv.toString('hex'),
                tag: tag.toString('hex')
            };
        } catch (error) {
            console.error('Encryption error:', error);
            throw new Error('Failed to encrypt data');
        }
    }

    // Decrypt sensitive data
    decrypt(encryptedData) {
        try {
            if (!encryptedData || !encryptedData.encrypted) return null;
            
            const decipher = crypto.createDecipher(this.algorithm, this.encryptionKey);
            decipher.setAAD(Buffer.from('assessment-data', 'utf8'));
            decipher.setAuthTag(Buffer.from(encryptedData.tag, 'hex'));
            
            let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
            decrypted += decipher.final('utf8');
            
            return decrypted;
        } catch (error) {
            console.error('Decryption error:', error);
            throw new Error('Failed to decrypt data');
        }
    }

    // Encrypt student answers
    encryptAnswer(answer, metadata = {}) {
        try {
            const answerData = {
                answer: answer,
                metadata: metadata,
                timestamp: new Date().toISOString(),
                version: 1
            };
            
            return this.encrypt(answerData);
        } catch (error) {
            console.error('Answer encryption error:', error);
            throw error;
        }
    }

    // Decrypt student answers
    decryptAnswer(encryptedAnswer) {
        try {
            const decryptedData = this.decrypt(encryptedAnswer);
            return decryptedData ? JSON.parse(decryptedData) : null;
        } catch (error) {
            console.error('Answer decryption error:', error);
            throw error;
        }
    }

    // Hash sensitive data for integrity checking
    hashData(data) {
        try {
            const dataString = typeof data === 'string' ? data : JSON.stringify(data);
            return crypto.createHash('sha256').update(dataString).digest('hex');
        } catch (error) {
            console.error('Hashing error:', error);
            throw new Error('Failed to hash data');
        }
    }

    // Verify data integrity
    verifyIntegrity(data, hash) {
        try {
            const calculatedHash = this.hashData(data);
            return calculatedHash === hash;
        } catch (error) {
            console.error('Integrity verification error:', error);
            return false;
        }
    }

    // Generate secure session token
    generateSessionToken(userId, sessionData = {}) {
        try {
            const tokenData = {
                userId: userId,
                timestamp: Date.now(),
                sessionId: crypto.randomUUID(),
                ...sessionData
            };
            
            const token = crypto.createHash('sha256')
                .update(JSON.stringify(tokenData))
                .digest('hex');
            
            return {
                token: token,
                sessionId: tokenData.sessionId,
                expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
            };
        } catch (error) {
            console.error('Session token generation error:', error);
            throw new Error('Failed to generate session token');
        }
    }

    // Validate session token
    validateSessionToken(token, userId) {
        try {
            const query = `
                SELECT * FROM user_sessions 
                WHERE token = ? AND user_id = ? AND expires_at > NOW() AND is_active = TRUE
            `;
            
            return db.query(query, [token, userId]);
        } catch (error) {
            console.error('Session validation error:', error);
            return false;
        }
    }

    // Create secure session
    async createSecureSession(userId, sessionData = {}) {
        try {
            const sessionInfo = this.generateSessionToken(userId, sessionData);
            
            const query = `
                INSERT INTO user_sessions 
                (user_id, token, session_id, session_data, created_at, expires_at, is_active)
                VALUES (?, ?, ?, ?, NOW(), ?, TRUE)
            `;
            
            await db.query(query, [
                userId,
                sessionInfo.token,
                sessionInfo.sessionId,
                JSON.stringify(sessionData),
                sessionInfo.expiresAt
            ]);
            
            return sessionInfo;
        } catch (error) {
            console.error('Secure session creation error:', error);
            throw error;
        }
    }

    // Invalidate session
    async invalidateSession(token) {
        try {
            const query = `
                UPDATE user_sessions 
                SET is_active = FALSE, invalidated_at = NOW()
                WHERE token = ?
            `;
            
            await db.query(query, [token]);
            return true;
        } catch (error) {
            console.error('Session invalidation error:', error);
            throw error;
        }
    }

    // Prevent multiple sessions
    async preventMultipleSessions(userId, maxSessions = 1) {
        try {
            const query = `
                SELECT COUNT(*) as active_sessions
                FROM user_sessions 
                WHERE user_id = ? AND is_active = TRUE AND expires_at > NOW()
            `;
            
            const [results] = await db.query(query, [userId]);
            const activeSessions = results[0].active_sessions;
            
            if (activeSessions >= maxSessions) {
                // Invalidate oldest sessions
                const invalidateQuery = `
                    UPDATE user_sessions 
                    SET is_active = FALSE, invalidated_at = NOW()
                    WHERE user_id = ? AND is_active = TRUE
                    ORDER BY created_at ASC
                    LIMIT ?
                `;
                
                await db.query(invalidateQuery, [userId, activeSessions - maxSessions + 1]);
            }
            
            return true;
        } catch (error) {
            console.error('Multiple session prevention error:', error);
            throw error;
        }
    }

    // Advanced browser lockdown
    generateBrowserLockdownScript() {
        return `
            (function() {
                'use strict';
                
                // Disable right-click
                document.addEventListener('contextmenu', function(e) {
                    e.preventDefault();
                    return false;
                });
                
                // Disable F12, Ctrl+Shift+I, etc.
                document.addEventListener('keydown', function(e) {
                    if (e.key === 'F12' || 
                        (e.ctrlKey && e.shiftKey && e.key === 'I') ||
                        (e.ctrlKey && e.shiftKey && e.key === 'C') ||
                        (e.ctrlKey && e.key === 'U') ||
                        (e.ctrlKey && e.key === 'S') ||
                        (e.ctrlKey && e.key === 'A') ||
                        (e.ctrlKey && e.key === 'P')) {
                        e.preventDefault();
                        return false;
                    }
                });
                
                // Disable copy/paste
                document.addEventListener('copy', function(e) {
                    e.preventDefault();
                    return false;
                });
                
                document.addEventListener('paste', function(e) {
                    e.preventDefault();
                    return false;
                });
                
                document.addEventListener('cut', function(e) {
                    e.preventDefault();
                    return false;
                });
                
                // Disable drag and drop
                document.addEventListener('dragstart', function(e) {
                    e.preventDefault();
                    return false;
                });
                
                // Disable text selection
                document.addEventListener('selectstart', function(e) {
                    e.preventDefault();
                    return false;
                });
                
                // Disable print
                window.addEventListener('beforeprint', function(e) {
                    e.preventDefault();
                    return false;
                });
                
                // Disable print screen
                document.addEventListener('keyup', function(e) {
                    if (e.key === 'PrintScreen') {
                        e.preventDefault();
                        return false;
                    }
                });
                
                // Disable developer tools
                let devtools = {open: false, orientation: null};
                const threshold = 160;
                
                setInterval(function() {
                    if (window.outerHeight - window.innerHeight > threshold || 
                        window.outerWidth - window.innerWidth > threshold) {
                        if (!devtools.open) {
                            devtools.open = true;
                            document.body.innerHTML = '<h1>Developer tools detected. Assessment terminated.</h1>';
                        }
                    }
                }, 500);
                
                // Disable tab switching
                document.addEventListener('visibilitychange', function() {
                    if (document.hidden) {
                        document.body.innerHTML = '<h1>Tab switching detected. Assessment terminated.</h1>';
                    }
                });
                
                // Disable window resize
                window.addEventListener('resize', function() {
                    if (window.innerWidth < 1024 || window.innerHeight < 768) {
                        document.body.innerHTML = '<h1>Window size too small. Please resize your browser.</h1>';
                    }
                });
                
                // Disable fullscreen exit
                document.addEventListener('fullscreenchange', function() {
                    if (!document.fullscreenElement) {
                        document.body.innerHTML = '<h1>Fullscreen mode required. Assessment terminated.</h1>';
                    }
                });
                
                // Disable console
                console.log = function() {};
                console.warn = function() {};
                console.error = function() {};
                console.info = function() {};
                console.debug = function() {};
                
                // Disable alert, confirm, prompt
                window.alert = function() {};
                window.confirm = function() { return false; };
                window.prompt = function() { return null; };
                
            })();
        `;
    }

    // Activity monitoring
    generateActivityMonitoringScript() {
        return `
            (function() {
                'use strict';
                
                let activityLog = [];
                let lastActivity = Date.now();
                
                // Track mouse movements
                document.addEventListener('mousemove', function(e) {
                    lastActivity = Date.now();
                    activityLog.push({
                        type: 'mouse_move',
                        timestamp: Date.now(),
                        x: e.clientX,
                        y: e.clientY
                    });
                });
                
                // Track clicks
                document.addEventListener('click', function(e) {
                    lastActivity = Date.now();
                    activityLog.push({
                        type: 'click',
                        timestamp: Date.now(),
                        target: e.target.tagName,
                        x: e.clientX,
                        y: e.clientY
                    });
                });
                
                // Track keyboard activity
                document.addEventListener('keydown', function(e) {
                    lastActivity = Date.now();
                    activityLog.push({
                        type: 'keydown',
                        timestamp: Date.now(),
                        key: e.key,
                        code: e.code
                    });
                });
                
                // Track focus changes
                document.addEventListener('focusin', function(e) {
                    activityLog.push({
                        type: 'focus_in',
                        timestamp: Date.now(),
                        target: e.target.tagName
                    });
                });
                
                document.addEventListener('focusout', function(e) {
                    activityLog.push({
                        type: 'focus_out',
                        timestamp: Date.now(),
                        target: e.target.tagName
                    });
                });
                
                // Track scroll events
                document.addEventListener('scroll', function(e) {
                    activityLog.push({
                        type: 'scroll',
                        timestamp: Date.now(),
                        scrollX: window.scrollX,
                        scrollY: window.scrollY
                    });
                });
                
                // Detect suspicious activity
                setInterval(function() {
                    const now = Date.now();
                    const timeSinceLastActivity = now - lastActivity;
                    
                    if (timeSinceLastActivity > 300000) { // 5 minutes of inactivity
                        activityLog.push({
                            type: 'suspicious_inactivity',
                            timestamp: now,
                            duration: timeSinceLastActivity
                        });
                    }
                    
                    // Send activity log to server
                    if (activityLog.length > 0) {
                        fetch('/api/proctoring/log-activity', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                activities: activityLog,
                                timestamp: now
                            })
                        });
                        
                        activityLog = [];
                    }
                }, 30000); // Send every 30 seconds
                
            })();
        `;
    }

    // Data integrity validation
    async validateDataIntegrity(tableName, recordId) {
        try {
            const query = `
                SELECT * FROM ${tableName} WHERE id = ?
            `;
            
            const [results] = await db.query(query, [recordId]);
            
            if (results.length === 0) {
                return { valid: false, message: 'Record not found' };
            }
            
            const record = results[0];
            const calculatedHash = this.hashData(record);
            
            // Check if hash exists in integrity table
            const integrityQuery = `
                SELECT hash FROM data_integrity 
                WHERE table_name = ? AND record_id = ?
            `;
            
            const [integrityResults] = await db.query(integrityQuery, [tableName, recordId]);
            
            if (integrityResults.length === 0) {
                // Create new integrity record
                await this.createIntegrityRecord(tableName, recordId, calculatedHash);
                return { valid: true, message: 'Integrity record created' };
            }
            
            const storedHash = integrityResults[0].hash;
            const isValid = calculatedHash === storedHash;
            
            return {
                valid: isValid,
                message: isValid ? 'Data integrity verified' : 'Data integrity violation detected',
                calculatedHash: calculatedHash,
                storedHash: storedHash
            };
        } catch (error) {
            console.error('Data integrity validation error:', error);
            throw error;
        }
    }

    // Create integrity record
    async createIntegrityRecord(tableName, recordId, hash) {
        try {
            const query = `
                INSERT INTO data_integrity 
                (table_name, record_id, hash, created_at)
                VALUES (?, ?, ?, NOW())
                ON CONFLICT (table_name, record_id) DO UPDATE SET
                hash = EXCLUDED.hash,
                updated_at = NOW()
            `;
            
            await db.query(query, [tableName, recordId, hash]);
        } catch (error) {
            console.error('Integrity record creation error:', error);
            throw error;
        }
    }

    // Role-based access control
    async checkAccess(userId, resource, action) {
        try {
            const query = `
                SELECT r.name as role_name, p.resource, p.action, p.allowed
                FROM users u
                JOIN roles r ON u.role = r.name
                JOIN role_permissions rp ON r.id = rp.role_id
                JOIN permissions p ON rp.permission_id = p.id
                WHERE u.id = ? AND p.resource = ? AND p.action = ?
            `;
            
            const [results] = await db.query(query, [userId, resource, action]);
            
            if (results.length === 0) {
                return { allowed: false, message: 'Permission not found' };
            }
            
            const permission = results[0];
            return {
                allowed: permission.allowed,
                message: permission.allowed ? 'Access granted' : 'Access denied',
                role: permission.role_name
            };
        } catch (error) {
            console.error('Access control check error:', error);
            throw error;
        }
    }

    // Audit logging
    async logSecurityEvent(userId, event, details = {}) {
        try {
            const query = `
                INSERT INTO security_audit_log 
                (user_id, event_type, event_details, ip_address, user_agent, timestamp)
                VALUES (?, ?, ?, ?, ?, NOW())
            `;
            
            await db.query(query, [
                userId,
                event,
                JSON.stringify(details),
                details.ipAddress || null,
                details.userAgent || null
            ]);
        } catch (error) {
            console.error('Security audit logging error:', error);
            throw error;
        }
    }

    // Generate secure random string
    generateSecureRandom(length = 32) {
        return crypto.randomBytes(length).toString('hex');
    }

    // Generate secure password hash
    hashPassword(password, salt = null) {
        const actualSalt = salt || crypto.randomBytes(16).toString('hex');
        const hash = crypto.pbkdf2Sync(password, actualSalt, 10000, 64, 'sha512').toString('hex');
        return `${actualSalt}:${hash}`;
    }

    // Verify password
    verifyPassword(password, hashedPassword) {
        try {
            const [salt, hash] = hashedPassword.split(':');
            const testHash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
            return hash === testHash;
        } catch (error) {
            console.error('Password verification error:', error);
            return false;
        }
    }
}

export default new SecurityService();
