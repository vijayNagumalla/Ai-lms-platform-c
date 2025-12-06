import { pool } from '../config/database.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { getPlatformStatsSnapshot } from '../services/platformStatsService.js';

// Get dashboard statistics
export const getDashboardStats = async (req, res) => {
  try {
    const {
      activeUsers,
      totalColleges,
      totalDepartments,
      totalAssessments,
      totalSubmissions
    } = await getPlatformStatsSnapshot();
    const totalUsers = activeUsers;

    // Get recent activities
    // Calculate date on application side - PostgreSQL compatible
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const sevenDaysAgoStr = sevenDaysAgo.toISOString();
    
    const [recentActivities] = await pool.execute(`
      SELECT 
        'user' as type,
        'New user registered' as description,
        created_at
       FROM users 
       WHERE created_at >= ?
       UNION ALL
       SELECT 
        'college' as type,
        'New college created' as description,
        created_at
      FROM colleges
       WHERE created_at >= ?
      ORDER BY created_at DESC
      LIMIT 10
    `, [sevenDaysAgoStr, sevenDaysAgoStr]);

    // Get user growth over time
    // Calculate date on application side - PostgreSQL compatible
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const thirtyDaysAgoStr = thirtyDaysAgo.toISOString();
    
    const [userGrowthResult] = await pool.execute(`
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as count
      FROM users
      WHERE created_at >= ?
      GROUP BY DATE(created_at)
      ORDER BY date
    `, [thirtyDaysAgoStr]);

    // Get college growth over time
    // Calculate date on application side - PostgreSQL compatible
    const thirtyDaysAgoColleges = new Date();
    thirtyDaysAgoColleges.setDate(thirtyDaysAgoColleges.getDate() - 30);
    const thirtyDaysAgoCollegesStr = thirtyDaysAgoColleges.toISOString();
    
    const [collegeGrowthResult] = await pool.execute(`
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as count
      FROM colleges
      WHERE created_at >= ?
      GROUP BY DATE(created_at)
      ORDER BY date
    `, [thirtyDaysAgoCollegesStr]);

    res.json({
      success: true,
      data: {
        totalUsers,
        totalColleges,
        totalDepartments,
        totalAssessments,
        totalSubmissions,
        activeUsers,
        recentActivities,
        userGrowth: userGrowthResult,
        collegeGrowth: collegeGrowthResult,
      }
    });

  } catch (error) {
    console.error('Error getting dashboard stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get dashboard statistics'
    });
  }
};

// Get all colleges with statistics
export const getAllColleges = async (req, res) => {
  try {
    const [colleges] = await pool.execute(`
      SELECT 
        c.*,
        (SELECT COUNT(*) FROM users WHERE college_id = c.id AND is_active = true) as user_count,
        (SELECT COUNT(*) FROM departments WHERE college_id = c.id AND is_active = true) as department_count
      FROM colleges c
      WHERE c.is_active = true
      ORDER BY c.created_at DESC
    `);

    res.json({
      success: true,
      data: colleges
    });

  } catch (error) {
    console.error('Error getting colleges:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get colleges'
    });
  }
};

// Get college details with statistics
export const getCollegeDetails = async (req, res) => {
  try {
    const { id } = req.params;

    const [colleges] = await pool.execute(`
      SELECT 
        c.*,
        (SELECT COUNT(*) FROM users WHERE college_id = c.id AND is_active = true) as user_count,
        (SELECT COUNT(*) FROM departments WHERE college_id = c.id AND is_active = true) as department_count
      FROM colleges c
      WHERE c.id = ? AND c.is_active = true
    `, [id]);

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
    `, [id]);

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
    console.error('Error getting college details:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get college details'
    });
  }
};

// Create new college
export const createCollege = async (req, res) => {
  try {
    const { name, code, address, contact_email, contact_phone, description } = req.body;

    // Validate required fields
    if (!name || !code) {
      return res.status(400).json({
        success: false,
        message: 'Name and code are required'
      });
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

    // Insert new college
    const [result] = await pool.execute(`
      INSERT INTO colleges (name, code, address, contact_email, contact_phone, description)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [name, code, address, contact_email, contact_phone, description]);

    res.status(201).json({
      success: true,
      message: 'College created successfully',
      data: { id: result.insertId }
    });

  } catch (error) {
    console.error('Error creating college:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create college'
    });
  }
};

// Update college
export const updateCollege = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, code, address, contact_email, contact_phone, description } = req.body;

    // Check if college exists
    const [existing] = await pool.execute(
      'SELECT id FROM colleges WHERE id = ? AND is_active = true',
      [id]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'College not found'
      });
    }

    // Check if code is being changed and if it already exists
    if (code) {
      const [codeExists] = await pool.execute(
        'SELECT id FROM colleges WHERE code = ? AND id != ? AND is_active = true',
        [code, id]
      );

      if (codeExists.length > 0) {
        return res.status(400).json({
          success: false,
          message: 'College code already exists'
        });
      }
    }

    // Update college
    await pool.execute(`
      UPDATE colleges 
      SET name = ?, code = ?, address = ?, contact_email = ?, contact_phone = ?, description = ?
      WHERE id = ?
    `, [name, code, address, contact_email, contact_phone, description, id]);

    res.json({
      success: true,
      message: 'College updated successfully'
    });

  } catch (error) {
    console.error('Error updating college:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update college'
    });
  }
};

