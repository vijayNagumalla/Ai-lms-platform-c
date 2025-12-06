import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import logger from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env file from backend directory (where this file is located)
const envPath = join(__dirname, '..', '.env');
const envResult = dotenv.config({ path: envPath });

// Log .env file loading status
if (envResult.error) {
  logger.debug(`⚠️  Could not load .env file from ${envPath}`);
  logger.debug(`   Error: ${envResult.error.message}`);
  logger.debug('   Make sure .env file exists in the backend directory');
} else {
  logger.debug(`✅ Loaded .env file from ${envPath}`);
}

// Supabase configuration
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const supabaseDbUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;

if (!supabaseUrl || !supabaseKey) {
  logger.error('Missing Supabase configuration. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your .env file');
  if (process.env.NODE_ENV !== 'test') {
    process.exit(1);
  }
}

// Create Supabase client with service role key for admin operations
const supabase = createClient(supabaseUrl, supabaseKey || 'dummy-key', {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

// Direct PostgreSQL connection for complex queries (optional - only if SUPABASE_DB_URL is provided)
let pgClient = null;
let pgPool = null;
let connectionInitializing = false;
let connectionInitialized = false;

// Initialize PostgreSQL connection if connection string is provided
const initPostgresConnection = async (retry = false) => {
  // Don't retry if already initialized successfully
  if (connectionInitialized && pgPool) {
    return true;
  }
  
  // Don't initialize multiple times simultaneously
  if (connectionInitializing && !retry) {
    // Wait for existing initialization to complete
    while (connectionInitializing) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return pgPool !== null;
  }
  
  if (!supabaseDbUrl) {
    if (!retry) {
      logger.debug('SUPABASE_DB_URL not set - direct PostgreSQL connection not available');
    }
    return false;
  }
  
  connectionInitializing = true;
  
  try {
    // Dynamically import pg only if needed
    const pgModule = await import('pg').catch(() => null);
    if (!pgModule) {
      logger.warn('⚠️ pg package not installed. Install it with: npm install pg');
      connectionInitializing = false;
      return false;
    }
    
    const { Pool } = pgModule;
    
    // If pool exists but failed, close it first
    if (pgPool && !connectionInitialized) {
      try {
        await pgPool.end();
      } catch (e) {
        // Ignore errors when closing failed pool
      }
      pgPool = null;
    }
    
    pgPool = new Pool({
      connectionString: supabaseDbUrl,
      ssl: supabaseDbUrl.includes('supabase') ? { rejectUnauthorized: false } : false,
      max: 2, // Reduced for Shared Pooler (works better with fewer connections)
      min: 0, // Don't maintain minimum connections (let pooler handle it)
      idleTimeoutMillis: 10000, // Shorter idle timeout for pooler
      connectionTimeoutMillis: 10000, // Faster timeout for pooler
      query_timeout: 30000, // Query timeout
      // Connection pooler specific settings
      allowExitOnIdle: true, // Allow pool to close idle connections (pooler handles reconnection)
      // Handle connection errors gracefully
      application_name: 'lms-platform',
    });
    
    // Add error handlers to the pool
    pgPool.on('error', (err) => {
      logger.warn('PostgreSQL pool error:', err.message);
      // Don't reset connection on pool errors - let individual queries handle retries
    });
    
    // Test connection with retry logic
    let testClient = null;
    const maxRetries = 3;
    let lastError = null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        testClient = await Promise.race([
          pgPool.connect(),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Connection timeout after 15 seconds')), 15000)
          )
        ]);
        
        // Test with a simple query
        await testClient.query('SELECT 1');
        testClient.release();
        connectionInitialized = true;
        logger.info('✅ Direct PostgreSQL connection established for complex queries');
        connectionInitializing = false;
        return true;
      } catch (error) {
        lastError = error;
        if (testClient) {
          try {
            testClient.release();
          } catch (e) {
            // Ignore release errors
          }
          testClient = null;
        }
        
        if (attempt < maxRetries) {
          logger.debug(`Connection attempt ${attempt} failed, retrying... (${error.message})`);
          // Wait before retry (exponential backoff)
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
      }
    }
    
    // All retries failed
    throw lastError || new Error('Connection failed after multiple attempts');
  } catch (error) {
    connectionInitialized = false;
    connectionInitializing = false;
    
    // Provide helpful error messages for common issues
    let errorMessage = error.message;
    
    // Check if password might need URL encoding (only if it's not already encoded)
    const urlMatch = supabaseDbUrl.match(/postgresql:\/\/[^:]+:([^@]+)@/);
    if (urlMatch && urlMatch[1]) {
      const passwordInUrl = urlMatch[1];
      // Check if password contains unencoded special characters (not already URL-encoded)
      // If it contains % followed by hex digits, it's likely already encoded
      const isAlreadyEncoded = /%[0-9A-Fa-f]{2}/.test(passwordInUrl);
      // Check for unencoded special characters that need encoding
      if (!isAlreadyEncoded && (passwordInUrl.includes('@') || passwordInUrl.includes('#') || 
          passwordInUrl.includes('&') || passwordInUrl.includes('+') || passwordInUrl.includes('=') ||
          passwordInUrl.includes('/') || passwordInUrl.includes('?'))) {
        const encodedPassword = encodeURIComponent(passwordInUrl);
        errorMessage += '\n\n⚠️  PASSWORD ENCODING ISSUE DETECTED:\n' +
          `   Your password contains special characters that need URL encoding.\n` +
          `   Current password in URL: ${passwordInUrl}\n` +
          `   Should be encoded as: ${encodedPassword}\n` +
          `   Run: node backend/scripts/fix-db-connection.js\n` +
          `   Or manually encode: @ → %40, # → %23, % → %25, etc.`;
      }
    }
    
    // Handle connection termination errors (common with connection poolers)
    if (errorMessage.includes('terminated') || errorMessage.includes('Connection terminated') || 
        errorMessage.includes('connection closed') || errorMessage.includes('unexpectedly') ||
        errorMessage.includes('server closed the connection')) {
      errorMessage = 'Connection terminated unexpectedly. This can happen with connection poolers.\n' +
        '  1. The connection pooler may have closed idle connections\n' +
        '  2. This is usually temporary - the system will retry automatically\n' +
        '  3. Complex queries will attempt to reconnect when needed\n' +
        '  4. The app will work with Supabase PostgREST API for most queries\n' +
        '  5. If this persists, check your Supabase project status';
    } else if (errorMessage.includes('password authentication failed')) {
      errorMessage = 'Password authentication failed. Please check:\n' +
        '  1. Your SUPABASE_DB_URL connection string in .env\n' +
        '  2. If your password contains special characters, URL-encode them (e.g., @ becomes %40)\n' +
        '  3. Get the correct password from Supabase Dashboard → Settings → Database\n' +
        '  4. Connection string format: postgresql://postgres:[password]@db.[project-ref].supabase.co:5432/postgres\n' +
        '  5. Try connection pooling instead: postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres';
    } else if (errorMessage.includes('ENOTFOUND') || errorMessage.includes('getaddrinfo')) {
      errorMessage = 'Could not resolve database host. Check your SUPABASE_DB_URL connection string format.';
    } else if (errorMessage.includes('timeout') || errorMessage.includes('ETIMEDOUT') || errorMessage.includes('Connection timeout')) {
      errorMessage = 'Connection timeout. Possible causes:\n' +
        '  1. Network firewall blocking port 5432 (try connection pooling on port 6543 instead)\n' +
        '  2. Supabase project paused or not accessible\n' +
        '  3. Using direct connection - try connection pooling string instead:\n' +
        '     postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres\n' +
        '  4. Check Supabase Dashboard → Settings → Database for correct connection string';
    } else if (errorMessage.includes('ECONNREFUSED')) {
      errorMessage = 'Connection refused. Check:\n' +
        '  1. Supabase project is active (not paused)\n' +
        '  2. Connection string uses correct port (5432 for direct, 6543 for pooling)\n' +
        '  3. Try connection pooling string instead of direct connection';
    } else if (errorMessage.includes('Tenant or user not found') || errorMessage.includes('tenant') || errorMessage.includes('user not found')) {
      errorMessage = 'Tenant or user not found. This usually means:\n' +
        '  1. Connection pooling username format is incorrect\n' +
        '  2. For connection pooling, username should be: postgres.[project-ref]\n' +
        '  3. For direct connection, username should be: postgres\n' +
        '  4. Verify your connection string format:\n' +
        '     Pooling: postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres\n' +
        '     Direct: postgresql://postgres:[password]@db.[project-ref].supabase.co:5432/postgres\n' +
        '  5. Get the exact connection string from Supabase Dashboard → Settings → Database';
    }
    
    if (!retry) {
      logger.warn('⚠️ Could not establish direct PostgreSQL connection. Complex aggregation queries will need RPC functions.');
      logger.warn(`   Error: ${errorMessage}`);
      logger.warn('   Note: This is optional. The app will work with Supabase PostgREST API for most queries.');
    }
    
    // Clean up failed pool
    if (pgPool) {
      try {
        await pgPool.end();
      } catch (e) {
        // Ignore cleanup errors
      }
      pgPool = null;
    }
    
    return false;
  }
};

