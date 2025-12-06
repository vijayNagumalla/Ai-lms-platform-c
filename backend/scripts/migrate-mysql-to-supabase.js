import mysql from 'mysql2/promise';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';

dotenv.config();

// MySQL connection configuration
const mysqlConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'lms_platform',
  port: parseInt(process.env.DB_PORT) || 3306,
  multipleStatements: false
};

// Supabase configuration
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase configuration. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your .env file');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

// ID mapping stores: MySQL ID -> Supabase UUID
const idMaps = {
  colleges: new Map(),
  users: new Map(),
  departments: new Map(),
  courses: new Map(),
  course_modules: new Map(),
  course_content: new Map(),
  assessments: new Map(),
  assessment_questions: new Map(),
  coding_questions: new Map(),
  assessment_submissions: new Map(),
  coding_submission_results: new Map(),
  student_responses: new Map(),
  coding_platforms: new Map(),
  student_coding_profiles: new Map(),
  coding_platform_data: new Map(),
  coding_achievements: new Map(),
  coding_profile_sync_logs: new Map(),
  proctoring_logs: new Map(),
  proctoring_consents: new Map(),
  question_categories: new Map(),
  question_tags: new Map(),
  questions: new Map(),
  question_attachments: new Map(),
  notifications: new Map(),
  assessment_analytics: new Map(),
  assessment_reports: new Map(),
  assessment_notifications: new Map(),
  batches: new Map(),
  assessment_analytics: new Map(),
  assessment_reports: new Map(),
  coding_platform_data: new Map(),
  coding_achievements: new Map(),
  coding_profile_sync_logs: new Map(),
  proctoring_consents: new Map()
};

// Statistics
const stats = {
  total: 0,
  migrated: 0,
  skipped: 0,
  errors: 0,
  startTime: Date.now()
};

