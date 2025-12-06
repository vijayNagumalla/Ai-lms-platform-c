import { pool as db } from '../config/database.js';
import crypto from 'crypto';

class AccessControlService {
    // Validate password for password-protected assessments
    async validateAssessmentPassword(assessmentId, password) {
        try {
            const query = `
                SELECT password_protected, access_password 
                FROM assessments 
                WHERE id = ? AND is_published = true
            `;
            const [results] = await db.execute(query, [assessmentId]);
            
            if (results.length === 0) {
                return { success: false, message: 'Assessment not found' };
            }
            
            const assessment = results[0];
            
            if (!assessment.password_protected) {
                return { success: true, message: 'Assessment not password protected' };
            }
            
            if (!assessment.access_password) {
                return { success: false, message: 'Assessment password not set' };
            }
            
            // Compare hashed passwords
            const isValid = await this.comparePassword(password, assessment.access_password);
            
            return {
                success: isValid,
                message: isValid ? 'Password validated' : 'Invalid password'
            };
        } catch (error) {
            console.error('Error validating assessment password:', error);
            throw error;
        }
    }

    // Validate IP restrictions
    async validateIPAccess(assessmentId, clientIP) {
        try {
            const query = `
                SELECT ip_restrictions 
                FROM assessments 
                WHERE id = ? AND is_published = true
            `;
            const [results] = await db.execute(query, [assessmentId]);
            
            if (results.length === 0) {
                return { success: false, message: 'Assessment not found' };
            }
            
            const assessment = results[0];
            
            if (!assessment.ip_restrictions) {
                return { success: true, message: 'No IP restrictions' };
            }
            
            const allowedIPs = JSON.parse(assessment.ip_restrictions);
            
            // Check if client IP is in allowed list
            const isAllowed = allowedIPs.some(allowedIP => {
                if (allowedIP.includes('/')) {
                    // CIDR notation check
                    return this.isIPInCIDR(clientIP, allowedIP);
                } else {
                    // Exact IP match
                    return clientIP === allowedIP;
                }
            });
            
            return {
                success: isAllowed,
                message: isAllowed ? 'IP access granted' : 'IP access denied',
                allowedIPs: allowedIPs
            };
        } catch (error) {
            console.error('Error validating IP access:', error);
            throw error;
        }
    }

    // Validate device restrictions
    async validateDeviceAccess(assessmentId, deviceInfo) {
        try {
            const query = `
                SELECT device_restrictions 
                FROM assessments 
                WHERE id = ? AND is_published = true
            `;
            const [results] = await db.execute(query, [assessmentId]);
            
            if (results.length === 0) {
                return { success: false, message: 'Assessment not found' };
            }
            
            const assessment = results[0];
            
            if (!assessment.device_restrictions) {
                return { success: true, message: 'No device restrictions' };
            }
            
            const restrictions = JSON.parse(assessment.device_restrictions);
            const violations = [];
            
            // Check browser restrictions
            if (restrictions.allowedBrowsers && restrictions.allowedBrowsers.length > 0) {
                if (!restrictions.allowedBrowsers.includes(deviceInfo.browser)) {
                    violations.push(`Browser '${deviceInfo.browser}' not allowed`);
                }
            }
            
            // Check OS restrictions
            if (restrictions.allowedOS && restrictions.allowedOS.length > 0) {
                if (!restrictions.allowedOS.includes(deviceInfo.os)) {
                    violations.push(`OS '${deviceInfo.os}' not allowed`);
                }
            }
            
            // Check mobile device restrictions
            if (restrictions.mobileAllowed === false && deviceInfo.isMobile) {
                violations.push('Mobile devices not allowed');
            }
            
            // Check screen resolution restrictions
            if (restrictions.minScreenWidth && deviceInfo.screenWidth < restrictions.minScreenWidth) {
                violations.push(`Screen width ${deviceInfo.screenWidth}px below minimum ${restrictions.minScreenWidth}px`);
            }
            
            if (restrictions.minScreenHeight && deviceInfo.screenHeight < restrictions.minScreenHeight) {
                violations.push(`Screen height ${deviceInfo.screenHeight}px below minimum ${restrictions.minScreenHeight}px`);
            }
            
            return {
                success: violations.length === 0,
                message: violations.length === 0 ? 'Device access granted' : 'Device access denied',
                violations: violations
            };
        } catch (error) {
            console.error('Error validating device access:', error);
            throw error;
        }
    }