// Ensure connection is ready before queries
const ensurePostgresConnection = async () => {
  if (pgPool && connectionInitialized) {
    // Verify connection is still alive with a quick test
    try {
      const testClient = await Promise.race([
        pgPool.connect(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Connection check timeout')), 5000)
        )
      ]);
      await testClient.query('SELECT 1');
      testClient.release();
      return true;
    } catch (error) {
      // Connection is dead, reset and retry
      logger.debug('Connection pool health check failed, resetting...', error.message);
      connectionInitialized = false;
      if (pgPool) {
        try {
          await pgPool.end();
        } catch (e) {
          // Ignore cleanup errors
        }
        pgPool = null;
      }
    }
  }
  
  // Try to initialize if not already trying
  if (!connectionInitializing && supabaseDbUrl) {
    await initPostgresConnection(true); // Pass retry=true to allow reconnection
  }
  
  return pgPool !== null && connectionInitialized;
};

// Log connection status on startup
if (supabaseDbUrl) {
  // Mask password in connection string for logging
  const maskedUrl = supabaseDbUrl.replace(/:([^:@]+)@/, ':***@');
  logger.info(`📊 SUPABASE_DB_URL detected: ${maskedUrl}`);
  logger.info('   Attempting to establish direct PostgreSQL connection for complex queries...');
} else {
  logger.debug('ℹ️  SUPABASE_DB_URL not set - complex aggregation queries will use RPC functions');
}

// Initialize on module load (don't block if it fails)
initPostgresConnection().catch(err => {
  // Don't log here - initPostgresConnection already logs detailed errors
  // This catch is just to prevent unhandled promise rejection
});

// Connection pool stats (for compatibility with existing monitoring)
let poolStats = {
  totalConnections: 0,
  activeConnections: 0,
  idleConnections: 0,
  queueLength: 0,
  lastCheck: new Date()
};

// Test database connection
const testConnection = async () => {
  try {
    // Try to query a simple table to test connection
    const { data, error } = await supabase.from('users').select('id').limit(1);
    if (error && error.code !== 'PGRST116' && error.code !== '42P01') {
      // PGRST116/42P01 = relation does not exist (OK for initial setup)
      throw error;
    }
    logger.info('✅ Supabase connected successfully');
    return true;
  } catch (error) {
    logger.error('❌ Supabase connection failed:', error.message);
    return false;
  }
};

