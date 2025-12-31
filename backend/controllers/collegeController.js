import { pool } from '../config/database.js';
import crypto from 'crypto';
import cache from '../utils/cache.js';

// Batch Management Functions
export const createBatch = async (req, res) => {
  try {
    const { college_id, name, code, description, start_year, end_year } = req.body;

    if (!college_id || !name || !code) {
      return res.status(400).json({
        success: false,
        message: 'College ID, name, and code are required'
      });
    }

    // Check if college exists
    const [college] = await pool.query('SELECT id FROM colleges WHERE id = ? AND is_active = true', [college_id]);
    if (college.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'College not found'
      });
    }

    // Check if batch code already exists for this college
    const [existing] = await pool.query(
      'SELECT id FROM batches WHERE college_id = ? AND code = ? AND is_active = true',
      [college_id, code]
    );

    if (existing.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Batch code already exists for this college'
      });
    }

    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO batches (id, college_id, name, code, description, start_year, end_year) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, college_id, name, code, description || null, start_year || null, end_year || null]
    );

    res.json({
      success: true,
      message: 'Batch created successfully',
      data: { id, name, code }
    });
  } catch (error) {
    // console.error('Error creating batch:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create batch',
      error: error.message
    });
  }
};

export const getBatches = async (req, res) => {
  try {
    const { college_id } = req.query;

    let sql = 'SELECT * FROM batches WHERE is_active = true';
    let params = [];

    if (college_id) {
      sql += ' AND college_id = ?';
      params.push(college_id);
    }

    sql += ' ORDER BY start_year DESC, name ASC';

    const [batches] = await pool.query(sql, params);

    res.json({
      success: true,
      data: batches
    });
  } catch (error) {
    // console.error('Error getting batches:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get batches',
      error: error.message
    });
  }
};

export const updateBatch = async (req, res) => {
  try {
    const { batchId } = req.params;
    const { name, code, description, start_year, end_year, is_active } = req.body;

    const [batch] = await pool.query('SELECT * FROM batches WHERE id = ?', [batchId]);
    if (batch.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Batch not found'
      });
    }

    // Check if code already exists for other batches in the same college
    if (code && code !== batch[0].code) {
      const [existing] = await pool.query(
        'SELECT id FROM batches WHERE college_id = ? AND code = ? AND id != ? AND is_active = true',
        [batch[0].college_id, code, batchId]
      );

      if (existing.length > 0) {
        return res.status(400).json({
          success: false,
          message: 'Batch code already exists for this college'
        });
      }
    }

    await pool.query(
      `UPDATE batches SET name = ?, code = ?, description = ?, start_year = ?, end_year = ?, is_active = ? WHERE id = ?`,
      [name || batch[0].name, code || batch[0].code, description || batch[0].description,
      start_year || batch[0].start_year, end_year || batch[0].end_year,
      is_active !== undefined ? is_active : batch[0].is_active, batchId]
    );

    res.json({
      success: true,
      message: 'Batch updated successfully'
    });
  } catch (error) {
    // console.error('Error updating batch:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update batch',
      error: error.message
    });
  }
};

