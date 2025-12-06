import { pool } from '../config/database.js';
import { v4 as uuidv4 } from 'uuid';
import jwt from 'jsonwebtoken';
import emailService from '../services/emailService.js';
import crypto from 'crypto'; // Added for crypto.randomUUID()
import dockerCodeService from '../services/dockerCodeService.js';

// Helper function to safely parse JSON fields
const safeJsonParse = (field, defaultValue = null) => {
  if (!field) return defaultValue;

  try {
    // Check if field is already an object (MySQL JSON fields are auto-parsed)
    if (typeof field === 'object') {
      return field;
    }

    // Check if it's a string and looks like JSON
    if (typeof field === 'string') {
      const trimmed = field.trim();
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        return JSON.parse(trimmed);
      } else {
        // If it's not valid JSON, return default value
        // console.warn('Invalid JSON format:', field);
        return defaultValue;
      }
    }

    return defaultValue;
  } catch (parseError) {
    // console.error('Error parsing JSON field:', parseError);
    // console.error('Raw field data:', field);
    return defaultValue;
  }
};

// Generate JWT token
const generateToken = (userId) => {
  return jwt.sign(
    { userId },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
};

// Helper function to evaluate coding questions using test cases
const evaluateCodingQuestion = async (question, userAnswer) => {
  try {
    // console.log('Evaluating coding question:', question.id);
    // console.log('User answer:', userAnswer);

    // Extract coding details from question
    let codingDetails = {};

    // Try to get coding details from different possible locations
    if (question.coding_details) {
      codingDetails = question.coding_details;
    } else if (question.metadata) {
      codingDetails = typeof question.metadata === 'string' ?
        JSON.parse(question.metadata) : question.metadata;
    }

    // console.log('Coding details:', codingDetails);

    // Get test cases from multiple possible locations
    let testCases = [];

    // Try different locations for test cases
    if (codingDetails.test_cases && Array.isArray(codingDetails.test_cases)) {
      testCases = codingDetails.test_cases;
    } else if (question.test_cases && Array.isArray(question.test_cases)) {
      testCases = question.test_cases;
    } else if (question.metadata && question.metadata.test_cases && Array.isArray(question.metadata.test_cases)) {
      testCases = question.metadata.test_cases;
    }

    // console.log('Test cases found:', testCases.length);
    // console.log('Test cases:', testCases);

    if (testCases.length === 0) {
      // console.warn('No test cases found in assessment sections for coding question:', question.id);

      // Try to fetch test cases from the question bank
      try {
        // console.log('Attempting to fetch test cases from question bank...');
        const [questionDetails] = await pool.query(
          'SELECT q.*, c.test_cases, c.language FROM questions q LEFT JOIN coding_questions c ON q.id = c.question_id WHERE q.id = ?',
          [question.id]
        );

        if (questionDetails.length > 0) {
          const questionDetail = questionDetails[0];
          if (questionDetail.test_cases) {
            const fetchedTestCases = typeof questionDetail.test_cases === 'string' ?
              JSON.parse(questionDetail.test_cases) : questionDetail.test_cases;

            if (Array.isArray(fetchedTestCases) && fetchedTestCases.length > 0) {
              // console.log('Found test cases in question bank:', fetchedTestCases.length);
              testCases = fetchedTestCases;
            }
          }
        }
      } catch (error) {
        // console.error('Error fetching test cases from question bank:', error);
      }

      if (testCases.length === 0) {
        // console.warn('No test cases available for coding question:', question.id);
        return { isCorrect: false, reason: 'No test cases available' };
      }
    }

    // Determine language from user answer or coding details
    let language = 'javascript'; // default

    // Try to get language from user answer
    if (userAnswer && typeof userAnswer === 'object' && userAnswer.language) {
      language = userAnswer.language;
    } else if (typeof userAnswer === 'string' && userAnswer.includes('python')) {
      // Try to detect language from code content
      language = 'python';
    } else if (typeof userAnswer === 'string' && userAnswer.includes('java')) {
      language = 'java';
    } else if (typeof userAnswer === 'string' && userAnswer.includes('cpp')) {
      language = 'cpp';
    } else if (codingDetails.languages && codingDetails.languages.length > 0) {
      language = codingDetails.languages[0];
    }

    // Extract source code from user answer
    let sourceCode = '';
    if (typeof userAnswer === 'string') {
      sourceCode = userAnswer;
    } else if (userAnswer && typeof userAnswer === 'object' && userAnswer.code) {
      sourceCode = userAnswer.code;
    } else if (userAnswer && typeof userAnswer === 'object' && userAnswer.sourceCode) {
      sourceCode = userAnswer.sourceCode;
    } else {
      // console.error('No source code found in user answer:', userAnswer);
      return { isCorrect: false, reason: 'No source code provided' };
    }

    // Get language configuration
    const config = dockerCodeService.getLanguageConfig(language);

    // Create temporary file for the source code
    const { filepath } = await dockerCodeService.createTempFile(sourceCode, config.extension);

    try {
      // Run test cases using Docker service
      const result = await dockerCodeService.executeBatchTestCases(filepath, config, testCases);

      // Check if all test cases passed
      const allPassed = result.every(testResult =>
        testResult.result?.verdict?.status === 'accepted'
      );

      // Calculate test case statistics
      const passedTests = result.filter(testResult =>
        testResult.result?.verdict?.status === 'accepted'
      ).length;
      const totalTests = result.length;

      return {
        isCorrect: allPassed,
        reason: allPassed ? 'All test cases passed' : 'Some test cases failed',
        testResults: result,
        passedTests,
        totalTests,
        score: totalTests > 0 ? Math.round((passedTests / totalTests) * 100) : 0
      };

    } finally {
      // Clean up temporary file
      await dockerCodeService.cleanupTempFiles([filepath]);
    }

  } catch (error) {
    // console.error('Error evaluating coding question:', error);
    return { isCorrect: false, reason: 'Evaluation error: ' + error.message };
  }
};

// =====================================================
// ASSESSMENT TEMPLATES MANAGEMENT
// =====================================================

// Create new assessment template
export const createAssessmentTemplate = async (req, res) => {
  try {

    const {
      title,
      description,
      instructions,
      assessment_type,
      difficulty_level,
      time_limit_minutes,
      total_points,
      passing_score,
      max_attempts,
      time_between_attempts_hours,
      shuffle_questions,
      show_results_immediately,
      allow_review,
      show_correct_answers,
      require_proctoring,
      proctoring_type,
      proctoring_settings,
      scheduling,
      access_control,
      assignment_settings,
      sections,
      college_id,
      department,
      tags,
      metadata
    } = req.body;

    // Extract assessment_type from metadata if not provided directly
    const finalAssessmentType = assessment_type || metadata?.assessment_type || 'quiz';

    // Validate assessment_type
    const validAssessmentTypes = ['quiz', 'test', 'exam', 'assignment', 'coding_challenge', 'survey'];
    if (!validAssessmentTypes.includes(finalAssessmentType)) {
      return res.status(400).json({
        success: false,
        message: `Invalid assessment_type. Must be one of: ${validAssessmentTypes.join(', ')}. Received: ${finalAssessmentType}`
      });
    }

    const created_by = req.user.id;
    const assessment_id = uuidv4();

    // Validate required fields
    if (!title) {
      return res.status(400).json({
        success: false,
        message: 'Title is required'
      });
    }

    // Helper function to convert undefined to null and handle JSON serialization
    const safeValue = (value) => {
      if (value === undefined || value === null) return null;
      if (typeof value === 'object' && value !== null) {
        // For JSON columns, ensure it's a valid JSON object
        try {
          // Always stringify JSON objects for MySQL JSON columns
          return JSON.stringify(value);
        } catch (error) {
          // console.warn('Invalid JSON object:', value, error);
          return null;
        }
      }
      return value;
    };

    // Helper function specifically for JSON fields to ensure proper encoding
    const safeJsonValue = (value) => {
      if (value === undefined || value === null) return null;
      if (typeof value === 'string') {
        // If it's already a string, try to parse and re-stringify to ensure valid JSON
        try {
          const parsed = JSON.parse(value);
          return JSON.stringify(parsed);
        } catch (error) {
          // console.warn('Invalid JSON string:', value, error);
          return null;
        }
      }
      if (typeof value === 'object' && value !== null) {
        try {
          return JSON.stringify(value);
        } catch (error) {
          // console.warn('Invalid JSON object:', value, error);
          return null;
        }
      }
      return null;
    };

    // Helper function to map difficulty levels from frontend to database values
    const mapDifficultyLevel = (level) => {
      const mapping = {
        'easy': 'beginner',
        'medium': 'intermediate',
        'hard': 'advanced',
        'expert': 'expert'
      };
      return mapping[level] || 'intermediate';
    };

    // Helper function to map status from frontend to database values
    const mapStatus = (status) => {
      const mapping = {
        'active': 'published',
        'draft': 'draft',
        'published': 'published',
        'archived': 'archived',
        'scheduled': 'scheduled'
      };
      return mapping[status] || 'draft';
    };

    // Extract scheduling data for new fields
    // Clean up date strings to extract just the date part (YYYY-MM-DD)
    const cleanDateString = (dateString) => {
      if (!dateString) return null;
      // Ensure dateString is a string before processing
      const dateStr = String(dateString);
      // If it's a full ISO datetime string, extract just the date part
      if (dateStr.includes('T')) {
        return dateStr.split('T')[0];
      }
      return dateStr;
    };

    const default_start_date_only = cleanDateString(scheduling?.start_date) || null;
    const default_start_time_only = scheduling?.start_time || null;
    const default_end_date_only = cleanDateString(scheduling?.end_date) || null;
    const default_end_time_only = scheduling?.end_time || null;
    const default_assessment_timezone = scheduling?.timezone || 'UTC';
    const default_early_access_hours = scheduling?.early_access_hours || 0;
    const default_late_submission_minutes = scheduling?.late_submission_minutes || 0;

    // Prepare the values for SQL insertion (ordered to match database column order)



    const sqlValues = [
      assessment_id,
      safeValue(title),
      safeValue(description),
      safeValue(instructions),
      safeValue(finalAssessmentType),
      mapDifficultyLevel(difficulty_level),
      safeValue(time_limit_minutes),
      safeValue(total_points),
      safeValue(passing_score),
      safeValue(max_attempts),
      safeValue(shuffle_questions),
      safeValue(show_results_immediately),
      safeValue(allow_review),
      safeValue(require_proctoring),
      mapStatus(req.body.status || 'draft'),
      created_by,
      safeValue(college_id),
      safeValue(department),
      safeJsonValue(tags),
      safeJsonValue(metadata),
      safeValue(time_between_attempts_hours),
      safeValue(show_correct_answers),
      safeValue(proctoring_type),
      safeJsonValue(proctoring_settings),
      // New scheduling fields
      default_start_date_only,
      default_start_time_only,
      default_end_date_only,
      default_end_time_only,
      default_assessment_timezone,
      default_early_access_hours,
      default_late_submission_minutes,
      safeJsonValue(access_control),
      safeJsonValue(assignment_settings),
      safeJsonValue(sections),
      safeJsonValue(scheduling)
    ];

    // Insert assessment template
    try {
      await pool.execute(
        `INSERT INTO assessments (
          id, title, description, instructions, assessment_type, difficulty_level,
          time_limit_minutes, total_points, passing_score, max_attempts, shuffle_questions,
          show_results_immediately, allow_review, require_proctoring, status, created_by,
          college_id, department, tags, metadata, time_between_attempts_hours,
          show_correct_answers, proctoring_type, proctoring_settings,
          default_start_date_only, default_start_time_only, default_end_date_only, 
          default_end_time_only, default_assessment_timezone, default_early_access_hours,
          default_late_submission_minutes, access_control, assignment_settings, sections, scheduling
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        sqlValues
      );
    } catch (sqlError) {
      console.error('SQL Error details:', {
        error: sqlError.message,
        code: sqlError.code,
        sqlState: sqlError.sqlState,
        sqlMessage: sqlError.sqlMessage
      });
      console.error('SQL Values being inserted:', sqlValues);
      throw sqlError;
    }

    // Get the created assessment
    const [assessments] = await pool.execute(
      'SELECT * FROM assessments WHERE id = ?',
      [assessment_id]
    );

    res.status(201).json({
      success: true,
      message: 'Assessment template created successfully',
      data: assessments[0]
    });
  } catch (error) {
    console.error('Create assessment template error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get all assessment templates with filtering and pagination
export const getAssessmentTemplates = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search,
      difficulty_level,
      status,
      college_id,
      department,
      created_by
    } = req.query;

    const offset = (page - 1) * limit;
    const conditions = [];
    const params = [];

    // Build WHERE conditions
    if (search) {
      conditions.push('(title LIKE ? OR description LIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
    }


    if (difficulty_level) {
      conditions.push('difficulty_level = ?');
      params.push(difficulty_level);
    }

    if (status) {
      conditions.push('status = ?');
      params.push(status);
    }

    if (college_id) {
      conditions.push('college_id = ?');
      params.push(college_id);
    }

    if (department) {
      conditions.push('department = ?');
      params.push(department);
    }

    if (created_by) {
      conditions.push('created_by = ?');
      params.push(created_by);
    }

    // Role-based filtering
    if (req.user.role === 'college-admin') {
      conditions.push('college_id = ?');
      params.push(req.user.college_id);
    } else if (req.user.role === 'faculty') {
      conditions.push('(created_by = ? OR college_id = ?)');
      params.push(req.user.id, req.user.college_id);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Get total count
    const [countResult] = await pool.query(
      `SELECT COUNT(*) as total FROM assessments ${whereClause}`,
      params
    );

    const total = countResult[0].total;

    // Get assessments with pagination
    const safeLimit = parseInt(limit) || 10;
    const safeOffset = parseInt(offset) || 0;

    const [assessments] = await pool.query(
      `SELECT 
        at.*,
        u.name as creator_name,
        u.email as creator_email,
        c.name as college_name,
        (SELECT COUNT(*) FROM assessment_assignments WHERE assessment_id = at.id) as assignment_count,
        (SELECT COUNT(*) FROM assessment_submissions WHERE assessment_id = at.id) as submission_count,
        TO_CHAR(at.default_start_date_only, 'YYYY-MM-DD') as start_date_only,
        TO_CHAR(at.default_start_time_only, 'HH24:MI:SS') as start_time_only,
        TO_CHAR(at.default_end_date_only, 'YYYY-MM-DD') as end_date_only,
        TO_CHAR(at.default_end_time_only, 'HH24:MI:SS') as end_time_only,
        at.default_assessment_timezone as assessment_timezone
      FROM assessments at
      LEFT JOIN users u ON at.created_by = u.id
      LEFT JOIN colleges c ON at.college_id = c.id
      ${whereClause}
      ORDER BY at.created_at DESC
      LIMIT ${safeLimit} OFFSET ${safeOffset}`,
      params
    );

    // Calculate question count from sections JSON for each assessment
    const assessmentsWithQuestionCount = assessments.map(assessment => {
      let questionCount = 0;

      // Parse sections JSON and count questions
      if (assessment.sections) {
        const sections = safeJsonParse(assessment.sections, []);

        if (Array.isArray(sections)) {
          sections.forEach(section => {
            if (section.questions && Array.isArray(section.questions)) {
              questionCount += section.questions.length;
            }
          });
        }
      }

      return {
        ...assessment,
        question_count: questionCount
      };
    });

    res.json({
      success: true,
      data: assessmentsWithQuestionCount,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    // console.error('Get assessment templates error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get assessment template by ID with full details
export const getAssessmentTemplateById = async (req, res) => {
  try {
    const { id } = req.params;

    // Get assessment template
    const [assessments] = await pool.execute(
      `SELECT 
        at.*,
        u.name as creator_name,
        u.email as creator_email,
        c.name as college_name
      FROM assessments at
      LEFT JOIN users u ON at.created_by = u.id
      LEFT JOIN colleges c ON at.college_id = c.id
      WHERE at.id = ?`,
      [id]
    );

    if (assessments.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Assessment template not found'
      });
    }

    const assessment = assessments[0];

    // Get assignments
    const [assignments] = await pool.execute(
      'SELECT * FROM assessment_assignments WHERE assessment_id = ?',
      [id]
    );

    // Parse JSON fields
    assessment.assignments = assignments || [];

    // Parse JSON fields in assessment using safe helper
    const parseJsonField = (field) => safeJsonParse(field, null);

    assessment.proctoring_settings = parseJsonField(assessment.proctoring_settings);

    // Construct scheduling object from new individual fields
    assessment.scheduling = {
      start_date: assessment.default_start_date_only,
      start_time: assessment.default_start_time_only,
      end_date: assessment.default_end_date_only,
      end_time: assessment.default_end_time_only,
      timezone: assessment.default_assessment_timezone,
      early_access_hours: assessment.default_early_access_hours,
      late_submission_minutes: assessment.default_late_submission_minutes
    };

    assessment.access_control = parseJsonField(assessment.access_control);
    assessment.assignment_settings = parseJsonField(assessment.assignment_settings);
    assessment.sections = parseJsonField(assessment.sections);
    assessment.tags = parseJsonField(assessment.tags);
    assessment.metadata = parseJsonField(assessment.metadata);

    // Calculate question count from sections
    let totalQuestions = 0;
    if (assessment.sections && Array.isArray(assessment.sections)) {
      assessment.sections.forEach(section => {
        if (section.questions && Array.isArray(section.questions)) {
          totalQuestions += section.questions.length;
        }
      });
    }
    assessment.question_count = totalQuestions;

    // Parse JSON fields in questions within sections
    if (assessment.sections && Array.isArray(assessment.sections)) {
      assessment.sections.forEach(section => {
        if (section.questions && Array.isArray(section.questions)) {
          section.questions.forEach(question => {
            question.options = parseJsonField(question.options);
            question.correct_answer = parseJsonField(question.correct_answer);
            question.correct_answers = parseJsonField(question.correct_answers);
            question.tags = parseJsonField(question.tags);
            question.hints = parseJsonField(question.hints);
            question.metadata = parseJsonField(question.metadata);
          });
        }
      });
    }

    res.json({
      success: true,
      data: assessment
    });
  } catch (error) {
    // console.error('Get assessment template by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Update assessment template
export const updateAssessmentTemplate = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    // Validate status field if present
    if (updateData.status && !['draft', 'active', 'archived', 'published'].includes(updateData.status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status value. Must be one of: draft, active, archived, published. Received: ${updateData.status}`
      });
    }

    // Validate proctoring_type field if present
    if (updateData.proctoring_type && !['none', 'basic', 'advanced', 'ai'].includes(updateData.proctoring_type)) {
      return res.status(400).json({
        success: false,
        message: `Invalid proctoring_type value. Must be one of: none, basic, advanced, ai. Received: ${updateData.proctoring_type}`
      });
    }


    // Map difficulty level from frontend to database values if needed
    const mapDifficultyLevel = (level) => {
      const mapping = {
        'easy': 'beginner',
        'medium': 'intermediate',
        'hard': 'advanced',
        'expert': 'expert'
      };
      return mapping[level] || level; // If already a database value, return as is
    };

    // Map difficulty level if it's a frontend value
    if (updateData.difficulty_level) {
      updateData.difficulty_level = mapDifficultyLevel(updateData.difficulty_level);
    }

    // Validate difficulty_level field if present
    if (updateData.difficulty_level && !['beginner', 'intermediate', 'advanced', 'expert'].includes(updateData.difficulty_level)) {
      return res.status(400).json({
        success: false,
        message: `Invalid difficulty_level value. Must be one of: beginner, intermediate, advanced, expert. Received: ${updateData.difficulty_level}`
      });
    }

    // Check if assessment exists
    const [assessments] = await pool.execute(
      'SELECT * FROM assessments WHERE id = ?',
      [id]
    );

    if (assessments.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Assessment template not found'
      });
    }

    // Handle scheduling data conversion if present
    let schedulingUpdated = false;
    let newSchedulingData = null;

    if (updateData.scheduling) {
      const scheduling = updateData.scheduling;



      // Clean up date strings to extract just the date part (YYYY-MM-DD)
      const cleanDateString = (dateString) => {
        if (!dateString) return null;
        // Ensure dateString is a string before processing
        const dateStr = String(dateString);
        // If it's a full ISO datetime string, extract just the date part
        if (dateStr.includes('T')) {
          return dateStr.split('T')[0];
        }
        return dateStr;
      };

      // Handle date conversion - just store as YYYY-MM-DD string
      const convertDateToLocalDate = (dateString, timezone = 'UTC') => {
        if (!dateString) return null;
        try {
          // If it's already in YYYY-MM-DD format, return as is
          if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
            return dateString;
          }
          // If it's a full datetime, extract just the date part
          if (dateString.includes('T')) {
            return dateString.split('T')[0];
          }
          // Otherwise, try to parse and format
          const date = new Date(dateString);
          return date.toISOString().split('T')[0];
        } catch (error) {
          // console.error('Error converting date:', error);
          return cleanDateString(dateString);
        }
      };

      updateData.default_start_date_only = convertDateToLocalDate(scheduling.start_date, scheduling.timezone) || null;
      updateData.default_start_time_only = scheduling.start_time || null;
      updateData.default_end_date_only = convertDateToLocalDate(scheduling.end_date, scheduling.timezone) || null;
      updateData.default_end_time_only = scheduling.end_time || null;
      updateData.default_assessment_timezone = scheduling.timezone || 'UTC';
      updateData.default_early_access_hours = scheduling.early_access_hours || 0;
      updateData.default_late_submission_minutes = scheduling.late_submission_minutes || 0;



      // Store the new scheduling data to update assignments
      newSchedulingData = {
        start_date_only: updateData.default_start_date_only,
        start_time_only: updateData.default_start_time_only,
        end_date_only: updateData.default_end_date_only,
        end_time_only: updateData.default_end_time_only,
        assessment_timezone: updateData.default_assessment_timezone,
        early_access_hours: updateData.default_early_access_hours,
        late_submission_minutes: updateData.default_late_submission_minutes
      };



      schedulingUpdated = true;

      // Remove the old scheduling object
      delete updateData.scheduling;
    }

    // Extract questions from sections if present
    let allQuestions = [];
    if (updateData.sections && Array.isArray(updateData.sections)) {
      updateData.sections.forEach(section => {
        if (section.questions && Array.isArray(section.questions)) {
          section.questions.forEach(question => {
            allQuestions.push({
              ...question,
              section_id: section.id
            });
          });
        }
      });
    }

    // Update assessment template
    const updateFields = [];
    const updateValues = [];

    Object.keys(updateData).forEach(key => {
      if (key !== 'id' && key !== 'created_by' && key !== 'created_at') {
        updateFields.push(`${key} = ?`);
        if (typeof updateData[key] === 'object') {
          updateValues.push(JSON.stringify(updateData[key]));
        } else {
          updateValues.push(updateData[key]);
        }
      }
    });

    if (updateFields.length > 0) {
      updateValues.push(id);
      const updateQuery = `UPDATE assessments SET ${updateFields.join(', ')} WHERE id = ?`;

      await pool.execute(updateQuery, updateValues);
    }

    // Handle questions if any were extracted
    if (allQuestions.length > 0) {
      // For now, we'll store questions within the sections JSON
      // This is simpler than managing a separate assessment_questions table
      // The questions are already included in the sections that were saved above
    }

    // Update assignment records if scheduling was changed
    if (schedulingUpdated && newSchedulingData) {
      try {


        // First, let's check what assignments exist for this assessment
        const [existingAssignments] = await pool.execute(
          'SELECT * FROM assessment_assignments WHERE assessment_id = ?',
          [id]
        );


        // Update all assignment records for this assessment with the new scheduling data
        const assignmentUpdateQuery = `
          UPDATE assessment_assignments 
          SET 
            start_date_only = ?,
            start_time_only = ?,
            end_date_only = ?,
            end_time_only = ?,
            assessment_timezone = ?,
            early_access_hours = ?,
            late_submission_minutes = ?,
            updated_at = CURRENT_TIMESTAMP
          WHERE assessment_id = ?
        `;

        const updateResult = await pool.execute(assignmentUpdateQuery, [
          newSchedulingData.start_date_only,
          newSchedulingData.start_time_only,
          newSchedulingData.end_date_only,
          newSchedulingData.end_time_only,
          newSchedulingData.assessment_timezone,
          newSchedulingData.early_access_hours,
          newSchedulingData.late_submission_minutes,
          id
        ]);



        // Verify the update by checking the assignments again
        const [updatedAssignments] = await pool.execute(
          'SELECT * FROM assessment_assignments WHERE assessment_id = ?',
          [id]
        );

      } catch (error) {
        // console.error('❌ [UPDATE] Error updating assignment scheduling:', error);
        // Don't fail the entire update if assignment update fails
        // Just log the error and continue
      }
    }

    // Get updated assessment
    const [updatedAssessments] = await pool.execute(
      'SELECT * FROM assessments WHERE id = ?',
      [id]
    );

    res.json({
      success: true,
      message: 'Assessment template updated successfully',
      data: updatedAssessments[0]
    });
  } catch (error) {
    // console.error('Update assessment template error:', error);
    // console.error('Error stack:', error.stack);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

// Delete assessment template
export const deleteAssessmentTemplate = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if assessment exists
    const [assessments] = await pool.execute(
      'SELECT * FROM assessments WHERE id = ?',
      [id]
    );

    if (assessments.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Assessment template not found'
      });
    }

    // Delete assessment (cascade will handle related records)
    await pool.execute(
      'DELETE FROM assessments WHERE id = ?',
      [id]
    );

    res.json({
      success: true,
      message: 'Assessment template deleted successfully'
    });
  } catch (error) {
    // console.error('Delete assessment template error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// =====================================================
// ASSESSMENT SECTIONS MANAGEMENT
// =====================================================

// Create assessment section
export const createAssessmentSection = async (req, res) => {
  try {
    const { assessment_id } = req.params;
    const {
      name,
      description,
      order_index,
      time_limit_minutes,
      allowed_question_types,
      shuffle_questions,
      navigation_type,
      instructions
    } = req.body;

    const section_id = uuidv4();

    // Validate required fields
    if (!name || !assessment_id) {
      return res.status(400).json({
        success: false,
        message: 'Section name and assessment ID are required'
      });
    }

    // Insert section
    await pool.execute(
      `INSERT INTO assessment_sections (
        id, assessment_id, name, description, order_index, time_limit_minutes,
        allowed_question_types, shuffle_questions, navigation_type, instructions
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        section_id, assessment_id, name, description, order_index, time_limit_minutes,
        JSON.stringify(allowed_question_types), shuffle_questions, navigation_type, instructions
      ]
    );

    // Get created section
    const [sections] = await pool.execute(
      'SELECT * FROM assessment_sections WHERE id = ?',
      [section_id]
    );

    res.status(201).json({
      success: true,
      message: 'Assessment section created successfully',
      data: sections[0]
    });
  } catch (error) {
    // console.error('Create assessment section error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Update assessment section
export const updateAssessmentSection = async (req, res) => {
  try {
    const { assessment_id, section_id } = req.params;
    const updateData = req.body;

    // Check if section exists
    const [sections] = await pool.execute(
      'SELECT * FROM assessment_sections WHERE id = ? AND assessment_id = ?',
      [section_id, assessment_id]
    );

    if (sections.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Assessment section not found'
      });
    }

    // Update section
    const updateFields = [];
    const updateValues = [];

    Object.keys(updateData).forEach(key => {
      if (key !== 'id' && key !== 'assessment_id' && key !== 'created_at') {
        updateFields.push(`${key} = ?`);
        if (typeof updateData[key] === 'object') {
          updateValues.push(JSON.stringify(updateData[key]));
        } else {
          updateValues.push(updateData[key]);
        }
      }
    });

    if (updateFields.length > 0) {
      updateValues.push(section_id);
      await pool.execute(
        `UPDATE assessment_sections SET ${updateFields.join(', ')} WHERE id = ?`,
        updateValues
      );
    }

    // Get updated section
    const [updatedSections] = await pool.execute(
      'SELECT * FROM assessment_sections WHERE id = ?',
      [section_id]
    );

    res.json({
      success: true,
      message: 'Assessment section updated successfully',
      data: updatedSections[0]
    });
  } catch (error) {
    // console.error('Update assessment section error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Delete assessment section
export const deleteAssessmentSection = async (req, res) => {
  try {
    const { assessment_id, section_id } = req.params;

    // Check if section exists
    const [sections] = await pool.execute(
      'SELECT * FROM assessment_sections WHERE id = ? AND assessment_id = ?',
      [section_id, assessment_id]
    );

    if (sections.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Assessment section not found'
      });
    }

    // Delete section (cascade will handle related records)
    await pool.execute(
      'DELETE FROM assessment_sections WHERE id = ?',
      [section_id]
    );

    res.json({
      success: true,
      message: 'Assessment section deleted successfully'
    });
  } catch (error) {
    // console.error('Delete assessment section error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// =====================================================
// ASSESSMENT QUESTIONS MANAGEMENT
// =====================================================

// Add question to assessment
export const addQuestionToAssessment = async (req, res) => {
  try {
    const { assessment_id } = req.params;
    const {
      question_id,
      section_id,
      question_order,
      points,
      time_limit_seconds,
      is_required
    } = req.body;

    const assessment_question_id = uuidv4();

    // Validate required fields
    if (!question_id || !assessment_id) {
      return res.status(400).json({
        success: false,
        message: 'Question ID and assessment ID are required'
      });
    }

    // Check if question already exists in assessment
    const [existingQuestions] = await pool.execute(
      'SELECT * FROM assessment_questions WHERE assessment_id = ? AND question_id = ?',
      [assessment_id, question_id]
    );

    if (existingQuestions.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Question already exists in this assessment'
      });
    }

    // Insert assessment question (using only existing columns)
    await pool.execute(
      `INSERT INTO assessment_questions (
        id, assessment_id, question_id, question_order, points, is_required
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        assessment_question_id, assessment_id, question_id, question_order,
        points, is_required
      ]
    );

    // Also update the sections JSON field to include this question
    try {
      // Get the question details first
      const [questionResult] = await pool.execute(
        'SELECT * FROM questions WHERE id = ?',
        [question_id]
      );

      if (questionResult.length > 0) {
        const question = questionResult[0];

        // Get the current assessment template
        const [assessmentResult] = await pool.execute(
          'SELECT sections FROM assessments WHERE id = ?',
          [assessment_id]
        );

        if (assessmentResult.length > 0) {
          let sections = assessmentResult[0].sections;

          // Parse sections if it's a string
          if (typeof sections === 'string') {
            sections = JSON.parse(sections);
          } else if (!sections) {
            sections = [];
          }

          // Ensure sections is an array
          if (!Array.isArray(sections)) {
            sections = [];
          }

          // Find or create a default section
          let defaultSection = sections.find(section => section.name === 'Default Section');
          if (!defaultSection) {
            defaultSection = {
              id: uuidv4(),
              name: 'Default Section',
              description: 'Default section for questions',
              questions: []
            };
            sections.push(defaultSection);
          }

          // Ensure questions array exists
          if (!defaultSection.questions) {
            defaultSection.questions = [];
          }

          // Add the question to the default section
          const questionData = {
            id: question_id,
            title: question.title || 'Untitled Question',
            content: question.content,
            question_type: question.question_type,
            points: points,
            is_required: is_required,
            order: question_order
          };

          defaultSection.questions.push(questionData);

          // Update the assessment template with the new sections
          await pool.execute(
            'UPDATE assessments SET sections = ? WHERE id = ?',
            [JSON.stringify(sections), assessment_id]
          );

        }
      }
    } catch (error) {
      // console.error('Error updating sections JSON:', error);
      // Don't fail the entire operation if sections update fails
    }

    // Get created assessment question with question details
    const [assessmentQuestions] = await pool.execute(
      `SELECT 
        aq.*,
        q.*,
        qc.name as category_name,
        qsc.name as subcategory_name
      FROM assessment_questions aq
      INNER JOIN questions q ON aq.question_id = q.id
      LEFT JOIN question_categories qc ON q.category_id = qc.id
      LEFT JOIN question_categories qsc ON q.subcategory_id = qsc.id
      WHERE aq.id = ?`,
      [assessment_question_id]
    );

    const assessmentQuestion = assessmentQuestions[0];

    // Parse JSON fields safely
    assessmentQuestion.options = safeJsonParse(assessmentQuestion.options, null);
    assessmentQuestion.correct_answer = safeJsonParse(assessmentQuestion.correct_answer, null);
    assessmentQuestion.correct_answers = safeJsonParse(assessmentQuestion.correct_answers, null);
    assessmentQuestion.tags = safeJsonParse(assessmentQuestion.tags, []);
    assessmentQuestion.hints = safeJsonParse(assessmentQuestion.hints, []);
    assessmentQuestion.metadata = safeJsonParse(assessmentQuestion.metadata, {});

    res.status(201).json({
      success: true,
      message: 'Question added to assessment successfully',
      data: assessmentQuestion
    });
  } catch (error) {
    // console.error('Add question to assessment error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Remove question from assessment
export const removeQuestionFromAssessment = async (req, res) => {
  try {
    const { assessment_id, question_id } = req.params;

    // Check if question exists in assessment
    const [assessmentQuestions] = await pool.execute(
      'SELECT * FROM assessment_questions WHERE assessment_id = ? AND question_id = ?',
      [assessment_id, question_id]
    );

    if (assessmentQuestions.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Question not found in assessment'
      });
    }

    // Remove question from assessment
    await pool.execute(
      'DELETE FROM assessment_questions WHERE assessment_id = ? AND question_id = ?',
      [assessment_id, question_id]
    );

    res.json({
      success: true,
      message: 'Question removed from assessment successfully'
    });
  } catch (error) {
    // console.error('Remove question from assessment error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Reorder assessment questions
export const reorderAssessmentQuestions = async (req, res) => {
  try {
    const { assessment_id } = req.params;
    const { question_orders } = req.body; // Array of {question_id, new_order}

    // Update question orders
    for (const item of question_orders) {
      await pool.execute(
        'UPDATE assessment_questions SET question_order = ? WHERE assessment_id = ? AND question_id = ?',
        [item.new_order, assessment_id, item.question_id]
      );
    }

    res.json({
      success: true,
      message: 'Questions reordered successfully'
    });
  } catch (error) {
    // console.error('Reorder assessment questions error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// =====================================================
// ASSESSMENT ASSIGNMENTS MANAGEMENT
// =====================================================

// Create assessment assignment
export const createAssessmentAssignment = async (req, res) => {
  try {
    const assessment_id = req.params.assessment_id; // Get from URL parameter
    const {
      assignment_type,
      target_id,
      start_date_only,
      start_time_only,
      end_date_only,
      end_time_only,
      assessment_timezone,
      early_access_hours,
      late_submission_minutes,
      password,
      ip_restrictions,
      device_restrictions,
      browser_restrictions
    } = req.body;

    const created_by = req.user.id;

    // Validate required fields
    if (!assessment_id || !assignment_type || !target_id) {
      return res.status(400).json({
        success: false,
        message: 'Assessment ID, assignment type, and target ID are required'
      });
    }

    // Validate scheduling fields
    if (!start_date_only || !start_time_only || !end_date_only || !end_time_only || !assessment_timezone) {
      return res.status(400).json({
        success: false,
        message: 'All scheduling fields (start date, start time, end date, end time, timezone) are required'
      });
    }

    // Validate date/time logic
    const startDateTime = new Date(`${start_date_only}T${start_time_only}`);
    const endDateTime = new Date(`${end_date_only}T${end_time_only}`);

    if (isNaN(startDateTime.getTime()) || isNaN(endDateTime.getTime())) {
      return res.status(400).json({
        success: false,
        message: 'Invalid date or time format'
      });
    }

    if (startDateTime >= endDateTime) {
      return res.status(400).json({
        success: false,
        message: 'End date/time must be after start date/time'
      });
    }

    // Generate assignment ID
    const assignment_id = crypto.randomUUID();

    // Insert into database with new structure
    await pool.execute(
      `INSERT INTO assessment_assignments (
        id, assessment_id, assignment_type, target_id,
        start_date_only, start_time_only, end_date_only, end_time_only,
        assessment_timezone, early_access_hours, late_submission_minutes,
        password, ip_restrictions, device_restrictions, browser_restrictions, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        assignment_id, assessment_id, assignment_type, target_id,
        start_date_only, start_time_only, end_date_only, end_time_only,
        assessment_timezone, early_access_hours || 0, late_submission_minutes || 0,
        password || null,
        JSON.stringify(ip_restrictions || {}),
        JSON.stringify(device_restrictions || {}),
        JSON.stringify(browser_restrictions || {}),
        created_by
      ]
    );

    // Get created assignment
    const [assignments] = await pool.execute(
      'SELECT * FROM assessment_assignments WHERE id = ?',
      [assignment_id]
    );

    res.status(201).json({
      success: true,
      message: 'Assessment assignment created successfully',
      data: assignments[0]
    });
  } catch (error) {
    // console.error('Create assessment assignment error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get assessment assignments
export const getAssessmentAssignments = async (req, res) => {
  try {
    const { assessment_id } = req.params;

    const [assignments] = await pool.execute(
      'SELECT * FROM assessment_assignments WHERE assessment_id = ?',
      [assessment_id]
    );

    res.json({
      success: true,
      data: assignments
    });
  } catch (error) {
    // console.error('Get assessment assignments error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Delete assessment assignment
export const deleteAssessmentAssignment = async (req, res) => {
  try {
    const { assessment_id, assignment_id } = req.params;

    // Check if assignment exists
    const [assignments] = await pool.execute(
      'SELECT * FROM assessment_assignments WHERE id = ? AND assessment_id = ?',
      [assignment_id, assessment_id]
    );

    if (assignments.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Assessment assignment not found'
      });
    }

    // Delete assignment
    await pool.execute(
      'DELETE FROM assessment_assignments WHERE id = ?',
      [assignment_id]
    );

    res.json({
      success: true,
      message: 'Assessment assignment deleted successfully'
    });
  } catch (error) {
    // console.error('Delete assessment assignment error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// =====================================================
// QUESTION SELECTION HELPERS
// =====================================================

// Get questions for selection (filtered by type, category, etc.)
export const getQuestionsForSelection = async (req, res) => {
  try {
    const {
      question_type,
      category_id,
      subcategory_id,
      difficulty_level,
      tags,
      search,
      page = 1,
      limit = 20
    } = req.query;

    const offset = (page - 1) * limit;
    const conditions = [];
    const params = [];

    // Build WHERE conditions
    if (question_type) {
      conditions.push('question_type = ?');
      params.push(question_type);
    }

    if (category_id) {
      conditions.push('category_id = ?');
      params.push(category_id);
    }

    if (subcategory_id) {
      conditions.push('subcategory_id = ?');
      params.push(subcategory_id);
    }

    if (difficulty_level) {
      conditions.push('difficulty_level = ?');
      params.push(difficulty_level);
    }

    if (search) {
      conditions.push('(title LIKE ? OR content LIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
    }

    // Role-based filtering
    if (req.user.role === 'college-admin') {
      conditions.push('(college_id = ? OR is_public = TRUE)');
      params.push(req.user.college_id);
    } else if (req.user.role === 'faculty') {
      conditions.push('(created_by = ? OR college_id = ? OR is_public = TRUE)');
      params.push(req.user.id, req.user.college_id);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Get total count
    const [countResult] = await pool.query(
      `SELECT COUNT(*) as total FROM questions ${whereClause}`,
      params
    );

    const total = countResult[0].total;

    // Get questions with pagination
    const safeLimit = parseInt(limit) || 20;
    const safeOffset = parseInt(offset) || 0;

    const [questions] = await pool.query(
      `SELECT 
        q.*,
        qc.name as category_name,
        qsc.name as subcategory_name,
        u.name as creator_name
      FROM questions q
      LEFT JOIN question_categories qc ON q.category_id = qc.id
      LEFT JOIN question_categories qsc ON q.subcategory_id = qsc.id
      LEFT JOIN users u ON q.created_by = u.id
      ${whereClause}
      ORDER BY q.created_at DESC
      LIMIT ${safeLimit} OFFSET ${safeOffset}`,
      params
    );

    // Parse JSON fields safely
    questions.forEach(question => {
      question.options = safeJsonParse(question.options, null);
      question.correct_answer = safeJsonParse(question.correct_answer, null);
      question.correct_answers = safeJsonParse(question.correct_answers, null);
      question.tags = safeJsonParse(question.tags, []);
      question.hints = safeJsonParse(question.hints, []);
      question.metadata = safeJsonParse(question.metadata, {});
    });

    res.json({
      success: true,
      data: questions,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    // console.error('Get questions for selection error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Calculate total points for assessment
export const calculateAssessmentPoints = async (req, res) => {
  try {
    const { assessment_id } = req.params;

    const [result] = await pool.execute(
      'SELECT SUM(points) as total_points FROM assessment_questions WHERE assessment_id = ?',
      [assessment_id]
    );

    const totalPoints = result[0].total_points || 0;

    res.json({
      success: true,
      data: { total_points: totalPoints }
    });
  } catch (error) {
    // console.error('Calculate assessment points error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// =====================================================
// EMAIL NOTIFICATIONS
// =====================================================

// Send email notifications for assessment assignment
export const sendAssessmentNotifications = async (req, res) => {
  try {
    const { assessment_id, assignment_id, recipients, assessment_details } = req.body;

    // Validate required fields
    if (!assessment_id || !recipients || !assessment_details) {
      return res.status(400).json({
        success: false,
        message: 'Assessment ID, recipients, and assessment details are required'
      });
    }

    // Get recipient emails from database
    const recipientEmails = await getRecipientEmailsFromAssignments(recipients);

    if (recipientEmails.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid recipients found'
      });
    }

    // Send email notifications
    const emailResult = await emailService.sendAssessmentNotification(
      recipientEmails,
      assessment_details
    );

    if (emailResult.success) {
      // Log notification in database
      await logNotificationInDatabase(assessment_id, assignment_id, recipients, 'sent');

      res.json({
        success: true,
        message: `Email notifications sent to ${recipientEmails.length} recipients`,
        data: {
          recipients_count: recipientEmails.length,
          assessment_id,
          assignment_id
        }
      });
    } else {
      // Handle different types of email errors
      if (emailResult.errorType === 'NOT_CONFIGURED') {
        res.status(200).json({
          success: true,
          message: `Assessment created successfully. Email notifications could not be sent (${recipientEmails.length} recipients) - Email service not configured.`,
          warning: 'Email service not configured. Please configure SMTP settings in environment variables.',
          data: {
            recipients_count: recipientEmails.length,
            assessment_id,
            assignment_id,
            email_sent: false
          }
        });
      } else {
        res.status(200).json({
          success: true,
          message: `Assessment created successfully. Email notifications could not be sent (${recipientEmails.length} recipients) - ${emailResult.message}`,
          warning: 'Some email notifications failed to send. Assessment was created successfully.',
          data: {
            recipients_count: recipientEmails.length,
            assessment_id,
            assignment_id,
            email_sent: false
          }
        });
      }
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Helper function to get recipient emails from assignments
const getRecipientEmailsFromAssignments = async (assignments) => {
  const emails = [];

  for (const assignment of assignments) {
    try {
      switch (assignment.assignment_type) {
        case 'college':
          const [collegeStudents] = await pool.execute(
            'SELECT email, name FROM users WHERE college_id = ? AND role = \'student\' AND is_active = true',
            [assignment.target_id]
          );
          emails.push(...collegeStudents);
          break;

        case 'department':
          const [deptStudents] = await pool.execute(
            'SELECT email, name FROM users WHERE department = ? AND role = \'student\' AND is_active = true',
            [assignment.target_id]
          );
          emails.push(...deptStudents);
          break;

        case 'group':
          // This would need a groups table - for now, we'll skip

          break;

        case 'individual':
          const [student] = await pool.execute(
            'SELECT email, name FROM users WHERE id = ? AND role = \'student\' AND is_active = true',
            [assignment.target_id]
          );
          if (student.length > 0) {
            emails.push(student[0]);
          }
          break;
      }
    } catch (error) {
      // console.error(`Error getting emails for assignment type ${assignment.assignment_type}:`, error);
    }
  }

  return emails;
};

// Helper function to log notifications in database
const logNotificationInDatabase = async (assessment_id, assignment_id, recipients, status, notificationType = 'assignment') => {
  try {
    // Skip logging if we don't have valid recipients or if this is a bulk notification
    // The assessment_notifications table requires a valid user_id that exists in the users table
    // For bulk notifications, we can't log individual notifications without knowing specific user IDs
    if (!recipients || recipients.length === 0) {
      // console.log('Skipping notification logging: No recipients provided');
      return;
    }

    // For now, we'll skip bulk notification logging to avoid foreign key constraint errors
    // In a full implementation, you'd want to log individual notifications for each recipient
    // by extracting user IDs from the recipients array and creating separate notification records
    // console.log(`Skipping bulk notification logging for ${recipients.length} recipients to avoid foreign key constraint issues`);

    // TODO: Implement individual notification logging for each recipient
    // This would require:
    // 1. Extracting user IDs from recipients array
    // 2. Creating separate notification records for each user
    // 3. Handling cases where recipient might not have a valid user_id

  } catch (error) {
    // console.error('Error logging notification:', error);
  }
};

// Send reminder emails for an assessment
export const sendAssessmentReminder = async (req, res) => {
  try {
    const { assessment_id } = req.params;

    // Get assessment details
    const [assessmentRows] = await pool.execute(
      `SELECT * FROM assessments WHERE id = ?`,
      [assessment_id]
    );

    if (assessmentRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Assessment not found'
      });
    }

    const assessment = assessmentRows[0];

    // Get all assignments for this assessment
    const [assignmentRows] = await pool.execute(
      `SELECT * FROM assessment_assignments WHERE assessment_id = ?`,
      [assessment_id]
    );

    if (assignmentRows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No assignments found for this assessment'
      });
    }

    // Get recipient emails from assignments
    const recipientEmails = await getRecipientEmailsFromAssignments(assignmentRows);

    if (recipientEmails.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No recipients found for this assessment'
      });
    }

    // Prepare assessment details for email
    const assessmentDetails = {
      title: assessment.title,
      start_date: assignmentRows[0].start_date_only,
      end_date: assignmentRows[0].end_date_only,
      start_time: assignmentRows[0].start_time_only,
      end_time: assignmentRows[0].end_time_only,
      timezone: assignmentRows[0].assessment_timezone,
      instructions: assessment.instructions,
      total_points: assessment.total_points,
      proctoring_required: assessment.require_proctoring,
      proctoring_type: assessment.proctoring_type,
      max_attempts: assessment.max_attempts,
      duration_minutes: assessment.time_limit_minutes,
      description: assessment.description,
      access_password: assignmentRows[0].password
    };

    // Send reminder emails
    const emailResult = await emailService.sendReminderNotification(recipientEmails, assessmentDetails);

    if (emailResult.success) {
      // Log reminder notification in database
      await logNotificationInDatabase(assessment_id, null, recipientEmails, 'sent', 'reminder');

      res.json({
        success: true,
        message: `Reminder emails sent to ${recipientEmails.length} recipients`,
        data: {
          recipients_count: recipientEmails.length,
          assessment_id
        }
      });
    } else {
      // Handle different types of email errors
      if (emailResult.errorType === 'NOT_CONFIGURED') {
        res.status(200).json({
          success: true,
          message: `Reminder emails could not be sent (${recipientEmails.length} recipients) - Email service not configured.`,
          warning: 'Email service not configured. Please configure SMTP settings in environment variables.',
          data: {
            recipients_count: recipientEmails.length,
            assessment_id,
            email_sent: false
          }
        });
      } else {
        res.status(200).json({
          success: true,
          message: `Reminder emails could not be sent (${recipientEmails.length} recipients) - ${emailResult.message}`,
          warning: 'Some reminder emails failed to send.',
          data: {
            recipients_count: recipientEmails.length,
            assessment_id,
            email_sent: false
          }
        });
      }
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// =====================================================
// STUDENT ASSESSMENT FUNCTIONS
// =====================================================

// Get assessment questions for admin (for copying purposes)
export const getAssessmentQuestionsForAdmin = async (req, res) => {
  try {
    const { assessment_id } = req.params;
    const { id: user_id, role } = req.user;

    // Check if user has admin access to this assessment
    let accessQuery;
    let accessParams;

    if (role === 'super-admin' || role === 'super_admin') {
      // Super admin can access any assessment
      accessQuery = `
        SELECT a.* 
        FROM assessments a
        WHERE a.id = ?
      `;
      accessParams = [assessment_id];
    } else if (role === 'college-admin' || role === 'faculty') {
      // College admin and faculty can access assessments they created or from their college
      accessQuery = `
        SELECT a.* 
        FROM assessments a
        WHERE a.id = ? 
        AND (a.created_by = ? OR a.college_id IN (
          SELECT college_id FROM users WHERE id = ?
        ))
      `;
      accessParams = [assessment_id, user_id, user_id];
    } else {
      return res.status(403).json({
        success: false,
        message: 'Admin access required'
      });
    }

    const [accessResult] = await pool.query(accessQuery, accessParams);

    if (accessResult.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'You do not have access to this assessment'
      });
    }

    const assessment = accessResult[0];

    // Get questions from assessment_questions table
    let allQuestions = [];

    try {
      const [questionsResult] = await pool.query(`
        SELECT 
          aq.*,
          q.*,
          qc.name as category_name,
          qsc.name as subcategory_name
        FROM assessment_questions aq
        INNER JOIN questions q ON aq.question_id = q.id
        LEFT JOIN question_categories qc ON q.category_id = qc.id
        LEFT JOIN question_categories qsc ON q.subcategory_id = qsc.id
        WHERE aq.assessment_id = ?
        ORDER BY aq.question_order ASC
      `, [assessment_id]);

      allQuestions = questionsResult;
    } catch (error) {
      // console.error('Error fetching questions from assessment_questions table:', error);
    }

    // If no questions found in assessment_questions table, try sections (legacy)
    if (allQuestions.length === 0 && assessment.sections) {
      try {
        // Check if sections is already an object or needs parsing
        let sections;
        if (typeof assessment.sections === 'string') {
          sections = JSON.parse(assessment.sections);
        } else {
          sections = assessment.sections;
        }

        if (Array.isArray(sections)) {
          sections.forEach(section => {
            if (section.questions && Array.isArray(section.questions)) {
              allQuestions = allQuestions.concat(section.questions);
            }
          });
        }
      } catch (error) {
        // console.error('Error processing sections:', error);
      }
    }

    res.json({
      success: true,
      data: allQuestions
    });

  } catch (error) {
    // console.error('Error getting assessment questions for admin:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get assessment questions'
    });
  }
};

// Get assessment questions for student
export const getAssessmentQuestions = async (req, res) => {
  try {
    const { assessment_id } = req.params;
    const { id: user_id, role } = req.user;

    // Check if user has access to this assessment
    let accessQuery;
    let accessParams;

    if (role === 'super-admin' || role === 'super_admin') {
      // Super admin can access any assessment
      accessQuery = `
        SELECT a.* 
        FROM assessments a
        WHERE a.id = ?
      `;
      accessParams = [assessment_id];
    } else if (role === 'college-admin' || role === 'faculty') {
      // College admin and faculty can access assessments they created or from their college
      accessQuery = `
        SELECT a.* 
        FROM assessments a
        WHERE a.id = ? 
        AND (a.created_by = ? OR a.college_id IN (
          SELECT college_id FROM users WHERE id = ?
        ))
      `;
      accessParams = [assessment_id, user_id, user_id];
    } else {
      // Students need assignment access
      accessQuery = `
        SELECT aa.*, a.* 
        FROM assessment_assignments aa
        JOIN assessments a ON aa.assessment_id = a.id
        WHERE aa.assessment_id = ? 
        AND (aa.target_id = ? OR aa.target_id IN (
          SELECT college_id FROM users WHERE id = ?
        ))
        AND a.is_published = true
      `;
      accessParams = [assessment_id, user_id, user_id];
    }

    const [accessResult] = await pool.query(accessQuery, accessParams);

    if (accessResult.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'You do not have access to this assessment'
      });
    }

    const assessment = accessResult[0];

    // Get current time for all role checks
    const now = new Date();

    // Only check time restrictions for students
    if (role === 'student') {

      // Check if assessment has started
      if (assessment.start_date_only && assessment.start_time_only) {
        const startDateTimeString = `${assessment.start_date_only}T${assessment.start_time_only}`;
        const startDateTime = new Date(startDateTimeString);

        if (now < startDateTime) {
          return res.status(403).json({
            success: false,
            message: 'Assessment has not started yet.'
          });
        }
      }

      // Check if assessment has ended
      if (assessment.end_date_only && assessment.end_time_only) {
        const endDateTimeString = `${assessment.end_date_only}T${assessment.end_time_only}`;
        const endDateTime = new Date(endDateTimeString);

        if (now > endDateTime) {
          return res.status(403).json({
            success: false,
            message: 'Assessment time has expired.'
          });
        }
      }
    }

    // For students, check if there's an in-progress attempt or create one
    // For admins, just get the questions without attempt logic
    if (role === 'student') {
      const attemptQuery = `
        SELECT id, status, started_at, attempt_number
        FROM assessment_submissions 
        WHERE assessment_id = ? AND student_id = ?
        ORDER BY attempt_number DESC
        LIMIT 1
      `;

      const [attemptResult] = await pool.query(attemptQuery, [assessment_id, user_id]);

      if (attemptResult.length === 0) {
        // Create a new attempt
        const submissionId = uuidv4();
        await pool.query(`
          INSERT INTO assessment_submissions (
            id, assessment_id, student_id, status, started_at, attempt_number
          ) VALUES (?, ?, ?, 'in_progress', NOW(), 1)
        `, [submissionId, assessment_id, user_id]);
      } else {
        const lastAttempt = attemptResult[0];

        // If the last attempt was completed, check if retake is allowed
        if (lastAttempt.status === 'submitted' || lastAttempt.status === 'graded') {
          if (assessment.max_attempts && lastAttempt.attempt_number >= assessment.max_attempts) {
            return res.status(403).json({
              success: false,
              message: `You have exceeded the maximum number of attempts (${assessment.max_attempts}) for this assessment`
            });
          }

          // Create a new attempt for retake
          const submissionId = uuidv4();
          await pool.query(`
            INSERT INTO assessment_submissions (
              id, assessment_id, student_id, status, started_at, attempt_number
            ) VALUES (?, ?, ?, 'in_progress', NOW(), ?)
          `, [submissionId, assessment_id, user_id, lastAttempt.attempt_number + 1]);
        } else if (lastAttempt.status === 'in_progress') {
          // Resume existing attempt
          // Check if it has expired
          if (assessment.end_date_only && assessment.end_time_only) {
            const endDateTimeString = `${assessment.end_date_only}T${assessment.end_time_only}`;
            const endDateTime = new Date(endDateTimeString);

            if (now > endDateTime) {
              // Auto-expire this attempt
              await checkAssessmentExpiration(assessment_id, user_id);
              return res.status(403).json({
                success: false,
                message: 'Assessment time has expired. Your attempt has been automatically submitted.'
              });
            }
          }
        }
      }
    }

    // Extract questions from sections JSON
    let allQuestions = [];

    if (assessment.sections) {
      try {
        let sections;
        if (typeof assessment.sections === 'string') {
          sections = JSON.parse(assessment.sections);
        } else if (typeof assessment.sections === 'object') {
          sections = assessment.sections;
        } else {
          sections = [];
        }

        if (Array.isArray(sections)) {
          sections.forEach((section, sectionIndex) => {
            if (section.questions && Array.isArray(section.questions)) {
              section.questions.forEach((question, questionIndex) => {
                // Parse JSON fields safely
                let parsedOptions = null;
                try {
                  if (question.options) {
                    if (typeof question.options === 'string') {
                      parsedOptions = JSON.parse(question.options);
                    } else if (Array.isArray(question.options)) {
                      parsedOptions = question.options;
                    }
                  }
                } catch (e) {
                  console.warn('Failed to parse options for question', question.id, e.message);
                  parsedOptions = null;
                }

                // Parse other JSON fields
                let parsedTags = [];
                try {
                  if (question.tags) {
                    if (typeof question.tags === 'string') {
                      parsedTags = JSON.parse(question.tags);
                    } else if (Array.isArray(question.tags)) {
                      parsedTags = question.tags;
                    }
                  }
                } catch (e) {
                  parsedTags = [];
                }

                let parsedMetadata = {};
                try {
                  if (question.metadata) {
                    if (typeof question.metadata === 'string') {
                      parsedMetadata = JSON.parse(question.metadata);
                    } else if (typeof question.metadata === 'object') {
                      parsedMetadata = question.metadata;
                    }
                  }
                } catch (e) {
                  parsedMetadata = {};
                }

                // Add section information to each question
                const questionWithSection = {
                  ...question,
                  section_id: section.id,
                  section_name: section.name,
                  section_order: sectionIndex + 1,
                  question_order: questionIndex + 1,
                  // Ensure question_text field exists
                  question_text: question.content || question.question_text || question.title || 'Question',
                  // Parse JSON fields
                  options: parsedOptions,
                  tags: parsedTags,
                  metadata: parsedMetadata
                };

                allQuestions.push(questionWithSection);
              });
            }
          });
        }
      } catch (error) {
        return res.status(500).json({
          success: false,
          message: 'Error parsing assessment sections'
        });
      }
    }

    // Remove correct answers for security
    const questions = allQuestions.map(q => ({
      ...q,
      correct_answer: undefined, // Don't send correct answers to student
      correct_answers: undefined // Don't send correct answers to student
    }));

    res.json({
      success: true,
      data: questions
    });
  } catch (error) {
    // console.error('Error getting assessment questions:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get assessment questions'
    });
  }
};

// Get student's assessment submission
export const getAssessmentSubmission = async (req, res) => {
  try {
    const { assessment_id, student_id } = req.params;
    const { id: current_user_id } = req.user;

    // Verify the student is accessing their own submission
    if (current_user_id !== student_id) {
      return res.status(403).json({
        success: false,
        message: 'You can only access your own submissions'
      });
    }

    const query = `
      SELECT 
        sub.*,
        a.title,
        a.time_limit_minutes as duration_minutes,
        aa.end_date_only,
        aa.end_time_only
      FROM assessment_submissions sub
      JOIN assessments a ON sub.assessment_id = a.id
      LEFT JOIN assessment_assignments aa ON sub.assessment_id = aa.assessment_id AND aa.target_id = ?
      WHERE sub.assessment_id = ? AND sub.student_id = ?
      ORDER BY 
        CASE WHEN sub.status = 'in_progress' THEN 0 ELSE 1 END,
        sub.submitted_at DESC,
        sub.created_at DESC
      LIMIT 1
    `;

    const [result] = await pool.query(query, [student_id, assessment_id, student_id]);

    if (result.length === 0) {
      return res.json({
        success: true,
        data: null
      });
    }

    const submission = result[0];

    // Check if this submission has expired
    if (submission.end_date_only && submission.end_time_only && submission.status === 'in_progress') {
      const endDateTimeString = `${submission.end_date_only}T${submission.end_time_only}`;
      const endDateTime = new Date(endDateTimeString);
      const now = new Date();

      if (now > endDateTime) {
        // Auto-expire this submission
        await checkAssessmentExpiration(assessment_id, student_id);

        // Get the updated submission
        const [updatedResult] = await pool.query(query, [student_id, assessment_id, student_id]);
        if (updatedResult.length > 0) {
          const updatedSubmission = updatedResult[0];
          updatedSubmission.answers = safeJsonParse(updatedSubmission.answers, {});

          return res.json({
            success: true,
            data: updatedSubmission,
            message: 'Assessment was automatically submitted due to time expiration'
          });
        }
      }
    }

    // Parse JSON fields safely
    submission.answers = safeJsonParse(submission.answers, {});

    res.json({
      success: true,
      data: submission
    });
  } catch (error) {
    // console.error('Error getting assessment submission:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get assessment submission'
    });
  }
};

// Save assessment progress (auto-save)
// UPDATED: Now uses student_responses table instead of JSON field for data consistency
// Uses transactions to prevent partial updates
export const saveAssessmentProgress = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const { assessment_id } = req.params;
    const { answers, current_question, time_remaining } = req.body;
    const { id: student_id } = req.user;

    // Import studentAssessmentService dynamically to avoid circular dependency
    const studentAssessmentService = (await import('../services/studentAssessmentService.js')).default;

    // Check if assessment time has expired before allowing progress save
    const timeCheckQuery = `
      SELECT 
        aa.start_date_only,
        aa.start_time_only,
        aa.end_date_only,
        aa.end_time_only
      FROM assessment_assignments aa
      JOIN assessments a ON aa.assessment_id = a.id
      WHERE aa.assessment_id = ? 
      AND (aa.target_id = ? OR aa.target_id IN (
        SELECT college_id FROM users WHERE id = ?
      ))
    `;

    const [timeCheckResult] = await pool.query(timeCheckQuery, [assessment_id, student_id, student_id]);

    if (timeCheckResult.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Assessment not found or access denied'
      });
    }

    const timeInfo = timeCheckResult[0];
    const now = new Date();

    // Check if assessment has ended
    if (timeInfo.end_date_only && timeInfo.end_time_only) {
      const endDateTimeString = `${timeInfo.end_date_only}T${timeInfo.end_time_only}`;
      const endDateTime = new Date(endDateTimeString);

      if (now > endDateTime) {
        // Auto-expire this assessment
        await checkAssessmentExpiration(assessment_id, student_id);
        return res.status(403).json({
          success: false,
          message: 'Assessment time has expired. Your attempt has been automatically submitted.'
        });
      }
    }

    // Check if assessment has started
    if (timeInfo.start_date_only && timeInfo.start_time_only) {
      const startDateTimeString = `${timeInfo.start_date_only}T${timeInfo.start_time_only}`;
      const startDateTime = new Date(startDateTimeString);

      if (now < startDateTime) {
        return res.status(403).json({
          success: false,
          message: 'Assessment has not started yet.'
        });
      }
    }

    // Get or create submission (use connection from transaction)
    const existingQuery = `
      SELECT id FROM assessment_submissions 
      WHERE assessment_id = ? AND student_id = ? AND status = 'in_progress'
      ORDER BY started_at DESC LIMIT 1
      FOR UPDATE
    `;

    const [existingResult] = await connection.query(existingQuery, [assessment_id, student_id]);

    let submissionId;

    if (existingResult.length > 0) {
      submissionId = existingResult[0].id;

      // Update submission metadata (not answers - those go to student_responses)
      const updateQuery = `
        UPDATE assessment_submissions 
        SET 
          current_question = ?,
          time_remaining = ?,
          updated_at = NOW()
        WHERE id = ?
      `;

      await connection.query(updateQuery, [
        current_question,
        time_remaining,
        submissionId
      ]);
    } else {
      // Create new submission
      submissionId = uuidv4();
      const insertQuery = `
        INSERT INTO assessment_submissions (
          id, assessment_id, student_id, current_question, 
          time_remaining, status, started_at
        ) VALUES (?, ?, ?, ?, ?, 'in_progress', NOW())
      `;

      await connection.query(insertQuery, [
        submissionId,
        assessment_id,
        student_id,
        current_question,
        time_remaining
      ]);
    }

    // Save all answers to student_responses table (consolidated storage)
    if (answers && typeof answers === 'object') {
      for (const [questionId, answer] of Object.entries(answers)) {
        if (answer !== undefined && answer !== null) {
          try {
            await studentAssessmentService.saveAnswer(submissionId, questionId, answer, 0, student_id);
          } catch (error) {
            console.error(`Error saving answer for question ${questionId}:`, error);
            // Continue with other answers even if one fails
          }
        }
      }
    }

    await connection.commit();

    res.json({
      success: true,
      message: 'Progress saved successfully'
    });
  } catch (error) {
    await connection.rollback();
    console.error('Error saving assessment progress:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to save progress',
      error: error.message
    });
  } finally {
    connection.release();
  }
};

// Submit assessment
export const submitAssessment = async (req, res) => {
  try {
    const { assessment_id } = req.params;
    const { answers, time_taken, auto_submitted = false } = req.body;
    const { id: student_id } = req.user;

    // Check if assessment time has expired before allowing submission
    const timeCheckQuery = `
      SELECT 
        aa.start_date_only,
        aa.start_time_only,
        aa.end_date_only,
        aa.end_time_only,
        a.time_limit_minutes,
        a.max_attempts
      FROM assessment_assignments aa
      JOIN assessments a ON aa.assessment_id = a.id
      WHERE aa.assessment_id = ? 
      AND (aa.target_id = ? OR aa.target_id IN (
        SELECT college_id FROM users WHERE id = ?
      ))
    `;

    const [timeCheckResult] = await pool.query(timeCheckQuery, [assessment_id, student_id, student_id]);

    if (timeCheckResult.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Assessment not found or access denied'
      });
    }

    const timeInfo = timeCheckResult[0];
    const now = new Date();

    // Check if assessment has ended
    if (timeInfo.end_date_only && timeInfo.end_time_only) {
      const endDateTimeString = `${timeInfo.end_date_only}T${timeInfo.end_time_only}`;
      const endDateTime = new Date(endDateTimeString);

      if (now > endDateTime) {
        return res.status(403).json({
          success: false,
          message: 'Assessment time has expired. You cannot submit after the deadline.'
        });
      }
    }

    // Check if assessment has started
    if (timeInfo.start_date_only && timeInfo.start_time_only) {
      const startDateTimeString = `${timeInfo.start_date_only}T${timeInfo.start_time_only}`;
      const startDateTime = new Date(startDateTimeString);

      if (now < startDateTime) {
        return res.status(403).json({
          success: false,
          message: 'Assessment has not started yet.'
        });
      }
    }

    // Check if this specific assessment has expired for this student
    const wasExpired = await checkAssessmentExpiration(assessment_id, student_id);
    if (wasExpired) {
      return res.status(403).json({
        success: false,
        message: 'Assessment time has expired. Your attempt has been automatically submitted with partial score.'
      });
    }

    // Check if there's an in-progress attempt that needs to be resumed
    const inProgressQuery = `
      SELECT id, status, started_at, answers
      FROM assessment_submissions 
      WHERE assessment_id = ? AND student_id = ? AND status = 'in_progress'
    `;

    const [inProgressResult] = await pool.query(inProgressQuery, [assessment_id, student_id]);

    if (inProgressResult.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No active assessment attempt found. Please start the assessment first.'
      });
    }

    const inProgressSubmission = inProgressResult[0];

    // Check if the in-progress attempt has expired
    if (timeInfo.end_date_only && timeInfo.end_time_only) {
      const endDateTimeString = `${timeInfo.end_date_only}T${timeInfo.end_time_only}`;
      const endDateTime = new Date(endDateTimeString);

      if (now > endDateTime) {
        // Auto-expire the in-progress attempt
        await checkAssessmentExpiration(assessment_id, student_id);
        return res.status(403).json({
          success: false,
          message: 'Assessment time has expired. Your attempt has been automatically submitted.'
        });
      }
    }

    // Validate and sanitize time_taken
    const sanitizedTimeTaken = Math.max(0, Number(time_taken) || 0);
    // console.log('Original time_taken:', time_taken, 'Sanitized:', sanitizedTimeTaken);

    // Check if student has access to this assessment
    const accessQuery = `
      SELECT aa.*, a.* 
      FROM assessment_assignments aa
      JOIN assessments a ON aa.assessment_id = a.id
      WHERE aa.assessment_id = ? 
      AND (aa.target_id = ? OR aa.target_id IN (
        SELECT college_id FROM users WHERE id = ?
      ))
      AND a.status = 'published'
    `;

    const [accessResult] = await pool.query(accessQuery, [assessment_id, student_id, student_id]);

    if (accessResult.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Assessment not found or access denied'
      });
    }

    const assessment = accessResult[0];

    // Check attempt limits
    const attemptQuery = `
      SELECT COUNT(*) as attempt_count, MAX(attempt_number) as max_attempt_number
      FROM assessment_submissions 
      WHERE assessment_id = ? AND student_id = ?
    `;

    const [attemptResult] = await pool.query(attemptQuery, [assessment_id, student_id]);
    const currentAttemptCount = attemptResult[0].attempt_count;
    const maxAttemptNumber = attemptResult[0].max_attempt_number || 0;
    const nextAttemptNumber = maxAttemptNumber + 1;

    // Check if student has exceeded max attempts (only count completed attempts)
    const completedAttemptsQuery = `
      SELECT COUNT(*) as completed_attempts
      FROM assessment_submissions 
      WHERE assessment_id = ? AND student_id = ? AND (status = 'submitted' OR status = 'graded')
    `;

    const [completedAttemptsResult] = await pool.query(completedAttemptsQuery, [assessment_id, student_id]);
    const completedAttempts = completedAttemptsResult[0].completed_attempts;

    if (assessment.max_attempts && completedAttempts >= assessment.max_attempts) {
      return res.status(403).json({
        success: false,
        message: `You have exceeded the maximum number of attempts (${assessment.max_attempts}) for this assessment`
      });
    }

    // Get all questions from assessment sections
    let allQuestions = [];

    if (assessment.sections) {
      try {
        let sections;
        if (typeof assessment.sections === 'string') {
          sections = JSON.parse(assessment.sections);
        } else if (typeof assessment.sections === 'object') {
          sections = assessment.sections;
        } else {
          sections = [];
        }

        if (Array.isArray(sections)) {
          sections.forEach((section, sectionIndex) => {
            if (section.questions && Array.isArray(section.questions)) {
              section.questions.forEach((question, questionIndex) => {
                // Add section information to each question
                const questionWithSection = {
                  ...question,
                  section_id: section.id,
                  section_name: section.name,
                  section_order: sectionIndex + 1,
                  question_order: questionIndex + 1,
                  // Ensure question_text field exists
                  question_text: question.content || question.question_text || question.title || 'Question'
                };

                allQuestions.push(questionWithSection);
              });
            }
          });
        }
      } catch (error) {
        // console.error('Error parsing assessment sections:', error);
        return res.status(500).json({
          success: false,
          message: 'Error processing assessment questions'
        });
      }
    }

    if (allQuestions.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No questions found for this assessment'
      });
    }

    const questions = allQuestions;

    // Calculate score
    let totalPoints = 0;
    let earnedPoints = 0;
    let correctAnswers = 0;
    const codingResults = [];

    for (const question of questions) {
      // Ensure points is a number and handle string concatenation issues
      let questionPoints = 1;
      if (question.points) {
        if (typeof question.points === 'string') {
          // Handle concatenated values like "1.001.00" by taking the first valid number
          const match = question.points.match(/(\d+\.?\d*)/);
          questionPoints = match ? parseFloat(match[1]) : 1;
        } else {
          questionPoints = Number(question.points) || 1;
        }
      }
      totalPoints += questionPoints;
      const userAnswer = answers[question.id]; // Use question.id instead of question.question_id

      // Check if answer is correct
      let isCorrect = false;

      if (question.question_type === 'coding') {
        // For coding questions, use stored test case results instead of re-running
        if (userAnswer && userAnswer.testResults) {
          // Use the stored test results from student's previous runs
          const testResults = userAnswer.testResults;
          const passedTests = testResults.filter(result =>
            result.result?.verdict?.status === 'accepted'
          ).length;
          const totalTests = testResults.length;

          isCorrect = passedTests === totalTests && totalTests > 0;

          // Store coding evaluation results for later insertion
          codingResults.push({
            questionId: question.id,
            evaluation: {
              isCorrect: isCorrect,
              passedTests: passedTests,
              totalTests: totalTests,
              score: totalTests > 0 ? Math.round((passedTests / totalTests) * 100) : 0,
              testResults: testResults
            },
            userAnswer: userAnswer
          });


        } else {
          // No test results available, mark as incorrect
          isCorrect = false;
          codingResults.push({
            questionId: question.id,
            evaluation: {
              isCorrect: false,
              passedTests: 0,
              totalTests: 0,
              score: 0,
              testResults: []
            },
            userAnswer: userAnswer
          });
        }
      } else {
        // For other question types, use string comparison
        let normalizedCorrectAnswer = null;

        // Case 1: correct_answer is an array of actual answers
        if (question.correct_answer && Array.isArray(question.correct_answer)) {
          normalizedCorrectAnswer = question.correct_answer.join(', ');
        }
        // Case 2: correct_answer is a single string
        else if (question.correct_answer && typeof question.correct_answer === 'string') {
          normalizedCorrectAnswer = question.correct_answer;
        }
        // Case 3: correct_answers is an array of indices
        else if (question.correct_answers && Array.isArray(question.correct_answers) && question.options && Array.isArray(question.options)) {
          const correctOptions = question.correct_answers.map(index => question.options[index]).filter(Boolean);
          normalizedCorrectAnswer = correctOptions.join(', ');
        }
        // Case 4: correct_answer_index is a single index
        else if (question.correct_answer_index !== undefined && question.options && Array.isArray(question.options)) {
          normalizedCorrectAnswer = question.options[question.correct_answer_index];
        }

        // Normalize user answer - handle array format
        let normalizedUserAnswer = userAnswer;
        if (Array.isArray(normalizedUserAnswer)) {
          normalizedUserAnswer = normalizedUserAnswer.join(', ');
        }

        isCorrect = normalizedUserAnswer && normalizedCorrectAnswer && normalizedUserAnswer === normalizedCorrectAnswer;
      }

      if (question.question_type === 'coding') {
        // For coding questions, calculate points based on stored test case results
        const evaluation = codingResults.find(cr => cr.questionId === question.id)?.evaluation;
        if (evaluation) {
          const testCasePoints = (evaluation.passedTests / evaluation.totalTests) * questionPoints;
          earnedPoints += testCasePoints;
          if (evaluation.isCorrect) {
            correctAnswers++;
          }
        } else if (isCorrect) {
          earnedPoints += questionPoints;
          correctAnswers++;
        }
      } else if (isCorrect) {
        earnedPoints += questionPoints;
        correctAnswers++;
      }
    }

    // Ensure points are valid numbers
    const validTotalPoints = Math.max(0, Number(totalPoints) || 0);
    const validEarnedPoints = Math.max(0, Number(earnedPoints) || 0);

    const score = validTotalPoints > 0 ? Math.round((validEarnedPoints / validTotalPoints) * 100) : 0;
    // Use existing submission ID from in-progress attempt
    const submissionId = inProgressSubmission.id;

    // Ensure score is a valid number
    const finalScore = isNaN(score) ? 0 : Math.max(0, Math.min(100, score));

    // Import studentAssessmentService to save answers to student_responses
    const studentAssessmentService = (await import('../services/studentAssessmentService.js')).default;

    // Save all answers to student_responses table (consolidated storage - no JSON field)
    if (answers && typeof answers === 'object') {
      for (const [questionId, answer] of Object.entries(answers)) {
        if (answer !== undefined && answer !== null) {
          try {
            await studentAssessmentService.saveAnswer(submissionId, questionId, answer, 0, student_id);
          } catch (error) {
            console.error(`Error saving answer for question ${questionId} during submission:`, error);
            // Continue with other answers even if one fails
          }
        }
      }
    }

    // Update existing submission (removed answers JSON field - now using student_responses table)
    const submissionQuery = `
      UPDATE assessment_submissions 
      SET 
          percentage_score = ?, 
          time_taken_minutes = ?, 
          status = 'submitted', 
          submitted_at = NOW(),
          auto_submitted = ?
      WHERE id = ?
    `;

    await pool.query(submissionQuery, [
      finalScore,
      Math.round(sanitizedTimeTaken / 60), // Convert seconds to minutes
      auto_submitted ? 1 : 0, // Store auto-submission flag
      submissionId
    ]);

    // Insert coding submission results
    for (const codingResult of codingResults) {
      const codingResultId = uuidv4();
      const codingResultQuery = `
        INSERT INTO coding_submission_results (
          id, submission_id, question_id, code, language, status,
          test_cases_passed, total_test_cases, score, feedback
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      const status = codingResult.evaluation.isCorrect ? 'accepted' : 'wrong_answer';

      // Determine language from user answer
      let language = 'javascript'; // default
      if (codingResult.userAnswer && typeof codingResult.userAnswer === 'object' && codingResult.userAnswer.language) {
        language = codingResult.userAnswer.language;
      } else if (typeof codingResult.userAnswer === 'string') {
        // Try to detect language from code content
        if (codingResult.userAnswer.includes('python') || codingResult.userAnswer.includes('print(')) {
          language = 'python';
        } else if (codingResult.userAnswer.includes('java') || codingResult.userAnswer.includes('public class')) {
          language = 'java';
        } else if (codingResult.userAnswer.includes('cpp') || codingResult.userAnswer.includes('#include')) {
          language = 'cpp';
        }
      }

      const sourceCode = typeof codingResult.userAnswer === 'string' ?
        codingResult.userAnswer :
        (codingResult.userAnswer && codingResult.userAnswer.code ? codingResult.userAnswer.code : '');

      await pool.query(codingResultQuery, [
        codingResultId,
        submissionId,
        codingResult.questionId,
        sourceCode,
        language,
        status,
        codingResult.evaluation.passedTests,
        codingResult.evaluation.totalTests,
        codingResult.evaluation.score,
        JSON.stringify(codingResult.evaluation.testResults)
      ]);
    }

    res.json({
      success: true,
      message: auto_submitted ? 'Assessment auto-submitted due to time expiration' : 'Assessment submitted successfully',
      data: {
        score: finalScore,
        correctAnswers,
        totalQuestions: questions.length,
        timeTaken: sanitizedTimeTaken,
        autoSubmitted: auto_submitted
      }
    });
  } catch (error) {
    // console.error('Error submitting assessment:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to submit assessment'
    });
  }
};

// Auto-expire assessments that are in progress but time has expired
const autoExpireAssessments = async () => {
  try {
    const now = new Date();

    // Find assessments that are in progress but time has expired
    const expireQuery = `
      UPDATE assessment_submissions sub
      JOIN assessment_assignments aa ON sub.assessment_id = aa.assessment_id
      SET sub.status = 'expired', sub.submitted_at = NOW()
      WHERE sub.status = 'in_progress'
      AND aa.end_date_only IS NOT NULL 
      AND aa.end_time_only IS NOT NULL
      AND CONCAT(aa.end_date_only, 'T', aa.end_time_only) < NOW()
    `;

    const [result] = await pool.query(expireQuery);

    if (result.affectedRows > 0) {
      // console.log(`Auto-expired ${result.affectedRows} assessments`);
    }
  } catch (error) {
    // console.error('Error auto-expiring assessments:', error);
  }
};

// Check if a specific assessment has expired for a student
// Uses database locks to prevent race conditions
const checkAssessmentExpiration = async (assessmentId, studentId) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // Use SELECT FOR UPDATE to lock the row and prevent concurrent expiration
    const checkQuery = `
      SELECT 
        aa.end_date_only,
        aa.end_time_only,
        sub.status,
        sub.started_at,
        sub.id as submission_id,
        sub.answers
      FROM assessment_assignments aa
      LEFT JOIN assessment_submissions sub ON aa.assessment_id = sub.assessment_id AND sub.student_id = ?
      WHERE aa.assessment_id = ?
      FOR UPDATE
    `;

    const [result] = await connection.query(checkQuery, [studentId, assessmentId]);

    if (result.length > 0) {
      const { end_date_only, end_time_only, status, started_at, submission_id, answers } = result[0];

      if (end_date_only && end_time_only && status === 'in_progress' && submission_id) {
        const endDateTimeString = `${end_date_only}T${end_time_only}`;
        const endDateTime = new Date(endDateTimeString);
        const now = new Date();

        if (now > endDateTime) {
          // Calculate time taken using server timestamp (NOW()) instead of client time
          const [timeCalculation] = await connection.query(`
              SELECT EXTRACT(EPOCH FROM (NOW() - started_at)) / 60 as time_taken_minutes
              FROM assessment_submissions
              WHERE id = ? AND status = 'in_progress'
          `, [submission_id]);

          const timeTaken = timeCalculation.length > 0 && timeCalculation[0].time_taken_minutes
            ? Math.max(0, timeCalculation[0].time_taken_minutes)
            : 0;

          // Use studentAssessmentService to calculate proper score
          try {
            const studentAssessmentService = (await import('../services/studentAssessmentService.js')).default;

            // Get answers from student_responses table (not JSON field)
            const [responses] = await connection.query(
              'SELECT question_id, student_answer FROM student_responses WHERE submission_id = ?',
              [submission_id]
            );

            if (responses.length > 0) {
              // Calculate score using studentAssessmentService
              try {
                const scoreData = await studentAssessmentService.calculateFinalScore(submission_id);

                // Update with expired status and calculated score
                await connection.query(`
              UPDATE assessment_submissions 
                  SET status = 'submitted', 
                  submitted_at = NOW(),
                  time_taken_minutes = ?,
                      percentage_score = ?,
                      total_score = ?
                  WHERE id = ? AND status = 'in_progress'
                `, [timeTaken, scoreData.percentage, scoreData.totalScore, submission_id]);
              } catch (scoreError) {
                // If score calculation fails, just expire without score
                await connection.query(`
                  UPDATE assessment_submissions 
                  SET status = 'submitted', 
                      submitted_at = NOW(),
                      time_taken_minutes = ?,
                      percentage_score = 0
                  WHERE id = ? AND status = 'in_progress'
                `, [timeTaken, submission_id]);
              }
            } else {
              // No answers, just expire
              await connection.query(`
              UPDATE assessment_submissions 
                SET status = 'submitted', submitted_at = NOW(), time_taken_minutes = ?
                WHERE id = ? AND status = 'in_progress'
              `, [timeTaken, submission_id]);
            }
          } catch (error) {
            // Fallback: just expire without score calculation
            await connection.query(`
              UPDATE assessment_submissions 
              SET status = 'submitted', submitted_at = NOW(), time_taken_minutes = ?
              WHERE id = ? AND status = 'in_progress'
            `, [timeTaken, submission_id]);
          }

          await connection.commit();
          return true; // Assessment was expired
        }
      }
    }

    await connection.commit();
    return false; // Assessment was not expired
  } catch (error) {
    await connection.rollback();
    console.error('Error checking assessment expiration:', error);
    return false;
  } finally {
    connection.release();
  }
};

// Start a new assessment attempt
export const startAssessmentAttempt = async (req, res) => {
  try {
    const { assessment_id } = req.params;
    const { id: student_id } = req.user;

    // Check if student has access to this assessment
    const accessQuery = `
      SELECT aa.*, a.* 
      FROM assessment_assignments aa
      JOIN assessments a ON aa.assessment_id = a.id
      WHERE aa.assessment_id = ? 
      AND (aa.target_id = ? OR aa.target_id IN (
        SELECT college_id FROM users WHERE id = ?
      ))
      AND a.status = 'published'
    `;

    const [accessResult] = await pool.query(accessQuery, [assessment_id, student_id, student_id]);

    if (accessResult.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Assessment not found or access denied'
      });
    }

    const assessment = accessResult[0];
    const now = new Date();

    // Check if assessment has started
    if (assessment.start_date_only && assessment.start_time_only) {
      const startDateTimeString = `${assessment.start_date_only}T${assessment.start_time_only}`;
      const startDateTime = new Date(startDateTimeString);

      if (now < startDateTime) {
        return res.status(403).json({
          success: false,
          message: 'Assessment has not started yet.'
        });
      }
    }

    // Check if assessment has ended
    if (assessment.end_date_only && assessment.end_time_only) {
      const endDateTimeString = `${assessment.end_date_only}T${assessment.end_time_only}`;
      const endDateTime = new Date(endDateTimeString);

      if (now > endDateTime) {
        return res.status(403).json({
          success: false,
          message: 'Assessment time has expired.'
        });
      }
    }

    // Check if student has exceeded max attempts (only count completed attempts)
    const completedAttemptsQuery = `
      SELECT COUNT(*) as completed_attempts
      FROM assessment_submissions 
      WHERE assessment_id = ? AND student_id = ? AND (status = 'submitted' OR status = 'graded')
    `;

    const [completedAttemptsResult] = await pool.query(completedAttemptsQuery, [assessment_id, student_id]);
    const completedAttempts = completedAttemptsResult[0].completed_attempts;

    if (assessment.max_attempts && completedAttempts >= assessment.max_attempts) {
      return res.status(403).json({
        success: false,
        message: `You have exceeded the maximum number of attempts (${assessment.max_attempts}) for this assessment`
      });
    }

    // CRITICAL FIX: Use row-level locking instead of table locks to prevent deadlocks
    // Get database connection for transaction
    const connection = await pool.getConnection();

    try {
      // CRITICAL FIX: Set transaction isolation level for consistent reads
      await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      await connection.beginTransaction();

      // Check if there's already an in-progress attempt with row-level locking
      const inProgressQuery = `
        SELECT id, status, started_at, attempt_number
      FROM assessment_submissions 
      WHERE assessment_id = ? AND student_id = ? AND status = 'in_progress'
        FOR UPDATE
    `;

      const [inProgressResult] = await connection.query(inProgressQuery, [assessment_id, student_id]);

      let submissionId;
      let nextAttemptNumber;

      if (inProgressResult.length > 0) {
        // Resume existing attempt - but first check if it expired
        submissionId = inProgressResult[0].id;
        nextAttemptNumber = inProgressResult[0].attempt_number || 1;

        // Check if assessment has expired before allowing resume
        const [expiryCheck] = await connection.query(`
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

        if (expiryCheck.length > 0) {
          const expiryInfo = expiryCheck[0];
          const serverNow = new Date();

          // Check if end date/time has passed
          if (expiryInfo.end_date_only && expiryInfo.end_time_only) {
            const endDateTime = new Date(`${expiryInfo.end_date_only}T${expiryInfo.end_time_only}`);
            if (serverNow > endDateTime) {
              // Auto-expire this attempt
              await checkAssessmentExpiration(assessment_id, student_id);
              throw new Error('Assessment has expired. Your attempt has been automatically submitted.');
            }
          }

          // Check if time limit exceeded
          if (expiryInfo.started_at && expiryInfo.time_limit_minutes) {
            const [elapsedTime] = await connection.query(`
              SELECT EXTRACT(EPOCH FROM (NOW() - ?)) / 60 as elapsed_minutes
            `, [expiryInfo.started_at]);

            if (elapsedTime.length > 0 && elapsedTime[0].elapsed_minutes > expiryInfo.time_limit_minutes) {
              // Auto-expire this attempt
              await checkAssessmentExpiration(assessment_id, student_id);
              throw new Error('Assessment time limit has been exceeded. Your attempt has been automatically submitted.');
            }
          }
        }

        // CRITICAL SECURITY: Never reset started_at - it's used for time tracking
        // The started_at timestamp must remain unchanged to accurately track time spent
        // If student returns after break, they continue from where they left off
      } else {
        // Calculate next attempt number atomically
        const attemptQuery = `
          SELECT COALESCE(MAX(attempt_number), 0) as max_attempt_number
          FROM assessment_submissions 
          WHERE assessment_id = ? AND student_id = ?
          FOR UPDATE
        `;

        const [attemptResult] = await connection.query(attemptQuery, [assessment_id, student_id]);
        nextAttemptNumber = (attemptResult[0].max_attempt_number || 0) + 1;

        // Create new attempt
        submissionId = uuidv4();
        await connection.query(`
        INSERT INTO assessment_submissions (
          id, assessment_id, student_id, status, started_at, attempt_number
        ) VALUES (?, ?, ?, 'in_progress', NOW(), ?)
      `, [submissionId, assessment_id, student_id, nextAttemptNumber]);
      }

      // CRITICAL FIX: Commit transaction instead of unlocking tables
      await connection.commit();

      // CRITICAL FIX: Release connection before returning
      connection.release();

      return res.json({
        success: true,
        data: {
          submission_id: submissionId,
          assessment_id,
          attempt_number: nextAttemptNumber,
          started_at: new Date().toISOString(),
          message: inProgressResult.length > 0 ? 'Resumed existing attempt' : 'Started new attempt'
        }
      });
    } catch (error) {
      // CRITICAL FIX: Rollback transaction and release connection on error
      if (connection) {
        await connection.rollback();
        connection.release();
      }
      throw error;
    }
  } catch (error) {
    console.error('Error starting assessment attempt:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to start assessment attempt',
      error: error.message
    });
  }
};

// Get student's attempt information for an assessment
export const getStudentAttemptInfo = async (req, res) => {
  try {
    const { assessment_id } = req.params;
    const { id: student_id } = req.user;

    // Check if student has access to this assessment
    const accessQuery = `
      SELECT aa.*, a.* 
      FROM assessment_assignments aa
      JOIN assessments a ON aa.assessment_id = a.id
      WHERE aa.assessment_id = ? 
      AND (aa.target_id = ? OR aa.target_id IN (
        SELECT college_id FROM users WHERE id = ?
      ))
      AND a.status = 'published'
    `;

    const [accessResult] = await pool.query(accessQuery, [assessment_id, student_id, student_id]);

    if (accessResult.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Assessment not found or access denied'
      });
    }

    const assessment = accessResult[0];

    // Get attempt information
    const attemptQuery = `
      SELECT 
        COUNT(*) as total_attempts,
        MAX(attempt_number) as last_attempt_number,
        MAX(submitted_at) as last_attempt_date,
        MAX(CASE WHEN status = 'submitted' OR status = 'graded' THEN attempt_number END) as completed_attempts
      FROM assessment_submissions 
      WHERE assessment_id = ? AND student_id = ?
    `;

    const [attemptResult] = await pool.query(attemptQuery, [assessment_id, student_id]);
    const attemptInfo = attemptResult[0];

    // Check if student can attempt again
    // For resume functionality, only count completed attempts, not in-progress ones
    const completedAttempts = attemptInfo.completed_attempts || 0;
    const canAttempt = !assessment.max_attempts || completedAttempts < assessment.max_attempts;

    // Check time between attempts
    let timeUntilNextAttempt = 0;
    let canAttemptNow = true;

    if (assessment.time_between_attempts_hours && assessment.time_between_attempts_hours > 0 && attemptInfo.last_attempt_date) {
      const lastAttemptTime = new Date(attemptInfo.last_attempt_date);
      const currentTime = new Date();
      const hoursSinceLastAttempt = (currentTime - lastAttemptTime) / (1000 * 60 * 60);

      if (hoursSinceLastAttempt < assessment.time_between_attempts_hours) {
        timeUntilNextAttempt = Math.ceil(assessment.time_between_attempts_hours - hoursSinceLastAttempt);
        canAttemptNow = false;
      }
    }

    res.json({
      success: true,
      data: {
        assessment_id,
        max_attempts: assessment.max_attempts,
        time_between_attempts_hours: assessment.time_between_attempts_hours,
        current_attempts: completedAttempts,
        total_attempts: attemptInfo.total_attempts,
        completed_attempts: completedAttempts,
        last_attempt_number: attemptInfo.last_attempt_number || 0,
        next_attempt_number: (attemptInfo.last_attempt_number || 0) + 1,
        can_attempt: canAttempt && canAttemptNow,
        time_until_next_attempt: timeUntilNextAttempt,
        last_attempt_date: attemptInfo.last_attempt_date
      }
    });
  } catch (error) {
    // console.error('Error getting student attempt info:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get attempt information'
    });
  }
};

// Get assessment attempts history for a student
export const getAssessmentAttemptsHistory = async (req, res) => {
  try {
    const { assessment_id } = req.params;
    const { id: student_id } = req.user;

    // Check if student has access to this assessment
    const accessQuery = `
      SELECT aa.*, a.* 
      FROM assessment_assignments aa
      JOIN assessments a ON aa.assessment_id = a.id
      WHERE aa.assessment_id = ? 
      AND (aa.target_id = ? OR aa.target_id IN (
        SELECT college_id FROM users WHERE id = ?
      ))
      AND a.status = 'published'
    `;

    const [accessResult] = await pool.query(accessQuery, [assessment_id, student_id, student_id]);

    if (accessResult.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Assessment not found or access denied'
      });
    }

    const assessment = accessResult[0];

    // Get all attempts for this assessment and student
    const attemptsQuery = `
      SELECT 
        sub.id,
        sub.attempt_number,
        sub.percentage_score,
        sub.time_taken_minutes,
        sub.status,
        sub.submitted_at,
        sub.started_at,
        COUNT(csr.id) as coding_questions_count
      FROM assessment_submissions sub
      LEFT JOIN coding_submission_results csr ON sub.id = csr.submission_id
      WHERE sub.assessment_id = ? AND sub.student_id = ?
      GROUP BY sub.id, sub.attempt_number, sub.percentage_score, sub.time_taken_minutes, sub.status, sub.submitted_at, sub.started_at
      ORDER BY sub.attempt_number DESC
    `;

    const [attemptsResult] = await pool.query(attemptsQuery, [assessment_id, student_id]);

    // Get attempt info for next attempt
    const attemptInfoQuery = `
      SELECT COUNT(*) as total_attempts, MAX(attempt_number) as max_attempt_number
      FROM assessment_submissions 
      WHERE assessment_id = ? AND student_id = ?
    `;

    const [attemptInfoResult] = await pool.query(attemptInfoQuery, [assessment_id, student_id]);
    const attemptInfo = attemptInfoResult[0];

    const canAttempt = !assessment.max_attempts || attemptInfo.total_attempts < assessment.max_attempts;
    const nextAttemptNumber = (attemptInfo.max_attempt_number || 0) + 1;

    res.json({
      success: true,
      data: {
        assessment: {
          id: assessment.id,
          title: assessment.title,
          max_attempts: assessment.max_attempts,
          time_between_attempts_hours: assessment.time_between_attempts_hours
        },
        attempts: attemptsResult,
        can_retake: canAttempt,
        next_attempt_number: nextAttemptNumber,
        total_attempts: attemptInfo.total_attempts
      }
    });
  } catch (error) {
    // console.error('Error getting assessment attempts history:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get attempts history'
    });
  }
};

// Get assessment results
export const getAssessmentResults = async (req, res) => {
  try {
    const { assessment_id, student_id } = req.params;
    const { id: current_user_id } = req.user;

    // Verify the student is accessing their own results
    if (current_user_id !== student_id) {
      return res.status(403).json({
        success: false,
        message: 'You can only access your own results'
      });
    }

    // Get submission and assessment details
    const query = `
      SELECT 
        sub.*,
        a.title,
        a.description,
        a.time_limit_minutes as duration_minutes,
        a.passing_score
      FROM assessment_submissions sub
      JOIN assessments a ON sub.assessment_id = a.id
      WHERE sub.assessment_id = ? AND sub.student_id = ?
      ORDER BY sub.submitted_at DESC
      LIMIT 1
    `;

    const [result] = await pool.query(query, [assessment_id, student_id]);

    if (result.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Results not found'
      });
    }

    const submission = result[0];

    // Parse JSON fields safely
    submission.answers = safeJsonParse(submission.answers, {});

    // Get assessment template to extract questions from sections
    const [assessmentTemplate] = await pool.query(
      'SELECT * FROM assessments WHERE id = ?',
      [assessment_id]
    );

    if (assessmentTemplate.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Assessment template not found'
      });
    }

    const assessment = assessmentTemplate[0];

    // Extract questions from sections JSON with correct answers
    let allQuestions = [];

    if (assessment.sections) {
      try {
        let sections;
        if (typeof assessment.sections === 'string') {
          sections = JSON.parse(assessment.sections);
        } else if (typeof assessment.sections === 'object') {
          sections = assessment.sections;
        } else {
          sections = [];
        }

        if (Array.isArray(sections)) {
          sections.forEach((section, sectionIndex) => {
            if (section.questions && Array.isArray(section.questions)) {
              section.questions.forEach((question, questionIndex) => {
                // Normalize correct answer - try different possible formats
                let normalizedCorrectAnswer = null;

                // Case 1: correct_answer is an array of actual answers
                if (question.correct_answer && Array.isArray(question.correct_answer)) {
                  normalizedCorrectAnswer = question.correct_answer.join(', ');
                }
                // Case 2: correct_answer is a single string
                else if (question.correct_answer && typeof question.correct_answer === 'string') {
                  normalizedCorrectAnswer = question.correct_answer;
                }
                // Case 3: correct_answers is an array of indices
                else if (question.correct_answers && Array.isArray(question.correct_answers) && question.options && Array.isArray(question.options)) {
                  const correctOptions = question.correct_answers.map(index => question.options[index]).filter(Boolean);
                  normalizedCorrectAnswer = correctOptions.join(', ');
                }
                // Case 4: correct_answer_index is a single index
                else if (question.correct_answer_index !== undefined && question.options && Array.isArray(question.options)) {
                  normalizedCorrectAnswer = question.options[question.correct_answer_index];
                }

                // Normalize user answer - handle array format
                let normalizedUserAnswer = submission.answers[question.id] || null;
                if (Array.isArray(normalizedUserAnswer)) {
                  normalizedUserAnswer = normalizedUserAnswer.join(', ');
                }

                // Add section information to each question
                const questionWithSection = {
                  ...question,
                  section_id: section.id,
                  section_name: section.name,
                  section_order: sectionIndex + 1,
                  question_order: questionIndex + 1,
                  // Ensure question_text field exists
                  question_text: question.content || question.question_text || question.title || 'Question',
                  // Ensure points is a number
                  points: Number(question.points) || 1,
                  // Normalize correct answer
                  correct_answer: normalizedCorrectAnswer,
                  // Add user's answer and correctness
                  user_answer: normalizedUserAnswer,
                  is_correct: null // Will be determined below for coding questions
                };



                allQuestions.push(questionWithSection);
              });
            }
          });
        }
      } catch (error) {
        // console.error('Error parsing assessment sections:', error);
        return res.status(500).json({
          success: false,
          message: 'Error processing assessment questions'
        });
      }
    }

    // Calculate score from questions and answers
    let totalPoints = 0;
    let earnedPoints = 0;
    let correctAnswers = 0;

    // Get coding submission results for this submission
    const [codingResults] = await pool.query(
      'SELECT * FROM coding_submission_results WHERE submission_id = ?',
      [submission.id]
    );

    // Create a map of question_id to coding results
    const codingResultsMap = {};
    codingResults.forEach(result => {
      codingResultsMap[result.question_id] = result;
    });

    // First, evaluate coding questions that don't have is_correct set
    for (const question of allQuestions) {
      if (question.question_type === 'coding') {
        // Check if we have stored results for this question
        const storedResult = codingResultsMap[question.id];
        if (storedResult) {
          // Use stored results
          question.is_correct = storedResult.status === 'accepted';
          question.coding_result = {
            testCasesPassed: storedResult.test_cases_passed,
            totalTestCases: storedResult.total_test_cases,
            score: storedResult.score,
            testResults: safeJsonParse(storedResult.feedback, []),
            language: storedResult.language || 'Not specified',
            code: storedResult.code
          };

          // Ensure testResults has the correct structure for frontend
          if (question.coding_result.testResults && Array.isArray(question.coding_result.testResults)) {
            question.coding_result.testResults = question.coding_result.testResults.map(testResult => ({
              ...testResult,
              input: testResult.testCase?.input || testResult.input || '',
              expectedOutput: testResult.testCase?.expected_output || testResult.expectedOutput || '',
              result: {
                ...testResult.result,
                output: testResult.result?.output || '',
                error: testResult.result?.error || ''
              }
            }));
          }


        } else {
          // No stored results found - this shouldn't happen for submitted assessments
          // console.warn('No stored coding results found for question:', question.id);
          question.is_correct = false;
          question.coding_result = {
            testCasesPassed: 0,
            totalTestCases: 0,
            score: 0,
            testResults: [],
            language: 'Not specified',
            code: question.user_answer || 'No code provided'
          };
        }
      } else {
        // For non-coding questions, determine correctness based on answer comparison
        question.is_correct = question.user_answer && question.correct_answer &&
          question.user_answer === question.correct_answer;
      }
    }

    for (const question of allQuestions) {
      // Ensure points is a number and handle string concatenation issues
      let questionPoints = 1;
      if (question.points) {
        if (typeof question.points === 'string') {
          // Handle concatenated values like "1.001.00" by taking the first valid number
          const match = question.points.match(/(\d+\.?\d*)/);
          questionPoints = match ? parseFloat(match[1]) : 1;
        } else {
          questionPoints = Number(question.points) || 1;
        }
      }

      totalPoints += questionPoints;
      if (question.is_correct) {
        earnedPoints += questionPoints;
        correctAnswers++;
      }
    }

    const calculatedScore = totalPoints > 0 ? Math.round((earnedPoints / totalPoints) * 100) : 0;
    const calculatedPoints = earnedPoints;

    res.json({
      success: true,
      data: {
        ...submission,
        score: Number(calculatedPoints),
        total_points: Number(totalPoints),
        percentage_score: Number(calculatedScore),
        correct_answers: Number(correctAnswers),
        total_questions: Number(allQuestions.length),
        questions: allQuestions
      }
    });
  } catch (error) {
    // console.error('Error getting assessment results:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get assessment results'
    });
  }
};

// =====================================================
// ASSESSMENT INSTANCES FUNCTIONS
// =====================================================

// Get assessment instances for student
export const getAssessmentInstances = async (req, res) => {
  try {
    // Auto-expire assessments before getting instances
    await autoExpireAssessments();

    const { student_id } = req.query;
    const { id: current_user_id } = req.user;

    // Verify the student is accessing their own instances
    if (current_user_id !== student_id) {
      return res.status(403).json({
        success: false,
        message: 'You can only access your own assessment instances'
      });
    }

    // Get assessment instances assigned to the student with new structure
    // Return all submissions to preserve attempt history
    const query = `
      SELECT 
        a.id,
        a.title,
        a.description,
        a.time_limit_minutes,
        a.total_points,
        a.passing_score,
        a.status,
        a.created_at,
        a.proctoring_settings,
        a.require_proctoring,
        TO_CHAR(aa.start_date_only, 'YYYY-MM-DD') as start_date_only,
        TO_CHAR(aa.start_time_only, 'HH24:MI:SS') as start_time_only,
        TO_CHAR(aa.end_date_only, 'YYYY-MM-DD') as end_date_only,
        TO_CHAR(aa.end_time_only, 'HH24:MI:SS') as end_time_only,
        aa.assessment_timezone,
        aa.assignment_type,
        aa.target_id,
        sub.status as submission_status,
        sub.score,
        sub.max_score,
        sub.percentage_score,
        sub.time_taken_minutes,
        sub.started_at,
        sub.submitted_at,
        sub.attempt_number
      FROM assessments a
      INNER JOIN assessment_assignments aa ON a.id = aa.assessment_id
      LEFT JOIN assessment_submissions sub ON a.id = sub.assessment_id AND sub.student_id = ?
      WHERE (aa.target_id = ? OR aa.target_id IN (
        SELECT college_id FROM users WHERE id = ?
      ))
      AND a.status = 'published'
      ORDER BY a.created_at DESC
    `;

    const [result] = await pool.query(query, [student_id, student_id, student_id]);



    // Process the results to determine status with proper timezone handling
    const instances = result.map(instance => {
      // Format dates to ensure they're in YYYY-MM-DD format
      // IMPORTANT: Don't convert dates to different timezones - use them as stored
      const formatDateField = (dateField) => {
        if (!dateField) return null;

        // If it's already a string in YYYY-MM-DD format, return as is
        if (typeof dateField === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateField)) {
          return dateField;
        }

        // If it's a Date object, extract just the date part without timezone conversion
        if (dateField instanceof Date) {
          // Use local date methods to avoid timezone conversion
          const year = dateField.getFullYear();
          const month = String(dateField.getMonth() + 1).padStart(2, '0');
          const day = String(dateField.getDate()).padStart(2, '0');
          return `${year}-${month}-${day}`;
        }

        if (typeof dateField === 'string') {
          // If it's a full datetime string, extract just the date part
          if (dateField.includes('T')) {
            return dateField.split('T')[0];
          }
          // If it's already just a date, return as is
          return dateField;
        }

        return null;
      };

      const formattedStartDate = formatDateField(instance.start_date_only);
      const formattedEndDate = formatDateField(instance.end_date_only);



      let status = 'assigned';
      const now = new Date();

      // Create proper datetime objects for comparison
      let startDateTime = null;
      let endDateTime = null;

      if (formattedStartDate && instance.start_time_only) {
        try {
          // Create datetime string in the assessment timezone
          // IMPORTANT: Use the date as stored, don't convert timezones
          const startDateTimeString = `${formattedStartDate}T${instance.start_time_only}`;
          startDateTime = new Date(startDateTimeString);

          // Validate the date
          if (isNaN(startDateTime.getTime())) {
            // console.warn(`Invalid start date for assessment ${instance.id}: ${startDateTimeString}`);
            startDateTime = null;
          }
        } catch (error) {
          // console.warn(`Error parsing start date for assessment ${instance.id}:`, error);
          startDateTime = null;
        }
      }

      if (formattedEndDate && instance.end_time_only) {
        try {
          // Create datetime string in the assessment timezone
          // IMPORTANT: Use the date as stored, don't convert timezones
          const endDateTimeString = `${formattedEndDate}T${instance.end_time_only}`;
          endDateTime = new Date(endDateTimeString);

          // Validate the date
          if (isNaN(endDateTime.getTime())) {
            // console.warn(`Invalid end date for assessment ${instance.id}: ${endDateTimeString}`);
            endDateTime = null;
          }
        } catch (error) {
          // console.warn(`Error parsing end date for assessment ${instance.id}:`, error);
          endDateTime = null;
        }
      }

      // Debug logging to check the datetime values
      // Removed // console.log to clean up terminal output

      // Determine status based on submission and timing
      if (instance.submission_status === 'in_progress') {
        status = 'in_progress';
      } else if (instance.submission_status === 'submitted' || instance.submission_status === 'graded') {
        // Check if this is a retake scenario
        if (endDateTime && now > endDateTime) {
          status = 'expired'; // Assessment has ended, can't retake
        } else if (startDateTime && now < startDateTime) {
          status = 'scheduled'; // Assessment hasn't started yet
        } else {
          // Check if retake is allowed based on attempt limits
          const maxAttempts = instance.max_attempts || 1;
          const currentAttempts = instance.attempt_number || 0;

          if (currentAttempts >= maxAttempts) {
            status = 'completed'; // Max attempts reached, no more retakes
          } else {
            status = 'available'; // Available for retake
          }
        }
      } else if (endDateTime && now > endDateTime) {
        status = 'expired'; // Assessment has ended and not completed
      } else if (startDateTime && now < startDateTime) {
        status = 'scheduled'; // Assessment hasn't started yet
      } else if (startDateTime && endDateTime && now >= startDateTime && now <= endDateTime) {
        status = 'available'; // Assessment is currently available
      } else if (endDateTime && now <= endDateTime) {
        // If only end time is set and we're within it, mark as available
        status = 'available';
      } else {
        // Default fallback - if no timing constraints, mark as available
        status = 'available';
      }

      return {
        ...instance,
        start_date_only: formattedStartDate,
        end_date_only: formattedEndDate,
        status,
        // Indicate if this is a retake scenario
        // This will be true for any assessment that has been completed before
        is_retake: instance.submission_status === 'submitted' || instance.submission_status === 'graded',
        // Ensure timezone is always present
        assessment_timezone: instance.assessment_timezone || 'UTC',
        // Parse proctoring settings JSON
        proctoring_settings: safeJsonParse(instance.proctoring_settings, null)
      };
    });

    res.json({
      success: true,
      data: instances
    });
  } catch (error) {
    // console.error('Error getting assessment instances:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get assessment instances'
    });
  }
};

// Debug endpoint to check assessment data directly
// CRITICAL FIX: Only allow in development environment
export const debugAssessmentData = async (req, res) => {
  // CRITICAL FIX: Protect debug endpoints in production
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({
      success: false,
      message: 'Debug endpoints are not available in production'
    });
  }

  try {
    const { assessment_id } = req.params;



    // Get assessment template data
    const [templateResult] = await pool.execute(
      'SELECT * FROM assessments WHERE id = ?',
      [assessment_id]
    );

    // Get assignment data
    const [assignmentResult] = await pool.execute(
      'SELECT * FROM assessment_assignments WHERE assessment_id = ?',
      [assessment_id]
    );



    res.json({
      success: true,
      template: templateResult[0] || null,
      assignments: assignmentResult
    });
  } catch (error) {
    // console.error('Debug assessment data error:', error);
    res.status(500).json({
      success: false,
      message: 'Debug failed'
    });
  }
};

// Retake assessment endpoint
export const retakeAssessment = async (req, res) => {
  try {
    const { assessment_id } = req.params;
    const user_id = req.user.id;

    console.log('Retake request:', { assessment_id, user_id });

    // Get assessment details - try without assignment join first
    const [assessmentResult] = await pool.execute(
      `SELECT a.*, aa.start_date_only, aa.end_date_only, aa.start_time_only, aa.end_time_only, aa.assessment_timezone
       FROM assessments a
       LEFT JOIN assessment_assignments aa ON a.id = aa.assessment_id
       WHERE a.id = ?`,
      [assessment_id]
    );

    if (assessmentResult.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Assessment not found or not assigned to you'
      });
    }

    const assessment = assessmentResult[0];
    const now = new Date();

    // Check if assessment is still available for retake
    if (assessment.end_date_only && assessment.end_time_only) {
      const endDateTimeString = `${assessment.end_date_only}T${assessment.end_time_only}`;
      const endDateTime = new Date(endDateTimeString);

      if (now > endDateTime) {
        return res.status(403).json({
          success: false,
          message: 'Assessment time has expired. Retake is no longer available.'
        });
      }
    }

    // Get the latest submission for this assessment
    const [submissionResult] = await pool.execute(
      `SELECT * FROM assessment_submissions 
       WHERE assessment_id = ? AND student_id = ? 
       ORDER BY attempt_number DESC LIMIT 1`,
      [assessment_id, user_id]
    );

    if (submissionResult.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No previous attempt found for this assessment'
      });
    }

    const lastSubmission = submissionResult[0];

    // Check if retake is allowed
    if (lastSubmission.status !== 'submitted' && lastSubmission.status !== 'graded') {
      return res.status(400).json({
        success: false,
        message: 'Assessment must be completed before retaking'
      });
    }

    // Check attempt limits
    if (assessment.max_attempts && lastSubmission.attempt_number >= assessment.max_attempts) {
      return res.status(403).json({
        success: false,
        message: `You have exceeded the maximum number of attempts (${assessment.max_attempts}) for this assessment`
      });
    }

    // Create a new submission for retake
    const submissionId = uuidv4();
    const newAttemptNumber = lastSubmission.attempt_number + 1;

    try {
      // Try to insert with is_retake column
      await pool.execute(
        `INSERT INTO assessment_submissions (
          id, assessment_id, student_id, status, started_at, attempt_number, is_retake
        ) VALUES (?, ?, ?, 'in_progress', NOW(), ?, 1)`,
        [submissionId, assessment_id, user_id, newAttemptNumber]
      );
    } catch (error) {
      // If is_retake column doesn't exist, insert without it
      if ((error.code === 'ER_BAD_FIELD_ERROR' || error.code === '42703' || error.message?.includes('column') || error.message?.includes('does not exist')) && error.message.includes('is_retake')) {
        console.log('is_retake column not found, inserting without it');
        await pool.execute(
          `INSERT INTO assessment_submissions (
            id, assessment_id, student_id, status, started_at, attempt_number
          ) VALUES (?, ?, ?, 'in_progress', NOW(), ?)`,
          [submissionId, assessment_id, user_id, newAttemptNumber]
        );
      } else {
        throw error;
      }
    }

    res.json({
      success: true,
      message: 'Assessment retake started successfully',
      data: {
        submissionId,
        attemptNumber: newAttemptNumber,
        isRetake: true
      }
    });

  } catch (error) {
    console.error('Error retaking assessment:', error);
    console.error('Error details:', {
      message: error.message,
      code: error.code,
      sqlState: error.sqlState,
      sqlMessage: error.sqlMessage
    });

    res.status(500).json({
      success: false,
      message: 'Failed to retake assessment',
      error: error.message,
      details: process.env.NODE_ENV === 'development' ? {
        code: error.code,
        sqlState: error.sqlState,
        sqlMessage: error.sqlMessage
      } : undefined
    });
  }
};

// Debug endpoint to manually update assignment dates
// CRITICAL FIX: Only allow in development environment
export const debugUpdateAssignmentDates = async (req, res) => {
  // CRITICAL FIX: Protect debug endpoints in production
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({
      success: false,
      message: 'Debug endpoints are not available in production'
    });
  }

  try {
    const { assessment_id } = req.params;
    const { start_date, end_date, timezone = 'Asia/Kolkata' } = req.body;



    // Convert date to proper format - just store as YYYY-MM-DD string
    const convertDateWithTimezone = (dateString, tz) => {
      if (!dateString) return null;
      try {
        // If it's already in YYYY-MM-DD format, return as is
        if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
          return dateString;
        }
        // If it's a full datetime, extract just the date part
        if (dateString.includes('T')) {
          const datePart = dateString.split('T')[0];
          return datePart;
        }
        // Otherwise, try to parse and format
        const date = new Date(dateString);
        const formattedDate = date.toISOString().split('T')[0];
        return formattedDate;
      } catch (error) {
        // console.error('Error converting date:', error);
        return dateString;
      }
    };

    const convertedStartDate = convertDateWithTimezone(start_date, timezone);
    const convertedEndDate = convertDateWithTimezone(end_date, timezone);



    // Update assignment dates directly
    const updateQuery = `
      UPDATE assessment_assignments 
      SET 
        start_date_only = ?,
        end_date_only = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE assessment_id = ?
    `;

    const result = await pool.execute(updateQuery, [convertedStartDate, convertedEndDate, assessment_id]);

    // Verify the update
    const [updatedAssignments] = await pool.execute(
      'SELECT * FROM assessment_assignments WHERE assessment_id = ?',
      [assessment_id]
    );

    // Also check the raw SQL result to see the exact data types
    const [rawResult] = await pool.execute(
      'SELECT start_date_only, end_date_only, DATE(start_date_only) as start_date_raw, DATE(end_date_only) as end_date_raw FROM assessment_assignments WHERE assessment_id = ?',
      [assessment_id]
    );

    res.json({
      success: true,
      message: 'Assignment dates updated manually',
      assignments: updatedAssignments
    });
  } catch (error) {
    // console.error('Debug update assignment dates error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update assignment dates'
    });
  }
};

// Create assessment instance
export const createAssessmentInstance = async (req, res) => {
  try {
    const { assessment_id, student_id, start_date, end_date } = req.body;
    const { id: current_user_id } = req.user;

    // Only allow faculty/admins to create instances
    if (!['faculty', 'college-admin', 'super-admin'].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to create assessment instances'
      });
    }

    // Check if assessment exists
    const assessmentQuery = 'SELECT * FROM assessments WHERE id = ?';
    const [assessmentResult] = await pool.query(assessmentQuery, [assessment_id]);

    if (assessmentResult.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Assessment not found'
      });
    }

    // Create assignment
    const assignmentQuery = `
      INSERT INTO assessment_assignments (
        assessment_id, target_id, assignment_type, start_date, end_date, created_at
      ) VALUES (?, ?, 'student', ?, ?, NOW())
    `;

    await pool.query(assignmentQuery, [
      assessment_id,
      student_id,
      start_date,
      end_date
    ]);

    res.json({
      success: true,
      message: 'Assessment instance created successfully'
    });
  } catch (error) {
    // console.error('Error creating assessment instance:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create assessment instance'
    });
  }
};

// Assign assessment to students
export const assignAssessmentToStudents = async (req, res) => {
  const { assessmentId } = req.params;
  const { student_ids } = req.body;
  const userId = req.user.id;

  try {
    if (!student_ids || !Array.isArray(student_ids) || student_ids.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Student IDs are required'
      });
    }

    if (!assessmentId) {
      return res.status(400).json({
        success: false,
        message: 'Assessment ID is required'
      });
    }

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required'
      });
    }

    // Verify assessment exists and user has permission
    const assessmentQuery = `
      SELECT id, title, created_by 
      FROM assessments 
      WHERE id = ? AND (created_by = ? OR ? IN (SELECT id FROM users WHERE role = 'super_admin'))
    `;
    const [assessmentRows] = await pool.execute(assessmentQuery, [assessmentId, userId, userId]);

    if (assessmentRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Assessment not found or access denied'
      });
    }

    // Verify all students exist
    const placeholders = student_ids.map(() => '?').join(',');
    const studentQuery = `
      SELECT id, email, name 
      FROM users 
      WHERE id IN (${placeholders}) AND role = 'student'
    `;
    const [studentRows] = await pool.execute(studentQuery, student_ids);

    if (studentRows.length !== student_ids.length) {
      return res.status(400).json({
        success: false,
        message: 'Some students not found or invalid'
      });
    }

    // Get assessment scheduling data
    const assessment = assessmentRows[0];
    const schedulingQuery = `
      SELECT default_start_date_only, default_start_time_only, default_end_date_only, 
             default_end_time_only, default_assessment_timezone, default_early_access_hours, 
             default_late_submission_minutes
      FROM assessments 
      WHERE id = ?
    `;
    const [schedulingRows] = await pool.execute(schedulingQuery, [assessmentId]);

    let startDate, startTime, endDate, endTime, timezone, earlyAccessHours, lateSubmissionMinutes;

    if (schedulingRows.length > 0 && schedulingRows[0].default_start_date_only) {
      // Use assessment's scheduling data
      startDate = schedulingRows[0].default_start_date_only;
      startTime = schedulingRows[0].default_start_time_only || '09:00:00';
      endDate = schedulingRows[0].default_end_date_only;
      endTime = schedulingRows[0].default_end_time_only || '17:00:00';
      timezone = schedulingRows[0].default_assessment_timezone || 'UTC';
      earlyAccessHours = schedulingRows[0].default_early_access_hours || 0;
      lateSubmissionMinutes = schedulingRows[0].default_late_submission_minutes || 0;
    } else {
      // Fallback to default scheduling values
      const now = new Date();
      startDate = now.toISOString().split('T')[0];
      startTime = '09:00:00';
      endDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]; // 7 days from now
      endTime = '17:00:00';
      timezone = 'UTC';
      earlyAccessHours = 0;
      lateSubmissionMinutes = 0;
    }

    // Create assessment assignments for each student
    const insertPromises = student_ids.map(studentId => {
      const assignmentId = uuidv4();
      return pool.execute(
        `INSERT INTO assessment_assignments 
         (id, assessment_id, assignment_type, target_id, start_date_only, start_time_only, 
          end_date_only, end_time_only, assessment_timezone, early_access_hours, 
          late_submission_minutes, created_by, created_at) 
         VALUES (?, ?, 'individual', ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [assignmentId, assessmentId, studentId, startDate, startTime, endDate, endTime, timezone, earlyAccessHours, lateSubmissionMinutes, userId]
      );
    });

    await Promise.all(insertPromises);

    res.json({
      success: true,
      message: `Assessment assigned to ${studentRows.length} students`,
      data: {
        assigned_count: studentRows.length,
        students: studentRows.map(s => ({
          id: s.id,
          name: s.name,
          email: s.email
        }))
      }
    });

  } catch (error) {
    // console.error('Error assigning assessment to students:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to assign assessment to students'
    });
  }
};