    // Validate time-based access
    async validateTimeAccess(assessmentId) {
        try {
            const query = `
                SELECT scheduling, time_restrictions 
                FROM assessments 
                WHERE id = ? AND is_published = true
            `;
            const [results] = await db.execute(query, [assessmentId]);
            
            if (results.length === 0) {
                return { success: false, message: 'Assessment not found' };
            }
            
            const assessment = results[0];
            const now = new Date();
            
            // Check scheduling
            if (assessment.scheduling) {
                const scheduling = JSON.parse(assessment.scheduling);
                
                if (scheduling.start_date && new Date(scheduling.start_date) > now) {
                    return {
                        success: false,
                        message: 'Assessment not yet available',
                        availableAt: scheduling.start_date
                    };
                }
                
                if (scheduling.end_date && new Date(scheduling.end_date) < now) {
                    return {
                        success: false,
                        message: 'Assessment deadline has passed',
                        deadline: scheduling.end_date
                    };
                }
            }
            
            // Check time restrictions
            if (assessment.time_restrictions) {
                const timeRestrictions = JSON.parse(assessment.time_restrictions);
                
                if (timeRestrictions.allowedDays && timeRestrictions.allowedDays.length > 0) {
                    const currentDay = now.getDay();
                    if (!timeRestrictions.allowedDays.includes(currentDay)) {
                        return {
                            success: false,
                            message: 'Assessment not available on this day',
                            allowedDays: timeRestrictions.allowedDays
                        };
                    }
                }
                
                if (timeRestrictions.allowedHours) {
                    const currentHour = now.getHours();
                    const isInAllowedHours = timeRestrictions.allowedHours.some(range => {
                        return currentHour >= range.start && currentHour <= range.end;
                    });
                    
                    if (!isInAllowedHours) {
                        return {
                            success: false,
                            message: 'Assessment not available at this time',
                            allowedHours: timeRestrictions.allowedHours
                        };
                    }
                }
            }
            
            return { success: true, message: 'Time access granted' };
        } catch (error) {
            console.error('Error validating time access:', error);
            throw error;
        }
    }

    // Validate user eligibility
    async validateUserEligibility(assessmentId, userId) {
        try {
            const query = `
                SELECT a.*, u.batch_id, u.department_id, u.college_id
                FROM assessments a
                JOIN users u ON u.id = ?
                WHERE a.id = ? AND a.is_published = true
            `;
            const [results] = await db.execute(query, [userId, assessmentId]);
            
            if (results.length === 0) {
                return { success: false, message: 'Assessment or user not found' };
            }
            
            const assessment = results[0];
            const violations = [];
            
            // Check batch restrictions
            if (assessment.batch_restrictions) {
                const batchRestrictions = JSON.parse(assessment.batch_restrictions);
                
                if (batchRestrictions.allowedBatches && batchRestrictions.allowedBatches.length > 0) {
                    if (!batchRestrictions.allowedBatches.includes(assessment.batch_id)) {
                        violations.push('User batch not eligible for this assessment');
                    }
                }
                
                if (batchRestrictions.excludedBatches && batchRestrictions.excludedBatches.includes(assessment.batch_id)) {
                    violations.push('User batch excluded from this assessment');
                }
            }
            
            // Check department restrictions
            if (assessment.department_restrictions) {
                const deptRestrictions = JSON.parse(assessment.department_restrictions);
                
                if (deptRestrictions.allowedDepartments && deptRestrictions.allowedDepartments.length > 0) {
                    if (!deptRestrictions.allowedDepartments.includes(assessment.department_id)) {
                        violations.push('User department not eligible for this assessment');
                    }
                }
                
                if (deptRestrictions.excludedDepartments && deptRestrictions.excludedDepartments.includes(assessment.department_id)) {
                    violations.push('User department excluded from this assessment');
                }
            }
            
            // Check college restrictions
            if (assessment.college_restrictions) {
                const collegeRestrictions = JSON.parse(assessment.college_restrictions);
                
                if (collegeRestrictions.allowedColleges && collegeRestrictions.allowedColleges.length > 0) {
                    if (!collegeRestrictions.allowedColleges.includes(assessment.college_id)) {
                        violations.push('User college not eligible for this assessment');
                    }
                }
            }
            
            return {
                success: violations.length === 0,
                message: violations.length === 0 ? 'User eligible' : 'User not eligible',
                violations: violations
            };
        } catch (error) {
            console.error('Error validating user eligibility:', error);
            throw error;
        }
    }