// Delete college (Enhanced with proper soft delete)
export const deleteCollege = async (req, res) => {
  try {
    const { id } = req.params;
    const { hardDelete = false } = req.query; // Allow hard delete option

    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'College ID is required'
      });
    }

    // Check if college exists
    const [existing] = await pool.execute(
      'SELECT id, name, code FROM colleges WHERE id = ?',
      [id]
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
      [id]
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
      [id]
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
      if (hardDelete) {
        // Hard delete - permanently remove all data
        await connection.execute(
          'DELETE FROM users WHERE college_id = ?',
          [id]
        );

        await connection.execute(
          'DELETE FROM departments WHERE college_id = ?',
          [id]
        );

        await connection.execute(
          'DELETE FROM college_departments WHERE college_id = ?',
          [id]
        );

        await connection.execute(
          'DELETE FROM colleges WHERE id = ?',
          [id]
        );

        res.json({
          success: true,
          message: `College "${collegeName}" permanently deleted. All related data has been removed.`,
          deletionType: 'hard',
          collegeCode: collegeCode,
          cleanupDetails: {
            collegeDeleted: true,
            usersRemoved: true,
            departmentsRemoved: true
          }
        });
      } else {
        // Soft delete - mark as inactive and set deletion timestamp
        await connection.execute(
          'UPDATE colleges SET is_active = FALSE, deleted_at = CURRENT_TIMESTAMP WHERE id = ?',
          [id]
        );

        // Clean up user references
        await connection.execute(
          'UPDATE users SET college_id = NULL WHERE college_id = ?',
          [id]
        );

        // Clean up department references
        await connection.execute(
          'UPDATE departments SET is_active = FALSE WHERE college_id = ?',
          [id]
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
    console.error('Error deleting college:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete college',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Get all users with college information
export const getAllUsers = async (req, res) => {
  try {
    const [users] = await pool.execute(`
      SELECT 
        u.*,
        c.name as college_name,
        c.code as college_code
      FROM users u
      LEFT JOIN colleges c ON u.college_id = c.id
      WHERE u.is_active = true
      ORDER BY u.created_at DESC
    `);

    res.json({
      success: true,
      data: users
    });

  } catch (error) {
    console.error('Error getting users:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get users'
    });
  }
};

// Get user details
export const getUserDetails = async (req, res) => {
  try {
    const { id } = req.params;

    const [users] = await pool.execute(`
      SELECT 
        u.*,
        c.name as college_name,
        c.code as college_code
      FROM users u
      LEFT JOIN colleges c ON u.college_id = c.id
      WHERE u.id = ? AND u.is_active = true
    `, [id]);

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      data: users[0]
    });

  } catch (error) {
    console.error('Error getting user details:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get user details'
    });
  }
};

// Update user
export const updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, role, college_id, department_id, is_active } = req.body;

    // Check if user exists
    const [existing] = await pool.execute(
      'SELECT id FROM users WHERE id = ? AND is_active = TRUE',
      [id]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check if email is being changed and if it already exists
    if (email) {
      const [emailExists] = await pool.execute(
        'SELECT id FROM users WHERE email = ? AND id != ? AND is_active = true',
        [email, id]
      );

      if (emailExists.length > 0) {
        return res.status(400).json({
          success: false,
          message: 'Email already exists'
        });
      }
    }

    // Update user
    await pool.execute(`
      UPDATE users 
      SET name = ?, email = ?, role = ?, college_id = ?, department_id = ?, is_active = ?
      WHERE id = ?
    `, [name, email, role, college_id, department_id, is_active, id]);

    res.json({
      success: true,
      message: 'User updated successfully'
    });

  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update user'
    });
  }
};

// Delete user
export const deleteUser = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if user exists
    const [existing] = await pool.execute(
      'SELECT id FROM users WHERE id = ? AND is_active = TRUE',
      [id]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Soft delete user
    await pool.execute(
      'UPDATE users SET is_active = FALSE WHERE id = ?',
      [id]
    );

    res.json({
      success: true,
      message: 'User deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete user'
    });
  }
};

// Restore deleted college
export const restoreCollege = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'College ID is required'
      });
    }

    // Check if college exists and is deleted
    const [existing] = await pool.execute(
      'SELECT id, name, code FROM colleges WHERE id = ? AND is_active = FALSE',
      [id]
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
      [collegeCode, id]
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
        [id]
      );

      // Restore departments
      await connection.execute(
        'UPDATE departments SET is_active = true WHERE college_id = ?',
        [id]
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
    console.error('Error restoring college:', error);
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
          WHEN is_active = FALSE THEN 'Inactive'
          ELSE 'Unknown'
        END as deletion_status
       FROM colleges 
       WHERE is_active = FALSE OR deleted_at IS NOT NULL
       ORDER BY deleted_at DESC, updated_at DESC`
    );

    res.json({
      success: true,
      data: deletedColleges,
      count: deletedColleges.length
    });

  } catch (error) {
    console.error('Error getting deleted colleges:', error);
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
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'College ID is required'
      });
    }

    // Get college details
    const [college] = await pool.execute(
      'SELECT id, name, code, is_active, deleted_at FROM colleges WHERE id = ?',
      [id]
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
      [id]
    );

    const [departmentCount] = await pool.execute(
      'SELECT COUNT(*) as count FROM departments WHERE college_id = ? AND is_active = true',
      [id]
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
    console.error('Error getting college deletion status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get college deletion status',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}; 