import { pool } from '../config/database.js';
import crypto from 'crypto';
import { safeJsonParse, safeJsonParseArray, safeJsonParseObject } from '../utils/jsonParser.js';
import fs from 'fs';
import { validateFileContent } from '../middleware/fileValidation.js';
import ExcelJS from 'exceljs';
import * as XLSX from 'xlsx';

// Helper function to safely parse correct_answer which might be JSON stringified or a plain string
const safeParseCorrectAnswer = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    // Handle boolean strings from MySQL JSON columns
    if (trimmed === 'true') return true;
    if (trimmed === 'false') return false;
    // If it looks like JSON (starts with " or [ or {), try to parse it
    if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      trimmed.startsWith('[') ||
      trimmed.startsWith('{')) {
      const parsed = safeJsonParse(value, value);
      // If parsing resulted in a boolean string, convert it
      if (parsed === 'true') return true;
      if (parsed === 'false') return false;
      return parsed;
    }
    // Otherwise, it's a plain string (like "A" for single choice), return as-is
    return value;
  }
  return value;
};

// =====================================================
// QUESTION CATEGORIES MANAGEMENT
// =====================================================

// Create question category
export const createQuestionCategory = async (req, res) => {
  try {
    const {
      name,
      description,
      parent_id,
      color,
      icon
    } = req.body;

    const created_by = req.user.id;
    const college_id = req.user.college_id;

    // Validate required fields
    if (!name) {
      return res.status(400).json({
        success: false,
        message: 'Category name is required'
      });
    }

    // Check if category name already exists for this college
    const [existing] = await pool.execute(
      'SELECT id FROM question_categories WHERE name = ? AND college_id = ?',
      [name, college_id]
    );

    if (existing.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Category name already exists'
      });
    }

    // Insert category - ensure all parameters are properly handled
    const [result] = await pool.execute(
      `INSERT INTO question_categories (
        name, description, parent_id, color, icon, created_by, college_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        name,
        description || null,
        parent_id || null,
        color || '#3B82F6',
        icon || null,
        created_by,
        college_id || null
      ]
    );

    // Since we're using UUIDs, we need to get the created category by name and created_by
    const [categories] = await pool.execute(
      'SELECT * FROM question_categories WHERE name = ? AND created_by = ? ORDER BY created_at DESC LIMIT 1',
      [name, created_by]
    );

    res.status(201).json({
      success: true,
      message: 'Question category created successfully',
      data: categories[0]
    });
  } catch (error) {
    // console.error('Create question category error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get question categories
export const getQuestionCategories = async (req, res) => {
  try {
    const { parent_id, include_questions } = req.query;
    const conditions = [];
    const params = [];

    // Role-based filtering
    if (req.user.role === 'college-admin') {
      conditions.push('college_id = ?');
      params.push(req.user.college_id);
    } else if (req.user.role === 'faculty') {
      conditions.push('(college_id = ? OR is_public = TRUE)');
      params.push(req.user.college_id);
    }

    if (parent_id) {
      conditions.push('parent_id = ?');
      params.push(parent_id);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Get categories
    const [categories] = await pool.execute(
      `SELECT 
        qc.*,
        u.name as creator_name,
        (SELECT COUNT(*) FROM question_categories WHERE parent_id = qc.id) as subcategory_count,
        CASE 
          WHEN qc.parent_id IS NULL THEN 
            (SELECT COUNT(*) FROM questions WHERE subcategory_id IN (SELECT id FROM question_categories WHERE parent_id = qc.id))
          ELSE 
            (SELECT COUNT(*) FROM questions WHERE subcategory_id = qc.id)
        END as question_count
      FROM question_categories qc
      LEFT JOIN users u ON qc.created_by = u.id
      ${whereClause}
      ORDER BY qc.name`,
      params
    );

    // Include questions if requested
    if (include_questions === 'true') {
      for (let category of categories) {
        const [questions] = await pool.execute(
          'SELECT id, title, question_type, difficulty_level FROM questions WHERE category_id = ? AND status = "active"',
          [category.id]
        );
        category.questions = questions;
      }
    }

    res.json({
      success: true,
      data: categories
    });
  } catch (error) {
    // console.error('Get question categories error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Update question category
export const updateQuestionCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, parent_id, color, icon } = req.body;

    // Check if category exists and user has permission
    const [categories] = await pool.execute(
      'SELECT * FROM question_categories WHERE id = ?',
      [id]
    );

    if (categories.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Question category not found'
      });
    }

    const category = categories[0];

    // Check permissions
    if (req.user.role !== 'super-admin' &&
      category.created_by !== req.user.id &&
      (req.user.role === 'college-admin' && category.college_id !== req.user.college_id)) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to update this category'
      });
    }

    // Update category
    const [result] = await pool.execute(
      `UPDATE question_categories SET
        name = ?, description = ?, parent_id = ?, color = ?, icon = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
      [name, description, parent_id, color, icon, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: 'Question category not found'
      });
    }

    // Get updated category
    const [updatedCategories] = await pool.execute(
      'SELECT * FROM question_categories WHERE id = ?',
      [id]
    );

    res.json({
      success: true,
      message: 'Question category updated successfully',
      data: updatedCategories[0]
    });
  } catch (error) {
    // console.error('Update question category error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Delete question category
export const deleteQuestionCategory = async (req, res) => {
  const connection = await pool.getConnection();

  try {
    const { id } = req.params;

    // Start transaction
    await connection.beginTransaction();

    // Check if category exists and user has permission
    const [categories] = await connection.execute(
      'SELECT * FROM question_categories WHERE id = ?',
      [id]
    );

    if (categories.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: 'Question category not found'
      });
    }

    const category = categories[0];

    // Check permissions
    if (req.user.role !== 'super-admin' &&
      category.created_by !== req.user.id &&
      (req.user.role === 'college-admin' && category.college_id !== req.user.college_id)) {
      await connection.rollback();
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to delete this category'
      });
    }

    // Get all subcategories of this category
    const [subcategories] = await connection.execute(
      'SELECT id FROM question_categories WHERE parent_id = ?',
      [id]
    );

    let deletedQuestionsCount = 0;

    // Delete questions in all subcategories
    for (const subcategory of subcategories) {
      // Get all questions in this subcategory
      const [subcategoryQuestions] = await connection.execute(
        'SELECT id FROM questions WHERE subcategory_id = ?',
        [subcategory.id]
      );

      // Delete each question (cascade will handle related data)
      for (const question of subcategoryQuestions) {
        // Delete question attachments first
        await connection.execute(
          'DELETE FROM question_attachments WHERE question_id = ?',
          [question.id]
        );

        // Delete coding question details if exists
        await connection.execute(
          'DELETE FROM coding_questions WHERE question_id = ?',
          [question.id]
        );

        // Delete from assessment_questions (remove question from assessments)
        await connection.execute(
          'DELETE FROM assessment_questions WHERE question_id = ?',
          [question.id]
        );

        // Delete the question itself
        await connection.execute(
          'DELETE FROM questions WHERE id = ?',
          [question.id]
        );

        deletedQuestionsCount++;
      }
    }

    // Delete questions directly in the parent category (if any)
    const [parentQuestions] = await connection.execute(
      'SELECT id FROM questions WHERE category_id = ?',
      [id]
    );

    for (const question of parentQuestions) {
      // Delete question attachments first
      await connection.execute(
        'DELETE FROM question_attachments WHERE question_id = ?',
        [question.id]
      );

      // Delete coding question details if exists
      await connection.execute(
        'DELETE FROM coding_questions WHERE question_id = ?',
        [question.id]
      );

      // Delete from assessment_questions (remove question from assessments)
      await connection.execute(
        'DELETE FROM assessment_questions WHERE question_id = ?',
        [question.id]
      );

      // Delete the question itself
      await connection.execute(
        'DELETE FROM questions WHERE id = ?',
        [question.id]
      );

      deletedQuestionsCount++;
    }

    // Delete all subcategories
    if (subcategories.length > 0) {
      await connection.execute(
        'DELETE FROM question_categories WHERE parent_id = ?',
        [id]
      );
    }

    // Delete the category itself
    await connection.execute('DELETE FROM question_categories WHERE id = ?', [id]);

    // Commit transaction
    await connection.commit();

    const subcategoryText = subcategories.length > 0
      ? `, ${subcategories.length} subcategory${subcategories.length !== 1 ? 'ies' : ''}`
      : '';
    const questionText = deletedQuestionsCount > 0
      ? `, and ${deletedQuestionsCount} question${deletedQuestionsCount !== 1 ? 's' : ''}`
      : '';

    res.json({
      success: true,
      message: `Category${subcategoryText}${questionText} deleted successfully.`
    });
  } catch (error) {
    // Rollback transaction on error
    await connection.rollback();
    console.error('Delete question category error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  } finally {
    // Release connection
    connection.release();
  }
};