    // Comprehensive access validation
    async validateAssessmentAccess(assessmentId, userId, accessData) {
        try {
            const results = await Promise.all([
                this.validateTimeAccess(assessmentId),
                this.validateUserEligibility(assessmentId, userId),
                accessData.password ? this.validateAssessmentPassword(assessmentId, accessData.password) : { success: true },
                accessData.clientIP ? this.validateIPAccess(assessmentId, accessData.clientIP) : { success: true },
                accessData.deviceInfo ? this.validateDeviceAccess(assessmentId, accessData.deviceInfo) : { success: true }
            ]);
            
            const failures = results.filter(result => !result.success);
            
            if (failures.length > 0) {
                return {
                    success: false,
                    message: 'Access denied',
                    failures: failures
                };
            }
            
            return {
                success: true,
                message: 'Access granted',
                validatedChecks: results.length
            };
        } catch (error) {
            console.error('Error validating assessment access:', error);
            throw error;
        }
    }

    // Log access attempts
    async logAccessAttempt(assessmentId, userId, accessData, result) {
        try {
            const query = `
                INSERT INTO assessment_access_logs 
                (assessment_id, user_id, access_type, access_data, result, ip_address, user_agent, timestamp)
                VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
            `;
            
            await db.query(query, [
                assessmentId,
                userId,
                accessData.accessType || 'assessment_access',
                JSON.stringify(accessData),
                result.success ? 'granted' : 'denied',
                accessData.clientIP || null,
                accessData.userAgent || null
            ]);
        } catch (error) {
            console.error('Error logging access attempt:', error);
        }
    }

    // Get access control settings for assessment
    async getAccessControlSettings(assessmentId) {
        try {
            const query = `
                SELECT 
                    password_protected,
                    access_password,
                    ip_restrictions,
                    device_restrictions,
                    time_restrictions,
                    batch_restrictions,
                    department_restrictions,
                    college_restrictions,
                    scheduling
                FROM assessments 
                WHERE id = ? AND is_published = true
            `;
            const [results] = await db.execute(query, [assessmentId]);
            
            if (results.length === 0) {
                return { success: false, message: 'Assessment not found' };
            }
            
            const assessment = results[0];
            
            return {
                success: true,
                settings: {
                    passwordProtected: assessment.password_protected,
                    ipRestrictions: assessment.ip_restrictions ? JSON.parse(assessment.ip_restrictions) : null,
                    deviceRestrictions: assessment.device_restrictions ? JSON.parse(assessment.device_restrictions) : null,
                    timeRestrictions: assessment.time_restrictions ? JSON.parse(assessment.time_restrictions) : null,
                    batchRestrictions: assessment.batch_restrictions ? JSON.parse(assessment.batch_restrictions) : null,
                    departmentRestrictions: assessment.department_restrictions ? JSON.parse(assessment.department_restrictions) : null,
                    collegeRestrictions: assessment.college_restrictions ? JSON.parse(assessment.college_restrictions) : null,
                    scheduling: assessment.scheduling ? JSON.parse(assessment.scheduling) : null
                }
            };
        } catch (error) {
            console.error('Error getting access control settings:', error);
            throw error;
        }
    }

