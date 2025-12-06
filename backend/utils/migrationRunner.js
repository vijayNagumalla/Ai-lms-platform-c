// LOW PRIORITY FIX: Migration runner utility
// Provides basic migration tracking and execution

import { pool } from '../config/database.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import logger from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class MigrationRunner {
    constructor() {
        this.migrationsDir = path.join(__dirname, '../database');
        this.ensureMigrationTable();
    }

    async ensureMigrationTable() {
        try {
            // Create migration table directly (simpler than parsing SQL file with DELIMITER)
            await pool.query(`
                CREATE TABLE IF NOT EXISTS migration_history (
                    id SERIAL PRIMARY KEY,
                    migration_name VARCHAR(255) NOT NULL UNIQUE,
                    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    checksum VARCHAR(64),
                    applied_by VARCHAR(100),
                    execution_time_ms INT,
                    status VARCHAR(20) CHECK (status IN ('success', 'failed', 'rolled_back')) DEFAULT 'success',
                    error_message TEXT
                )
            `);

            // Create view if it doesn't exist
            await pool.query(`
                CREATE OR REPLACE VIEW migration_status AS
                SELECT 
                    migration_name,
                    applied_at,
                    status,
                    execution_time_ms,
                    applied_by
                FROM migration_history
                ORDER BY applied_at DESC
            `);
        } catch (error) {
            // Table might already exist
            if (!error.message.includes('already exists') && !error.message.includes('Duplicate')) {
                logger.warn('Migration table creation', { error: error.message });
            }
        }
    }

    async getAppliedMigrations() {
        try {
            const [rows] = await pool.query(
                'SELECT migration_name FROM migration_history WHERE status = ?',
                ['success']
            );
            return new Set(rows.map(row => row.migration_name));
        } catch (error) {
            logger.error('Error getting applied migrations', { error: error.message });
            return new Set();
        }
    }

    calculateChecksum(filePath) {
        const content = fs.readFileSync(filePath, 'utf8');
        return crypto.createHash('sha256').update(content).digest('hex');
    }

    async recordMigration(migrationName, checksum, executionTime, status = 'success', error = null) {
        try {
            await pool.query(
                `INSERT INTO migration_history 
                 (migration_name, checksum, execution_time_ms, status, error_message, applied_by)
                 VALUES (?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                 applied_at = CURRENT_TIMESTAMP,
                 checksum = VALUES(checksum),
                 execution_time_ms = VALUES(execution_time_ms),
                 status = VALUES(status),
                 error_message = VALUES(error_message)`,
                [
                    migrationName,
                    checksum,
                    executionTime,
                    status,
                    error?.message || null,
                    process.env.USER || 'system'
                ]
            );
        } catch (error) {
            logger.error('Error recording migration', { error: error.message });
        }
    }

    async runMigration(migrationFile) {
        const migrationName = path.basename(migrationFile);
        const startTime = Date.now();

        try {
            logger.info(`Running migration: ${migrationName}`);

            const sql = fs.readFileSync(migrationFile, 'utf8');
            const checksum = this.calculateChecksum(migrationFile);

            // Handle SQL files with DELIMITER statements (stored procedures, functions)
            if (sql.includes('DELIMITER')) {
                // Import and use the DELIMITER handler
                const { executeMigrationWithDelimiter } = await import('./executeMigrationWithDelimiter.js');
                await executeMigrationWithDelimiter(sql);
            } else {
                // Split SQL by semicolons and execute statements
                // Remove comments and empty lines
                const statements = sql
                    .split(';')
                    .map(s => s.trim())
                    .filter(s => {
                        const trimmed = s.trim();
                        return trimmed.length > 0 
                            && !trimmed.startsWith('--') 
                            && !trimmed.startsWith('/*')
                            && trimmed.toUpperCase() !== 'USE';
                    });

                for (const statement of statements) {
                    if (statement.length > 0) {
                        try {
                            await pool.query(statement);
                        } catch (error) {
                            // If it's an "already exists" error for indexes, continue
                            if (error.message.includes('Duplicate key name') || 
                                error.message.includes('already exists') ||
                                error.message.includes('Duplicate column name')) {
                                logger.warn(`Index/constraint already exists, skipping: ${statement.substring(0, 50)}...`);
                                continue;
                            }
                            // If table doesn't exist, skip (for optional tables like attendance)
                            if (error.message.includes("doesn't exist") && 
                                (statement.includes('attendance') || statement.includes('ATTENDANCE'))) {
                                logger.warn(`Table doesn't exist, skipping: ${statement.substring(0, 50)}...`);
                                continue;
                            }
                            throw error;
                        }
                    }
                }
            }

            const executionTime = Date.now() - startTime;
            await this.recordMigration(migrationName, checksum, executionTime, 'success');

            logger.info(`Migration completed: ${migrationName} (${executionTime}ms)`);
            return { success: true, migrationName, executionTime };
        } catch (error) {
            const executionTime = Date.now() - startTime;
            await this.recordMigration(migrationName, null, executionTime, 'failed', error);

            logger.error(`Migration failed: ${migrationName}`, { error: error.message });
            throw error;
        }
    }

    async getMigrationStatus() {
        try {
            const [rows] = await pool.query(
                'SELECT * FROM migration_status ORDER BY applied_at DESC'
            );
            return rows;
        } catch (error) {
            logger.error('Error getting migration status', { error: error.message });
            return [];
        }
    }

    async getPendingMigrations() {
        const appliedMigrations = await this.getAppliedMigrations();
        const allMigrations = [
            'migrate_enhanced_features.sql',
            'migrate_add_performance_indexes_simple.sql', // Use simplified version without DELIMITER
            'add_scraping_failures_table.sql',
            'migrate_add_qr_code_used_column.sql'
        ];

        return allMigrations.filter(migration => !appliedMigrations.has(migration));
    }
}

export default new MigrationRunner();