// =====================================================
// QUESTION TAGS MANAGEMENT
// =====================================================

// Create question tag
export const createQuestionTag = async (req, res) => {
  try {
    const { name, description, color } = req.body;
    const created_by = req.user.id;

    // Validate required fields
    if (!name) {
      return res.status(400).json({
        success: false,
        message: 'Tag name is required'
      });
    }

    // Check if tag already exists
    const [existing] = await pool.execute(
      'SELECT id FROM question_tags WHERE name = ?',
      [name]
    );

    if (existing.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Tag name already exists'
      });
    }

    // Insert tag - ensure all parameters are properly handled
    const [result] = await pool.execute(
      'INSERT INTO question_tags (name, description, color, created_by) VALUES (?, ?, ?, ?)',
      [name, description || null, color || '#6B7280', created_by]
    );

    // Since we're using UUIDs, we need to get the created tag by name and created_by
    const [tags] = await pool.execute(
      'SELECT * FROM question_tags WHERE name = ? AND created_by = ? ORDER BY created_at DESC LIMIT 1',
      [name, created_by]
    );

    res.status(201).json({
      success: true,
      message: 'Question tag created successfully',
      data: tags[0]
    });
  } catch (error) {
    // console.error('Create question tag error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get question tags
export const getQuestionTags = async (req, res) => {
  try {
    const [tags] = await pool.execute(
      `SELECT 
        qt.*,
        u.name as creator_name,
        (SELECT COUNT(*) FROM questions WHERE tags::jsonb @> CONCAT('"', qt.name, '"')::jsonb) as usage_count
      FROM question_tags qt
      LEFT JOIN users u ON qt.created_by = u.id
      ORDER BY qt.name`
    );

    res.json({
      success: true,
      data: tags
    });
  } catch (error) {
    // console.error('Get question tags error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// =====================================================
// QUESTIONS MANAGEMENT
// =====================================================

// Create question
export const createQuestion = async (req, res) => {
  try {
    const {
      title,
      content,
      question_type,
      difficulty_level,
      points,
      time_limit_seconds,
      category_id,
      subcategory_id,
      status,
      tags,
      options,
      correct_answer,
      correct_answers,
      explanation,
      hints,
      metadata,
      // Advanced fields
      acceptable_answers, // short answer
      rubric, // essay
      coding_details, // coding
      blanks // fill in the blanks
    } = req.body;

    const created_by = req.user.id;
    const college_id = req.user.college_id;
    const department = req.user.department;

    // Validate required fields
    if (!content || !question_type) {
      return res.status(400).json({
        success: false,
        message: 'Content and question type are required'
      });
    }

    // Title is mandatory only for coding questions
    if (question_type === 'coding' && (!title || !title.trim())) {
      return res.status(400).json({
        success: false,
        message: 'Title is required for coding questions'
      });
    }

    let _options = options;
    let _correct_answer = correct_answer;
    let _correct_answers = correct_answers;
    let _metadata = metadata || {};

    // Handle both singular and plural correct answer fields
    if (correct_answers && Array.isArray(correct_answers)) {
      _correct_answers = correct_answers;
      // For single choice and true/false, use the first answer as correct_answer
      if (question_type === 'single_choice' || question_type === 'true_false') {
        _correct_answer = correct_answers[0];
      }
    }

    // Type-specific validation and mapping
    switch (question_type) {
      case 'multiple_choice':
        if (!_options || !Array.isArray(_options) || _options.length < 2) {
          return res.status(400).json({ success: false, message: 'Multiple choice questions require at least 2 options' });
        }
        if (!_correct_answers || !Array.isArray(_correct_answers) || _correct_answers.length === 0) {
          return res.status(400).json({ success: false, message: 'Correct answers are required for multiple choice questions' });
        }
        break;
      case 'single_choice':
        if (!_options || !Array.isArray(_options) || _options.length < 2) {
          return res.status(400).json({ success: false, message: 'Single choice questions require at least 2 options' });
        }
        if (!_correct_answer && (!_correct_answers || !Array.isArray(_correct_answers) || _correct_answers.length === 0)) {
          return res.status(400).json({ success: false, message: 'Correct answer is required for single choice questions' });
        }
        break;
      case 'true_false':
        if (_correct_answer !== 'true' && _correct_answer !== 'false') {
          return res.status(400).json({ success: false, message: 'Correct answer must be true or false for True/False questions' });
        }
        _options = ['True', 'False'];
        break;
      case 'short_answer':
        if (!acceptable_answers || !Array.isArray(acceptable_answers) || acceptable_answers.length === 0) {
          return res.status(400).json({ success: false, message: 'Short answer questions require at least one acceptable answer' });
        }
        _correct_answers = acceptable_answers;
        break;
      case 'essay':
        if (!rubric) {
          return res.status(400).json({ success: false, message: 'Essay questions require a rubric/guidelines' });
        }
        _metadata = { ..._metadata, rubric };
        break;
      case 'coding':
        if (!coding_details) {
          return res.status(400).json({ success: false, message: 'Coding details are required for coding questions' });
        }

        // Check for multi-language structure (starter_codes, solution_codes)
        const hasStarterCode = coding_details.starter_codes &&
          Object.keys(coding_details.starter_codes).length > 0 &&
          Object.values(coding_details.starter_codes).some(code => code && code.trim());

        const hasSolutionCode = coding_details.solution_codes &&
          Object.keys(coding_details.solution_codes).length > 0 &&
          Object.values(coding_details.solution_codes).some(code => code && code.trim());

        // Check for single-language structure (starter_code, solution_code) - legacy support
        const hasLegacyStarterCode = coding_details.starter_code && coding_details.starter_code.trim();
        const hasLegacySolutionCode = coding_details.solution_code && coding_details.solution_code.trim();

        if (!hasStarterCode && !hasLegacyStarterCode) {
          return res.status(400).json({ success: false, message: 'Coding questions require starter code for at least one language' });
        }

        if (!hasSolutionCode && !hasLegacySolutionCode) {
          return res.status(400).json({ success: false, message: 'Coding questions require solution code for at least one language' });
        }

        if (!Array.isArray(coding_details.test_cases) || coding_details.test_cases.length === 0) {
          return res.status(400).json({ success: false, message: 'Coding questions require at least one test case' });
        }

        _metadata = { ..._metadata, ...coding_details };
        break;
      case 'fill_blanks':
        if (!blanks || !Array.isArray(blanks) || blanks.length === 0) {
          return res.status(400).json({ success: false, message: 'Fill in the blanks questions require at least one blank' });
        }
        _correct_answers = blanks;
        break;
      // Add more types as needed
    }

    // Insert question
    const [result] = await pool.execute(
      `INSERT INTO questions (
        title, content, question_type, difficulty_level, points,
        time_limit_seconds, category_id, subcategory_id, status, tags, options, correct_answer, correct_answers,
        explanation, hints, metadata, created_by, college_id, department
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        title, content, question_type, difficulty_level, points,
        time_limit_seconds || null, category_id || null, subcategory_id || null, status || 'draft', JSON.stringify(tags || []),
        JSON.stringify(_options || []), JSON.stringify(_correct_answer || null), JSON.stringify(_correct_answers || null),
        explanation || null, JSON.stringify(hints || []), JSON.stringify(_metadata || {}),
        created_by, college_id || null, department || null
      ]
    );

    // Since we're using UUIDs, we need to get the created question by content and created_by
    const [questions] = await pool.execute(
      'SELECT * FROM questions WHERE content = ? AND created_by = ? ORDER BY created_at DESC LIMIT 1',
      [content, created_by]
    );

    if (questions.length === 0) {
      return res.status(500).json({
        success: false,
        message: 'Failed to retrieve created question'
      });
    }

    const questionId = questions[0].id;

    // If coding, insert into coding_questions table for each language
    if (question_type === 'coding' && coding_details) {
      const languages = coding_details.languages || [];

      // If no languages specified, try to get from starter_codes or solution_codes
      if (languages.length === 0) {
        if (coding_details.starter_codes) {
          languages.push(...Object.keys(coding_details.starter_codes));
        }
        if (coding_details.solution_codes) {
          languages.push(...Object.keys(coding_details.solution_codes));
        }
        // Remove duplicates
        const uniqueLanguages = [...new Set(languages)];
        languages.length = 0;
        languages.push(...uniqueLanguages);
      }

      // If still no languages, use default
      if (languages.length === 0) {
        languages.push('javascript');
      }

      for (const language of languages) {
        const starterCode = coding_details.starter_codes?.[language] || coding_details.starter_code || '';
        const solutionCode = coding_details.solution_codes?.[language] || coding_details.solution_code || '';

        // Generate UUID for coding_questions id
        const codingQuestionId = crypto.randomUUID();

        await pool.execute(
          `INSERT INTO coding_questions (
            id, question_id, language, starter_code, solution_code, test_cases, time_limit, memory_limit, difficulty, category, tags
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            codingQuestionId,
            questionId,
            language,
            starterCode,
            solutionCode,
            JSON.stringify(coding_details.test_cases || []),
            coding_details.time_limit || 1000,
            coding_details.memory_limit || 256,
            coding_details.difficulty || 'medium',
            coding_details.category || null,
            JSON.stringify(coding_details.tags || [])
          ]
        );
      }
    }

    // Parse and return all fields
    let q = questions[0];
    // CRITICAL FIX: Safe JSON parsing with error handling (imported at top of file)
    q.tags = safeJsonParseArray(q.tags);
    q.options = q.options ? safeJsonParse(q.options) : null;
    q.correct_answer = safeParseCorrectAnswer(q.correct_answer);
    q.correct_answers = q.correct_answers ? safeJsonParse(q.correct_answers) : null;
    q.hints = safeJsonParseArray(q.hints);
    q.metadata = safeJsonParseObject(q.metadata);

    // If coding, add coding_details
    if (question_type === 'coding') {
      const [codingRows] = await pool.execute('SELECT * FROM coding_questions WHERE question_id = ?', [questionId]);
      if (codingRows.length > 0) {
        // Convert to multi-language structure
        q.coding_details = {
          languages: codingRows.map(row => row.language),
          starter_codes: {},
          solution_codes: {},
          test_cases: codingRows[0] ? safeJsonParseArray(codingRows[0].test_cases) : [],
          time_limit: codingRows[0]?.time_limit || 1000,
          memory_limit: codingRows[0]?.memory_limit || 256,
          difficulty: codingRows[0]?.difficulty || 'medium',
          category: codingRows[0]?.category || null,
          tags: codingRows[0] ? safeJsonParseArray(codingRows[0].tags) : []
        };

        // Populate starter_codes and solution_codes for each language
        codingRows.forEach(row => {
          q.coding_details.starter_codes[row.language] = row.starter_code || '';
          q.coding_details.solution_codes[row.language] = row.solution_code || '';
        });
      }
    }

    res.status(201).json({
      success: true,
      message: 'Question created successfully',
      data: q
    });
  } catch (error) {
    // console.error('Create question error:', error);
    if (error && error.stack) {
      // console.error('Error stack:', error.stack);
    }
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message,
      stack: error.stack
    });
  }
};