export const deleteBatch = async (req, res) => {
  try {
    const { batchId } = req.params;

    // Check if batch is being used by any students
    const [students] = await pool.query(
      'SELECT COUNT(*) as count FROM users WHERE batch = (SELECT code FROM batches WHERE id = ?) AND is_active = true',
      [batchId]
    );

    if (students[0].count > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete batch. ${students[0].count} student(s) are currently assigned to this batch.`
      });
    }

    await pool.query('UPDATE batches SET is_active = false WHERE id = ?', [batchId]);

    res.json({
      success: true,
      message: 'Batch deleted successfully'
    });
  } catch (error) {
    // console.error('Error deleting batch:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete batch',
      error: error.message
    });
  }
};

// Get all colleges with statistics
export const getAllColleges = async (req, res) => {
  // PERFORMANCE FIX: Cache colleges list based on query parameters
  const { page = 1, limit = 10, search, city, state, country, is_active } = req.query;
  const cacheKey = `colleges_list_${page}_${limit}_${search || 'none'}_${city || 'none'}_${state || 'none'}_${country || 'none'}_${is_active || 'none'}`;
  const cached = cache.get(cacheKey);
  if (cached !== null) {
    return res.json(cached);
  }

  try {
    // Ensure proper type conversion and validation
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.max(1, Math.min(100, parseInt(limit) || 10)); // Max 100 per page
    const offset = (pageNum - 1) * limitNum;

    let whereClause = 'WHERE c.is_active = true';
    let params = [];

    if (search && search.trim() !== '') {
      whereClause += ' AND (c.name LIKE ? OR c.code LIKE ? OR c.email LIKE ?)';
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm);
    }

    if (city && city.trim() !== '') {
      whereClause += ' AND c.city LIKE ?';
      params.push(`%${city}%`);
    }

    if (state && state.trim() !== '') {
      whereClause += ' AND c.state LIKE ?';
      params.push(`%${state}%`);
    }

    if (country && country.trim() !== '') {
      whereClause += ' AND c.country LIKE ?';
      params.push(`%${country}%`);
    }

    if (is_active !== undefined && is_active !== '') {
      whereClause += ' AND c.is_active = ?';
      params.push(is_active === 'true' ? 1 : 0);
    }

    // PERFORMANCE FIX: Use LEFT JOINs with GROUP BY instead of subqueries for better performance
    // This avoids executing 5 subqueries per row and uses indexes more efficiently
    const sql = `SELECT 
      c.id, c.name, c.code, c.address, c.city, c.state, c.country, 
      c.postal_code, c.phone, c.email, c.website, c.logo_url, 
      c.established_year, c.accreditation, c.description, 
      c.is_active, c.created_at, c.updated_at,
      COALESCE(COUNT(DISTINCT CASE WHEN u.is_active = true THEN u.id END), 0) as total_users,
      COALESCE(COUNT(DISTINCT CASE WHEN u.role = 'faculty' AND u.is_active = true THEN u.id END), 0) as faculty_count,
      COALESCE(COUNT(DISTINCT CASE WHEN u.role = 'student' AND u.is_active = true THEN u.id END), 0) as student_count,
      COALESCE(COUNT(DISTINCT CASE WHEN cd.is_active = true THEN cd.id END), 0) as department_count,
      COALESCE(COUNT(DISTINCT CASE WHEN b.is_active = true THEN b.id END), 0) as batch_count
       FROM colleges c
       LEFT JOIN users u ON u.college_id = c.id
       LEFT JOIN college_departments cd ON cd.college_id = c.id
       LEFT JOIN batches b ON b.college_id = c.id
       ${whereClause}
       GROUP BY c.id, c.name, c.code, c.address, c.city, c.state, c.country, 
                c.postal_code, c.phone, c.email, c.website, c.logo_url, 
                c.established_year, c.accreditation, c.description, 
                c.is_active, c.created_at, c.updated_at
       ORDER BY c.created_at DESC
       LIMIT ? OFFSET ?`;

    // Always include limit and offset parameters - ensure they are numbers
    const sqlParams = [...params, Number(limitNum), Number(offset)];
    const [colleges] = await pool.query(sql, sqlParams);

    // Get total count
    const countSql = `SELECT COUNT(*) as total FROM colleges c ${whereClause}`;
    const [countResult] = await pool.query(countSql, params);

    const total = countResult[0].total;
    const totalPages = Math.ceil(total / limitNum);

    const response = {
      success: true,
      data: {
        colleges,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages
        }
      }
    };

    // Cache for 1 minute (colleges list changes infrequently)
    cache.set(cacheKey, response, 60 * 1000);

    res.json(response);

  } catch (error) {
    // console.error('Error getting colleges:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get colleges',
      error: error.message
    });
  }
};

// Get college details with contact persons and departments
export const getCollegeDetails = async (req, res) => {
  try {
    const { collegeId } = req.params;

    if (!collegeId) {
      return res.status(400).json({
        success: false,
        message: 'College ID is required'
      });
    }

    // Get college basic info
    const [colleges] = await pool.execute(
      'SELECT * FROM colleges WHERE id = ? AND is_active = true',
      [collegeId]
    );

    if (colleges.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'College not found'
      });
    }

    const college = colleges[0];

    // Get contact persons
    const [contactPersons] = await pool.execute(
      'SELECT * FROM contact_persons WHERE college_id = ? AND is_active = true ORDER BY is_primary DESC, created_at ASC',
      [collegeId]
    );

    // Get departments
    const [departments] = await pool.execute(
      'SELECT * FROM college_departments WHERE college_id = ? AND is_active = true ORDER BY created_at ASC',
      [collegeId]
    );

    // Get user counts
    const [userCounts] = await pool.execute(`
      SELECT 
        COUNT(*) as total_users,
        SUM(CASE WHEN role = 'faculty' THEN 1 ELSE 0 END) as faculty_count,
        SUM(CASE WHEN role = 'student' THEN 1 ELSE 0 END) as student_count
      FROM users 
      WHERE college_id = ? AND is_active = true
    `, [collegeId]);

    const collegeData = {
      ...college,
      contact_persons: contactPersons,
      departments: departments,
      total_users: userCounts[0]?.total_users || 0,
      faculty_count: userCounts[0]?.faculty_count || 0,
      student_count: userCounts[0]?.student_count || 0
    };

    res.json({
      success: true,
      data: collegeData
    });

  } catch (error) {
    // console.error('Error getting college details:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get college details',
      error: error.message
    });
  }
};

// Get college by ID with detailed statistics
export const getCollegeById = async (req, res) => {
  try {
    const { collegeId } = req.params;

    if (!collegeId) {
      return res.status(400).json({
        success: false,
        message: 'College ID is required'
      });
    }

    const [colleges] = await pool.execute(`
      SELECT c.*, 
              (SELECT COUNT(*) FROM users WHERE college_id = c.id AND is_active = true) as total_users,
              (SELECT COUNT(*) FROM users WHERE college_id = c.id AND role = 'faculty' AND is_active = true) as faculty_count,
              (SELECT COUNT(*) FROM users WHERE college_id = c.id AND role = 'student' AND is_active = true) as student_count,
              (SELECT COUNT(*) FROM college_departments WHERE college_id = c.id AND is_active = true) as department_count
       FROM colleges c
      WHERE c.id = ? AND c.is_active = true
    `, [collegeId]);

    if (colleges.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'College not found'
      });
    }

    const college = colleges[0];

    // Get recent users for this college
    const [recentUsers] = await pool.query(`
      SELECT id, name, email, role, created_at
       FROM users 
       WHERE college_id = ? AND is_active = true 
       ORDER BY created_at DESC 
      LIMIT 5
    `, [collegeId]);

    college.recentUsers = recentUsers;

    // Get recent departments for this college
    const [recentDepartments] = await pool.query(`
      SELECT id, name, description, created_at
      FROM departments
      WHERE college_id = ? AND is_active = true
      ORDER BY created_at DESC
      LIMIT 5
    `, [id]);

    college.recentDepartments = recentDepartments;

    res.json({
      success: true,
      data: college
    });

  } catch (error) {
    // console.error('Error getting college:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get college'
    });
  }
};

// Create new college
export const createCollege = async (req, res) => {
  try {
    const {
      name,
      code,
      email,
      phone,
      address,
      city,
      state,
      country,
      postal_code,
      website,
      logo_url,
      established_year,
      accreditation,
      description,
      contact_persons,
      departments,
      batches
    } = req.body;

    // Validate required fields
    if (!name || !code || !email) {
      return res.status(400).json({
        success: false,
        message: 'Name, code, and email are required'
      });
    }

    // Validate contact persons (at least one required)
    if (!contact_persons || !Array.isArray(contact_persons) || contact_persons.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'At least one contact person is required'
      });
    }

    // Validate each contact person has required fields
    for (const contact of contact_persons) {
      if (!contact.name || !contact.phone || !contact.email) {
        return res.status(400).json({
          success: false,
          message: 'Contact person name, phone, and email are required'
        });
      }
    }

    // Check if college code already exists
    const [existing] = await pool.execute(
      'SELECT id FROM colleges WHERE code = ? AND is_active = true',
      [code]
    );

    if (existing.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'College code already exists'
      });
    }

    // Start transaction
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      // Generate UUID for the college
      const collegeId = crypto.randomUUID();
      // console.log('Generated college ID:', collegeId);

      // Insert new college
      const [result] = await connection.execute(`
        INSERT INTO colleges (
          id, name, code, email, phone, address, city, state, country, postal_code,
          website, logo_url, established_year, accreditation, description
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        collegeId, name, code, email, phone, address, city, state, country, postal_code,
        website, logo_url, established_year, accreditation, description
      ]);

      // console.log('College inserted successfully, result:', result);

      // Insert contact persons
      for (let i = 0; i < contact_persons.length; i++) {
        const contact = contact_persons[i];
        const contactId = crypto.randomUUID();
        // console.log(`Inserting contact person ${i + 1}:`, { contactId, collegeId, contact });

        await connection.execute(`
          INSERT INTO contact_persons (
            id, college_id, name, phone, email, designation, is_primary
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [
          contactId, collegeId, contact.name, contact.phone, contact.email,
          contact.designation || null, i === 0 // First contact is primary
        ]);

        // console.log(`Contact person ${i + 1} inserted successfully`);
      }

      // Insert departments if provided
      if (departments && Array.isArray(departments) && departments.length > 0) {
        for (const dept of departments) {
          if (dept.name && dept.code) {
            const deptId = crypto.randomUUID();
            // console.log('Inserting department:', { deptId, collegeId, dept });

            await connection.execute(`
              INSERT INTO college_departments (
                id, college_id, name, code, description
              ) VALUES (?, ?, ?, ?, ?)
            `, [deptId, collegeId, dept.name, dept.code, dept.description || null]);

            // console.log('Department inserted successfully');
          }
        }
      }

      // Insert batches if provided
      if (batches && Array.isArray(batches) && batches.length > 0) {
        for (const batch of batches) {
          if (batch.name && batch.code) {
            const batchId = crypto.randomUUID();
            // console.log('Inserting batch:', { batchId, collegeId, batch });

            await connection.execute(`
              INSERT INTO batches (
                id, college_id, name, code, description
              ) VALUES (?, ?, ?, ?, ?)
            `, [batchId, collegeId, batch.name, batch.code, batch.description || null]);

            // console.log('Batch inserted successfully');
          }
        }
      }

      await connection.commit();

      res.status(201).json({
        success: true,
        message: 'College created successfully',
        data: { id: collegeId }
      });

    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

  } catch (error) {
    // console.error('Error creating college:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create college'
    });
  }
};

// Update college
export const updateCollege = async (req, res) => {
  try {
    const { collegeId } = req.params;
    const {
      name,
      code,
      email,
      phone,
      address,
      city,
      state,
      country,
      postal_code,
      website,
      logo_url,
      established_year,
      accreditation,
      description,
      contact_persons,
      departments
    } = req.body;

    // Check if college exists
    const [existing] = await pool.execute(
      'SELECT id FROM colleges WHERE id = ? AND is_active = true',
      [collegeId]
    );

    if (existing.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'College not found'
      });
    }

    // Check if code is being changed and if it already exists
    if (code) {
      const [codeExists] = await pool.execute(
        'SELECT id FROM colleges WHERE code = ? AND id != ? AND is_active = true',
        [code, collegeId]
      );

      if (codeExists.length > 0) {
        return res.status(400).json({
          success: false,
          message: 'College code already exists'
        });
      }
    }

    // Start transaction
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      // Update college basic info
      await connection.execute(`
        UPDATE colleges 
        SET name = ?, code = ?, email = ?, phone = ?, address = ?, city = ?, state = ?, 
            country = ?, postal_code = ?, website = ?, logo_url = ?, established_year = ?, 
            accreditation = ?, description = ?, updated_at = NOW()
        WHERE id = ?
      `, [
        name, code, email, phone, address, city, state, country, postal_code,
        website, logo_url, established_year, accreditation, description, collegeId
      ]);

      // Update contact persons - first deactivate all existing ones
      await connection.execute(
        'UPDATE contact_persons SET is_active = false WHERE college_id = ?',
        [collegeId]
      );

      // Insert new contact persons
      if (contact_persons && Array.isArray(contact_persons) && contact_persons.length > 0) {
        for (let i = 0; i < contact_persons.length; i++) {
          const contact = contact_persons[i];
          if (contact.name && contact.phone && contact.email) {
            const contactId = crypto.randomUUID();
            await connection.execute(`
              INSERT INTO contact_persons (
                id, college_id, name, phone, email, designation, is_primary
              ) VALUES (?, ?, ?, ?, ?, ?, ?)
            `, [
              contactId, collegeId, contact.name, contact.phone, contact.email,
              contact.designation || null, i === 0 // First contact is primary
            ]);
          }
        }
      }

      // Update departments - handle existing ones properly
      if (departments && Array.isArray(departments) && departments.length > 0) {
        // First, get existing departments for this college
        const [existingDepts] = await connection.execute(
          'SELECT id, code FROM college_departments WHERE college_id = ?',
          [collegeId]
        );

        // Create a map of existing department codes to their IDs
        const existingDeptMap = new Map(existingDepts.map(dept => [dept.code, dept.id]));

        // Process each department
        for (const dept of departments) {
          if (dept.name && dept.code) {
            if (existingDeptMap.has(dept.code)) {
              // Update existing department
              const existingDeptId = existingDeptMap.get(dept.code);
              await connection.execute(`
                UPDATE college_departments 
                SET name = ?, description = ?, is_active = true, updated_at = NOW()
                WHERE id = ?
              `, [dept.name, dept.description || null, existingDeptId]);

              // Remove from map to track which ones we've processed
              existingDeptMap.delete(dept.code);
            } else {
              // Insert new department
              const deptId = crypto.randomUUID();
              await connection.execute(`
                INSERT INTO college_departments (
                  id, college_id, name, code, description
                ) VALUES (?, ?, ?, ?, ?)
              `, [deptId, collegeId, dept.name, dept.code, dept.description || null]);
            }
          }
        }

        // Deactivate any remaining existing departments that weren't updated
        if (existingDeptMap.size > 0) {
          const remainingDeptIds = Array.from(existingDeptMap.values());
          const placeholders = remainingDeptIds.map(() => '?').join(',');
          await connection.execute(
            `UPDATE college_departments SET is_active = false WHERE id IN (${placeholders})`,
            remainingDeptIds
          );
        }
      } else {
        // If no departments provided, deactivate all existing ones
        await connection.execute(
          'UPDATE college_departments SET is_active = false WHERE college_id = ?',
          [collegeId]
        );
      }

      await connection.commit();

      res.json({
        success: true,
        message: 'College updated successfully'
      });

    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

  } catch (error) {
    // console.error('Error updating college:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update college'
    });
  }
};

// Delete college (Hard delete by default - actually removes data from database)
export const deleteCollege = async (req, res) => {
  try {
    const { collegeId } = req.params;
    const { softDelete = false } = req.query; // Allow soft delete option

    if (!collegeId) {
      return res.status(400).json({
        success: false,
        message: 'College ID is required'
      });
    }

    // Check if college exists
    const [existing] = await pool.execute(
      'SELECT id, name, code FROM colleges WHERE id = ?',
      [collegeId]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'College not found'
      });
    }

    const college = existing[0];
    const collegeName = college.name;
    const collegeCode = college.code;

    // Check if college is already deleted
    if (college.is_active === 0 || college.is_active === false || college.is_active === '0') {
      return res.status(400).json({
        success: false,
        message: 'College is already deleted'
      });
    }

    // Check if college has active users
    const [activeUsers] = await pool.query(
      'SELECT COUNT(*) as count FROM users WHERE college_id = ? AND is_active = true',
      [collegeId]
    );

    if (activeUsers[0].count > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete college with active users. Please deactivate users first.',
        userCount: activeUsers[0].count
      });
    }

    // Check if college has active departments
    const [activeDepartments] = await pool.query(
      'SELECT COUNT(*) as count FROM departments WHERE college_id = ? AND is_active = true',
      [collegeId]
    );

    if (activeDepartments[0].count > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete college with active departments. Please deactivate departments first.',
        departmentCount: activeDepartments[0].count
      });
    }

    // Start transaction for data cleanup
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      if (softDelete) {
        // Soft delete - mark as inactive and set deletion timestamp
        await connection.execute(
          'UPDATE colleges SET is_active = false, deleted_at = CURRENT_TIMESTAMP WHERE id = ?',
          [collegeId]
        );

        // Clean up user references
        await connection.execute(
          'UPDATE users SET college_id = NULL WHERE college_id = ?',
          [collegeId]
        );

        // Clean up department references
        await connection.execute(
          'UPDATE departments SET is_active = false WHERE college_id = ?',
          [collegeId]
        );

        res.json({
          success: true,
          message: `College "${collegeName}" soft deleted successfully. College code "${collegeCode}" can now be reused.`,
          deletionType: 'soft',
          collegeCode: collegeCode,
          canReuseCode: true,
          cleanupDetails: {
            collegeSoftDeleted: true,
            usersCleaned: true,
            departmentsCleaned: true
          }
        });
      } else {
        // Hard delete - permanently remove all data (DEFAULT BEHAVIOR)
        await connection.execute(
          'DELETE FROM users WHERE college_id = ?',
          [collegeId]
        );

        await connection.execute(
          'DELETE FROM departments WHERE college_id = ?',
          [collegeId]
        );

        await connection.execute(
          'DELETE FROM college_departments WHERE college_id = ?',
          [collegeId]
        );

        await connection.execute(
          'DELETE FROM colleges WHERE id = ?',
          [collegeId]
        );

        res.json({
          success: true,
          message: `College "${collegeName}" permanently deleted. All related data has been removed from database.`,
          deletionType: 'hard',
          collegeCode: collegeCode,
          cleanupDetails: {
            collegeDeleted: true,
            usersRemoved: true,
            departmentsRemoved: true
          }
        });
      }

      // Commit transaction
      await connection.commit();

    } catch (transactionError) {
      // Rollback transaction on error
      await connection.rollback();
      throw transactionError;
    } finally {
      connection.release();
    }

  } catch (error) {
    // console.error('Error deleting college:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete college',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Soft delete college (mark as inactive but keep data)
export const softDeleteCollege = async (req, res) => {
  try {
    const { collegeId } = req.params;

    if (!collegeId) {
      return res.status(400).json({
        success: false,
        message: 'College ID is required'
      });
    }

    // Check if college exists
    const [existing] = await pool.execute(
      'SELECT id, name, code FROM colleges WHERE id = ?',
      [collegeId]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'College not found'
      });
    }

    const college = existing[0];
    const collegeName = college.name;
    const collegeCode = college.code;

    // Check if college is already deleted
    if (college.is_active === 0 || college.is_active === false || college.is_active === '0') {
      return res.status(400).json({
        success: false,
        message: 'College is already deleted'
      });
    }

    // Check if college has active users
    const [activeUsers] = await pool.query(
      'SELECT COUNT(*) as count FROM users WHERE college_id = ? AND is_active = true',
      [collegeId]
    );

    if (activeUsers[0].count > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete college with active users. Please deactivate users first.',
        userCount: activeUsers[0].count
      });
    }

    // Check if college has active departments
    const [activeDepartments] = await pool.query(
      'SELECT COUNT(*) as count FROM departments WHERE college_id = ? AND is_active = true',
      [collegeId]
    );

    if (activeDepartments[0].count > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete college with active departments. Please deactivate departments first.',
        departmentCount: activeDepartments[0].count
      });
    }

    // Start transaction for soft delete
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      // Soft delete - mark as inactive and set deletion timestamp
      await connection.execute(
        'UPDATE colleges SET is_active = false, deleted_at = CURRENT_TIMESTAMP WHERE id = ?',
        [collegeId]
      );

      // Clean up user references
      await connection.execute(
        'UPDATE users SET college_id = NULL WHERE college_id = ?',
        [collegeId]
      );

      // Clean up department references
      await connection.execute(
        'UPDATE departments SET is_active = false WHERE college_id = ?',
        [collegeId]
      );

      await connection.commit();

      res.json({
        success: true,
        message: `College "${collegeName}" soft deleted successfully. College code "${collegeCode}" can now be reused.`,
        deletionType: 'soft',
        collegeCode: collegeCode,
        canReuseCode: true,
        cleanupDetails: {
          collegeSoftDeleted: true,
          usersCleaned: true,
          departmentsCleaned: true
        }
      });

    } catch (transactionError) {
      // Rollback transaction on error
      await connection.rollback();
      throw transactionError;
    } finally {
      connection.release();
    }

  } catch (error) {
    // console.error('Error soft deleting college:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to soft delete college',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Get college statistics
export const getCollegeStats = async (req, res) => {
  try {
    const { collegeId } = req.params;

    if (!collegeId) {
      return res.status(400).json({
        success: false,
        message: 'College ID is required'
      });
    }

    // Check if college exists
    const [colleges] = await pool.execute(
      'SELECT id, name FROM colleges WHERE id = ? AND is_active = true',
      [collegeId]
    );

    if (colleges.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'College not found'
      });
    }

    // Get user statistics
    const [userStats] = await pool.query(`
      SELECT 
        COUNT(*) as total_users,
        SUM(CASE WHEN role = 'faculty' THEN 1 ELSE 0 END) as faculty_count,
        SUM(CASE WHEN role = 'student' THEN 1 ELSE 0 END) as student_count,
        SUM(CASE WHEN created_at >= NOW() - INTERVAL '30 days' THEN 1 ELSE 0 END) as new_users_30_days
       FROM users 
      WHERE college_id = ? AND is_active = true
    `, [collegeId]);

    // Get department statistics
    const [departmentStats] = await pool.query(`
      SELECT 
        COUNT(*) as total_departments,
        SUM(CASE WHEN created_at >= NOW() - INTERVAL '7 days' THEN 1 ELSE 0 END) as new_departments_30_days
       FROM college_departments 
      WHERE college_id = ? AND is_active = true
    `, [collegeId]);

    // Get recent activities
    const [recentActivities] = await pool.query(`
      SELECT 
        'user' as type,
        'New user registered' as description,
        created_at
       FROM users 
       WHERE college_id = ? AND created_at >= NOW() - INTERVAL '7 days'
       UNION ALL
       SELECT 
        'department' as type,
        'New department created' as description,
        created_at
      FROM college_departments
       WHERE college_id = ? AND created_at >= NOW() - INTERVAL '7 days'
      ORDER BY created_at DESC
      LIMIT 10
    `, [collegeId, collegeId]);

    res.json({
      success: true,
      data: {
        college: colleges[0],
        userStats: userStats[0],
        departmentStats: departmentStats[0],
        recentActivities
      }
    });

  } catch (error) {
    // console.error('Error getting college stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get college statistics'
    });
  }
};

// Get college locations (for filtering)
export const getCollegeLocations = async (req, res) => {
  try {
    // First check if the new columns exist
    // Note: INFORMATION_SCHEMA queries automatically use direct PostgreSQL connection
    const [columns] = await pool.query(
      `SELECT COLUMN_NAME 
       FROM INFORMATION_SCHEMA.COLUMNS 
       WHERE TABLE_SCHEMA = 'public' 
       AND TABLE_NAME = 'colleges' 
       AND COLUMN_NAME IN ('city', 'state', 'country')`
    );

    const hasNewColumns = columns.length >= 3;

    if (hasNewColumns) {
      const [locations] = await pool.query(
        `SELECT DISTINCT city, state, country 
         FROM colleges 
         WHERE is_active = true 
         AND city IS NOT NULL 
         AND city != ''
         ORDER BY country, state, city`
      );

      res.json({
        success: true,
        data: locations
      });
    } else {
      // Fallback for old schema - return empty array
      res.json({
        success: true,
        data: []
      });
    }
  } catch (error) {
    // console.error('Get college locations error:', error);
    // Return empty array on error to prevent frontend issues
    res.json({
      success: true,
      data: []
    });
  }
};

// Get departments for a specific college
export const getCollegeDepartments = async (req, res) => {
  try {
    const { collegeId } = req.params;

    // Verify college exists
    const [colleges] = await pool.query('SELECT id, name FROM colleges WHERE id = ? AND is_active = true', [collegeId]);
    if (colleges.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'College not found'
      });
    }

    // Get departments for the college
    const [departments] = await pool.query(`
      SELECT id, name, code, description, is_active, created_at, updated_at
      FROM college_departments 
      WHERE college_id = ? AND is_active = true
      ORDER BY name ASC
    `, [collegeId]);

    res.json({
      success: true,
      data: departments
    });

  } catch (error) {
    // console.error('Error getting college departments:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get college departments'
    });
  }
};

// Get batches for a specific college
export const getCollegeBatches = async (req, res) => {
  try {
    const { collegeId } = req.params;

    // Verify college exists
    const [colleges] = await pool.query('SELECT id, name FROM colleges WHERE id = ? AND is_active = true', [collegeId]);
    if (colleges.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'College not found'
      });
    }

    // Get batches for the college
    const [batches] = await pool.query(`
      SELECT id, name, code, description, is_active, created_at, updated_at
      FROM batches 
      WHERE college_id = ? AND is_active = true
      ORDER BY name ASC
    `, [collegeId]);

    res.json({
      success: true,
      data: batches
    });

  } catch (error) {
    // console.error('Error getting college batches:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get college batches'
    });
  }
};

// Get departments for multiple colleges
export const getDepartmentsForColleges = async (req, res) => {
  try {
    const { collegeIds } = req.body;

    if (!collegeIds || !Array.isArray(collegeIds) || collegeIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'College IDs array is required'
      });
    }

    // Get departments for all specified colleges
    const [departments] = await pool.query(`
      SELECT d.id, d.name, d.code, d.description, d.is_active, d.created_at, d.updated_at,
             c.id as college_id, c.name as college_name
      FROM college_departments d
      JOIN colleges c ON d.college_id = c.id
      WHERE d.college_id IN (${collegeIds.map(() => '?').join(',')}) 
      AND d.is_active = true AND c.is_active = true
      ORDER BY c.name ASC, d.name ASC
    `, collegeIds);

    // Group departments by college
    const departmentsByCollege = {};
    departments.forEach(dept => {
      if (!departmentsByCollege[dept.college_id]) {
        departmentsByCollege[dept.college_id] = {
          college_id: dept.college_id,
          college_name: dept.college_name,
          departments: []
        };
      }
      departmentsByCollege[dept.college_id].departments.push({
        id: dept.id,
        name: dept.name,
        code: dept.code,
        description: dept.description,
        is_active: dept.is_active,
        created_at: dept.created_at,
        updated_at: dept.updated_at
      });
    });

    res.json({
      success: true,
      data: Object.values(departmentsByCollege)
    });

  } catch (error) {
    // console.error('Error getting departments for colleges:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get departments for colleges'
    });
  }
};

// Get batches for multiple colleges
export const getBatchesForColleges = async (req, res) => {
  try {
    const { collegeIds } = req.body;

    if (!collegeIds || !Array.isArray(collegeIds) || collegeIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'College IDs array is required'
      });
    }

    // Get batches for all specified colleges
    const [batches] = await pool.query(`
      SELECT b.id, b.name, b.code, b.description, b.is_active, b.created_at, b.updated_at,
             c.id as college_id, c.name as college_name
      FROM batches b
      JOIN colleges c ON b.college_id = c.id
      WHERE b.college_id IN (${collegeIds.map(() => '?').join(',')}) 
      AND b.is_active = true AND c.is_active = true
      ORDER BY c.name ASC, b.name ASC
    `, collegeIds);

    // Group batches by college
    const batchesByCollege = {};
    batches.forEach(batch => {
      if (!batchesByCollege[batch.college_id]) {
        batchesByCollege[batch.college_id] = {
          college_id: batch.college_id,
          college_name: batch.college_name,
          batches: []
        };
      }
      batchesByCollege[batch.college_id].batches.push({
        id: batch.id,
        name: batch.name,
        code: batch.code,
        description: batch.description,
        is_active: batch.is_active,
        created_at: batch.created_at,
        updated_at: batch.updated_at
      });
    });

    res.json({
      success: true,
      data: Object.values(batchesByCollege)
    });

  } catch (error) {
    // console.error('Error getting batches for colleges:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get batches for colleges'
    });
  }
};

// Get common departments for dropdown (used when creating colleges)
export const getCommonDepartments = async (req, res) => {
  try {
    // Get all unique departments from users table
    const [departments] = await pool.query(`
      SELECT DISTINCT department as name, department as code, department as description
      FROM users 
      WHERE department IS NOT NULL 
      AND department != '' 
      AND role = 'student'
      ORDER BY department ASC
    `);

    res.json({
      success: true,
      data: departments
    });

  } catch (error) {
    console.error('Error getting common departments:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get common departments'
    });
  }
};

// Restore deleted college
export const restoreCollege = async (req, res) => {
  try {
    const { collegeId } = req.params;

    if (!collegeId) {
      return res.status(400).json({
        success: false,
        message: 'College ID is required'
      });
    }

    // Check if college exists and is deleted
    const [existing] = await pool.execute(
      'SELECT id, name, code FROM colleges WHERE id = ? AND is_active = false',
      [collegeId]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Deleted college not found'
      });
    }

    const college = existing[0];
    const collegeName = college.name;
    const collegeCode = college.code;

    // Check if the college code is already in use by another active college
    const [codeConflict] = await pool.execute(
      'SELECT id, name FROM colleges WHERE code = ? AND is_active = true AND id != ?',
      [collegeCode, collegeId]
    );

    if (codeConflict.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot restore college. College code "${collegeCode}" is already in use by "${codeConflict[0].name}".`,
        conflictCollege: codeConflict[0]
      });
    }

    // Start transaction
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      // Restore the college
      await connection.execute(
        'UPDATE colleges SET is_active = true, deleted_at = NULL WHERE id = ?',
        [collegeId]
      );

      // Restore departments
      await connection.execute(
        'UPDATE departments SET is_active = true WHERE college_id = ?',
        [collegeId]
      );

      // Commit transaction
      await connection.commit();

      res.json({
        success: true,
        message: `College "${collegeName}" restored successfully.`,
        collegeCode: collegeCode,
        restoredAt: new Date().toISOString()
      });

    } catch (transactionError) {
      await connection.rollback();
      throw transactionError;
    } finally {
      connection.release();
    }

  } catch (error) {
    // console.error('Error restoring college:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to restore college',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Get deleted colleges
export const getDeletedColleges = async (req, res) => {
  try {
    const [deletedColleges] = await pool.execute(
      `SELECT 
        id, name, code, city, state, country, 
        created_at, updated_at, deleted_at,
        CASE 
          WHEN deleted_at IS NOT NULL THEN 'Soft Deleted'
          WHEN is_active = false THEN 'Inactive'
          ELSE 'Unknown'
        END as deletion_status
       FROM colleges 
       WHERE is_active = false OR deleted_at IS NOT NULL
       ORDER BY deleted_at DESC, updated_at DESC`
    );

    res.json({
      success: true,
      data: deletedColleges,
      count: deletedColleges.length
    });

  } catch (error) {
    // console.error('Error getting deleted colleges:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get deleted colleges',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Get college deletion status
export const getCollegeDeletionStatus = async (req, res) => {
  try {
    const { collegeId } = req.params;

    if (!collegeId) {
      return res.status(400).json({
        success: false,
        message: 'College ID is required'
      });
    }

    // Get college details
    const [college] = await pool.execute(
      'SELECT id, name, code, is_active, deleted_at FROM colleges WHERE id = ?',
      [collegeId]
    );

    if (college.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'College not found'
      });
    }

    const collegeData = college[0];

    // Get dependency counts
    const [userCount] = await pool.execute(
      'SELECT COUNT(*) as count FROM users WHERE college_id = ? AND is_active = true',
      [collegeId]
    );

    const [departmentCount] = await pool.execute(
      'SELECT COUNT(*) as count FROM departments WHERE college_id = ? AND is_active = true',
      [collegeId]
    );

    // Determine deletion status
    let deletionStatus = 'Active';
    let canDelete = true;
    let canRestore = false;
    let deletionType = null;

    if (!collegeData.is_active) {
      if (collegeData.deleted_at) {
        deletionStatus = 'Soft Deleted';
        deletionType = 'soft';
        canRestore = true;
      } else {
        deletionStatus = 'Inactive';
        deletionType = 'inactive';
      }
    }

    if (userCount[0].count > 0 || departmentCount[0].count > 0) {
      canDelete = false;
    }

    res.json({
      success: true,
      data: {
        college: collegeData,
        deletionStatus,
        deletionType,
        dependencies: {
          activeUsers: userCount[0].count,
          activeDepartments: departmentCount[0].count
        },
        actions: {
          canDelete,
          canRestore,
          canHardDelete: canDelete && !collegeData.is_active
        }
      }
    });

  } catch (error) {
    // console.error('Error getting college deletion status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get college deletion status',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}; 