// Send assessment reminders
export const sendAssessmentReminders = async (req, res) => {
  const { assessment_id, send_immediately, send_before_start, send_before_end, custom_message, student_ids } = req.body;
  const userId = req.user.id;

  try {
    // Verify assessment exists and user has permission
    const assessmentQuery = `
      SELECT at.id, at.title, at.created_by, at.scheduling
      FROM assessments at
      WHERE at.id = ? AND (at.created_by = ? OR ? IN (SELECT id FROM users WHERE role = 'super_admin'))
    `;
    const [assessmentRows] = await pool.execute(assessmentQuery, [assessment_id, userId, userId]);

    if (assessmentRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Assessment not found or access denied'
      });
    }

    const assessment = assessmentRows[0];

    // Get assigned students (either specific ones or all)
    let studentsQuery, queryParams;

    if (student_ids && student_ids.length > 0) {
      // Get only specific students
      const placeholders = student_ids.map(() => '?').join(',');
      studentsQuery = `
        SELECT u.id, u.email, u.name, aa.id as assignment_id
        FROM assessment_assignments aa
        JOIN users u ON aa.target_id = u.id
        WHERE aa.assessment_id = ? AND aa.assignment_type = 'individual' AND u.id IN (${placeholders})
      `;
      queryParams = [assessment_id, ...student_ids];
    } else {
      // Get all assigned students (backward compatibility)
      studentsQuery = `
        SELECT u.id, u.email, u.name, aa.id as assignment_id
        FROM assessment_assignments aa
        JOIN users u ON aa.target_id = u.id
        WHERE aa.assessment_id = ? AND aa.assignment_type = 'individual'
      `;
      queryParams = [assessment_id];
    }

    const [studentRows] = await pool.execute(studentsQuery, queryParams);

    if (studentRows.length === 0) {
      return res.json({
        success: true,
        message: 'No students assigned to this assessment',
        data: { sent_count: 0 }
      });
    }

    let sentCount = 0;
    const emailPromises = [];

    // Parse scheduling data
    let scheduling = {};
    if (assessment.scheduling) {
      try {
        scheduling = JSON.parse(assessment.scheduling);
      } catch (error) {
        // console.warn('Invalid scheduling JSON:', assessment.scheduling);
      }
    }

    // Send immediate reminders
    if (send_immediately) {
      for (const student of studentRows) {
        const emailPromise = emailService.sendAssessmentReminder({
          to: student.email,
          studentName: student.name,
          assessmentTitle: assessment.title,
          startDate: scheduling.start_date || 'TBD',
          endDate: scheduling.end_date || 'TBD',
          customMessage: custom_message,
          type: 'immediate'
        });
        emailPromises.push(emailPromise);
      }
    }

    // Schedule future reminders
    if (send_before_start && scheduling.start_date) {
      const startDate = new Date(scheduling.start_date);
      const reminderDate = new Date(startDate.getTime() - 24 * 60 * 60 * 1000); // 1 day before

      // In a real implementation, you would schedule these with a job queue
      // For now, we'll just log them
      // console.log(`Scheduled start reminder for ${studentRows.length} students on ${reminderDate}`);
    }

    if (send_before_end && scheduling.end_date) {
      const endDate = new Date(scheduling.end_date);
      const reminderDate = new Date(endDate.getTime() - 2 * 60 * 60 * 1000); // 2 hours before

      // In a real implementation, you would schedule these with a job queue
      // For now, we'll just log them
      // console.log(`Scheduled end reminder for ${studentRows.length} students on ${reminderDate}`);
    }

    // Send immediate emails
    if (emailPromises.length > 0) {
      const results = await Promise.allSettled(emailPromises);
      sentCount = results.filter(result => result.status === 'fulfilled').length;
    }

    res.json({
      success: true,
      message: `Reminders sent to ${sentCount} students`,
      data: {
        sent_count: sentCount,
        total_students: studentRows.length,
        immediate_sent: send_immediately ? sentCount : 0,
        scheduled_reminders: {
          before_start: send_before_start,
          before_end: send_before_end
        }
      }
    });

  } catch (error) {
    // console.error('Error sending assessment reminders:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send assessment reminders'
    });
  }
}; 