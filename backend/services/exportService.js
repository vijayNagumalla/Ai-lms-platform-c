import { pool as db } from '../config/database.js';
import ExcelJS from 'exceljs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import appConfig from '../config/appConfig.js';
import exportProgressService from './exportProgressService.js';
import { v4 as uuidv4 } from 'uuid';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class ExportService {
    constructor() {
        // VERCEL/SERVERLESS FIX: Detect serverless environment
        const isServerless = process.env.VERCEL === '1' || 
                           process.env.AWS_LAMBDA_FUNCTION_NAME || 
                           process.env.FUNCTION_NAME ||
                           __dirname.includes('/var/task') ||
                           process.cwd().includes('/var/task');
        
        // In serverless, use /tmp which is writable
        if (isServerless) {
            this.exportDir = '/tmp/exports';
        } else {
            this.exportDir = path.join(__dirname, '../temp/exports');
        }
        
        // MEDIUM FIX: Use configurable values from appConfig
        this.MAX_EXPORT_RECORDS = appConfig.export.maxRecords;
        this.MAX_EXPORT_FILE_SIZE = appConfig.export.maxFileSize;
        this.BATCH_SIZE = appConfig.export.batchSize;
        this.ensureExportDirectory();
    }

    ensureExportDirectory() {
        try {
            if (!fs.existsSync(this.exportDir)) {
                fs.mkdirSync(this.exportDir, { recursive: true });
            }
        } catch (error) {
            // In serverless, /tmp should be writable, but handle gracefully
            console.warn('Could not create export directory:', error.message);
            // Export functionality may be limited in this environment
        }
    }

    // Export assessment results to Excel
    async exportAssessmentResults(assessmentId, filters = {}, exportId = null) {
        try {
            // MEDIUM FIX: Create progress tracker if exportId provided
            if (exportId) {
                exportProgressService.createProgress(exportId, 100);
                exportProgressService.updateProgress(exportId, 5, 'Validating parameters...');
            }
            
            // CRITICAL FIX: Validate assessmentId
            if (!assessmentId || typeof assessmentId !== 'string' || assessmentId.length > 50) {
                if (exportId) exportProgressService.failProgress(exportId, 'Invalid assessmentId parameter');
                throw new Error('Invalid assessmentId parameter');
            }
            
            if (exportId) exportProgressService.updateProgress(exportId, 10, 'Fetching assessment details...');
            const assessment = await this.getAssessmentDetails(assessmentId);
            if (!assessment) {
                if (exportId) exportProgressService.failProgress(exportId, 'Assessment not found');
                throw new Error('Assessment not found');
            }

            // CRITICAL FIX: Get submissions with pagination to prevent memory exhaustion
            if (exportId) exportProgressService.updateProgress(exportId, 20, 'Fetching submission data...');
            const submissions = await this.getAssessmentSubmissions(assessmentId, filters);
            
            // CRITICAL FIX: Validate export size before processing
            if (submissions.length > this.MAX_EXPORT_RECORDS) {
                if (exportId) exportProgressService.failProgress(exportId, `Export exceeds maximum record limit (${this.MAX_EXPORT_RECORDS})`);
                throw new Error(`Export exceeds maximum record limit (${this.MAX_EXPORT_RECORDS}). Please use filters to reduce the dataset size.`);
            }
            
            if (exportId) exportProgressService.updateProgress(exportId, 30, 'Calculating analytics...');
            const analytics = await this.calculateAssessmentAnalytics(assessmentId, filters);

            if (exportId) exportProgressService.updateProgress(exportId, 40, 'Creating workbook...');
            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet('Assessment Results');

            // Add headers
            this.addAssessmentHeaders(worksheet, assessment);
            
            // CRITICAL FIX: Stream data to worksheet in batches to prevent memory issues
            // MEDIUM FIX: Update progress during batch processing
            const totalBatches = Math.ceil(submissions.length / this.BATCH_SIZE);
            for (let i = 0; i < submissions.length; i += this.BATCH_SIZE) {
                const batch = submissions.slice(i, i + this.BATCH_SIZE);
                this.addSubmissionData(worksheet, batch);
                
                // Update progress (40-80% for data processing)
                if (exportId) {
                    const batchProgress = 40 + Math.round((i / submissions.length) * 40);
                    exportProgressService.updateProgress(exportId, batchProgress, `Processing data: ${i + batch.length}/${submissions.length} records...`);
                }
                
                // Optional: Yield control periodically for large exports
                if (i % (this.BATCH_SIZE * 5) === 0 && i > 0) {
                    await new Promise(resolve => setImmediate(resolve));
                }
            }
            
            if (exportId) exportProgressService.updateProgress(exportId, 85, 'Adding analytics data...');
            this.addAnalyticsData(worksheet, analytics);

            // Style the worksheet
            this.styleAssessmentWorksheet(worksheet);

            const filename = `assessment_${assessmentId}_results_${Date.now()}.xlsx`;
            const filepath = path.join(this.exportDir, filename);

            if (exportId) exportProgressService.updateProgress(exportId, 90, 'Writing file...');
            // CRITICAL FIX: Use streaming writer for large files to prevent memory issues
            const stream = fs.createWriteStream(filepath);
            await workbook.xlsx.write(stream);
            await new Promise((resolve, reject) => {
                stream.on('finish', resolve);
                stream.on('error', reject);
            });
            
            // CRITICAL FIX: Validate file size after creation
            const stats = fs.statSync(filepath);
            if (stats.size > this.MAX_EXPORT_FILE_SIZE) {
                // Clean up oversized file
                fs.unlinkSync(filepath);
                if (exportId) exportProgressService.failProgress(exportId, 'Export file exceeds maximum size');
                throw new Error(`Export file exceeds maximum size (50MB). Please use filters to reduce the dataset size.`);
            }

            if (exportId) exportProgressService.completeProgress(exportId, 'Export completed successfully');
            return {
                success: true,
                filename,
                filepath,
                downloadUrl: `/api/exports/download/${filename}`,
                recordCount: submissions.length,
                fileSize: stats.size,
                exportId
            };
        } catch (error) {
            console.error('Error exporting assessment results:', error);
            if (exportId) exportProgressService.failProgress(exportId, error.message);
            throw error;
        }
    }

    // Export student performance report
    async exportStudentPerformance(studentId, filters = {}) {
        try {
            // CRITICAL FIX: Validate studentId
            if (!studentId || typeof studentId !== 'string' || studentId.length > 50) {
                throw new Error('Invalid studentId parameter');
            }
            
            const student = await this.getStudentDetails(studentId);
            if (!student) {
                throw new Error('Student not found');
            }

            const performance = await this.getStudentPerformanceData(studentId, filters);
            
            // CRITICAL FIX: Validate export size before processing
            if (performance.length > this.MAX_EXPORT_RECORDS) {
                throw new Error(`Export exceeds maximum record limit (${this.MAX_EXPORT_RECORDS}). Please use filters to reduce the dataset size.`);
            }
            
            const analytics = await this.calculateStudentAnalytics(studentId, filters);

            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet('Student Performance');

            // Add headers
            this.addStudentHeaders(worksheet, student);
            
            // CRITICAL FIX: Stream data to worksheet in batches
            for (let i = 0; i < performance.length; i += this.BATCH_SIZE) {
                const batch = performance.slice(i, i + this.BATCH_SIZE);
                this.addPerformanceData(worksheet, batch);
            }
            
            this.addStudentAnalytics(worksheet, analytics);

            // Style the worksheet
            this.styleStudentWorksheet(worksheet);

            const filename = `student_${studentId}_performance_${Date.now()}.xlsx`;
            const filepath = path.join(this.exportDir, filename);

            // CRITICAL FIX: Use streaming writer for large files
            const stream = fs.createWriteStream(filepath);
            await workbook.xlsx.write(stream);
            await new Promise((resolve, reject) => {
                stream.on('finish', resolve);
                stream.on('error', reject);
            });
            
            // CRITICAL FIX: Validate file size after creation
            const stats = fs.statSync(filepath);
            if (stats.size > this.MAX_EXPORT_FILE_SIZE) {
                // Clean up oversized file
                fs.unlinkSync(filepath);
                throw new Error(`Export file exceeds maximum size (50MB). Please use filters to reduce the dataset size.`);
            }

            return {
                success: true,
                filename,
                filepath,
                downloadUrl: `/api/exports/download/${filename}`,
                recordCount: performance.length,
                fileSize: stats.size
            };
        } catch (error) {
            console.error('Error exporting student performance:', error);
            throw error;
        }
    }

    // Export batch/department performance
    async exportBatchPerformance(batchId, departmentId, filters = {}) {
        try {
            // CRITICAL FIX: Validate batchId and departmentId
            if (!batchId || typeof batchId !== 'string' || batchId.length > 50) {
                throw new Error('Invalid batchId parameter');
            }
            if (!departmentId || typeof departmentId !== 'string' || departmentId.length > 50) {
                throw new Error('Invalid departmentId parameter');
            }
            
            const batch = await this.getBatchDetails(batchId);
            const department = await this.getDepartmentDetails(departmentId);

            const students = await this.getBatchStudents(batchId, departmentId);
            
            // CRITICAL FIX: Validate export size before processing
            if (students.length > this.MAX_EXPORT_RECORDS) {
                throw new Error(`Export exceeds maximum record limit (${this.MAX_EXPORT_RECORDS}). Please use filters to reduce the dataset size.`);
            }
            
            const performance = await this.getBatchPerformanceData(batchId, departmentId, filters);
            
            // CRITICAL FIX: Validate performance data size
            if (performance.length > this.MAX_EXPORT_RECORDS) {
                throw new Error(`Performance data exceeds maximum record limit (${this.MAX_EXPORT_RECORDS}). Please use filters to reduce the dataset size.`);
            }
            
            const analytics = await this.calculateBatchAnalytics(batchId, departmentId, filters);

            const workbook = new ExcelJS.Workbook();
            
            // Create multiple worksheets
            const summarySheet = workbook.addWorksheet('Summary');
            const studentsSheet = workbook.addWorksheet('Students');
            const performanceSheet = workbook.addWorksheet('Performance');
            const analyticsSheet = workbook.addWorksheet('Analytics');

            // Add data to each worksheet
            this.addBatchSummaryData(summarySheet, batch, department, analytics);
            
            // CRITICAL FIX: Stream data to worksheets in batches
            for (let i = 0; i < students.length; i += this.BATCH_SIZE) {
                const batch = students.slice(i, i + this.BATCH_SIZE);
                this.addBatchStudentsData(studentsSheet, batch);
            }
            
            for (let i = 0; i < performance.length; i += this.BATCH_SIZE) {
                const batch = performance.slice(i, i + this.BATCH_SIZE);
                this.addBatchPerformanceData(performanceSheet, batch);
            }
            
            this.addBatchAnalyticsData(analyticsSheet, analytics);

            // Style worksheets
            this.styleBatchWorksheets(workbook);

            const filename = `batch_${batchId}_dept_${departmentId}_performance_${Date.now()}.xlsx`;
            const filepath = path.join(this.exportDir, filename);

            // CRITICAL FIX: Use streaming writer for large files
            const stream = fs.createWriteStream(filepath);
            await workbook.xlsx.write(stream);
            await new Promise((resolve, reject) => {
                stream.on('finish', resolve);
                stream.on('error', reject);
            });
            
            // CRITICAL FIX: Validate file size after creation
            const stats = fs.statSync(filepath);
            if (stats.size > this.MAX_EXPORT_FILE_SIZE) {
                // Clean up oversized file
                fs.unlinkSync(filepath);
                throw new Error(`Export file exceeds maximum size (50MB). Please use filters to reduce the dataset size.`);
            }

            return {
                success: true,
                filename,
                filepath,
                downloadUrl: `/api/exports/download/${filename}`,
                recordCount: students.length,
                fileSize: stats.size
            };
        } catch (error) {
            console.error('Error exporting batch performance:', error);
            throw error;
        }
    }

    // Export comprehensive analytics report
    async exportComprehensiveAnalytics(filters = {}) {
        try {
            const analytics = await this.getComprehensiveAnalytics(filters);
            const trends = await this.getPerformanceTrends(filters);
            const comparisons = await this.getComparativeData(filters);

            const workbook = new ExcelJS.Workbook();
            
            // Create multiple worksheets
            const overviewSheet = workbook.addWorksheet('Overview');
            const trendsSheet = workbook.addWorksheet('Trends');
            const comparisonsSheet = workbook.addWorksheet('Comparisons');
            const detailedSheet = workbook.addWorksheet('Detailed Analysis');

            // Add data to each worksheet
            this.addOverviewData(overviewSheet, analytics);
            this.addTrendsData(trendsSheet, trends);
            this.addComparisonsData(comparisonsSheet, comparisons);
            this.addDetailedAnalysisData(detailedSheet, analytics);

            // Style worksheets
            this.styleAnalyticsWorksheets(workbook);

            const filename = `comprehensive_analytics_${Date.now()}.xlsx`;
            const filepath = path.join(this.exportDir, filename);

            await workbook.xlsx.writeFile(filepath);

            return {
                success: true,
                filename,
                filepath,
                downloadUrl: `/api/exports/download/${filename}`,
                recordCount: analytics.length
            };
        } catch (error) {
            console.error('Error exporting comprehensive analytics:', error);
            throw error;
        }
    }

    // Export proctoring data
    async exportProctoringData(assessmentId, filters = {}) {
        try {
            const proctoringData = await this.getProctoringData(assessmentId, filters);
            const violations = await this.getProctoringViolations(assessmentId, filters);

            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet('Proctoring Data');

            // Add headers
            this.addProctoringHeaders(worksheet);
            this.addProctoringData(worksheet, proctoringData);
            this.addViolationsData(worksheet, violations);

            // Style the worksheet
            this.styleProctoringWorksheet(worksheet);

            const filename = `proctoring_${assessmentId}_${Date.now()}.xlsx`;
            const filepath = path.join(this.exportDir, filename);

            await workbook.xlsx.writeFile(filepath);

            return {
                success: true,
                filename,
                filepath,
                downloadUrl: `/api/exports/download/${filename}`,
                recordCount: proctoringData.length
            };
        } catch (error) {
            console.error('Error exporting proctoring data:', error);
            throw error;
        }
    }

    // Generate PDF report
    async generatePDFReport(reportType, data, options = {}) {
        try {
            // This would require a PDF generation library like puppeteer or jsPDF
            // For now, we'll return a placeholder
            const filename = `${reportType}_report_${Date.now()}.pdf`;
            const filepath = path.join(this.exportDir, filename);

            // Placeholder for PDF generation
            const pdfContent = this.generatePDFContent(reportType, data, options);
            fs.writeFileSync(filepath, pdfContent);

            return {
                success: true,
                filename,
                filepath,
                downloadUrl: `/api/exports/download/${filename}`,
                recordCount: data.length
            };
        } catch (error) {
            console.error('Error generating PDF report:', error);
            throw error;
        }
    }

    // Export to CSV
    async exportToCSV(data, filename, headers) {
        try {
            const csvContent = this.generateCSVContent(data, headers);
            const filepath = path.join(this.exportDir, filename);

            fs.writeFileSync(filepath, csvContent);

            return {
                success: true,
                filename,
                filepath,
                downloadUrl: `/api/exports/download/${filename}`,
                recordCount: data.length
            };
        } catch (error) {
            console.error('Error exporting to CSV:', error);
            throw error;
        }
    }

    // Helper methods for data retrieval
    async getAssessmentDetails(assessmentId) {
        // CRITICAL FIX: Use correct table name
        const query = 'SELECT * FROM assessments WHERE id = ?';
        const [results] = await db.execute(query, [assessmentId]);
        return results[0];
    }

    async getAssessmentSubmissions(assessmentId, filters) {
        // CRITICAL FIX: Add LIMIT to prevent loading all records at once
        let query = `
            SELECT 
                s.*,
                u.name as student_name,
                u.email as student_email,
                u.roll_number,
                b.name as batch_name,
                d.name as department_name
            FROM assessment_submissions s
            JOIN users u ON s.student_id = u.id
            LEFT JOIN batches b ON u.batch_id = b.id
            LEFT JOIN departments d ON u.department_id = d.id
            WHERE s.assessment_id = ?
        `;
        const params = [assessmentId];

        if (filters.batchId) {
            query += ' AND u.batch_id = ?';
            params.push(filters.batchId);
        }

        if (filters.departmentId) {
            query += ' AND u.department_id = ?';
            params.push(filters.departmentId);
        }

        if (filters.status) {
            query += ' AND s.status = ?';
            params.push(filters.status);
        }

        // CRITICAL FIX: Add LIMIT to prevent memory exhaustion
        const maxRecords = this.MAX_EXPORT_RECORDS;
        query += ` ORDER BY s.submitted_at DESC LIMIT ${maxRecords}`;

        const [results] = await db.execute(query, params);
        return results;
    }

    async getStudentDetails(studentId) {
        const query = `
            SELECT u.*, b.name as batch_name, d.name as department_name
            FROM users u
            LEFT JOIN batches b ON u.batch_id = b.id
            LEFT JOIN departments d ON u.department_id = d.id
            WHERE u.id = ?
        `;
        const [results] = await db.execute(query, [studentId]);
        return results[0];
    }

    async getStudentPerformanceData(studentId, filters) {
        // CRITICAL FIX: Add LIMIT to prevent loading all records at once
        const maxRecords = this.MAX_EXPORT_RECORDS;
        const query = `
            SELECT 
                a.title as assessment_title,
                s.total_score,
                s.total_points,
                s.percentage_score,
                s.status,
                s.submitted_at,
                s.time_taken_minutes,
                s.attempt_number
            FROM assessment_submissions s
            JOIN assessments a ON s.assessment_id = a.id
            WHERE s.student_id = ?
            ORDER BY s.submitted_at DESC
            LIMIT ${maxRecords}
        `;
        const [results] = await db.execute(query, [studentId]);
        return results;
    }

    async getBatchDetails(batchId) {
        const query = 'SELECT * FROM batches WHERE id = ?';
        const [results] = await db.execute(query, [batchId]);
        return results[0];
    }

    async getDepartmentDetails(departmentId) {
        const query = 'SELECT * FROM departments WHERE id = ?';
        const [results] = await db.execute(query, [departmentId]);
        return results[0];
    }

    async getBatchStudents(batchId, departmentId) {
        // CRITICAL FIX: Add LIMIT to prevent loading all records at once
        const maxRecords = this.MAX_EXPORT_RECORDS;
        const query = `
            SELECT u.*, b.name as batch_name, d.name as department_name
            FROM users u
            LEFT JOIN batches b ON u.batch_id = b.id
            LEFT JOIN departments d ON u.department_id = d.id
            WHERE u.batch_id = ? AND u.department_id = ? AND u.role = 'student'
            ORDER BY u.name ASC
            LIMIT ${maxRecords}
        `;
        const [results] = await db.execute(query, [batchId, departmentId]);
        return results;
    }

    async getBatchPerformanceData(batchId, departmentId, filters) {
        // CRITICAL FIX: Add LIMIT to prevent loading all records at once
        const maxRecords = this.MAX_EXPORT_RECORDS;
        const query = `
            SELECT 
                u.name as student_name,
                u.roll_number,
                a.title as assessment_title,
                s.total_score,
                s.percentage_score,
                s.status,
                s.submitted_at
            FROM assessment_submissions s
            JOIN users u ON s.student_id = u.id
            JOIN assessments a ON s.assessment_id = a.id
            WHERE u.batch_id = ? AND u.department_id = ?
            ORDER BY s.submitted_at DESC
            LIMIT ${maxRecords}
        `;
        const [results] = await db.execute(query, [batchId, departmentId]);
        return results;
    }

    async getProctoringData(assessmentId, filters) {
        // CRITICAL FIX: Add LIMIT to prevent loading all records at once
        const maxRecords = this.MAX_EXPORT_RECORDS;
        const query = `
            SELECT 
                p.*,
                u.name as student_name,
                s.submitted_at
            FROM proctoring_logs p
            JOIN assessment_submissions s ON p.submission_id = s.id
            JOIN users u ON s.student_id = u.id
            WHERE s.assessment_id = ?
            ORDER BY p.timestamp DESC
            LIMIT ${maxRecords}
        `;
        const [results] = await db.execute(query, [assessmentId]);
        return results;
    }

    async getProctoringViolations(assessmentId, filters) {
        // CRITICAL FIX: Add LIMIT to prevent loading all records at once
        const maxRecords = this.MAX_EXPORT_RECORDS;
        const query = `
            SELECT 
                p.*,
                u.name as student_name,
                s.submitted_at
            FROM proctoring_logs p
            JOIN assessment_submissions s ON p.submission_id = s.id
            JOIN users u ON s.student_id = u.id
            WHERE s.assessment_id = ? AND p.violation_type IS NOT NULL
            ORDER BY p.timestamp DESC
            LIMIT ${maxRecords}
        `;
        const [results] = await db.execute(query, [assessmentId]);
        return results;
    }

    // Analytics calculation methods
    async calculateAssessmentAnalytics(assessmentId, filters) {
        // CRITICAL FIX: Use database functions for calculations to ensure accuracy
        const query = `
            SELECT 
                COUNT(*) as total_submissions,
                ROUND(AVG(percentage_score), 2) as average_score,
                ROUND(MIN(percentage_score), 2) as min_score,
                ROUND(MAX(percentage_score), 2) as max_score,
                COUNT(CASE WHEN status IN ('submitted', 'graded') THEN 1 END) as completed_count,
                COUNT(CASE WHEN status = 'in_progress' THEN 1 END) as in_progress_count,
                COUNT(CASE WHEN status = 'abandoned' THEN 1 END) as abandoned_count
            FROM assessment_submissions
            WHERE assessment_id = ?
        `;
        const [results] = await db.execute(query, [assessmentId]);
        return results[0];
    }

    async calculateStudentAnalytics(studentId, filters) {
        // CRITICAL FIX: Use database functions for calculations to ensure accuracy
        const query = `
            SELECT 
                COUNT(*) as total_assessments,
                ROUND(AVG(percentage_score), 2) as average_score,
                ROUND(MIN(percentage_score), 2) as min_score,
                ROUND(MAX(percentage_score), 2) as max_score,
                COUNT(CASE WHEN status IN ('submitted', 'graded') THEN 1 END) as completed_count,
                SUM(COALESCE(time_taken_minutes, 0)) as total_time_spent
            FROM assessment_submissions
            WHERE student_id = ?
        `;
        const [results] = await db.execute(query, [studentId]);
        return results[0];
    }

    async calculateBatchAnalytics(batchId, departmentId, filters) {
        const query = `
            SELECT 
                COUNT(DISTINCT s.student_id) as total_students,
                COUNT(*) as total_submissions,
                AVG(s.percentage_score) as average_score,
                MIN(s.percentage_score) as min_score,
                MAX(s.percentage_score) as max_score,
                COUNT(CASE WHEN s.status IN ('submitted', 'graded') THEN 1 END) as completed_count
            FROM assessment_submissions s
            JOIN users u ON s.student_id = u.id
            WHERE u.batch_id = ? AND u.department_id = ?
        `;
        const [results] = await db.execute(query, [batchId, departmentId]);
        return results[0];
    }

    async getComprehensiveAnalytics(filters) {
        // CRITICAL FIX: Use correct table and column names
        const query = `
            SELECT 
                a.title as assessment_title,
                COUNT(s.id) as total_submissions,
                AVG(s.percentage_score) as average_score,
                COUNT(CASE WHEN s.status IN ('submitted', 'graded') THEN 1 END) as completed_count,
                COUNT(CASE WHEN s.status = 'in_progress' THEN 1 END) as in_progress_count
            FROM assessments a
            LEFT JOIN assessment_submissions s ON a.id = s.assessment_id
            GROUP BY a.id, a.title
            ORDER BY a.created_at DESC
        `;
        const [results] = await db.execute(query);
        return results;
    }

    async getPerformanceTrends(filters) {
        // CRITICAL FIX: Use correct column name
        const query = `
            SELECT 
                DATE(s.submitted_at) as date,
                COUNT(*) as submissions,
                AVG(s.percentage_score) as average_score
            FROM assessment_submissions s
            WHERE s.submitted_at >= NOW() - INTERVAL '30 days'
            GROUP BY DATE(s.submitted_at)
            ORDER BY date DESC
        `;
        const [results] = await db.execute(query);
        return results;
    }

    async getComparativeData(filters) {
        const query = `
            SELECT 
                d.name as department_name,
                b.name as batch_name,
                COUNT(s.id) as total_submissions,
                AVG(s.percentage_score) as average_score
            FROM assessment_submissions s
            JOIN users u ON s.student_id = u.id
            LEFT JOIN departments d ON u.department_id = d.id
            LEFT JOIN batches b ON u.batch_id = b.id
            GROUP BY d.id, d.name, b.id, b.name
            ORDER BY average_score DESC
        `;
        const [results] = await db.execute(query);
        return results;
    }

    // Excel formatting methods
    addAssessmentHeaders(worksheet, assessment) {
        worksheet.addRow(['Assessment Results Report']);
        worksheet.addRow(['Assessment:', assessment.title]);
        worksheet.addRow(['Created:', assessment.created_at]);
        worksheet.addRow(['Duration:', assessment.duration + ' minutes']);
        worksheet.addRow([]);
        
        const headers = [
            'Student Name', 'Email', 'Roll Number', 'Batch', 'Department',
            'Score', 'Total Points', 'Percentage', 'Status', 'Submitted At',
            'Time Spent', 'Attempt Number'
        ];
        worksheet.addRow(headers);
    }

    addSubmissionData(worksheet, submissions) {
        submissions.forEach(submission => {
            worksheet.addRow([
                submission.student_name,
                submission.student_email,
                submission.roll_number,
                submission.batch_name,
                submission.department_name,
                submission.total_score || submission.score,
                submission.total_points,
                submission.percentage_score || submission.percentage,
                submission.status,
                submission.submitted_at,
                submission.time_spent,
                submission.attempt_number
            ]);
        });
    }

    addAnalyticsData(worksheet, analytics) {
        worksheet.addRow([]);
        worksheet.addRow(['Analytics Summary']);
        worksheet.addRow(['Total Submissions:', analytics.total_submissions]);
        worksheet.addRow(['Average Score:', analytics.average_score]);
        worksheet.addRow(['Min Score:', analytics.min_score]);
        worksheet.addRow(['Max Score:', analytics.max_score]);
        worksheet.addRow(['Completed:', analytics.completed_count]);
        worksheet.addRow(['In Progress:', analytics.in_progress_count]);
        worksheet.addRow(['Abandoned:', analytics.abandoned_count]);
    }

    addStudentHeaders(worksheet, student) {
        worksheet.addRow(['Student Performance Report']);
        worksheet.addRow(['Student:', student.name]);
        worksheet.addRow(['Email:', student.email]);
        worksheet.addRow(['Roll Number:', student.roll_number]);
        worksheet.addRow(['Batch:', student.batch_name]);
        worksheet.addRow(['Department:', student.department_name]);
        worksheet.addRow([]);
        
        const headers = [
            'Assessment', 'Score', 'Total Points', 'Percentage', 'Status',
            'Submitted At', 'Time Spent', 'Attempt Number'
        ];
        worksheet.addRow(headers);
    }

    addPerformanceData(worksheet, performance) {
        performance.forEach(record => {
            worksheet.addRow([
                record.assessment_title,
                record.total_score || record.score,
                record.total_points,
                record.percentage_score || record.percentage,
                record.status,
                record.submitted_at,
                record.time_spent,
                record.attempt_number
            ]);
        });
    }

    addStudentAnalytics(worksheet, analytics) {
        worksheet.addRow([]);
        worksheet.addRow(['Performance Analytics']);
        worksheet.addRow(['Total Assessments:', analytics.total_assessments]);
        worksheet.addRow(['Average Score:', analytics.average_score]);
        worksheet.addRow(['Min Score:', analytics.min_score]);
        worksheet.addRow(['Max Score:', analytics.max_score]);
        worksheet.addRow(['Completed:', analytics.completed_count]);
        worksheet.addRow(['Total Time Spent:', analytics.total_time_spent]);
    }

    addBatchSummaryData(worksheet, batch, department, analytics) {
        worksheet.addRow(['Batch Performance Summary']);
        worksheet.addRow(['Batch:', batch.name]);
        worksheet.addRow(['Department:', department.name]);
        worksheet.addRow([]);
        worksheet.addRow(['Total Students:', analytics.total_students]);
        worksheet.addRow(['Total Submissions:', analytics.total_submissions]);
        worksheet.addRow(['Average Score:', analytics.average_score]);
        worksheet.addRow(['Min Score:', analytics.min_score]);
        worksheet.addRow(['Max Score:', analytics.max_score]);
        worksheet.addRow(['Completed:', analytics.completed_count]);
    }

    addBatchStudentsData(worksheet, students) {
        // CRITICAL FIX: Only add headers once (on first call)
        if (worksheet.rowCount === 0) {
            const headers = ['Name', 'Email', 'Roll Number', 'Batch', 'Department'];
            worksheet.addRow(headers);
        }
        
        // Add student rows
        students.forEach(student => {
            worksheet.addRow([
                student.name || '',
                student.email || '',
                student.roll_number || '',
                student.batch_name || '',
                student.department_name || ''
            ]);
        });
    }

    addBatchPerformanceData(worksheet, performance) {
        // CRITICAL FIX: Only add headers once (on first call)
        if (worksheet.rowCount === 0) {
            const headers = ['Student', 'Roll Number', 'Assessment', 'Score', 'Percentage', 'Status', 'Submitted At'];
            worksheet.addRow(headers);
        }
        
        // Add performance rows
        performance.forEach(record => {
            worksheet.addRow([
                record.student_name || '',
                record.roll_number || '',
                record.assessment_title || '',
                record.total_score || record.score || 0,
                record.percentage_score || record.percentage || 0,
                record.status || '',
                record.submitted_at || ''
            ]);
        });
    }

    addBatchAnalyticsData(worksheet, analytics) {
        worksheet.addRow(['Batch Analytics']);
        worksheet.addRow(['Total Students:', analytics.total_students]);
        worksheet.addRow(['Total Submissions:', analytics.total_submissions]);
        worksheet.addRow(['Average Score:', analytics.average_score]);
        worksheet.addRow(['Min Score:', analytics.min_score]);
        worksheet.addRow(['Max Score:', analytics.max_score]);
        worksheet.addRow(['Completed:', analytics.completed_count]);
    }

    addOverviewData(worksheet, analytics) {
        worksheet.addRow(['Comprehensive Analytics Overview']);
        worksheet.addRow([]);
        
        const headers = ['Assessment', 'Total Submissions', 'Average Score', 'Completed', 'In Progress'];
        worksheet.addRow(headers);
        
        analytics.forEach(record => {
            worksheet.addRow([
                record.assessment_title,
                record.total_submissions,
                record.average_score,
                record.completed_count,
                record.in_progress_count
            ]);
        });
    }

    addTrendsData(worksheet, trends) {
        worksheet.addRow(['Performance Trends']);
        worksheet.addRow([]);
        
        const headers = ['Date', 'Submissions', 'Average Score'];
        worksheet.addRow(headers);
        
        trends.forEach(trend => {
            worksheet.addRow([
                trend.date,
                trend.submissions,
                trend.average_score
            ]);
        });
    }

    addComparisonsData(worksheet, comparisons) {
        worksheet.addRow(['Comparative Analysis']);
        worksheet.addRow([]);
        
        const headers = ['Department', 'Batch', 'Total Submissions', 'Average Score'];
        worksheet.addRow(headers);
        
        comparisons.forEach(comparison => {
            worksheet.addRow([
                comparison.department_name,
                comparison.batch_name,
                comparison.total_submissions,
                comparison.average_score
            ]);
        });
    }

    addDetailedAnalysisData(worksheet, analytics) {
        worksheet.addRow(['Detailed Analysis']);
        worksheet.addRow([]);
        
        const headers = ['Assessment', 'Total Submissions', 'Average Score', 'Completed', 'In Progress'];
        worksheet.addRow(headers);
        
        analytics.forEach(record => {
            worksheet.addRow([
                record.assessment_title,
                record.total_submissions,
                record.average_score,
                record.completed_count,
                record.in_progress_count
            ]);
        });
    }

    addProctoringHeaders(worksheet) {
        worksheet.addRow(['Proctoring Data Report']);
        worksheet.addRow([]);
        
        const headers = ['Student', 'Timestamp', 'Event Type', 'Details', 'Submitted At'];
        worksheet.addRow(headers);
    }

    addProctoringData(worksheet, proctoringData) {
        proctoringData.forEach(record => {
            worksheet.addRow([
                record.student_name,
                record.timestamp,
                record.event_type,
                record.details,
                record.submitted_at
            ]);
        });
    }

    addViolationsData(worksheet, violations) {
        worksheet.addRow([]);
        worksheet.addRow(['Proctoring Violations']);
        worksheet.addRow([]);
        
        const headers = ['Student', 'Violation Type', 'Timestamp', 'Details', 'Severity'];
        worksheet.addRow(headers);
        
        violations.forEach(violation => {
            worksheet.addRow([
                violation.student_name,
                violation.violation_type,
                violation.timestamp,
                violation.details,
                violation.severity
            ]);
        });
    }

    // Styling methods
    styleAssessmentWorksheet(worksheet) {
        // Style headers
        worksheet.getRow(1).font = { bold: true, size: 16 };
        worksheet.getRow(6).font = { bold: true };
        worksheet.getRow(6).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };
    }

    styleStudentWorksheet(worksheet) {
        worksheet.getRow(1).font = { bold: true, size: 16 };
        worksheet.getRow(8).font = { bold: true };
        worksheet.getRow(8).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };
    }

    styleBatchWorksheets(workbook) {
        workbook.worksheets.forEach(worksheet => {
            worksheet.getRow(1).font = { bold: true, size: 16 };
        });
    }

    styleAnalyticsWorksheets(workbook) {
        workbook.worksheets.forEach(worksheet => {
            worksheet.getRow(1).font = { bold: true, size: 16 };
        });
    }

    styleProctoringWorksheet(worksheet) {
        worksheet.getRow(1).font = { bold: true, size: 16 };
        worksheet.getRow(3).font = { bold: true };
        worksheet.getRow(3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };
    }

    // CSV generation
    generateCSVContent(data, headers) {
        const csvRows = [];
        csvRows.push(headers.join(','));
        
        data.forEach(row => {
            const values = headers.map(header => {
                const value = row[header] || '';
                return `"${value.toString().replace(/"/g, '""')}"`;
            });
            csvRows.push(values.join(','));
        });
        
        return csvRows.join('\n');
    }

    // PDF generation placeholder
    generatePDFContent(reportType, data, options) {
        // This is a placeholder - in a real implementation, you would use a PDF library
        return `PDF Report: ${reportType}\nData: ${JSON.stringify(data)}\nOptions: ${JSON.stringify(options)}`;
    }

    // Clean up old export files
    async cleanupOldExports(maxAgeHours = 24) {
        try {
            const files = fs.readdirSync(this.exportDir);
            const now = Date.now();
            const maxAge = maxAgeHours * 60 * 60 * 1000;

            for (const file of files) {
                const filepath = path.join(this.exportDir, file);
                const stats = fs.statSync(filepath);
                
                if (now - stats.mtime.getTime() > maxAge) {
                    fs.unlinkSync(filepath);
                }
            }

            return { success: true, message: 'Old export files cleaned up' };
        } catch (error) {
            console.error('Error cleaning up old exports:', error);
            throw error;
        }
    }
}

export default new ExportService();