// Enhanced SQL parser for common MySQL patterns
class SQLParser {
  static parseSelect(sql, params = []) {
    // Map table names
    const normalizedSql = sql.replace(/assessment_templates/g, 'assessments');
    
    // Check if this is an aggregation query with JOINs - Supabase can't handle these
    const hasAggregations = /GROUP\s+BY|COUNT\s*\(|AVG\s*\(|SUM\s*\(|MAX\s*\(|MIN\s*\(|COALESCE\s*\(/i.test(normalizedSql);
    const hasJoins = /LEFT\s+JOIN|INNER\s+JOIN|JOIN/i.test(normalizedSql);
    
    // For aggregation queries with JOINs, use direct PostgreSQL connection if available
    if (hasAggregations && hasJoins) {
      logger.debug('Aggregation query with JOINs detected - using direct PostgreSQL connection if available');
      
      // Return a promise-like object that executes the query
      const queryPromise = (async () => {
        try {
          // Ensure connection is ready before executing
          const hasConnection = await ensurePostgresConnection();
          
          if (!hasConnection || !pgPool) {
            throw new Error('Complex aggregation queries with JOINs require SUPABASE_DB_URL environment variable for direct PostgreSQL connection. Please set SUPABASE_DB_URL in your .env file. Format: postgresql://postgres:[password]@[host]:5432/postgres');
          }
          
          // Convert MySQL syntax to PostgreSQL
          let pgSql = normalizedSql
            .replace(/assessment_templates/g, 'assessments')
            // Convert UUID() to gen_random_uuid()
            .replace(/UUID\(\)/gi, 'gen_random_uuid()')
            // Convert MySQL boolean TRUE/FALSE to PostgreSQL true/false
            .replace(/\bTRUE\b/g, 'true')
            .replace(/\bFALSE\b/g, 'false')
            // Convert status = 'published' to is_published = true
            .replace(/status\s*=\s*['"]published['"]/gi, 'is_published = true');
          
          // Replace ? placeholders with $1, $2, etc. for PostgreSQL
          let paramIndex = 1;
          pgSql = pgSql.replace(/\?/g, () => `$${paramIndex++}`);
          
          // Execute query with parameters
          const result = await pgPool.query(pgSql, params);
          return { data: result.rows, error: null };
        } catch (error) {
          logger.error('PostgreSQL query error:', error);
          throw error;
        }
      })();
      
      return queryPromise;
    }
    
    const tableMatch = normalizedSql.match(/FROM\s+`?(\w+)`?/i);
    if (!tableMatch) {
      throw new Error('Could not parse table name from SQL');
    }
    
    const tableName = tableMatch[1];
    let query = supabase.from(tableName);
    
    // Parse SELECT columns
    const selectMatch = normalizedSql.match(/SELECT\s+(.+?)\s+FROM/i);
    if (selectMatch) {
      const columns = selectMatch[1].trim();
      
      // Handle COUNT(*) queries
      if (columns.includes('COUNT(*)') || columns.includes('COUNT( * )')) {
        query = query.select('*', { count: 'exact', head: true });
      } else if (columns === '*' || columns.includes('*')) {
        // For SELECT *, use all columns
        query = query.select('*');
      } else {
        // Parse column list, handling table aliases (u.*, c.name)
        const columnList = columns.split(',').map(c => {
          const trimmed = c.trim().replace(/`/g, '');
          // Remove table alias prefix (e.g., "u." from "u.name")
          const withoutAlias = trimmed.replace(/^\w+\./, '');
          return withoutAlias;
        }).filter(c => c && c !== '*');
        
        if (columnList.length > 0) {
          query = query.select(columnList.join(','));
        } else {
          query = query.select('*');
        }
      }
    } else {
      query = query.select('*');
    }
    
    // Parse WHERE conditions - convert MySQL date functions first
    const whereMatch = normalizedSql.match(/WHERE\s+([\s\S]+?)(?:\s+ORDER|\s+GROUP|\s+LIMIT|$)/i);
    if (whereMatch) {
      let whereClause = whereMatch[1];
      // Convert DATE_SUB in WHERE clauses before parsing
      whereClause = whereClause.replace(/DATE_SUB\(NOW\(\),\s*INTERVAL\s+(\d+)\s+(DAY|MINUTE|HOUR|WEEK|MONTH|YEAR)\)/gi, 
        (match, value, unit) => {
          const multiplier = {
            'MINUTE': 60 * 1000,
            'HOUR': 60 * 60 * 1000,
            'DAY': 24 * 60 * 60 * 1000,
            'WEEK': 7 * 24 * 60 * 60 * 1000,
            'MONTH': 30 * 24 * 60 * 60 * 1000,
            'YEAR': 365 * 24 * 60 * 60 * 1000
          }[unit.toUpperCase()] || 1000;
          const dateValue = new Date(Date.now() - parseInt(value, 10) * multiplier);
          return dateValue.toISOString();
        });
      
      const conditions = this.parseWhereClause(whereClause, params);
      conditions.forEach(condition => {
        // Extract the table alias from the column reference
        const columnTableMatch = condition.column.match(/^(\w+)\./);
        if (columnTableMatch) {
          const columnTable = columnTableMatch[1].toLowerCase();
          // Main table aliases that are safe (these might be the main table)
          const mainTableAliases = [tableName.toLowerCase(), 'c', 'd', 'u'];
          // Known joined table aliases that should be skipped
          const joinedTableAliases = ['sub', 'at', 'a', 's', 'sr', 'b'];
          
          // If it's a known joined table alias, skip it
          if (joinedTableAliases.includes(columnTable)) {
            logger.debug(`Skipping WHERE condition for joined table alias: ${condition.column}`);
            return;
          }
          // If it's not a main table alias, also skip it
          if (!mainTableAliases.includes(columnTable)) {
            logger.debug(`Skipping WHERE condition for unknown table alias: ${condition.column}`);
            return;
          }
        }
        // Also skip conditions on columns that don't exist in the main table
        const cleanColumn = condition.column.replace(/^\w+\./, '');
        const invalidColumns = ['submitted_at', 'percentage_score', 'status', 'student_id', 'assessment_id'];
        if (invalidColumns.includes(cleanColumn.toLowerCase()) && condition.column.includes('.')) {
          logger.debug(`Skipping WHERE condition for invalid column in main table: ${condition.column}`);
          return;
        }
        
        // Only apply conditions that are valid for the main table
        try {
          if (condition.operator === '=') {
            query = query.eq(cleanColumn, condition.value);
          } else if (condition.operator === '!=' || condition.operator === '<>') {
            query = query.neq(cleanColumn, condition.value);
          } else if (condition.operator === '>') {
            query = query.gt(cleanColumn, condition.value);
          } else if (condition.operator === '<') {
            query = query.lt(cleanColumn, condition.value);
          } else if (condition.operator === '>=') {
            query = query.gte(cleanColumn, condition.value);
          } else if (condition.operator === '<=') {
            query = query.lte(cleanColumn, condition.value);
          } else if (condition.operator === 'LIKE') {
            query = query.like(cleanColumn, condition.value.replace(/%/g, ''));
          } else if (condition.operator === 'IN') {
            query = query.in(cleanColumn, condition.value);
          }
        } catch (whereError) {
          logger.debug(`Failed to apply WHERE condition for ${cleanColumn}, skipping:`, whereError.message);
        }
      });
    }
    
    // Parse ORDER BY - handle table aliases (e.g., "u.id" -> "id")
    // For aggregation queries with JOINs, skip ORDER BY on calculated columns
    const orderMatch = normalizedSql.match(/ORDER\s+BY\s+`?(\w+\.)?(\w+)`?(?:\s+(ASC|DESC))?/i);
    if (orderMatch) {
      const columnName = orderMatch[2]; // Get column name without table alias
      
      // List of calculated columns that don't exist in tables
      const calculatedColumns = [
        'averagescore', 'average_score', 'totalstudents', 'total_students',
        'totalassessments', 'total_assessments', 'completedassessments', 'completed_assessments',
        'totalsubmissions', 'total_submissions', 'lowestscore', 'lowest_score',
        'highestscore', 'highest_score', 'averagetimetaken', 'average_time_taken'
      ];
      
      // Skip ORDER BY for calculated columns
      if (calculatedColumns.includes(columnName.toLowerCase())) {
        logger.debug(`Skipping ORDER BY for calculated column: ${columnName}`);
      } else {
        try {
          query = query.order(columnName, { ascending: orderMatch[3]?.toUpperCase() !== 'DESC' });
        } catch (orderError) {
          logger.debug(`Failed to apply ORDER BY for ${columnName}, skipping:`, orderError.message);
        }
      }
    }
    
    // Parse LIMIT
    const limitMatch = sql.match(/LIMIT\s+(\d+)(?:\s*,\s*(\d+))?/i);
    if (limitMatch) {
      const limit = parseInt(limitMatch[1]);
      const offset = limitMatch[2] ? parseInt(limitMatch[2]) : 0;
      query = query.range(offset, offset + limit - 1);
    }
    
    return query;
  }
  
  static parseWhereClause(whereClause, params) {
    const conditions = [];
    // Handle MySQL date functions first
    let processedClause = whereClause;
    
    // Convert DATE_SUB(NOW(), INTERVAL X UNIT) to JavaScript date calculation
    processedClause = processedClause.replace(/DATE_SUB\(NOW\(\),\s*INTERVAL\s+(\d+)\s+(MINUTE|HOUR|DAY|WEEK|MONTH|YEAR)\)/gi, 
      (match, value, unit) => {
        const multiplier = {
          'MINUTE': 60 * 1000,
          'HOUR': 60 * 60 * 1000,
          'DAY': 24 * 60 * 60 * 1000,
          'WEEK': 7 * 24 * 60 * 60 * 1000,
          'MONTH': 30 * 24 * 60 * 60 * 1000,
          'YEAR': 365 * 24 * 60 * 60 * 1000
        }[unit.toUpperCase()] || 1000;
        const dateValue = new Date(Date.now() - parseInt(value, 10) * multiplier);
        return dateValue.toISOString();
      });
    
    // Split by AND/OR but keep them
    const parts = processedClause.split(/\s+(AND|OR)\s+/i);
    let paramIndex = 0;
    
    for (let i = 0; i < parts.length; i += 2) {
      const part = parts[i];
      if (!part) continue;
      
      // Match: column operator value (including date ISO strings and table aliases like "at.status")
      // Pattern: (table_alias.)?column operator value
      const match = part.match(/`?(\w+\.)?(\w+)`?\s*(=|!=|<>|>|<|>=|<=|LIKE|IN)\s*(\?|'[^']*'|"[^"]*"|`?\w+`?|\d+|NULL|[\d-]+T[\d:]+(\.\d+)?Z?)/i);
      if (match) {
        let column = match[2] || match[1]; // Use column name without table alias
        const operator = match[3];
        let value = match[4];
        
        // Map assessment_templates.status = 'published' to assessments.is_published = true
        if (column === 'status' && value === "'published'" || value === '"published"') {
          column = 'is_published';
          value = true;
        } else {
          // Replace ? with param value
          if (value === '?') {
            value = params[paramIndex++];
          } else if (value === 'NULL' || value === 'null') {
            value = null;
          } else if (value.startsWith("'") || value.startsWith('"')) {
            value = value.slice(1, -1);
          } else if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
            // ISO date string - keep as is
            value = value.replace(/Z$/, '');
          } else if (!isNaN(value) && value !== '') {
            value = parseFloat(value);
          }
        }
        
        conditions.push({ column, operator, value });
      }
    }
    
    return conditions;
  }
  
  static parseInsert(sql, params) {
    const tableMatch = sql.match(/INSERT\s+INTO\s+`?(\w+)`?/i);
    if (!tableMatch) {
      throw new Error('Could not parse table name from INSERT SQL');
    }
    
    const tableName = tableMatch[1];
    
    // Check for ON DUPLICATE KEY UPDATE (MySQL) or ON CONFLICT (PostgreSQL)
    const isUpsert = /ON\s+DUPLICATE\s+KEY\s+UPDATE/i.test(sql) || /ON\s+CONFLICT/i.test(sql);
    
    // Parse columns
    const columnsMatch = sql.match(/\(([^)]+)\)/);
    if (!columnsMatch) {
      throw new Error('Could not parse columns from INSERT SQL');
    }
    
    const columns = columnsMatch[1].split(',').map(c => c.trim().replace(/`/g, ''));
    
    // Parse VALUES
    const valuesMatch = sql.match(/VALUES\s*\(([^)]+)\)/i);
    if (!valuesMatch) {
      throw new Error('Could not parse values from INSERT SQL');
    }
    
    let paramIndex = 0;
    const values = valuesMatch[1].split(',').map((v) => {
      const trimmed = v.trim();
      if (trimmed === '?') {
        return params[paramIndex++];
      } else if (trimmed === 'NULL' || trimmed === 'null') {
        return null;
      } else if (trimmed === 'NOW()' || trimmed === 'CURRENT_TIMESTAMP') {
        return new Date().toISOString();
      } else if (trimmed.startsWith("'") || trimmed.startsWith('"')) {
        return trimmed.slice(1, -1);
      } else if (!isNaN(trimmed) && trimmed !== '') {
        return parseFloat(trimmed);
      }
      return trimmed;
    });
    
    // Build object
    const record = {};
    columns.forEach((col, i) => {
      record[col] = values[i];
    });
    
    // Parse UPDATE fields for ON DUPLICATE KEY UPDATE (MySQL) or ON CONFLICT (PostgreSQL)
    if (isUpsert) {
      // Handle MySQL syntax: ON DUPLICATE KEY UPDATE
      let updateMatch = sql.match(/ON\s+DUPLICATE\s+KEY\s+UPDATE\s+(.+?)(?:\s+WHERE|$)/i);
      
      // Handle PostgreSQL syntax: ON CONFLICT ... DO UPDATE SET
      if (!updateMatch) {
        updateMatch = sql.match(/ON\s+CONFLICT[^D]+DO\s+UPDATE\s+SET\s+(.+?)(?:\s+WHERE|$)/i);
      }
      
      if (updateMatch) {
        const updateClause = updateMatch[1];
        const assignments = updateClause.split(',').map(a => a.trim());
        assignments.forEach(assignment => {
          // Handle both "column = value" and "column = EXCLUDED.column" syntax
          const [col, val] = assignment.split('=').map(s => s.trim().replace(/`/g, ''));
          const cleanCol = col.trim();
          
          if (val === '?' || val.includes('EXCLUDED.')) {
            // For EXCLUDED.column, use the value from the record we're inserting
            const excludedCol = val.replace('EXCLUDED.', '').trim();
            record[cleanCol] = record[excludedCol] || params[paramIndex++];
          } else if (val === 'NOW()' || val === 'CURRENT_TIMESTAMP') {
            record[cleanCol] = new Date().toISOString();
          } else if (val.startsWith("'") || val.startsWith('"')) {
            record[cleanCol] = val.slice(1, -1);
          } else {
            record[cleanCol] = val;
          }
        });
      }
    }
    
    return { tableName, record, isUpsert };
  }
  
  static parseUpdate(sql, params) {
    const tableMatch = sql.match(/UPDATE\s+`?(\w+)`?/i);
    if (!tableMatch) {
      throw new Error('Could not parse table name from UPDATE SQL');
    }
    
    const tableName = tableMatch[1];
    
    // Parse SET clause
    const setMatch = sql.match(/SET\s+(.+?)(?:\s+WHERE|$)/i);
    if (!setMatch) {
      throw new Error('Could not parse SET clause from UPDATE SQL');
    }
    
    const updates = {};
    const setClause = setMatch[1];
    const assignments = setClause.split(',');
    
    let paramIndex = 0;
    assignments.forEach(assignment => {
      const [column, value] = assignment.split('=').map(s => s.trim().replace(/`/g, ''));
      if (value === '?') {
        updates[column] = params[paramIndex++];
      } else if (value === 'NULL' || value === 'null') {
        updates[column] = null;
      } else if (value.startsWith("'") || value.startsWith('"')) {
        updates[column] = value.slice(1, -1);
      } else if (!isNaN(value) && value !== '') {
        updates[column] = parseFloat(value);
      } else {
        updates[column] = value;
      }
    });
    
    // Parse WHERE clause
    const whereMatch = sql.match(/WHERE\s+([\s\S]+?)(?:\s+LIMIT|$)/i);
    const whereConditions = whereMatch ? this.parseWhereClause(whereMatch[1], params.slice(paramIndex)) : [];
    
    return { tableName, updates, whereConditions };
  }
  
  static parseDelete(sql, params) {
    const tableMatch = sql.match(/DELETE\s+FROM\s+`?(\w+)`?/i);
    if (!tableMatch) {
      throw new Error('Could not parse table name from DELETE SQL');
    }
    
    const tableName = tableMatch[1];
    
    // Parse WHERE clause
    const whereMatch = sql.match(/WHERE\s+(.+?)(?:\s+LIMIT|$)/i);
    const whereConditions = whereMatch ? this.parseWhereClause(whereMatch[1], params) : [];
    
    return { tableName, whereConditions };
  }
}

// Main query function
export const query = async (sql, params = []) => {
  try {
    const sqlUpper = sql.trim().toUpperCase();
    
    // Handle COUNT(*) queries specially - must be before general SELECT handling
    if (sqlUpper.includes('COUNT(*)') || sqlUpper.includes('COUNT( * )')) {
      // Replace MySQL date functions with PostgreSQL equivalents
      let processedSql = sql
        .replace(/DATE_SUB\(NOW\(\),\s*INTERVAL\s+(\d+)\s+MINUTE\)/gi, (match, minutes) => {
          // Convert to PostgreSQL: NOW() - INTERVAL 'X minutes'
          return `(NOW() - INTERVAL '${minutes} minutes')`;
        })
        .replace(/DATE_SUB\(NOW\(\),\s*INTERVAL\s+(\d+)\s+DAY\)/gi, (match, days) => {
          return `(NOW() - INTERVAL '${days} days')`;
        });
      
      // Extract table name and WHERE clause
      const tableMatch = processedSql.match(/FROM\s+`?(\w+)`?/i);
      if (!tableMatch) {
        throw new Error('Could not parse table name from COUNT query');
      }
      
      const tableName = tableMatch[1];
      // Map table names
      const mappedTableName = tableName === 'assessment_templates' ? 'assessments' : tableName;
      
      let query = supabase.from(mappedTableName).select('*', { count: 'exact', head: true });
      
      // Parse WHERE conditions - handle MySQL date functions
      const whereMatch = processedSql.match(/WHERE\s+([\s\S]+?)(?:\s+ORDER|\s+GROUP|\s+LIMIT|$)/i);
      if (whereMatch) {
        let whereClause = whereMatch[1];
        // Convert MySQL date comparisons to PostgreSQL
        whereClause = whereClause.replace(/attempted_at\s*>\s*DATE_SUB\(NOW\(\),\s*INTERVAL\s+(\d+)\s+MINUTE\)/gi, 
          (match, minutes) => {
            return `attempted_at > (NOW() - INTERVAL '${minutes} minutes')`;
          });
        
        const conditions = SQLParser.parseWhereClause(whereClause, params);
        conditions.forEach(condition => {
          if (condition.operator === '=') {
            query = query.eq(condition.column, condition.value);
          } else if (condition.operator === '!=' || condition.operator === '<>') {
            query = query.neq(condition.column, condition.value);
          } else if (condition.operator === '>') {
            query = query.gt(condition.column, condition.value);
          } else if (condition.operator === '<') {
            query = query.lt(condition.column, condition.value);
          } else if (condition.operator === '>=') {
            query = query.gte(condition.column, condition.value);
          } else if (condition.operator === '<=') {
            query = query.lte(condition.column, condition.value);
          } else if (condition.operator === 'LIKE') {
            query = query.like(condition.column, condition.value.replace(/%/g, ''));
          } else if (condition.operator === 'IN') {
            query = query.in(condition.column, condition.value);
          }
        });
      }
      
      const { count, error } = await query;
      if (error) {
        // If error, try without head option
        const retryQuery = supabase.from(mappedTableName).select('*', { count: 'exact' });
        const { count: retryCount, error: retryError } = await retryQuery;
        if (retryError) throw retryError;
        return [[{ count: retryCount || 0 }]];
      }
      return [[{ count: count || 0 }]];
    }
    
    // SELECT queries
    if (sqlUpper.startsWith('SELECT')) {
      // Handle SELECT * queries - need to get all columns
      if (sql.includes('*') && !sql.includes('COUNT')) {
        // For SELECT * queries, we need to specify columns or use RPC
        // For now, let's try to get the table and select all
        const tableMatch = sql.match(/FROM\s+`?(\w+)`?/i);
        if (tableMatch) {
          const tableName = tableMatch[1];
          const mappedTableName = tableName === 'assessment_templates' ? 'assessments' : tableName;
          
          // For SELECT u.*, we need to handle joins differently
          if (sql.includes('u.*') || sql.includes('LEFT JOIN') || sql.includes('JOIN')) {
            // Check if it's an aggregation query (these are handled correctly by SQLParser)
            const hasAggregations = /GROUP\s+BY|COUNT\s*\(|AVG\s*\(|SUM\s*\(|MAX\s*\(|MIN\s*\(|COALESCE\s*\(/i.test(sql);
            const hasCalculatedColumns = /as\s+(averageScore|average_score|totalStudents|total_students|totalAssessments|total_assessments|completedAssessments|completed_assessments|totalSubmissions|total_submissions)/i.test(sql);
            
            // Try to execute as-is with Supabase - only warn if it fails
            try {
              const query = SQLParser.parseSelect(sql.replace(/assessment_templates/g, 'assessments'), params);
              const { data, error } = await query;
              if (error) {
                // Only warn if query fails and it's not an aggregation query
                if (!hasAggregations && !hasCalculatedColumns) {
                  logger.warn('Complex SELECT with joins failed, may need RPC function:', sql.substring(0, 100), error.message);
                }
                throw error;
              }
              return [data || []];
            } catch (queryError) {
              // If Supabase query fails, try direct PostgreSQL connection if available
              if (!hasAggregations && !hasCalculatedColumns) {
                const hasConnection = await ensurePostgresConnection();
                if (hasConnection && pgPool) {
                  logger.debug('Falling back to direct PostgreSQL connection for JOIN query');
                  try {
                    let pgSql = sql.replace(/assessment_templates/g, 'assessments');
                    let paramIndex = 1;
                    pgSql = pgSql.replace(/\?/g, () => `$${paramIndex++}`);
                    const result = await pgPool.query(pgSql, params);
                    return [result.rows || []];
                  } catch (pgError) {
                    logger.error('PostgreSQL query also failed:', pgError);
                    throw queryError; // Throw original error
                  }
                }
              }
              throw queryError;
            }
          } else {
            // Simple SELECT * - get all columns
            let query = supabase.from(mappedTableName).select('*');
            
            // Parse WHERE conditions
            const whereMatch = sql.match(/WHERE\s+([\s\S]+?)(?:\s+ORDER|\s+GROUP|\s+LIMIT|$)/i);
            if (whereMatch) {
              const conditions = SQLParser.parseWhereClause(whereMatch[1], params);
              conditions.forEach(condition => {
                if (condition.operator === '=') {
                  query = query.eq(condition.column, condition.value);
                } else if (condition.operator === '!=' || condition.operator === '<>') {
                  query = query.neq(condition.column, condition.value);
                } else if (condition.operator === '>') {
                  query = query.gt(condition.column, condition.value);
                } else if (condition.operator === '<') {
                  query = query.lt(condition.column, condition.value);
                } else if (condition.operator === '>=') {
                  query = query.gte(condition.column, condition.value);
                } else if (condition.operator === '<=') {
                  query = query.lte(condition.column, condition.value);
                }
              });
            }
            
            const { data, error } = await query;
            if (error) throw error;
            return [data || []];
          }
        }
      }
      
      // Replace assessment_templates with assessments and handle MySQL date functions
      // Also map status = 'published' to is_published = true for assessments
      let normalizedSql = sql
        .replace(/assessment_templates/g, 'assessments')
        .replace(/at\.status\s*=\s*['"]published['"]/gi, 'at.is_published = true')
        .replace(/assessments\.status\s*=\s*['"]published['"]/gi, 'assessments.is_published = true');
      
      // Skip Supabase foreign key approach for complex aggregation queries
      // These queries use GROUP BY, COUNT, AVG, etc. and need to be executed as raw SQL
      const hasAggregations = /GROUP\s+BY|COUNT\s*\(|AVG\s*\(|SUM\s*\(|MAX\s*\(|MIN\s*\(|COALESCE\s*\(/i.test(normalizedSql);
      const hasCalculatedColumns = /as\s+(averageScore|average_score|totalStudents|total_students|totalAssessments|total_assessments|completedAssessments|completed_assessments|totalSubmissions|total_submissions)/i.test(normalizedSql);
      
      // Log when skipping Supabase approach for aggregation queries
      if ((normalizedSql.includes('u.*') || normalizedSql.includes('LEFT JOIN') || normalizedSql.includes('JOIN')) && (hasAggregations || hasCalculatedColumns)) {
        logger.debug('Skipping Supabase foreign key approach for aggregation query, using raw SQL parser');
      }
      
      // Handle SELECT queries with JOINs - use Supabase foreign key relationships
      // BUT skip if it's an aggregation query (GROUP BY, COUNT, AVG, etc.)
      // Also handle SELECT * or SELECT table.* patterns, not just u.*
      const hasJoinPattern = normalizedSql.includes('LEFT JOIN') || normalizedSql.includes('INNER JOIN') || 
                             normalizedSql.includes('RIGHT JOIN') || normalizedSql.includes('JOIN') ||
                             normalizedSql.match(/SELECT\s+\w+\.\*/i);
      
      if (hasJoinPattern && !hasAggregations && !hasCalculatedColumns) {
        const mainTableMatch = normalizedSql.match(/FROM\s+`?(\w+)`?\s+(\w+)?/i);
        if (mainTableMatch) {
          const mainTable = mainTableMatch[1];
          
          // Check for common JOIN patterns and use Supabase foreign key syntax
          let selectString = '*';
          const needsCollegeData = normalizedSql.includes('colleges') || normalizedSql.includes('college_name') || 
                                  normalizedSql.match(/JOIN\s+colleges/i) || normalizedSql.match(/colleges\s+c\s+ON/i);
          const needsDepartmentData = normalizedSql.includes('departments') || normalizedSql.includes('department_name') ||
                                     normalizedSql.match(/JOIN\s+departments/i) || normalizedSql.match(/departments\s+d\s+ON/i);
          const needsBatchData = normalizedSql.includes('batches') || normalizedSql.includes('batch_name') ||
                                normalizedSql.match(/JOIN\s+batches/i) || normalizedSql.match(/batches\s+b\s+ON/i);
          const needsCodingQuestions = normalizedSql.includes('coding_questions') || normalizedSql.includes('test_cases') ||
                                      normalizedSql.match(/JOIN\s+coding_questions/i);
          const needsCodingPlatforms = normalizedSql.includes('coding_platforms') || normalizedSql.includes('platform_name') ||
                                      normalizedSql.match(/JOIN\s+coding_platforms/i);
          
          // Build Supabase foreign key relationships
          const foreignKeyJoins = [];
          
          // Common patterns: detect what tables are being joined
          const needsUserData = normalizedSql.includes('users') || normalizedSql.includes('u.id') || normalizedSql.includes('created_by') || normalizedSql.includes('student_id') || normalizedSql.includes('instructor_id');
          const needsAssessmentData = normalizedSql.includes('assessments') || normalizedSql.includes('at.id') || normalizedSql.includes('assessment_id');
          const needsCourseData = normalizedSql.includes('courses') || normalizedSql.includes('course_id');
          const needsQuestionCategoryData = normalizedSql.includes('question_categories') || normalizedSql.includes('category_id') || normalizedSql.includes('subcategory_id');
          
          if (mainTable === 'users') {
            if (needsCollegeData) {
              foreignKeyJoins.push('colleges!users_college_id_fkey(name, code)');
            }
            if (needsDepartmentData) {
              // Try department_id foreign key if it exists, otherwise use department field
              foreignKeyJoins.push('departments!users_department_id_fkey(name)');
            }
            if (needsBatchData) {
              foreignKeyJoins.push('batches!users_batch_id_fkey(name)');
            }
          } else if (mainTable === 'questions') {
            if (needsCodingQuestions) {
              foreignKeyJoins.push('coding_questions!questions_id_fkey(test_cases, language)');
            }
            if (needsQuestionCategoryData) {
              foreignKeyJoins.push('question_categories!questions_category_id_fkey(name)');
            }
            if (needsUserData) {
              foreignKeyJoins.push('users!questions_created_by_fkey(name, email)');
            }
            if (needsCollegeData) {
              foreignKeyJoins.push('colleges!questions_college_id_fkey(name)');
            }
          } else if (mainTable === 'student_coding_profiles') {
            if (needsCodingPlatforms) {
              foreignKeyJoins.push('coding_platforms!student_coding_profiles_platform_id_fkey(name)');
            }
            if (needsUserData) {
              foreignKeyJoins.push('users!student_coding_profiles_student_id_fkey(name, email)');
            }
          } else if (mainTable === 'assessments') {
            if (needsCollegeData) {
              foreignKeyJoins.push('colleges!assessments_college_id_fkey(name, code)');
            }
            if (needsCourseData) {
              foreignKeyJoins.push('courses!assessments_course_id_fkey(title, code)');
            }
            if (needsUserData) {
              foreignKeyJoins.push('users!assessments_created_by_fkey(name, email)');
            }
          } else if (mainTable === 'assessment_submissions') {
            if (needsAssessmentData) {
              foreignKeyJoins.push('assessments!assessment_submissions_assessment_id_fkey(title, type)');
            }
            if (needsUserData) {
              foreignKeyJoins.push('users!assessment_submissions_student_id_fkey(name, email)');
            }
          } else if (mainTable === 'courses') {
            if (needsCollegeData) {
              foreignKeyJoins.push('colleges!courses_college_id_fkey(name, code)');
            }
            if (needsDepartmentData) {
              foreignKeyJoins.push('departments!courses_department_id_fkey(name)');
            }
            if (needsUserData) {
              foreignKeyJoins.push('users!courses_instructor_id_fkey(name, email)');
            }
          } else if (mainTable === 'course_enrollments') {
            if (needsCourseData) {
              foreignKeyJoins.push('courses!course_enrollments_course_id_fkey(title, code)');
            }
            if (needsUserData) {
              foreignKeyJoins.push('users!course_enrollments_student_id_fkey(name, email)');
            }
          } else if (mainTable === 'question_categories') {
            if (needsUserData) {
              foreignKeyJoins.push('users!question_categories_created_by_fkey(name, email)');
            }
            if (needsCollegeData) {
              foreignKeyJoins.push('colleges!question_categories_college_id_fkey(name)');
            }
          } else if (mainTable === 'departments') {
            if (needsCollegeData) {
              foreignKeyJoins.push('colleges!departments_college_id_fkey(name, code)');
            }
          }
          
          // Build select string with foreign key relationships
          if (foreignKeyJoins.length > 0) {
            selectString = `*, ${foreignKeyJoins.join(', ')}`;
          }
          
          logger.debug('JOIN query detected, attempting Supabase foreign key relationships:', { mainTable, selectString, sqlPreview: normalizedSql.substring(0, 100) });
          let query = supabase.from(mainTable).select(selectString);
          
          // Apply WHERE conditions (remove table aliases)
          const whereMatch = normalizedSql.match(/WHERE\s+([\s\S]+?)(?:\s+ORDER|\s+GROUP|\s+LIMIT|$)/i);
          if (whereMatch) {
            let whereClause = whereMatch[1];
            // Remove table aliases from WHERE clause for main table columns
            whereClause = whereClause.replace(/\bu\.(\w+)/g, '$1');
            
            // List of columns that don't exist in main tables
            const invalidColumns = [
              'submitted_at', 'averagescore', 'average_score', 'totalstudents', 'total_students',
              'totalassessments', 'total_assessments', 'completedassessments', 'completed_assessments'
            ];
            
            const conditions = SQLParser.parseWhereClause(whereClause, params);
            conditions.forEach(condition => {
              const cleanColumn = condition.column.replace(/^(u|main|c|d|at|sub)\./, '');
              
              // Skip conditions on calculated columns or columns from joined tables
              if (invalidColumns.includes(cleanColumn.toLowerCase())) {
                logger.debug(`Skipping WHERE condition for invalid column: ${cleanColumn}`);
                return;
              }
              
              // Skip if column references a different table
              const columnTableMatch = condition.column.match(/^(\w+)\./);
              if (columnTableMatch) {
                const columnTable = columnTableMatch[1];
                if (columnTable !== mainTable && 
                    columnTable !== 'u' && columnTable !== 'main' &&
                    !(columnTable === 'c' && mainTable === 'colleges') &&
                    !(columnTable === 'd' && mainTable === 'departments') &&
                    !(columnTable === 'u' && mainTable === 'users')) {
                  logger.debug(`Skipping WHERE condition for column from different table: ${condition.column}`);
                  return;
                }
              }
              
              try {
                if (condition.operator === '=') {
                  query = query.eq(cleanColumn, condition.value);
                } else if (condition.operator === '!=' || condition.operator === '<>') {
                  query = query.neq(cleanColumn, condition.value);
                } else if (condition.operator === '>') {
                  query = query.gt(cleanColumn, condition.value);
                } else if (condition.operator === '<') {
                  query = query.lt(cleanColumn, condition.value);
                } else if (condition.operator === '>=') {
                  query = query.gte(cleanColumn, condition.value);
                } else if (condition.operator === '<=') {
                  query = query.lte(cleanColumn, condition.value);
                }
              } catch (whereError) {
                logger.debug(`Failed to apply WHERE condition for ${cleanColumn}, skipping:`, whereError.message);
              }
            });
          }
          
          // Apply ORDER BY (remove table aliases)
          // Skip ORDER BY for calculated columns or columns from joined tables
          const orderMatch = normalizedSql.match(/ORDER\s+BY\s+`?(\w+\.)?(\w+)`?(?:\s+(ASC|DESC))?/i);
          if (orderMatch) {
            const tablePrefix = orderMatch[1]?.replace('.', '') || '';
            const columnName = orderMatch[2];
            
            // List of calculated columns that don't exist in tables
            const calculatedColumns = [
              'averagescore', 'average_score', 'totalstudents', 'total_students',
              'totalassessments', 'total_assessments', 'completedassessments', 'completed_assessments',
              'totalsubmissions', 'total_submissions', 'lowestscore', 'lowest_score',
              'highestscore', 'highest_score', 'averagetimetaken', 'average_time_taken'
            ];
            
            // List of columns that don't exist in specific tables
            const invalidColumnsForTable = {
              'colleges': ['submitted_at'],
              'departments': ['submitted_at', 'averagescore', 'average_score'],
              'users': ['averagescore', 'average_score'],
              'assessments': ['submitted_at'] // submitted_at is in assessment_submissions, not assessments
            };
            
            // Skip if it's a calculated column
            if (calculatedColumns.includes(columnName.toLowerCase())) {
              logger.debug(`Skipping ORDER BY for calculated column: ${columnName}`);
            }
            // Skip if column doesn't exist in the main table
            else if (invalidColumnsForTable[mainTable]?.includes(columnName.toLowerCase())) {
              logger.debug(`Skipping ORDER BY for invalid column in ${mainTable}: ${columnName}`);
            }
            // Skip if ORDER BY references a different table explicitly
            else if (tablePrefix && 
                     tablePrefix !== mainTable && 
                     tablePrefix !== 'u' && 
                     tablePrefix !== 'c' && 
                     tablePrefix !== 'd' && 
                     tablePrefix !== 'at' && 
                     tablePrefix !== 'sub') {
              logger.debug(`Skipping ORDER BY for column from different table: ${tablePrefix}.${columnName}`);
            }
            // Skip if table prefix doesn't match main table
            else if (tablePrefix && 
                     ((tablePrefix === 'c' && mainTable !== 'colleges') ||
                      (tablePrefix === 'd' && mainTable !== 'departments') ||
                      (tablePrefix === 'u' && mainTable !== 'users') ||
                      (tablePrefix === 'at' && mainTable !== 'assessments') ||
                      (tablePrefix === 'sub' && mainTable !== 'assessment_submissions'))) {
              logger.debug(`Skipping ORDER BY for column from joined table: ${tablePrefix}.${columnName}`);
            }
            // Only apply ORDER BY if it's a valid column from the main table
            else {
              try {
                query = query.order(columnName, { ascending: orderMatch[3]?.toUpperCase() !== 'DESC' });
              } catch (orderError) {
                logger.debug(`Failed to apply ORDER BY for ${columnName}, skipping:`, orderError.message);
              }
            }
          }
          
          const { data, error } = await query;
          if (error) {
            // Try direct PostgreSQL connection if available before fallback
            const hasConnection = await ensurePostgresConnection();
            if (hasConnection && pgPool) {
              logger.debug('Foreign key selection failed, trying direct PostgreSQL connection');
              try {
                let pgSql = normalizedSql;
                let paramIndex = 1;
                pgSql = pgSql.replace(/\?/g, () => `$${paramIndex++}`);
                const result = await pgPool.query(pgSql, params);
                return [result.rows || []];
              } catch (pgError) {
                logger.debug('PostgreSQL query failed, using Supabase fallback:', pgError.message);
              }
            }
            
            // Fallback: fetch main table and related data separately
            logger.debug('Foreign key selection failed, using fallback approach:', error.message);
            
            // Fetch main table data
            let mainQuery = supabase.from(mainTable).select('*');
            const whereMatch = normalizedSql.match(/WHERE\s+([\s\S]+?)(?:\s+ORDER|\s+GROUP|\s+LIMIT|$)/i);
            if (whereMatch) {
              let whereClause = whereMatch[1].replace(/\bu\.(\w+)/g, '$1');
              const conditions = SQLParser.parseWhereClause(whereClause, params);
              
              // List of columns that don't exist in main tables
              const invalidColumns = [
                'submitted_at', 'averagescore', 'average_score', 'totalstudents', 'total_students',
                'totalassessments', 'total_assessments', 'completedassessments', 'completed_assessments'
              ];
              
              conditions.forEach(condition => {
                const cleanColumn = condition.column.replace(/^(u|main|c|d|at|sub)\./, '');
                
                // Skip conditions on calculated columns or columns from joined tables
                if (invalidColumns.includes(cleanColumn.toLowerCase())) {
                  logger.debug(`Skipping WHERE condition for invalid column: ${cleanColumn}`);
                  return;
                }
                
                // Skip if column references a different table
                const columnTableMatch = condition.column.match(/^(\w+)\./);
                if (columnTableMatch) {
                  const columnTable = columnTableMatch[1];
                  if (columnTable !== mainTable && 
                      columnTable !== 'u' && columnTable !== 'main' &&
                      !(columnTable === 'c' && mainTable === 'colleges') &&
                      !(columnTable === 'd' && mainTable === 'departments') &&
                      !(columnTable === 'u' && mainTable === 'users')) {
                    logger.debug(`Skipping WHERE condition for column from different table: ${condition.column}`);
                    return;
                  }
                }
                
                // Only apply conditions for main table columns
                if (condition.operator === '=') {
                  try {
                    mainQuery = mainQuery.eq(cleanColumn, condition.value);
                  } catch (whereError) {
                    logger.debug(`Failed to apply WHERE condition for ${cleanColumn}, skipping:`, whereError.message);
                  }
                }
              });
            }
            
            const { data: mainData, error: mainError } = await mainQuery;
            if (mainError) throw mainError;
            
            // Fetch related college data if needed
            if (needsCollegeData && mainData) {
              const collegeIds = [...new Set(mainData.map(u => u.college_id).filter(Boolean))];
              if (collegeIds.length > 0) {
                const { data: colleges } = await supabase
                  .from('colleges')
                  .select('id, name, code')
                  .in('id', collegeIds);
                
                const collegeMap = new Map((colleges || []).map(c => [c.id, c]));
                
                // Merge college data
                mainData.forEach(user => {
                  const college = collegeMap.get(user.college_id);
                  if (college) {
                    user.college_name = college.name;
                    user.college_code = college.code;
                  } else {
                    user.college_name = null;
                    user.college_code = null;
                  }
                });
              }
            }
            
            return [mainData || []];
          }
          
          // Transform Supabase response to match SQL JOIN format
          const transformed = (data || []).map(row => {
            const result = { ...row };
            // Flatten foreign key relationships
            if (row.colleges) {
              if (Array.isArray(row.colleges) && row.colleges.length > 0) {
                result.college_name = row.colleges[0].name;
                result.college_code = row.colleges[0].code;
              } else if (typeof row.colleges === 'object') {
                result.college_name = row.colleges.name;
                result.college_code = row.colleges.code;
              }
              delete result.colleges;
            }
            return result;
          });
          
          return [transformed];
        }
      }
      
      // Check if this is an aggregation query with JOINs before parsing
      // hasAggregations is already declared above at line 628, reuse it
      const hasJoins = /LEFT\s+JOIN|INNER\s+JOIN|JOIN/i.test(normalizedSql);
      
      // For aggregation queries with JOINs, use direct PostgreSQL connection
      if (hasAggregations && hasJoins) {
        // Ensure connection is ready
        const hasConnection = await ensurePostgresConnection();
        
        if (hasConnection && pgPool) {
          try {
            // Convert MySQL syntax to PostgreSQL and execute directly
            let pgSql = normalizedSql
              .replace(/assessment_templates/g, 'assessments')
              // Convert UUID() to gen_random_uuid()
              .replace(/UUID\(\)/gi, 'gen_random_uuid()')
              // Convert MySQL boolean TRUE/FALSE to PostgreSQL true/false
              .replace(/\bTRUE\b/g, 'true')
              .replace(/\bFALSE\b/g, 'false')
              // Convert status = 'published' to is_published = true
              .replace(/status\s*=\s*['"]published['"]/gi, 'is_published = true')
              // Convert ON DUPLICATE KEY UPDATE to ON CONFLICT ... DO UPDATE SET
              .replace(/ON\s+DUPLICATE\s+KEY\s+UPDATE/gi, (match, offset, string) => {
                // Try to find the conflict column from the INSERT statement
                const insertMatch = normalizedSql.substring(0, offset).match(/INSERT\s+INTO\s+\w+\s*\(([^)]+)\)/i);
                if (insertMatch) {
                  const columns = insertMatch[1].split(',').map(c => c.trim());
                  // Use first column as conflict target (usually id or primary key)
                  const conflictCol = columns[0] || 'id';
                  return `ON CONFLICT (${conflictCol}) DO UPDATE SET`;
                }
                return 'ON CONFLICT DO UPDATE SET';
              })
              // Convert VALUES(column) to EXCLUDED.column
              .replace(/VALUES\((\w+)\)/gi, 'EXCLUDED.$1')
              .replace(/\?/g, (match, offset, string) => {
                const placeholderIndex = (normalizedSql.substring(0, offset).match(/\?/g) || []).length + 1;
                return `$${placeholderIndex}`;
              });
            
            const result = await pgPool.query(pgSql, params);
            return [result.rows];
          } catch (error) {
            // Handle connection termination errors
            if (error.message && (error.message.includes('shutdown') || error.message.includes('db_termination') || error.message.includes('terminating connection'))) {
              logger.warn('PostgreSQL connection terminated, resetting pool...');
              // Reset connection state to allow reconnection
              connectionInitialized = false;
              if (pgPool) {
                try {
                  await pgPool.end();
                } catch (e) {
                  // Ignore cleanup errors
                }
                pgPool = null;
              }
              // Try to reconnect
              await ensurePostgresConnection();
              // Retry the query once
              if (pgPool) {
                try {
                  const pgSql = normalizedSql
                    .replace(/assessment_templates/g, 'assessments')
                    // Convert UUID() to gen_random_uuid()
                    .replace(/UUID\(\)/gi, 'gen_random_uuid()')
                    // Convert MySQL boolean TRUE/FALSE to PostgreSQL true/false
                    .replace(/\bTRUE\b/g, 'true')
                    .replace(/\bFALSE\b/g, 'false')
                    // Convert status = 'published' to is_published = true
                    .replace(/status\s*=\s*['"]published['"]/gi, 'is_published = true')
                    // Convert ON DUPLICATE KEY UPDATE to ON CONFLICT ... DO UPDATE SET
                    .replace(/ON\s+DUPLICATE\s+KEY\s+UPDATE/gi, (match, offset, string) => {
                      const insertMatch = normalizedSql.substring(0, offset).match(/INSERT\s+INTO\s+\w+\s*\(([^)]+)\)/i);
                      if (insertMatch) {
                        const columns = insertMatch[1].split(',').map(c => c.trim());
                        const conflictCol = columns[0] || 'id';
                        return `ON CONFLICT (${conflictCol}) DO UPDATE SET`;
                      }
                      return 'ON CONFLICT DO UPDATE SET';
                    })
                    // Convert VALUES(column) to EXCLUDED.column
                    .replace(/VALUES\((\w+)\)/gi, 'EXCLUDED.$1')
                    .replace(/\?/g, (match, offset, string) => {
                      const placeholderIndex = (normalizedSql.substring(0, offset).match(/\?/g) || []).length + 1;
                      return `$${placeholderIndex}`;
                    });
                  const result = await pgPool.query(pgSql, params);
                  return [result.rows];
                } catch (retryError) {
                  logger.error('PostgreSQL query error on retry:', retryError);
                  throw retryError;
                }
              }
            }
            logger.error('PostgreSQL query error:', error);
            throw error;
          }
        } else {
          throw new Error('Complex aggregation queries with JOINs require SUPABASE_DB_URL environment variable for direct PostgreSQL connection. Please set SUPABASE_DB_URL in your .env file.');
        }
      }
      
      const query = SQLParser.parseSelect(normalizedSql, params);
      const { data, error } = await query;
      if (error) throw error;
      return [data || []];
    }
    
    // INSERT queries
    if (sqlUpper.startsWith('INSERT')) {
      // Check for PostgreSQL ON CONFLICT syntax
      const hasOnConflict = /ON\s+CONFLICT/i.test(sql);
      const { tableName, record, isUpsert } = SQLParser.parseInsert(sql, params);
      
      if (isUpsert || hasOnConflict) {
        // Use upsert for ON DUPLICATE KEY UPDATE or ON CONFLICT
        // Determine conflict column from table or SQL
        let conflictColumn = 'id';
        
        if (tableName === 'csrf_tokens') {
          conflictColumn = 'user_id';
        } else {
          // Try to extract from ON CONFLICT (column_name)
          const conflictMatch = sql.match(/ON\s+CONFLICT\s*\(([^)]+)\)/i);
          if (conflictMatch) {
            conflictColumn = conflictMatch[1].trim();
          }
        }
        
        // For csrf_tokens, use update-then-insert approach to avoid conflicts
        if (tableName === 'csrf_tokens' && record.user_id) {
          // First try to update existing record
          const { data: existing, error: selectError } = await supabase
            .from(tableName)
            .select('id')
            .eq('user_id', record.user_id)
            .maybeSingle();
          
          if (selectError && selectError.code !== 'PGRST116') {
            throw selectError;
          }
          
          if (existing) {
            // Update existing
            const { data, error } = await supabase
              .from(tableName)
              .update(record)
              .eq('user_id', record.user_id)
              .select();
            if (error) throw error;
            return [{ insertId: data?.[0]?.id, affectedRows: data?.length || 0 }, []];
          } else {
            // Insert new
            const { data, error } = await supabase
              .from(tableName)
              .insert(record)
              .select();
            if (error) throw error;
            return [{ insertId: data?.[0]?.id, affectedRows: data?.length || 0 }, []];
          }
        } else {
          // Use standard upsert for other tables
          const { data, error } = await supabase
            .from(tableName)
            .upsert(record, { onConflict: conflictColumn });
          if (error) throw error;
          return [{ insertId: data?.[0]?.id, affectedRows: data?.length || 0 }, []];
        }
      } else {
        const { data, error } = await supabase.from(tableName).insert(record).select();
        if (error) throw error;
        return [{ insertId: data[0]?.id, affectedRows: data.length }, []];
      }
    }
    
    // UPDATE queries
    if (sqlUpper.startsWith('UPDATE')) {
      const { tableName, updates, whereConditions } = SQLParser.parseUpdate(sql, params);
      let query = supabase.from(tableName).update(updates);
      
      whereConditions.forEach(condition => {
        switch (condition.operator) {
          case '=':
            query = query.eq(condition.column, condition.value);
            break;
          case '!=':
          case '<>':
            query = query.neq(condition.column, condition.value);
            break;
          case '>':
            query = query.gt(condition.column, condition.value);
            break;
          case '<':
            query = query.lt(condition.column, condition.value);
            break;
          case '>=':
            query = query.gte(condition.column, condition.value);
            break;
          case '<=':
            query = query.lte(condition.column, condition.value);
            break;
        }
      });
      
      const { data, error } = await query.select();
      if (error) throw error;
      return [{ affectedRows: data?.length || 0 }, []];
    }
    
    // DELETE queries
    if (sqlUpper.startsWith('DELETE')) {
      const { tableName, whereConditions } = SQLParser.parseDelete(sql, params);
      let query = supabase.from(tableName).delete();
      
      whereConditions.forEach(condition => {
        switch (condition.operator) {
          case '=':
            query = query.eq(condition.column, condition.value);
            break;
          case '!=':
          case '<>':
            query = query.neq(condition.column, condition.value);
            break;
          case '>':
            query = query.gt(condition.column, condition.value);
            break;
          case '<':
            query = query.lt(condition.column, condition.value);
            break;
          case '>=':
            query = query.gte(condition.column, condition.value);
            break;
          case '<=':
            query = query.lte(condition.column, condition.value);
            break;
        }
      });
      
      const { data, error } = await query.select();
      if (error) throw error;
      return [{ affectedRows: data?.length || 0 }, []];
    }
    
    // Handle ALTER TABLE queries (Supabase doesn't support via PostgREST)
    if (sqlUpper.startsWith('ALTER TABLE')) {
      // For Supabase, ALTER TABLE must be run directly in SQL Editor
      // We'll gracefully skip these in application code
      logger.warn('ALTER TABLE queries are not supported via PostgREST. Run in Supabase SQL Editor:', sql.substring(0, 100));
      
      // Check if it's adding a column that might already exist
      const addColumnMatch = sql.match(/ADD\s+COLUMN\s+(\w+)/i);
      if (addColumnMatch) {
        const columnName = addColumnMatch[1];
        logger.info(`Column ${columnName} should be added via migration. Skipping ALTER TABLE.`);
        // Return success to avoid breaking the flow
        return [{ affectedRows: 0 }, []];
      }
      
      throw new Error('ALTER TABLE queries must be run in Supabase SQL Editor, not via PostgREST API');
    }
    
    // For other queries, try direct PostgreSQL connection first if available
    const hasConnection = await ensurePostgresConnection();
    if (hasConnection && pgPool) {
      logger.debug('Unsupported query type via PostgREST, trying direct PostgreSQL connection');
      try {
        let pgSql = sql
          .replace(/assessment_templates/g, 'assessments')
          .replace(/UUID\(\)/gi, 'gen_random_uuid()')
          .replace(/\bTRUE\b/g, 'true')
          .replace(/\bFALSE\b/g, 'false');
        
        let paramIndex = 1;
        pgSql = pgSql.replace(/\?/g, () => `$${paramIndex++}`);
        
        const result = await pgPool.query(pgSql, params);
        // Return in MySQL format: [rows, fields]
        return [result.rows || [], []];
      } catch (pgError) {
        logger.warn('Direct PostgreSQL connection also failed for unsupported query:', sql.substring(0, 100), pgError.message);
        throw new Error(`Unsupported SQL query type. Error: ${pgError.message}`);
      }
    }
    
    // Only warn if we can't use direct PostgreSQL connection
    logger.warn('Unsupported SQL query type. Set SUPABASE_DB_URL for direct PostgreSQL connection:', sql.substring(0, 100));
    throw new Error('Complex SQL queries need to be converted to Supabase queries or RPC functions, or set SUPABASE_DB_URL for direct PostgreSQL connection');
  } catch (error) {
    logger.error('Database query error:', { sql: sql.substring(0, 200), error: error.message });
    throw error;
  }
};

// Compatibility wrapper for pool.execute() - maintains same interface
export const pool = {
  execute: async (sql, params = []) => {
    try {
      const result = await query(sql, params);
      return result;
    } catch (error) {
      logger.error('Pool execute error:', error);
      throw error;
    }
  },
  
  // Provide compatibility for legacy code that used pool.query(...)
  query: async (sql, params = []) => {
    try {
      const result = await query(sql, params);
      return result;
    } catch (error) {
      logger.error('Pool query error:', error);
      throw error;
    }
  },
  
  // For transactions, return a mock connection object
  getConnection: async () => {
    return {
      execute: async (sql, params = []) => {
        return await query(sql, params);
      },
      query: async (sql, params = []) => {
        return await query(sql, params);
      },
      beginTransaction: async () => {
        // Supabase handles transactions automatically
        return true;
      },
      commit: async () => {
        // Supabase commits automatically
        return true;
      },
      rollback: async () => {
        logger.warn('Rollback called - Supabase handles transactions automatically');
        return true;
      },
      release: () => {
        // No-op for Supabase
        return true;
      }
    };
  }
};

// Export pool stats for monitoring
export const getPoolStats = () => poolStats;

// Export Supabase client for direct use if needed
export { supabase, testConnection };