    // Update access control settings
    async updateAccessControlSettings(assessmentId, settings) {
        try {
            const query = `
                UPDATE assessments 
                SET 
                    password_protected = ?,
                    access_password = ?,
                    ip_restrictions = ?,
                    device_restrictions = ?,
                    time_restrictions = ?,
                    batch_restrictions = ?,
                    department_restrictions = ?,
                    college_restrictions = ?,
                    updated_at = NOW()
                WHERE id = ?
            `;
            
            const hashedPassword = settings.password ? await this.hashPassword(settings.password) : null;
            
            await db.query(query, [
                settings.passwordProtected || false,
                hashedPassword,
                settings.ipRestrictions ? JSON.stringify(settings.ipRestrictions) : null,
                settings.deviceRestrictions ? JSON.stringify(settings.deviceRestrictions) : null,
                settings.timeRestrictions ? JSON.stringify(settings.timeRestrictions) : null,
                settings.batchRestrictions ? JSON.stringify(settings.batchRestrictions) : null,
                settings.departmentRestrictions ? JSON.stringify(settings.departmentRestrictions) : null,
                settings.collegeRestrictions ? JSON.stringify(settings.collegeRestrictions) : null,
                assessmentId
            ]);
            
            return { success: true, message: 'Access control settings updated' };
        } catch (error) {
            console.error('Error updating access control settings:', error);
            throw error;
        }
    }

    // Utility methods
    async hashPassword(password) {
        const salt = crypto.randomBytes(16).toString('hex');
        const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
        return `${salt}:${hash}`;
    }

    async comparePassword(password, hashedPassword) {
        const [salt, hash] = hashedPassword.split(':');
        const testHash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
        return hash === testHash;
    }

    isIPInCIDR(ip, cidr) {
        // Simple CIDR check - in production, use a proper IP address library
        const [network, prefixLength] = cidr.split('/');
        const prefix = parseInt(prefixLength);
        
        // Convert IP to binary and check if it matches the network prefix
        const ipParts = ip.split('.').map(Number);
        const networkParts = network.split('.').map(Number);
        
        for (let i = 0; i < 4; i++) {
            const mask = prefix > (i * 8) ? Math.min(prefix - (i * 8), 8) : 0;
            const ipByte = ipParts[i];
            const networkByte = networkParts[i];
            
            if (mask > 0) {
                const maskByte = (0xFF << (8 - mask)) & 0xFF;
                if ((ipByte & maskByte) !== (networkByte & maskByte)) {
                    return false;
                }
            }
        }
        
        return true;
    }

    // LOW PRIORITY FIX: Move authorization logic from routes to service
    // Check if user can access student analytics
    async canAccessStudentAnalytics(userId, userRole, studentId) {
        try {
            // Students can only access their own analytics
            if (userRole === 'student') {
                if (userId !== studentId) {
                    return {
                        allowed: false,
                        statusCode: 403,
                        message: 'You can only access your own analytics'
                    };
                }
                return { allowed: true };
            }

            // Faculty and college-admin can only access students from their college
            if (userRole === 'faculty' || userRole === 'college-admin') {
                const [authorization] = await db.query(
                    `SELECT u.id, u.college_id, u.batch_id, u.department_id 
                     FROM users u 
                     WHERE u.id = ? AND u.role = 'student'`,
                    [studentId]
                );
                
                if (authorization.length === 0) {
                    return {
                        allowed: false,
                        statusCode: 404,
                        message: 'Student not found'
                    };
                }
                
                const student = authorization[0];
                const [userInfo] = await db.query(
                    `SELECT college_id FROM users WHERE id = ?`,
                    [userId]
                );
                
                if (userInfo.length === 0 || userInfo[0].college_id !== student.college_id) {
                    return {
                        allowed: false,
                        statusCode: 403,
                        message: 'You do not have permission to access this student\'s analytics'
                    };
                }
            }

            // super-admin can access all
            return { allowed: true };
        } catch (error) {
            console.error('Error checking student analytics access:', error);
            return {
                allowed: false,
                statusCode: 500,
                message: 'Error checking access permissions'
            };
        }
    }
}

export default new AccessControlService();