// Get questions with advanced filtering
export const getQuestions = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search,
      question_type,
      difficulty_level,
      category_id,
      tags,
      status,
      created_by,
      college_id,
      department,
      sort_by = 'created_at',
      sort_order = 'DESC'
    } = req.query;

    const offset = (page - 1) * limit;
    const conditions = [];
    const params = [];

    // Build WHERE conditions
    if (search) {
      conditions.push('(q.title LIKE ? OR q.content LIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
    }

    if (question_type) {
      conditions.push('q.question_type = ?');
      params.push(question_type);
    }

    if (difficulty_level) {
      conditions.push('q.difficulty_level = ?');
      params.push(difficulty_level);
    }

    if (category_id) {
      conditions.push('(q.category_id = ? OR q.subcategory_id = ?)');
      params.push(category_id, category_id);
    }

    if (tags) {
      const tagArray = tags.split(',');
      const tagConditions = tagArray.map(() => 'JSON_CONTAINS(q.tags, ?)');
      conditions.push(`(${tagConditions.join(' OR ')})`);
      params.push(...tagArray.map(tag => `"${tag}"`));
    }

    if (status && status !== 'all') {
      conditions.push('q.status = ?');
      params.push(status);
    }

    if (created_by) {
      conditions.push('q.created_by = ?');
      params.push(created_by);
    }

    if (college_id) {
      conditions.push('q.college_id = ?');
      params.push(college_id);
    }

    if (department) {
      conditions.push('q.department = ?');
      params.push(department);
    }

    // Role-based filtering
    if (req.user.role === 'super-admin') {
      // Super admin can see all questions
      // No additional conditions needed
    } else if (req.user.role === 'college-admin') {
      conditions.push('(q.college_id = ? OR q.is_public = TRUE)');
      params.push(req.user.college_id);
    } else if (req.user.role === 'faculty') {
      conditions.push('(q.college_id = ? OR q.created_by = ? OR q.is_public = TRUE)');
      params.push(req.user.college_id, req.user.id);
    } else {
      // For other roles (like students), show only public questions
      conditions.push('q.is_public = TRUE');
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Validate sort parameters
    const allowedSortFields = ['created_at', 'updated_at', 'title', 'difficulty_level', 'usage_count', 'average_score'];
    const allowedSortOrders = ['ASC', 'DESC'];

    const sortField = allowedSortFields.includes(sort_by) ? sort_by : 'created_at';
    const sortOrder = allowedSortOrders.includes(sort_order.toUpperCase()) ? sort_order.toUpperCase() : 'DESC';

    // Get total count
    const [countResult] = await pool.query(
      `SELECT COUNT(*) as total FROM questions q ${whereClause}`,
      params
    );

    const total = countResult[0].total;

    // Get questions with pagination
    const safeLimit = parseInt(limit) || 10;
    const safeOffset = parseInt(offset) || 0;

    const [questions] = await pool.query(
      `SELECT 
        q.*,
        u.name as creator_name,
        u.email as creator_email,
        qc.name as category_name,
        qc.color as category_color
      FROM questions q
      LEFT JOIN users u ON q.created_by = u.id
      LEFT JOIN question_categories qc ON q.category_id = qc.id
      ${whereClause}
      ORDER BY q.${sortField} ${sortOrder}
      LIMIT ${safeLimit} OFFSET ${safeOffset}`,
      params
    );

    // Parse JSON fields (MySQL2 driver may have already parsed them)
    // CRITICAL FIX: Import safe JSON parser at top level (imported at top of file)
    questions.forEach(q => {
      try {
        q.tags = safeJsonParseArray(q.tags);
      } catch (e) {
        // console.warn('Failed to parse tags for question', q.id, e.message);
        q.tags = [];
      }

      // CRITICAL FIX: Safe JSON parsing with error handling (imported at top of file)
      q.options = q.options ? safeJsonParse(q.options) : null;
      q.correct_answer = safeParseCorrectAnswer(q.correct_answer);
      q.correct_answers = q.correct_answers ? safeJsonParse(q.correct_answers) : null;
      q.hints = safeJsonParseArray(q.hints);
      q.metadata = safeJsonParseObject(q.metadata);
      q.coding_details = q.coding_details ? safeJsonParse(q.coding_details) : null;
      q.blanks = q.blanks ? safeJsonParse(q.blanks) : null;
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
    // console.error('Get questions error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get question by ID
export const getQuestionById = async (req, res) => {
  try {
    const { id } = req.params;

    const [questions] = await pool.execute(
      `SELECT 
        q.*,
        u.name as creator_name,
        u.email as creator_email,
        qc.name as category_name,
        qc.color as category_color,
        qsc.name as subcategory_name,
        qsc.color as subcategory_color
      FROM questions q
      LEFT JOIN users u ON q.created_by = u.id
      LEFT JOIN question_categories qc ON q.category_id = qc.id
      LEFT JOIN question_categories qsc ON q.subcategory_id = qsc.id
      WHERE q.id = ?`,
      [id]
    );

    if (questions.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Question not found'
      });
    }

    const question = questions[0];

    // CRITICAL FIX: Safe JSON parsing with error handling (imported at top of file)
    question.tags = safeJsonParseArray(question.tags);
    question.options = question.options ? safeJsonParse(question.options) : null;
    question.correct_answer = safeParseCorrectAnswer(question.correct_answer);
    question.correct_answers = question.correct_answers ? safeJsonParse(question.correct_answers) : null;
    question.hints = safeJsonParseArray(question.hints);
    question.metadata = safeJsonParseObject(question.metadata);

    // If coding question, fetch coding details from coding_questions table
    if (question.question_type === 'coding') {
      const [codingRows] = await pool.execute('SELECT * FROM coding_questions WHERE question_id = ?', [id]);
      if (codingRows.length > 0) {
        // Convert to multi-language structure
        question.coding_details = {
          languages: codingRows.map(row => row.language),
          starter_codes: {},
          solution_codes: {},
          test_cases: codingRows[0] ? safeJsonParseArray(codingRows[0].test_cases) : [],
          time_limit: codingRows[0]?.time_limit || 1000,
          memory_limit: codingRows[0]?.memory_limit || 256,
          difficulty: codingRows[0]?.difficulty || 'medium',
          category: codingRows[0]?.category || null,
          tags: codingRows[0] ? safeJsonParseArray(codingRows[0].tags) : []
        };

        // Populate starter_codes and solution_codes for each language
        codingRows.forEach(row => {
          question.coding_details.starter_codes[row.language] = row.starter_code || '';
          question.coding_details.solution_codes[row.language] = row.solution_code || '';
        });
      } else {
        // Fallback to metadata if no coding_questions entries found
        question.coding_details = question.metadata || {
          languages: [],
          starter_codes: {},
          solution_codes: {},
          test_cases: []
        };
      }
    }

    // Get attachments
    const [attachments] = await pool.execute(
      'SELECT * FROM question_attachments WHERE question_id = ?',
      [id]
    );

    question.attachments = attachments;

    res.json({
      success: true,
      data: question
    });
  } catch (error) {
    // console.error('Get question by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Update question
export const updateQuestion = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      title,
      content,
      question_type,
      difficulty_level,
      points,
      time_limit_seconds,
      category_id,
      subcategory_id,
      tags,
      options,
      correct_answer,
      correct_answers,
      explanation,
      hints,
      metadata,
      status,
      // Advanced fields
      acceptable_answers, // short answer
      rubric, // essay
      coding_details, // coding
      blanks // fill in the blanks
    } = req.body;

    // Check if question exists and user has permission
    const [questions] = await pool.execute(
      'SELECT * FROM questions WHERE id = ?',
      [id]
    );

    if (questions.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Question not found'
      });
    }

    const question = questions[0];

    // Check permissions
    if (req.user.role !== 'super-admin' &&
      question.created_by !== req.user.id &&
      (req.user.role === 'college-admin' && question.college_id !== req.user.college_id)) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to update this question'
      });
    }

    // Validate coding questions if question_type is being updated to coding or if it's already coding
    if ((question_type === 'coding' || question.question_type === 'coding') && coding_details) {
      // Check for multi-language structure (starter_codes, solution_codes)
      const hasStarterCode = coding_details.starter_codes &&
        Object.keys(coding_details.starter_codes).length > 0 &&
        Object.values(coding_details.starter_codes).some(code => code && code.trim());

      const hasSolutionCode = coding_details.solution_codes &&
        Object.keys(coding_details.solution_codes).length > 0 &&
        Object.values(coding_details.solution_codes).some(code => code && code.trim());

      // Check for single-language structure (starter_code, solution_code) - legacy support
      const hasLegacyStarterCode = coding_details.starter_code && coding_details.starter_code.trim();
      const hasLegacySolutionCode = coding_details.solution_code && coding_details.solution_code.trim();

      if (!hasStarterCode && !hasLegacyStarterCode) {
        return res.status(400).json({ success: false, message: 'Coding questions require starter code for at least one language' });
      }

      if (!hasSolutionCode && !hasLegacySolutionCode) {
        return res.status(400).json({ success: false, message: 'Coding questions require solution code for at least one language' });
      }

      if (!Array.isArray(coding_details.test_cases) || coding_details.test_cases.length === 0) {
        return res.status(400).json({ success: false, message: 'Coding questions require at least one test case' });
      }
    }

    // Build dynamic UPDATE query based on provided fields
    const updateFields = [];
    const updateValues = [];

    if (title !== undefined) {
      updateFields.push('title = ?');
      updateValues.push(title);
    }
    if (content !== undefined) {
      updateFields.push('content = ?');
      updateValues.push(content);
    }
    if (question_type !== undefined) {
      updateFields.push('question_type = ?');
      updateValues.push(question_type);
    }
    if (difficulty_level !== undefined) {
      updateFields.push('difficulty_level = ?');
      updateValues.push(difficulty_level);
    }
    if (points !== undefined) {
      updateFields.push('points = ?');
      updateValues.push(points);
    }
    if (time_limit_seconds !== undefined) {
      updateFields.push('time_limit_seconds = ?');
      updateValues.push(time_limit_seconds);
    }
    if (category_id !== undefined) {
      updateFields.push('category_id = ?');
      updateValues.push(category_id);
    }
    if (subcategory_id !== undefined) {
      updateFields.push('subcategory_id = ?');
      updateValues.push(subcategory_id);
    }
    if (tags !== undefined) {
      updateFields.push('tags = ?');
      updateValues.push(JSON.stringify(tags));
    }
    if (options !== undefined) {
      updateFields.push('options = ?');
      updateValues.push(JSON.stringify(options));
    }
    if (correct_answer !== undefined) {
      updateFields.push('correct_answer = ?');
      updateValues.push(JSON.stringify(correct_answer));
    }
    if (correct_answers !== undefined) {
      updateFields.push('correct_answers = ?');
      updateValues.push(JSON.stringify(correct_answers));
    }
    if (explanation !== undefined) {
      updateFields.push('explanation = ?');
      updateValues.push(explanation);
    }
    if (hints !== undefined) {
      updateFields.push('hints = ?');
      updateValues.push(JSON.stringify(hints));
    }
    if (metadata !== undefined) {
      updateFields.push('metadata = ?');
      updateValues.push(JSON.stringify(metadata));
    }
    if (status !== undefined) {
      updateFields.push('status = ?');
      updateValues.push(status);
    }

    // Handle coding_details by merging with metadata
    if (coding_details !== undefined) {
      const currentMetadata = metadata || question.metadata || {};
      const updatedMetadata = { ...currentMetadata, ...coding_details };
      updateFields.push('metadata = ?');
      updateValues.push(JSON.stringify(updatedMetadata));
    }

    // Always update the updated_at timestamp
    updateFields.push('updated_at = CURRENT_TIMESTAMP');

    // Add the WHERE clause parameter
    updateValues.push(id);

    // Execute the dynamic UPDATE query
    const [result] = await pool.execute(
      `UPDATE questions SET ${updateFields.join(', ')} WHERE id = ?`,
      updateValues
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: 'Question not found'
      });
    }

    // If coding details were provided, update coding_questions table
    if (coding_details !== undefined) {
      // Delete existing coding entries for this question
      await pool.execute('DELETE FROM coding_questions WHERE question_id = ?', [id]);

      // Insert new coding entries for each language
      const languages = coding_details.languages || [];

      // If no languages specified, try to get from starter_codes or solution_codes
      if (languages.length === 0) {
        if (coding_details.starter_codes) {
          languages.push(...Object.keys(coding_details.starter_codes));
        }
        if (coding_details.solution_codes) {
          languages.push(...Object.keys(coding_details.solution_codes));
        }
        // Remove duplicates
        const uniqueLanguages = [...new Set(languages)];
        languages.length = 0;
        languages.push(...uniqueLanguages);
      }

      // If still no languages, use default
      if (languages.length === 0) {
        languages.push('javascript');
      }

      for (const language of languages) {
        const starterCode = coding_details.starter_codes?.[language] || coding_details.starter_code || '';
        const solutionCode = coding_details.solution_codes?.[language] || coding_details.solution_code || '';

        // Generate UUID for coding_questions id
        const codingQuestionId = crypto.randomUUID();

        await pool.execute(
          `INSERT INTO coding_questions (
            id, question_id, language, starter_code, solution_code, test_cases, time_limit, memory_limit, difficulty, category, tags
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            codingQuestionId,
            id,
            language,
            starterCode,
            solutionCode,
            JSON.stringify(coding_details.test_cases || []),
            coding_details.time_limit || 1000,
            coding_details.memory_limit || 256,
            coding_details.difficulty || 'medium',
            coding_details.category || null,
            JSON.stringify(coding_details.tags || [])
          ]
        );
      }
    }

    // Get updated question
    const [updatedQuestions] = await pool.execute(
      'SELECT * FROM questions WHERE id = ?',
      [id]
    );

    // CRITICAL FIX: Safe JSON parsing with error handling (imported at top of file)
    let updatedQuestion = updatedQuestions[0];
    updatedQuestion.tags = safeJsonParseArray(updatedQuestion.tags);
    updatedQuestion.options = updatedQuestion.options ? safeJsonParse(updatedQuestion.options) : null;
    updatedQuestion.correct_answer = safeParseCorrectAnswer(updatedQuestion.correct_answer);
    updatedQuestion.correct_answers = updatedQuestion.correct_answers ? safeJsonParse(updatedQuestion.correct_answers) : null;
    updatedQuestion.hints = safeJsonParseArray(updatedQuestion.hints);
    updatedQuestion.metadata = safeJsonParseObject(updatedQuestion.metadata);

    // If coding, add coding_details
    if (updatedQuestion.question_type === 'coding') {
      const [codingRows] = await pool.execute('SELECT * FROM coding_questions WHERE question_id = ?', [id]);
      if (codingRows.length > 0) {
        // Convert to multi-language structure
        updatedQuestion.coding_details = {
          languages: codingRows.map(row => row.language),
          starter_codes: {},
          solution_codes: {},
          test_cases: codingRows[0] ? safeJsonParseArray(codingRows[0].test_cases) : [],
          time_limit: codingRows[0]?.time_limit || 1000,
          memory_limit: codingRows[0]?.memory_limit || 256,
          difficulty: codingRows[0]?.difficulty || 'medium',
          category: codingRows[0]?.category || null,
          tags: codingRows[0] ? safeJsonParseArray(codingRows[0].tags) : []
        };

        // Populate starter_codes and solution_codes for each language
        codingRows.forEach(row => {
          updatedQuestion.coding_details.starter_codes[row.language] = row.starter_code || '';
          updatedQuestion.coding_details.solution_codes[row.language] = row.solution_code || '';
        });
      }
    }

    res.json({
      success: true,
      message: 'Question updated successfully',
      data: updatedQuestion
    });
  } catch (error) {
    // console.error('Update question error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Delete question
export const deleteQuestion = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if question exists and user has permission
    const [questions] = await pool.execute(
      'SELECT * FROM questions WHERE id = ?',
      [id]
    );

    if (questions.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Question not found'
      });
    }

    const question = questions[0];

    // Check permissions
    if (req.user.role !== 'super-admin' &&
      question.created_by !== req.user.id &&
      (req.user.role === 'college-admin' && question.college_id !== req.user.college_id)) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to delete this question'
      });
    }

    // Check if question is used in assessments
    const [usage] = await pool.execute(
      'SELECT COUNT(*) as count FROM assessment_questions WHERE question_id = ?',
      [id]
    );

    if (usage[0].count > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete question that is used in assessments. Archive it instead.'
      });
    }

    // Delete question (cascade will handle attachments)
    await pool.execute('DELETE FROM questions WHERE id = ?', [id]);

    res.json({
      success: true,
      message: 'Question deleted successfully'
    });
  } catch (error) {
    // console.error('Delete question error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// =====================================================
// QUESTION ATTACHMENTS
// =====================================================

// Upload question attachment
export const uploadQuestionAttachment = async (req, res) => {
  try {
    const { question_id } = req.params;
    const file = req.file;

    if (!file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    // CRITICAL FIX: File content validation (already done by middleware, but double-check)
    // validateFileContent and fs imported at top of file

    let fileBuffer;
    if (file.buffer) {
      fileBuffer = file.buffer;
    } else if (file.path) {
      fileBuffer = fs.readFileSync(file.path);
    }

    if (fileBuffer && !validateFileContent(fileBuffer, file.mimetype)) {
      // Delete the uploaded file if validation fails
      if (file.path && fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }
      return res.status(400).json({
        success: false,
        message: `File content does not match declared MIME type (${file.mimetype}). File may be corrupted or malicious.`
      });
    }

    // Check if question exists and user has permission
    const [questions] = await pool.execute(
      'SELECT * FROM questions WHERE id = ?',
      [question_id]
    );

    if (questions.length === 0) {
      // Delete the uploaded file if question doesn't exist
      if (file.path && fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }
      return res.status(404).json({
        success: false,
        message: 'Question not found'
      });
    }

    const question = questions[0];

    // Check permissions
    if (req.user.role !== 'super-admin' &&
      question.created_by !== req.user.id &&
      (req.user.role === 'college-admin' && question.college_id !== req.user.college_id)) {
      // Delete the uploaded file if permission denied
      if (file.path && fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to upload attachments for this question'
      });
    }

    // Save attachment record
    const [result] = await pool.execute(
      `INSERT INTO question_attachments (
        question_id, file_name, file_path, file_type, file_size, mime_type
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        question_id, file.originalname, file.path, file.mimetype,
        file.size, file.mimetype
      ]
    );

    const attachmentId = result.insertId;

    // Get the created attachment
    const [attachments] = await pool.execute(
      'SELECT * FROM question_attachments WHERE id = ?',
      [attachmentId]
    );

    res.status(201).json({
      success: true,
      message: 'Attachment uploaded successfully',
      data: attachments[0]
    });
  } catch (error) {
    // Delete uploaded file on error
    if (req.file && req.file.path) {
      // fs imported at top of file
      if (fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
    }
    console.error('Upload question attachment error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Delete question attachment
export const deleteQuestionAttachment = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if attachment exists
    const [attachments] = await pool.execute(
      `SELECT qa.*, q.created_by, q.college_id 
       FROM question_attachments qa
       LEFT JOIN questions q ON qa.question_id = q.id
       WHERE qa.id = ?`,
      [id]
    );

    if (attachments.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Attachment not found'
      });
    }

    const attachment = attachments[0];

    // Check permissions
    if (req.user.role !== 'super-admin' &&
      attachment.created_by !== req.user.id &&
      (req.user.role === 'college-admin' && attachment.college_id !== req.user.college_id)) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to delete this attachment'
      });
    }

    // Delete attachment
    await pool.execute('DELETE FROM question_attachments WHERE id = ?', [id]);

    res.json({
      success: true,
      message: 'Attachment deleted successfully'
    });
  } catch (error) {
    // console.error('Delete question attachment error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// =====================================================
// QUESTION ANALYTICS
// =====================================================

// Get question analytics
export const getQuestionAnalytics = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if question exists and user has permission
    const [questions] = await pool.execute(
      'SELECT * FROM questions WHERE id = ?',
      [id]
    );

    if (questions.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Question not found'
      });
    }

    const question = questions[0];

    // Check permissions
    if (req.user.role !== 'super-admin' &&
      question.created_by !== req.user.id &&
      (req.user.role === 'college-admin' && question.college_id !== req.user.college_id)) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view analytics for this question'
      });
    }

    // Get question analytics
    const [analytics] = await pool.execute(
      `SELECT 
        qa.total_attempts,
        qa.correct_attempts,
        qa.average_time_seconds,
        qa.difficulty_index,
        qa.discrimination_index,
        qa.usage_count,
        qa.last_used
      FROM question_analytics qa
      WHERE qa.question_id = ?`,
      [id]
    );

    // Get usage in assessments
    const [assessmentUsage] = await pool.execute(
      `SELECT 
        at.id,
        at.title,
        COUNT(aq.id) as usage_count
      FROM assessments at
      INNER JOIN assessment_questions aq ON at.id = aq.assessment_id
      WHERE aq.question_id = ?
      GROUP BY at.id`,
      [id]
    );

    // Get recent performance
    const [recentPerformance] = await pool.execute(
      `SELECT 
        sa.is_correct,
        sa.points_earned,
        sa.time_spent_seconds,
        aa.created_at
      FROM student_answers sa
      INNER JOIN assessment_attempts aa ON sa.attempt_id = aa.id
      WHERE sa.question_id = ? AND aa.status = 'graded'
      ORDER BY aa.created_at DESC
      LIMIT 50`,
      [id]
    );

    const analyticsData = {
      question_id: id,
      analytics: analytics[0] || {
        total_attempts: 0,
        correct_attempts: 0,
        average_time_seconds: 0,
        difficulty_index: 0,
        discrimination_index: 0,
        usage_count: 0
      },
      assessment_usage: assessmentUsage,
      recent_performance: recentPerformance
    };

    res.json({
      success: true,
      data: analyticsData
    });
  } catch (error) {
    // console.error('Get question analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// =====================================================
// BULK UPLOAD QUESTIONS
// =====================================================

// Download template for bulk question upload
export const downloadQuestionTemplate = async (req, res) => {
  try {
    const { type } = req.params;
    const validTypes = ['multiple_choice', 'single_choice', 'true_false', 'short_answer', 'essay', 'coding', 'fill_blanks'];

    if (!validTypes.includes(type)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid question type'
      });
    }

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Questions');

    // Define headers based on question type
    // Serial Number is auto-generated, Title is only required for coding questions
    let headers = ['Content/Question'];

    // Add Title only for coding questions
    if (type === 'coding') {
      headers.push('Title');
    }

    switch (type) {
      case 'multiple_choice':
      case 'single_choice':
        headers.push('Option A', 'Option B', 'Option C', 'Option D', 'Option E', 'Correct Answer(s)', 'Explanation');
        break;
      case 'true_false':
        headers.push('Correct Answer', 'Explanation');
        break;
      case 'short_answer':
        headers.push('Correct Answer(s)', 'Case Sensitive', 'Explanation');
        break;
      case 'essay':
        headers.push('Word Limit', 'Rubric/Scoring Guide');
        break;
      case 'coding':
        headers.push('Language', 'Starter Code', 'Solution Code', 'Test Cases', 'Time Limit (ms)', 'Memory Limit (MB)');
        break;
      case 'fill_blanks':
        headers.push('Answer for BLANK1', 'Answer for BLANK2', 'Answer for BLANK3', 'Answer for BLANK4', 'Case Sensitive', 'Explanation');
        break;
    }

    // Common headers for all types (Status is always 'active' by default, not in template)
    headers.push('Difficulty Level', 'Points', 'Category Name', 'Subcategory Name', 'Tags');

    // Add headers to worksheet
    worksheet.addRow(headers);

    // Style the header row
    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF4472C4' }
    };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };

    // Set column widths
    worksheet.columns.forEach((column, index) => {
      column.width = index === 0 ? 15 : index === 1 ? 30 : index === 2 ? 50 : 20;
    });

    // Freeze header row
    worksheet.views = [{ state: 'frozen', ySplit: 1 }];

    // Generate buffer
    const buffer = await workbook.xlsx.writeBuffer();

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=question_template_${type}.xlsx`);
    res.send(buffer);
  } catch (error) {
    console.error('Download template error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate template'
    });
  }
};

// Parse Excel file and return preview (without inserting)
export const previewBulkUploadQuestions = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    const { question_type } = req.body;
    if (!question_type) {
      return res.status(400).json({
        success: false,
        message: 'Question type is required'
      });
    }

    // Parse Excel file
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(worksheet, { defval: '', raw: false, blankrows: false });

    // Normalize column names - trim spaces and handle case variations
    const normalizeColumnName = (name) => {
      if (!name) return '';
      return String(name).trim();
    };

    // Normalize all column names in rows
    const normalizedRows = rows.map(row => {
      const normalized = {};
      for (const key in row) {
        const normalizedKey = normalizeColumnName(key);
        const value = row[key];
        // Trim string values
        normalized[normalizedKey] = typeof value === 'string' ? value.trim() : value;
      }
      return normalized;
    });

    if (normalizedRows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Excel file is empty'
      });
    }

    // Helper function to safely get cell value
    const getCellValue = (row, columnName) => {
      // Try exact match first
      if (row[columnName] !== undefined) {
        const value = row[columnName];
        return typeof value === 'string' ? value.trim() : (value || '');
      }
      // Try case-insensitive match
      const lowerColumnName = columnName.toLowerCase();
      for (const key in row) {
        if (key.toLowerCase() === lowerColumnName) {
          const value = row[key];
          return typeof value === 'string' ? value.trim() : (value || '');
        }
      }
      return '';
    };

    const previewData = [];
    let serialNumberCounter = 1;

    // Parse each row for preview
    for (let i = 0; i < normalizedRows.length; i++) {
      const row = normalizedRows[i];
      const rowNumber = i + 2;
      const autoSerialNumber = serialNumberCounter++;

      const previewItem = {
        serialNumber: autoSerialNumber,
        rowNumber: rowNumber,
        valid: true,
        errors: [],
        data: {}
      };

      try {
        // Validate required fields
        const contentQuestion = getCellValue(row, 'Content/Question');
        if (!contentQuestion) {
          previewItem.valid = false;
          previewItem.errors.push('Content/Question is required');
        } else {
          previewItem.data.content = contentQuestion;
        }

        // Title is only required for coding questions
        if (question_type === 'coding') {
          const title = getCellValue(row, 'Title');
          if (!title) {
            previewItem.valid = false;
            previewItem.errors.push('Title is required for coding questions');
          } else {
            previewItem.data.title = title;
          }
        } else {
          // Auto-generate title preview
          const title = getCellValue(row, 'Title');
          if (title) {
            previewItem.data.title = title;
          } else if (contentQuestion) {
            previewItem.data.title = contentQuestion.substring(0, 50).trim() + (contentQuestion.length > 50 ? '...' : '');
          }
        }

        // Parse category/subcategory
        const categoryName = getCellValue(row, 'Category Name');
        const subcategoryName = getCellValue(row, 'Subcategory Name');
        previewItem.data.categoryName = categoryName || null;
        previewItem.data.subcategoryName = subcategoryName || null;

        // Parse tags
        const tagsValue = getCellValue(row, 'Tags');
        if (tagsValue) {
          previewItem.data.tags = tagsValue.split(',').map(tag => tag.trim()).filter(tag => tag);
        } else {
          previewItem.data.tags = [];
        }

        // Parse difficulty
        const difficultyValue = getCellValue(row, 'Difficulty Level');
        previewItem.data.difficulty = ['easy', 'medium', 'hard', 'expert'].includes(difficultyValue.toLowerCase())
          ? difficultyValue.toLowerCase()
          : 'medium';

        // Parse points
        const pointsValue = getCellValue(row, 'Points');
        previewItem.data.points = parseInt(pointsValue) || 1;

        // Parse question type specific data
        switch (question_type) {
          case 'multiple_choice':
          case 'single_choice':
            const options = [];
            const optionA = getCellValue(row, 'Option A');
            const optionB = getCellValue(row, 'Option B');
            const optionC = getCellValue(row, 'Option C');
            const optionD = getCellValue(row, 'Option D');
            const optionE = getCellValue(row, 'Option E');

            if (optionA) options.push({ label: 'A', text: optionA });
            if (optionB) options.push({ label: 'B', text: optionB });
            if (optionC) options.push({ label: 'C', text: optionC });
            if (optionD) options.push({ label: 'D', text: optionD });
            if (optionE) options.push({ label: 'E', text: optionE });

            if (options.length < 2) {
              previewItem.valid = false;
              previewItem.errors.push('At least 2 options are required');
            }
            previewItem.data.options = options;

            const correctAnswersValue = getCellValue(row, 'Correct Answer(s)');
            if (!correctAnswersValue) {
              previewItem.valid = false;
              previewItem.errors.push('Correct Answer(s) is required');
            } else {
              if (question_type === 'single_choice') {
                const correctAnswer = correctAnswersValue.split(',')[0].trim().toUpperCase();
                previewItem.data.correctAnswer = correctAnswer;
                // Validate answer
                const validLabels = options.map(opt => opt.label);
                if (!validLabels.includes(correctAnswer)) {
                  previewItem.valid = false;
                  previewItem.errors.push(`Correct Answer must be one of: ${validLabels.join(', ')}`);
                }
              } else {
                previewItem.data.correctAnswers = correctAnswersValue.split(',').map(a => a.trim().toUpperCase()).filter(a => a);
                if (previewItem.data.correctAnswers.length === 0) {
                  previewItem.valid = false;
                  previewItem.errors.push('At least one correct answer is required');
                }
              }
            }
            break;

          case 'true_false':
            const tfAnswerValue = getCellValue(row, 'Correct Answer');
            if (!tfAnswerValue) {
              previewItem.valid = false;
              previewItem.errors.push('Correct Answer is required');
            } else {
              const tfAnswer = tfAnswerValue.toUpperCase();
              if (tfAnswer !== 'TRUE' && tfAnswer !== 'FALSE') {
                previewItem.valid = false;
                previewItem.errors.push('Correct Answer must be TRUE or FALSE');
              } else {
                previewItem.data.correctAnswer = tfAnswer === 'TRUE';
              }
            }
            break;

          case 'short_answer':
            const saAnswersValue = getCellValue(row, 'Correct Answer(s)');
            if (!saAnswersValue) {
              previewItem.valid = false;
              previewItem.errors.push('Correct Answer(s) is required');
            } else {
              previewItem.data.correctAnswers = saAnswersValue.split(',').map(a => a.trim()).filter(a => a);
              if (previewItem.data.correctAnswers.length === 0) {
                previewItem.valid = false;
                previewItem.errors.push('At least one correct answer is required');
              }
            }
            const caseSensitiveValue = getCellValue(row, 'Case Sensitive');
            previewItem.data.caseSensitive = caseSensitiveValue.toUpperCase() === 'YES';
            break;

          case 'essay':
            const wordLimitValue = getCellValue(row, 'Word Limit');
            previewItem.data.wordLimit = wordLimitValue ? parseInt(wordLimitValue) : null;
            previewItem.data.rubric = getCellValue(row, 'Rubric/Scoring Guide') || null;
            break;

          case 'coding':
            const languageValue = getCellValue(row, 'Language');
            previewItem.data.language = languageValue ? languageValue.toLowerCase() : 'python';
            previewItem.data.starterCode = getCellValue(row, 'Starter Code') || '';
            const solutionCode = getCellValue(row, 'Solution Code');
            if (!solutionCode) {
              previewItem.valid = false;
              previewItem.errors.push('Solution Code is required');
            } else {
              previewItem.data.solutionCode = solutionCode;
            }
            const testCasesValue = getCellValue(row, 'Test Cases');
            if (!testCasesValue) {
              previewItem.valid = false;
              previewItem.errors.push('Test Cases are required');
            } else {
              try {
                previewItem.data.testCases = safeJsonParseArray(testCasesValue);
                if (!Array.isArray(previewItem.data.testCases) || previewItem.data.testCases.length === 0) {
                  previewItem.valid = false;
                  previewItem.errors.push('Test Cases must be valid JSON array');
                }
              } catch (e) {
                previewItem.valid = false;
                previewItem.errors.push('Test Cases must be valid JSON');
              }
            }
            const timeLimitValue = getCellValue(row, 'Time Limit (ms)');
            previewItem.data.timeLimit = parseInt(timeLimitValue) || 1000;
            const memoryLimitValue = getCellValue(row, 'Memory Limit (MB)');
            previewItem.data.memoryLimit = parseInt(memoryLimitValue) || 256;
            break;

          case 'fill_blanks':
            const blankAnswers = [];
            const blank1 = getCellValue(row, 'Answer for BLANK1');
            const blank2 = getCellValue(row, 'Answer for BLANK2');
            const blank3 = getCellValue(row, 'Answer for BLANK3');
            const blank4 = getCellValue(row, 'Answer for BLANK4');

            if (blank1) blankAnswers.push(blank1);
            if (blank2) blankAnswers.push(blank2);
            if (blank3) blankAnswers.push(blank3);
            if (blank4) blankAnswers.push(blank4);

            if (blankAnswers.length === 0) {
              previewItem.valid = false;
              previewItem.errors.push('At least one blank answer is required');
            }
            previewItem.data.correctAnswers = blankAnswers;
            const fillBlanksCaseSensitive = getCellValue(row, 'Case Sensitive');
            previewItem.data.caseSensitive = fillBlanksCaseSensitive.toUpperCase() === 'YES';
            break;
        }

        previewItem.data.explanation = getCellValue(row, 'Explanation') || null;

      } catch (error) {
        previewItem.valid = false;
        previewItem.errors.push(error.message || 'Unknown error');
      }

      previewData.push(previewItem);
    }

    const validCount = previewData.filter(item => item.valid).length;
    const invalidCount = previewData.filter(item => !item.valid).length;

    res.json({
      success: true,
      data: {
        total: previewData.length,
        valid: validCount,
        invalid: invalidCount,
        questions: previewData
      }
    });

  } catch (error) {
    console.error('Preview bulk upload error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to parse Excel file',
      error: error.message
    });
  }
};

// Bulk upload questions from Excel (after confirmation)
export const bulkUploadQuestions = async (req, res) => {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    if (!req.file) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    const { question_type } = req.body;
    if (!question_type) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: 'Question type is required'
      });
    }

    // Parse Excel file
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(worksheet, { defval: '', raw: false, blankrows: false });

    // Normalize column names - trim spaces and handle case variations
    const normalizeColumnName = (name) => {
      if (!name) return '';
      return String(name).trim();
    };

    // Normalize all column names in rows
    const normalizedRows = rows.map(row => {
      const normalized = {};
      for (const key in row) {
        const normalizedKey = normalizeColumnName(key);
        const value = row[key];
        // Trim string values
        normalized[normalizedKey] = typeof value === 'string' ? value.trim() : value;
      }
      return normalized;
    });

    if (normalizedRows.length === 0) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: 'Excel file is empty'
      });
    }

    const results = {
      total: normalizedRows.length,
      success: 0,
      failed: 0,
      errors: []
    };

    const created_by = req.user.id;
    const college_id = req.user.college_id;
    let serialNumberCounter = 1; // Auto-generate serial numbers starting from 1

    // Cache to prevent duplicate category/subcategory creation
    const categoryCache = new Map(); // key: categoryName, value: categoryId
    const subcategoryCache = new Map(); // key: `${categoryId}_${subcategoryName}`, value: subcategoryId

    // Helper function to safely get cell value
    const getCellValue = (row, columnName) => {
      // Try exact match first
      if (row[columnName] !== undefined) {
        const value = row[columnName];
        return typeof value === 'string' ? value.trim() : (value || '');
      }
      // Try case-insensitive match
      const lowerColumnName = columnName.toLowerCase();
      for (const key in row) {
        if (key.toLowerCase() === lowerColumnName) {
          const value = row[key];
          return typeof value === 'string' ? value.trim() : (value || '');
        }
      }
      return '';
    };

    // Helper function to get or create category (with caching)
    const getOrCreateCategory = async (categoryName) => {
      if (!categoryName) return null;

      const cacheKey = categoryName.toLowerCase();
      if (categoryCache.has(cacheKey)) {
        return categoryCache.get(cacheKey);
      }

      const [categories] = await connection.execute(
        'SELECT id FROM question_categories WHERE name = ? AND parent_id IS NULL AND college_id = ?',
        [categoryName, college_id]
      );

      if (categories.length > 0) {
        categoryCache.set(cacheKey, categories[0].id);
        return categories[0].id;
      } else {
        // Create category
        const categoryId = crypto.randomUUID();
        await connection.execute(
          'INSERT INTO question_categories (id, name, description, parent_id, color, created_by, college_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [categoryId, categoryName, '', null, '#3B82F6', created_by, college_id]
        );
        categoryCache.set(cacheKey, categoryId);
        return categoryId;
      }
    };

    // Helper function to get or create subcategory (with caching)
    const getOrCreateSubcategory = async (subcategoryName, parentCategoryId) => {
      if (!subcategoryName || !parentCategoryId) return null;

      const cacheKey = `${parentCategoryId}_${subcategoryName.toLowerCase()}`;
      if (subcategoryCache.has(cacheKey)) {
        return subcategoryCache.get(cacheKey);
      }

      const [subcategories] = await connection.execute(
        'SELECT id FROM question_categories WHERE name = ? AND parent_id = ? AND college_id = ?',
        [subcategoryName, parentCategoryId, college_id]
      );

      if (subcategories.length > 0) {
        subcategoryCache.set(cacheKey, subcategories[0].id);
        return subcategories[0].id;
      } else {
        // Create subcategory
        const subcategoryId = crypto.randomUUID();
        await connection.execute(
          'INSERT INTO question_categories (id, name, description, parent_id, color, created_by, college_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [subcategoryId, subcategoryName, '', parentCategoryId, '#3B82F6', created_by, college_id]
        );
        subcategoryCache.set(cacheKey, subcategoryId);
        return subcategoryId;
      }
    };

    // Process each row
    for (let i = 0; i < normalizedRows.length; i++) {
      const row = normalizedRows[i];
      const rowNumber = i + 2; // +2 because Excel is 1-indexed and we have header row
      const autoSerialNumber = serialNumberCounter++;

      try {
        // Validate required fields using helper function
        const contentQuestion = getCellValue(row, 'Content/Question');
        if (!contentQuestion) {
          results.failed++;
          results.errors.push({
            row: rowNumber,
            serialNumber: autoSerialNumber,
            error: 'Content/Question is required'
          });
          continue;
        }

        // Title is only required for coding questions
        if (question_type === 'coding') {
          const title = getCellValue(row, 'Title');
          if (!title) {
            results.failed++;
            results.errors.push({
              row: rowNumber,
              serialNumber: autoSerialNumber,
              error: 'Title is required for coding questions'
            });
            continue;
          }
        }

        // Get or create category (using cache to prevent duplicates)
        const categoryName = getCellValue(row, 'Category Name');
        const category_id = categoryName ? await getOrCreateCategory(categoryName) : null;

        // Get or create subcategory (using cache to prevent duplicates)
        const subcategoryName = getCellValue(row, 'Subcategory Name');
        const subcategory_id = (category_id && subcategoryName) ? await getOrCreateSubcategory(subcategoryName, category_id) : null;

        // Parse tags
        let tags = [];
        const tagsValue = getCellValue(row, 'Tags');
        if (tagsValue) {
          tags = tagsValue.split(',').map(tag => tag.trim()).filter(tag => tag);
        }

        // Parse difficulty
        const difficultyValue = getCellValue(row, 'Difficulty Level');
        const difficulty = ['easy', 'medium', 'hard', 'expert'].includes(difficultyValue.toLowerCase())
          ? difficultyValue.toLowerCase()
          : 'medium';

        // Parse points
        const pointsValue = getCellValue(row, 'Points');
        const points = parseInt(pointsValue) || 1;

        // Status is always 'active' for bulk uploaded questions
        const status = 'active';

        // Create question based on type
        const questionId = crypto.randomUUID();
        let options = null;
        let correct_answer = null;
        let correct_answers = null;
        let metadata = {};

        switch (question_type) {
          case 'multiple_choice':
            const optionListMC = [];
            const optionAMC = getCellValue(row, 'Option A');
            const optionBMC = getCellValue(row, 'Option B');
            const optionCMC = getCellValue(row, 'Option C');
            const optionDMC = getCellValue(row, 'Option D');
            const optionEMC = getCellValue(row, 'Option E');

            if (optionAMC) optionListMC.push({ label: 'A', text: optionAMC });
            if (optionBMC) optionListMC.push({ label: 'B', text: optionBMC });
            if (optionCMC) optionListMC.push({ label: 'C', text: optionCMC });
            if (optionDMC) optionListMC.push({ label: 'D', text: optionDMC });
            if (optionEMC) optionListMC.push({ label: 'E', text: optionEMC });

            if (optionListMC.length < 2) {
              throw new Error('At least 2 options are required');
            }

            options = optionListMC;
            const correctAnswersValueMC = getCellValue(row, 'Correct Answer(s)');
            const correctAnswersMC = correctAnswersValueMC ? correctAnswersValueMC.split(',').map(a => a.trim().toUpperCase()).filter(a => a) : [];
            if (correctAnswersMC.length === 0) {
              throw new Error('Correct Answer(s) is required');
            }
            correct_answers = correctAnswersMC;
            break;

          case 'single_choice':
            const optionListSC = [];
            const optionASC = getCellValue(row, 'Option A');
            const optionBSC = getCellValue(row, 'Option B');
            const optionCSC = getCellValue(row, 'Option C');
            const optionDSC = getCellValue(row, 'Option D');
            const optionESC = getCellValue(row, 'Option E');

            if (optionASC) optionListSC.push({ label: 'A', text: optionASC });
            if (optionBSC) optionListSC.push({ label: 'B', text: optionBSC });
            if (optionCSC) optionListSC.push({ label: 'C', text: optionCSC });
            if (optionDSC) optionListSC.push({ label: 'D', text: optionDSC });
            if (optionESC) optionListSC.push({ label: 'E', text: optionESC });

            if (optionListSC.length < 2) {
              throw new Error('At least 2 options are required');
            }

            options = optionListSC;
            const correctAnswerValueSC = getCellValue(row, 'Correct Answer(s)');
            if (!correctAnswerValueSC) {
              throw new Error('Correct Answer is required');
            }
            // For single_choice, take the first answer and store in correct_answer (not correct_answers)
            const correctAnswerSC = correctAnswerValueSC.split(',')[0].trim().toUpperCase();
            if (!correctAnswerSC) {
              throw new Error('Correct Answer is required');
            }
            // Validate that the answer is one of the option labels
            const validLabels = optionListSC.map(opt => opt.label);
            if (!validLabels.includes(correctAnswerSC)) {
              throw new Error(`Correct Answer must be one of: ${validLabels.join(', ')}`);
            }
            correct_answer = correctAnswerSC;
            correct_answers = null; // Single choice uses correct_answer, not correct_answers
            break;

          case 'true_false':
            const tfAnswerValue = getCellValue(row, 'Correct Answer');
            const tfAnswer = tfAnswerValue.toUpperCase();
            if (tfAnswer !== 'TRUE' && tfAnswer !== 'FALSE') {
              throw new Error('Correct Answer must be TRUE or FALSE');
            }
            correct_answer = tfAnswer === 'TRUE';
            break;

          case 'short_answer':
            const saAnswersValue = getCellValue(row, 'Correct Answer(s)');
            const saAnswers = saAnswersValue ? saAnswersValue.split(',').map(a => a.trim()).filter(a => a) : [];
            if (saAnswers.length === 0) {
              throw new Error('At least one correct answer is required');
            }
            correct_answers = saAnswers;
            const caseSensitiveValue = getCellValue(row, 'Case Sensitive');
            metadata.caseSensitive = caseSensitiveValue.toUpperCase() === 'YES';
            break;

          case 'essay':
            const wordLimitValue = getCellValue(row, 'Word Limit');
            if (wordLimitValue) {
              metadata.wordLimit = parseInt(wordLimitValue) || null;
            }
            const rubricValue = getCellValue(row, 'Rubric/Scoring Guide');
            if (rubricValue) {
              metadata.rubric = rubricValue;
            }
            break;

          case 'coding':
            const languageValue = getCellValue(row, 'Language');
            const language = languageValue ? languageValue.toLowerCase() : 'python';
            const testCasesValue = getCellValue(row, 'Test Cases');
            const testCases = testCasesValue ? safeJsonParseArray(testCasesValue) : [];

            const solutionCode = getCellValue(row, 'Solution Code');
            if (!solutionCode) {
              throw new Error('Solution Code is required for coding questions');
            }
            if (testCases.length === 0) {
              throw new Error('Test Cases are required for coding questions');
            }

            metadata.language = language;
            metadata.starterCode = getCellValue(row, 'Starter Code') || '';
            metadata.solutionCode = solutionCode;
            metadata.testCases = testCases;
            const timeLimitValue = getCellValue(row, 'Time Limit (ms)');
            metadata.timeLimit = parseInt(timeLimitValue) || 1000;
            const memoryLimitValue = getCellValue(row, 'Memory Limit (MB)');
            metadata.memoryLimit = parseInt(memoryLimitValue) || 256;
            break;

          case 'fill_blanks':
            const blankAnswers = [];
            const blank1 = getCellValue(row, 'Answer for BLANK1');
            const blank2 = getCellValue(row, 'Answer for BLANK2');
            const blank3 = getCellValue(row, 'Answer for BLANK3');
            const blank4 = getCellValue(row, 'Answer for BLANK4');

            if (blank1) blankAnswers.push(blank1);
            if (blank2) blankAnswers.push(blank2);
            if (blank3) blankAnswers.push(blank3);
            if (blank4) blankAnswers.push(blank4);

            if (blankAnswers.length === 0) {
              throw new Error('At least one blank answer is required');
            }

            correct_answers = blankAnswers;
            const fillBlanksCaseSensitive = getCellValue(row, 'Case Sensitive');
            metadata.caseSensitive = fillBlanksCaseSensitive.toUpperCase() === 'YES';
            break;
        }

        // Auto-generate title if not provided (for non-coding questions)
        // For coding questions, title is required and validated above
        let questionTitle = getCellValue(row, 'Title') || null;
        if (!questionTitle && question_type !== 'coding') {
          // Generate title from content (first 50 characters)
          const contentPreview = contentQuestion.substring(0, 50).trim();
          questionTitle = contentPreview.length < contentQuestion.length
            ? contentPreview + '...'
            : contentPreview;
        }

        // Prepare values for insertion - ensure proper JSON encoding
        // For JSON columns in MySQL, we need to stringify the values
        // But we need to be careful with types:
        // - Strings should be stored as JSON strings
        // - Booleans should be stored as JSON booleans
        // - Arrays should be stored as JSON arrays
        let correctAnswerValue = null;
        if (correct_answer !== null && correct_answer !== undefined) {
          // For booleans, JSON.stringify will convert true -> "true" (string)
          // MySQL JSON column will parse this back to boolean true
          // For strings, JSON.stringify will add quotes, MySQL will parse correctly
          correctAnswerValue = JSON.stringify(correct_answer);
        }

        let correctAnswersValue = null;
        if (correct_answers !== null && correct_answers !== undefined && Array.isArray(correct_answers)) {
          correctAnswersValue = JSON.stringify(correct_answers);
        }

        // Insert question
        await connection.execute(
          `INSERT INTO questions (
            id, title, content, question_type, difficulty_level, points,
            category_id, subcategory_id, tags, options, correct_answer,
            correct_answers, explanation, metadata, status, created_by, college_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            questionId,
            questionTitle,
            contentQuestion,
            question_type,
            difficulty,
            points,
            category_id,
            subcategory_id,
            Array.isArray(tags) ? JSON.stringify(tags) : null,
            options && Array.isArray(options) ? JSON.stringify(options) : null,
            correctAnswerValue,
            correctAnswersValue,
            getCellValue(row, 'Explanation') || null,
            Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : null,
            status,
            created_by,
            college_id
          ]
        );

        // If coding question, insert coding details
        if (question_type === 'coding' && metadata.language) {
          const codingQuestionId = crypto.randomUUID();
          await connection.execute(
            `INSERT INTO coding_questions (
              id, question_id, language, starter_code, solution_code,
              test_cases, time_limit, memory_limit, difficulty, category, tags
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              codingQuestionId,
              questionId,
              metadata.language,
              metadata.starterCode || '',
              metadata.solutionCode,
              JSON.stringify(metadata.testCases),
              metadata.timeLimit,
              metadata.memoryLimit,
              difficulty,
              null,
              JSON.stringify(tags)
            ]
          );
        }

        results.success++;

      } catch (error) {
        results.failed++;
        results.errors.push({
          row: rowNumber,
          serialNumber: autoSerialNumber,
          error: error.message || 'Unknown error'
        });
        // Continue processing other rows
      }
    }

    await connection.commit();

    res.json({
      success: true,
      message: `Bulk upload completed: ${results.success} successful, ${results.failed} failed`,
      data: results
    });

  } catch (error) {
    await connection.rollback();
    console.error('Bulk upload error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process bulk upload',
      error: error.message
    });
  } finally {
    connection.release();
  }
};