// Helper function to convert MySQL date to ISO string
function convertDate(date) {
  if (!date) return null;
  if (date instanceof Date) return date.toISOString();
  if (typeof date === 'string') {
    const d = new Date(date);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

// Helper function to parse JSON fields
function parseJSON(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

// Helper function to convert MySQL INT/BIGINT ID to UUID
function getUUID(tableName, mysqlId) {
  if (!mysqlId) return null;
  const map = idMaps[tableName];
  if (!map) {
    console.warn(`⚠️  No ID map found for table: ${tableName}`);
    return null;
  }
  return map.get(mysqlId) || null;
}

// Helper function to migrate a table
async function migrateTable(
  mysqlConn,
  tableName,
  selectQuery,
  transformRow,
  batchSize = 100
) {
  console.log(`\n📦 Migrating table: ${tableName}`);
  
  try {
    // Check if table exists in MySQL
    const [tables] = await mysqlConn.query(
      `SELECT COUNT(*) as count FROM information_schema.tables 
       WHERE table_schema = ? AND table_name = ?`,
      [mysqlConfig.database, tableName]
    );
    
    if (tables[0].count === 0) {
      console.log(`   ⏭️  Table ${tableName} does not exist in MySQL, skipping...`);
      return;
    }

    // Get total count
    // Use query instead of execute for table name to avoid issues
    const [countResult] = await mysqlConn.query(
      `SELECT COUNT(*) as count FROM ??`,
      [tableName]
    );
    const totalRows = countResult[0].count;
    
    if (totalRows === 0) {
      console.log(`   ℹ️  Table ${tableName} is empty, skipping...`);
      return;
    }

    console.log(`   📊 Total rows to migrate: ${totalRows}`);
    stats.total += totalRows;

    let offset = 0;
    let migrated = 0;
    let skipped = 0;

      while (offset < totalRows) {
      // Fetch batch from MySQL
      // Note: LIMIT and OFFSET cannot use placeholders in MySQL, so we use string interpolation
      // batchSize and offset are integers from our code, so safe to interpolate
      const safeBatchSize = parseInt(batchSize, 10);
      const safeOffset = parseInt(offset, 10);
      const [rows] = await mysqlConn.execute(
        `${selectQuery} LIMIT ${safeBatchSize} OFFSET ${safeOffset}`
      );

      if (rows.length === 0) break;

      // Transform and insert into Supabase
      const records = [];
      for (const row of rows) {
        try {
          const transformed = transformRow(row);
          if (transformed) {
            records.push(transformed);
          } else {
            skipped++;
          }
        } catch (error) {
          console.error(`   ❌ Error transforming row:`, error.message);
          skipped++;
        }
      }

      if (records.length > 0) {
        // Insert in batches
        const { data, error } = await supabase
          .from(tableName)
          .upsert(records, { onConflict: 'id', ignoreDuplicates: false });

        if (error) {
          // Try inserting one by one if batch fails
          for (const record of records) {
            const { error: singleError } = await supabase
              .from(tableName)
              .upsert(record, { onConflict: 'id' });
            
            if (singleError) {
              console.error(`   ❌ Error inserting record:`, singleError.message);
              skipped++;
            } else {
              migrated++;
            }
          }
        } else {
          migrated += records.length;
        }
      }

      offset += batchSize;
      const progress = ((offset / totalRows) * 100).toFixed(1);
      process.stdout.write(`\r   ⏳ Progress: ${progress}% (${migrated}/${totalRows} migrated)`);
    }

    console.log(`\n   ✅ Migrated: ${migrated}, Skipped: ${skipped}`);
    stats.migrated += migrated;
    stats.skipped += skipped;

  } catch (error) {
    console.error(`   ❌ Error migrating ${tableName}:`, error.message);
    stats.errors++;
    throw error;
  }
}

// Migration functions for each table
async function migrateColleges(mysqlConn) {
  await migrateTable(
    mysqlConn,
    'colleges',
    'SELECT * FROM colleges ORDER BY id',
    (row) => {
      const uuid = uuidv4();
      idMaps.colleges.set(row.id, uuid);
      
      return {
        id: uuid,
        name: row.name,
        code: row.code,
        address: row.address,
        city: row.city,
        state: row.state,
        country: row.country || 'India',
        postal_code: row.postal_code,
        phone: row.phone,
        email: row.email,
        website: row.website,
        logo_url: row.logo_url,
        established_year: row.established_year,
        accreditation: row.accreditation,
        contact_person: row.contact_person,
        contact_person_phone: row.contact_person_phone,
        contact_person_email: row.contact_person_email,
        description: row.description,
        is_active: row.is_active !== 0,
        created_at: convertDate(row.created_at),
        updated_at: convertDate(row.updated_at)
      };
    }
  );
}

async function migrateUsers(mysqlConn) {
  await migrateTable(
    mysqlConn,
    'users',
    'SELECT * FROM users ORDER BY id',
    (row) => {
      const uuid = uuidv4();
      idMaps.users.set(row.id, uuid);
      
      return {
        id: uuid,
        email: row.email,
        password: row.password,
        name: row.name,
        role: row.role,
        college_id: getUUID('colleges', row.college_id),
        department: row.department,
        student_id: row.student_id,
        phone: row.phone,
        avatar_url: row.avatar_url,
        is_active: row.is_active !== 0,
        email_verified: row.email_verified !== 0,
        created_at: convertDate(row.created_at),
        updated_at: convertDate(row.updated_at)
      };
    }
  );
}

async function migrateDepartments(mysqlConn) {
  await migrateTable(
    mysqlConn,
    'departments',
    'SELECT * FROM departments ORDER BY id',
    (row) => {
      const uuid = uuidv4();
      idMaps.departments.set(row.id, uuid);
      
      return {
        id: uuid,
        college_id: getUUID('colleges', row.college_id),
        name: row.name,
        code: row.code,
        description: row.description,
        is_active: row.is_active !== 0,
        created_at: convertDate(row.created_at),
        updated_at: convertDate(row.updated_at)
      };
    }
  );
}

async function migrateCourses(mysqlConn) {
  await migrateTable(
    mysqlConn,
    'courses',
    'SELECT * FROM courses ORDER BY id',
    (row) => {
      const uuid = uuidv4();
      idMaps.courses.set(row.id, uuid);
      
      return {
        id: uuid,
        title: row.title,
        code: row.code,
        description: row.description,
        college_id: getUUID('colleges', row.college_id),
        department_id: getUUID('departments', row.department_id),
        instructor_id: getUUID('users', row.instructor_id),
        credits: row.credits || 3,
        duration_weeks: row.duration_weeks || 16,
        max_students: row.max_students || 50,
        is_active: row.is_active !== 0,
        is_published: row.is_published !== 0,
        thumbnail_url: row.thumbnail_url,
        syllabus_url: row.syllabus_url,
        created_at: convertDate(row.created_at),
        updated_at: convertDate(row.updated_at)
      };
    }
  );
}

async function migrateCourseEnrollments(mysqlConn) {
  await migrateTable(
    mysqlConn,
    'course_enrollments',
    'SELECT * FROM course_enrollments ORDER BY id',
    (row) => {
      const uuid = uuidv4();
      
      return {
        id: uuid,
        course_id: getUUID('courses', row.course_id),
        student_id: getUUID('users', row.student_id),
        enrollment_date: convertDate(row.enrollment_date),
        status: row.status || 'active',
        grade: row.grade,
        completion_date: convertDate(row.completion_date),
        created_at: convertDate(row.created_at),
        updated_at: convertDate(row.updated_at)
      };
    }
  );
}

async function migrateCourseModules(mysqlConn) {
  await migrateTable(
    mysqlConn,
    'course_modules',
    'SELECT * FROM course_modules ORDER BY id',
    (row) => {
      const uuid = uuidv4();
      idMaps.course_modules.set(row.id, uuid);
      
      return {
        id: uuid,
        course_id: getUUID('courses', row.course_id),
        title: row.title,
        description: row.description,
        order_index: row.order_index || 0,
        is_active: row.is_active !== 0,
        created_at: convertDate(row.created_at),
        updated_at: convertDate(row.updated_at)
      };
    }
  );
}

async function migrateCourseContent(mysqlConn) {
  await migrateTable(
    mysqlConn,
    'course_content',
    'SELECT * FROM course_content ORDER BY id',
    (row) => {
      const uuid = uuidv4();
      
      return {
        id: uuid,
        module_id: getUUID('course_modules', row.module_id),
        title: row.title,
        content_type: row.content_type,
        content: row.content,
        file_url: row.file_url,
        duration_minutes: row.duration_minutes,
        order_index: row.order_index || 0,
        is_active: row.is_active !== 0,
        created_at: convertDate(row.created_at),
        updated_at: convertDate(row.updated_at)
      };
    }
  );
}

async function migrateAssessments(mysqlConn) {
  await migrateTable(
    mysqlConn,
    'assessments',
    'SELECT * FROM assessments ORDER BY id',
    (row) => {
      const uuid = uuidv4();
      idMaps.assessments.set(row.id, uuid);
      
      return {
        id: uuid,
        title: row.title,
        description: row.description,
        course_id: getUUID('courses', row.course_id),
        college_id: getUUID('colleges', row.college_id),
        type: row.type,
        category: row.category,
        difficulty_level: row.difficulty_level || 'medium',
        total_points: row.total_points || 100,
        duration_minutes: row.duration_minutes,
        start_time: convertDate(row.start_time),
        end_time: convertDate(row.end_time),
        is_active: row.is_active !== 0,
        is_published: row.is_published !== 0,
        is_timed: row.is_timed !== 0,
        allow_retake: row.allow_retake !== 0,
        max_attempts: row.max_attempts || 1,
        shuffle_questions: row.shuffle_questions !== 0,
        show_results_immediately: row.show_results_immediately !== 0,
        passing_score: row.passing_score || 60,
        instructions: row.instructions,
        created_by: getUUID('users', row.created_by),
        assigned_to_college_id: getUUID('colleges', row.assigned_to_college_id),
        assigned_to_student_ids: parseJSON(row.assigned_to_student_ids),
        created_at: convertDate(row.created_at),
        updated_at: convertDate(row.updated_at)
      };
    }
  );
}

async function migrateAssessmentQuestions(mysqlConn) {
  await migrateTable(
    mysqlConn,
    'assessment_questions',
    'SELECT * FROM assessment_questions ORDER BY id',
    (row) => {
      const uuid = uuidv4();
      idMaps.assessment_questions.set(row.id, uuid);
      
      return {
        id: uuid,
        assessment_id: getUUID('assessments', row.assessment_id),
        question_text: row.question_text,
        question_type: row.question_type,
        points: row.points || 1,
        options: parseJSON(row.options),
        correct_answer: row.correct_answer,
        correct_answers: parseJSON(row.correct_answers),
        explanation: row.explanation,
        difficulty_level: row.difficulty_level || 'medium',
        order_index: row.order_index || 0,
        is_required: row.is_required !== 0,
        created_at: convertDate(row.created_at)
      };
    }
  );
}

async function migrateCodingQuestions(mysqlConn) {
  await migrateTable(
    mysqlConn,
    'coding_questions',
    'SELECT * FROM coding_questions ORDER BY id',
    (row) => {
      const uuid = uuidv4();
      
      return {
        id: uuid,
        question_id: getUUID('assessment_questions', row.question_id),
        language: row.language,
        starter_code: row.starter_code,
        solution_code: row.solution_code,
        test_cases: parseJSON(row.test_cases),
        time_limit: row.time_limit || 1000,
        memory_limit: row.memory_limit || 256,
        difficulty: row.difficulty || 'medium',
        category: row.category,
        tags: parseJSON(row.tags),
        created_at: convertDate(row.created_at)
      };
    }
  );
}

async function migrateAssessmentSubmissions(mysqlConn) {
  await migrateTable(
    mysqlConn,
    'assessment_submissions',
    'SELECT * FROM assessment_submissions ORDER BY id',
    (row) => {
      const uuid = uuidv4();
      idMaps.assessment_submissions.set(row.id, uuid);
      
      return {
        id: uuid,
        assessment_id: getUUID('assessments', row.assessment_id),
        student_id: getUUID('users', row.student_id),
        answers: parseJSON(row.answers),
        coding_submissions: parseJSON(row.coding_submissions),
        file_submissions: parseJSON(row.file_submissions),
        score: row.score || 0,
        max_score: row.max_score || 0,
        percentage_score: row.percentage_score || 0,
        time_taken_minutes: row.time_taken_minutes,
        started_at: convertDate(row.started_at),
        submitted_at: convertDate(row.submitted_at),
        graded_at: convertDate(row.graded_at),
        graded_by: getUUID('users', row.graded_by),
        feedback: row.feedback,
        status: row.status || 'in_progress',
        attempt_number: row.attempt_number || 1,
        auto_submitted: row.auto_submitted !== 0,
        ip_address: row.ip_address,
        user_agent: row.user_agent
      };
    }
  );
}

async function migrateStudentResponses(mysqlConn) {
  await migrateTable(
    mysqlConn,
    'student_responses',
    'SELECT * FROM student_responses ORDER BY id',
    (row) => {
      const uuid = uuidv4();
      
      return {
        id: uuid,
        submission_id: getUUID('assessment_submissions', row.submission_id),
        question_id: getUUID('assessment_questions', row.question_id),
        section_id: getUUID('assessment_questions', row.section_id),
        question_type: row.question_type,
        student_answer: row.student_answer,
        selected_options: parseJSON(row.selected_options),
        time_spent: row.time_spent || 0,
        is_correct: row.is_correct !== 0,
        points_earned: row.points_earned || 0,
        auto_saved: row.auto_saved !== 0,
        submitted_at: convertDate(row.submitted_at),
        created_at: convertDate(row.created_at),
        updated_at: convertDate(row.updated_at)
      };
    }
  );
}

async function migrateCodingSubmissionResults(mysqlConn) {
  await migrateTable(
    mysqlConn,
    'coding_submission_results',
    'SELECT * FROM coding_submission_results ORDER BY id',
    (row) => {
      const uuid = uuidv4();
      
      return {
        id: uuid,
        submission_id: getUUID('assessment_submissions', row.submission_id),
        question_id: getUUID('assessment_questions', row.question_id),
        code: row.code,
        language: row.language,
        status: row.status || 'pending',
        execution_time: row.execution_time,
        memory_used: row.memory_used,
        test_cases_passed: row.test_cases_passed || 0,
        total_test_cases: row.total_test_cases || 0,
        score: row.score || 0,
        feedback: row.feedback,
        error_message: row.error_message,
        created_at: convertDate(row.created_at)
      };
    }
  );
}

async function migrateProctoringLogs(mysqlConn) {
  await migrateTable(
    mysqlConn,
    'proctoring_logs',
    'SELECT * FROM proctoring_logs ORDER BY id',
    (row) => {
      const uuid = uuidv4();
      
      return {
        id: uuid,
        submission_id: getUUID('assessment_submissions', row.submission_id),
        violation_type: row.violation_type,
        timestamp: convertDate(row.timestamp),
        description: row.description,
        severity_level: row.severity_level || 'low',
        metadata: parseJSON(row.metadata),
        created_at: convertDate(row.created_at)
      };
    }
  );
}

async function migrateCodingPlatforms(mysqlConn) {
  await migrateTable(
    mysqlConn,
    'coding_platforms',
    'SELECT * FROM coding_platforms ORDER BY id',
    (row) => {
      const uuid = uuidv4();
      idMaps.coding_platforms.set(row.id, uuid);
      
      return {
        id: uuid,
        name: row.name,
        display_name: row.display_name,
        base_url: row.base_url,
        profile_url_pattern: row.profile_url_pattern,
        api_endpoint: row.api_endpoint,
        scraping_config: parseJSON(row.scraping_config),
        is_active: row.is_active !== 0,
        created_at: convertDate(row.created_at),
        updated_at: convertDate(row.updated_at)
      };
    }
  );
}

async function migrateStudentCodingProfiles(mysqlConn) {
  await migrateTable(
    mysqlConn,
    'student_coding_profiles',
    'SELECT * FROM student_coding_profiles ORDER BY id',
    (row) => {
      const uuid = uuidv4();
      idMaps.student_coding_profiles.set(row.id, uuid);
      
      return {
        id: uuid,
        student_id: getUUID('users', row.student_id),
        platform_id: getUUID('coding_platforms', row.platform_id),
        username: row.username,
        profile_url: row.profile_url,
        is_verified: row.is_verified !== 0,
        last_synced_at: convertDate(row.last_synced_at),
        sync_status: row.sync_status || 'pending',
        sync_error: row.sync_error,
        created_at: convertDate(row.created_at),
        updated_at: convertDate(row.updated_at)
      };
    }
  );
}

async function migrateBatches(mysqlConn) {
  await migrateTable(
    mysqlConn,
    'batches',
    'SELECT * FROM batches ORDER BY id',
    (row) => {
      const uuid = uuidv4();
      idMaps.batches.set(row.id, uuid);
      
      return {
        id: uuid,
        college_id: getUUID('colleges', row.college_id),
        department_id: getUUID('departments', row.department_id),
        name: row.name,
        code: row.code,
        start_date: convertDate(row.start_date),
        end_date: convertDate(row.end_date),
        academic_year: row.academic_year,
        semester: row.semester,
        is_active: row.is_active !== 0,
        created_at: convertDate(row.created_at),
        updated_at: convertDate(row.updated_at)
      };
    }
  );
}

async function migrateNotifications(mysqlConn) {
  await migrateTable(
    mysqlConn,
    'notifications',
    'SELECT * FROM notifications ORDER BY id',
    (row) => {
      const uuid = uuidv4();
      
      return {
        id: uuid,
        user_id: getUUID('users', row.user_id),
        title: row.title,
        message: row.message,
        type: row.type || 'info',
        is_read: row.is_read !== 0,
        related_url: row.link || row.related_url,
        created_at: convertDate(row.created_at)
      };
    }
  );
}

async function migrateAssessmentAnalytics(mysqlConn) {
  await migrateTable(
    mysqlConn,
    'assessment_analytics',
    'SELECT * FROM assessment_analytics ORDER BY id',
    (row) => {
      const uuid = uuidv4();
      
      return {
        id: uuid,
        assessment_id: getUUID('assessments', row.assessment_id),
        total_students_assigned: row.total_students_assigned || 0,
        total_students_attempted: row.total_students_attempted || 0,
        total_students_completed: row.total_students_completed || 0,
        average_score: row.average_score || 0,
        highest_score: row.highest_score || 0,
        lowest_score: row.lowest_score || 0,
        pass_rate: row.pass_rate || 0,
        average_time_taken_minutes: row.average_time_taken_minutes || 0,
        question_analytics: parseJSON(row.question_analytics),
        difficulty_analysis: parseJSON(row.difficulty_analysis),
        college_performance: parseJSON(row.college_performance),
        last_updated: convertDate(row.last_updated)
      };
    }
  );
}

async function migrateAssessmentReports(mysqlConn) {
  await migrateTable(
    mysqlConn,
    'assessment_reports',
    'SELECT * FROM assessment_reports ORDER BY id',
    (row) => {
      const uuid = uuidv4();
      
      return {
        id: uuid,
        report_type: row.report_type,
        report_name: row.report_name,
        generated_by: getUUID('users', row.generated_by),
        filters: parseJSON(row.filters),
        report_data: parseJSON(row.report_data),
        file_url: row.file_url,
        generated_at: convertDate(row.generated_at)
      };
    }
  );
}

async function migrateAssessmentNotifications(mysqlConn) {
  await migrateTable(
    mysqlConn,
    'assessment_notifications',
    'SELECT * FROM assessment_notifications ORDER BY id',
    (row) => {
      const uuid = uuidv4();
      
      return {
        id: uuid,
        assessment_id: getUUID('assessments', row.assessment_id),
        user_id: getUUID('users', row.user_id),
        notification_type: row.notification_type,
        title: row.title,
        message: row.message,
        is_read: row.is_read !== 0,
        sent_at: convertDate(row.sent_at)
      };
    }
  );
}

async function migrateQuestionCategories(mysqlConn) {
  await migrateTable(
    mysqlConn,
    'question_categories',
    'SELECT * FROM question_categories ORDER BY id',
    (row) => {
      const uuid = uuidv4();
      idMaps.question_categories.set(row.id, uuid);
      
      return {
        id: uuid,
        name: row.name,
        description: row.description,
        parent_id: getUUID('question_categories', row.parent_id),
        color: row.color || '#3B82F6',
        icon: row.icon,
        created_by: getUUID('users', row.created_by),
        college_id: getUUID('colleges', row.college_id),
        created_at: convertDate(row.created_at),
        updated_at: convertDate(row.updated_at)
      };
    }
  );
}

async function migrateQuestionTags(mysqlConn) {
  await migrateTable(
    mysqlConn,
    'question_tags',
    'SELECT * FROM question_tags ORDER BY id',
    (row) => {
      const uuid = uuidv4();
      idMaps.question_tags.set(row.id, uuid);
      
      return {
        id: uuid,
        name: row.name,
        created_by: getUUID('users', row.created_by),
        college_id: getUUID('colleges', row.college_id),
        created_at: convertDate(row.created_at)
      };
    }
  );
}

async function migrateQuestions(mysqlConn) {
  await migrateTable(
    mysqlConn,
    'questions',
    'SELECT * FROM questions ORDER BY id',
    (row) => {
      const uuid = uuidv4();
      idMaps.questions.set(row.id, uuid);
      
      return {
        id: uuid,
        question_text: row.question_text,
        question_type: row.question_type,
        category_id: getUUID('question_categories', row.category_id),
        difficulty_level: row.difficulty_level || 'medium',
        points: row.points || 1,
        options: parseJSON(row.options),
        correct_answer: row.correct_answer,
        correct_answers: parseJSON(row.correct_answers),
        explanation: row.explanation,
        tags: parseJSON(row.tags),
        created_by: getUUID('users', row.created_by),
        college_id: getUUID('colleges', row.college_id),
        is_active: row.is_active !== 0,
        usage_count: row.usage_count || 0,
        created_at: convertDate(row.created_at),
        updated_at: convertDate(row.updated_at)
      };
    }
  );
}

async function migrateQuestionAttachments(mysqlConn) {
  await migrateTable(
    mysqlConn,
    'question_attachments',
    'SELECT * FROM question_attachments ORDER BY id',
    (row) => {
      const uuid = uuidv4();
      
      return {
        id: uuid,
        question_id: getUUID('questions', row.question_id),
        file_name: row.file_name,
        file_url: row.file_url,
        file_type: row.file_type,
        file_size: row.file_size,
        uploaded_by: getUUID('users', row.uploaded_by),
        created_at: convertDate(row.created_at)
      };
    }
  );
}

async function migrateCodingPlatformData(mysqlConn) {
  await migrateTable(
    mysqlConn,
    'coding_platform_data',
    'SELECT * FROM coding_platform_data ORDER BY id',
    (row) => {
      const uuid = uuidv4();
      
      return {
        id: uuid,
        profile_id: getUUID('student_coding_profiles', row.profile_id),
        platform_id: getUUID('coding_platforms', row.platform_id),
        data_type: row.data_type,
        metric_name: row.metric_name,
        metric_value: row.metric_value,
        numeric_value: row.numeric_value,
        difficulty_level: row.difficulty_level,
        additional_data: parseJSON(row.additional_data),
        recorded_at: convertDate(row.recorded_at)
      };
    }
  );
}

async function migrateCodingAchievements(mysqlConn) {
  await migrateTable(
    mysqlConn,
    'coding_achievements',
    'SELECT * FROM coding_achievements ORDER BY id',
    (row) => {
      const uuid = uuidv4();
      
      return {
        id: uuid,
        profile_id: getUUID('student_coding_profiles', row.profile_id),
        platform_id: getUUID('coding_platforms', row.platform_id),
        achievement_type: row.achievement_type,
        achievement_name: row.achievement_name,
        achievement_description: row.achievement_description,
        achievement_level: row.achievement_level,
        stars_count: row.stars_count || 0,
        earned_at: convertDate(row.earned_at),
        achievement_data: parseJSON(row.achievement_data)
      };
    }
  );
}

async function migrateCodingProfileSyncLogs(mysqlConn) {
  await migrateTable(
    mysqlConn,
    'coding_profile_sync_logs',
    'SELECT * FROM coding_profile_sync_logs ORDER BY id',
    (row) => {
      const uuid = uuidv4();
      
      return {
        id: uuid,
        profile_id: getUUID('student_coding_profiles', row.profile_id),
        sync_type: row.sync_type,
        sync_status: row.sync_status,
        sync_started_at: convertDate(row.sync_started_at),
        sync_completed_at: convertDate(row.sync_completed_at),
        data_fetched: parseJSON(row.data_fetched),
        error_message: row.error_message,
        records_updated: row.records_updated || 0
      };
    }
  );
}

async function migrateProctoringConsents(mysqlConn) {
  await migrateTable(
    mysqlConn,
    'proctoring_consents',
    'SELECT * FROM proctoring_consents ORDER BY id',
    (row) => {
      const uuid = uuidv4();
      
      return {
        id: uuid,
        student_id: getUUID('users', row.student_id),
        assessment_id: getUUID('assessments', row.assessment_id),
        consent_given: row.consent_given !== 0,
        consent_timestamp: convertDate(row.consent_timestamp),
        ip_address: row.ip_address,
        user_agent: row.user_agent,
        created_at: convertDate(row.created_at)
      };
    }
  );
}

// Main migration function
async function runMigration() {
  console.log('🚀 Starting MySQL to Supabase Migration\n');
  console.log('=' .repeat(60));
  
  let mysqlConn = null;
  
  try {
    // Connect to MySQL
    console.log('\n📡 Connecting to MySQL...');
    mysqlConn = await mysql.createConnection(mysqlConfig);
    console.log('✅ MySQL connected successfully');
    
    // Test Supabase connection
    console.log('\n📡 Testing Supabase connection...');
    const { data, error } = await supabase.from('colleges').select('id').limit(1);
    if (error && error.code !== 'PGRST116' && error.code !== '42P01') {
      throw new Error(`Supabase connection failed: ${error.message}`);
    }
    console.log('✅ Supabase connected successfully');
    
    // Run migrations in dependency order
    console.log('\n' + '='.repeat(60));
    console.log('📦 Starting Data Migration');
    console.log('='.repeat(60));
    
    await migrateColleges(mysqlConn);
    await migrateUsers(mysqlConn);
    await migrateDepartments(mysqlConn);
    await migrateCourses(mysqlConn);
    await migrateCourseEnrollments(mysqlConn);
    await migrateCourseModules(mysqlConn);
    await migrateCourseContent(mysqlConn);
    await migrateAssessments(mysqlConn);
    await migrateAssessmentQuestions(mysqlConn);
    await migrateCodingQuestions(mysqlConn);
    await migrateAssessmentSubmissions(mysqlConn);
    await migrateStudentResponses(mysqlConn);
    await migrateCodingSubmissionResults(mysqlConn);
    await migrateProctoringLogs(mysqlConn);
    await migrateCodingPlatforms(mysqlConn);
    await migrateStudentCodingProfiles(mysqlConn);
    await migrateCodingPlatformData(mysqlConn);
    await migrateCodingAchievements(mysqlConn);
    await migrateCodingProfileSyncLogs(mysqlConn);
    await migrateBatches(mysqlConn);
    await migrateNotifications(mysqlConn);
    await migrateAssessmentAnalytics(mysqlConn);
    await migrateAssessmentReports(mysqlConn);
    await migrateAssessmentNotifications(mysqlConn);
    await migrateQuestionCategories(mysqlConn);
    await migrateQuestionTags(mysqlConn);
    await migrateQuestions(mysqlConn);
    await migrateQuestionAttachments(mysqlConn);
    await migrateProctoringConsents(mysqlConn);
    
    // Print summary
    console.log('\n' + '='.repeat(60));
    console.log('✅ Migration Complete!');
    console.log('='.repeat(60));
    console.log(`📊 Total rows processed: ${stats.total}`);
    console.log(`✅ Successfully migrated: ${stats.migrated}`);
    console.log(`⏭️  Skipped: ${stats.skipped}`);
    console.log(`❌ Errors: ${stats.errors}`);
    const duration = ((Date.now() - stats.startTime) / 1000).toFixed(2);
    console.log(`⏱️  Duration: ${duration} seconds`);
    console.log('='.repeat(60));
    
  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    console.error('Stack:', error.stack);
    process.exit(1);
  } finally {
    if (mysqlConn) {
      await mysqlConn.end();
      console.log('\n🔌 MySQL connection closed');
    }
  }
}

// Run migration
runMigration().catch(console.error);

