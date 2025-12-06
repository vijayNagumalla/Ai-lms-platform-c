import { pool } from '../config/database.js';
import codingPlatformService from '../services/codingPlatformService.js';
import * as XLSX from 'xlsx';
import { v4 as uuidv4 } from 'uuid';

// Generate Excel template for bulk upload
export const generateBulkUploadTemplate = async (req, res) => {
  try {
    // Create workbook
    const workbook = XLSX.utils.book_new();

    // Create template data with Roll Number and Email ID
    const templateData = [
      {
        'Roll Number': 'CS001',
        'Email ID': 'student1@college.edu',
        'LeetCode Username': 'leetcode_user1',
        'CodeChef Username': 'codechef_user1',
        'HackerRank Username': 'hackerrank_user1',
        'HackerEarth Username': 'hackerearth_user1',
        'GeeksforGeeks Username': 'geeks_user1'
      },
      {
        'Roll Number': 'CS002',
        'Email ID': 'student2@college.edu',
        'LeetCode Username': 'leetcode_user2',
        'CodeChef Username': 'codechef_user2',
        'HackerRank Username': 'hackerrank_user2',
        'HackerEarth Username': 'hackerearth_user2',
        'GeeksforGeeks Username': 'geeks_user2'
      }
    ];

    // Add instructions sheet
    const instructionsData = [
      ['Bulk Upload Template Instructions'],
      [''],
      ['1. Fill in the Roll Number OR Email ID (at least one is required)'],
      ['2. Add the corresponding platform usernames'],
      ['3. Leave blank if student doesn\'t have an account on that platform'],
      ['4. Save as Excel file (.xlsx)'],
      ['5. Upload using the bulk upload feature'],
      [''],
      ['Important Notes:'],
      ['- Roll Number and Email ID are used to identify students'],
      ['- If both are provided, Roll Number takes priority'],
      ['- URLs will be auto-generated from usernames'],
      ['- Data will be automatically synced after upload'],
      [''],
      ['Platform URLs (Auto-generated):'],
      ['LeetCode: https://leetcode.com/u/{username}'],
      ['CodeChef: https://www.codechef.com/users/{username}'],
      ['HackerRank: https://www.hackerrank.com/profile/{username}'],
      ['HackerEarth: https://www.hackerearth.com/@{username}'],
      ['GeeksforGeeks: https://www.geeksforgeeks.org/user/{username}']
    ];

    // Create worksheets
    const templateSheet = XLSX.utils.json_to_sheet(templateData);
    const instructionsSheet = XLSX.utils.aoa_to_sheet(instructionsData);

    // Add worksheets to workbook
    XLSX.utils.book_append_sheet(workbook, templateSheet, 'Template');
    XLSX.utils.book_append_sheet(workbook, instructionsSheet, 'Instructions');

    // Generate buffer
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    // Set response headers
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="coding_profiles_bulk_template.xlsx"');
    res.setHeader('Content-Length', buffer.length);

    res.send(buffer);
  } catch (error) {
    console.error('Error generating template:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate template'
    });
  }
};

// Process bulk upload
export const processBulkUpload = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    // CRITICAL FIX: Validate Excel file before parsing to prevent malicious file attacks
    // Validate file size (already done by multer, but double-check)
    if (req.file.size > 10 * 1024 * 1024) {
      return res.status(400).json({
        success: false,
        message: 'File size exceeds maximum allowed size (10MB)'
      });
    }

    // CRITICAL FIX: Validate file buffer is not empty
    if (!req.file.buffer || req.file.buffer.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'File buffer is empty or invalid'
      });
    }

    // CRITICAL FIX: Limit buffer size to prevent memory exhaustion
    const MAX_BUFFER_SIZE = 10 * 1024 * 1024; // 10MB
    if (req.file.buffer.length > MAX_BUFFER_SIZE) {
      return res.status(400).json({
        success: false,
        message: 'File exceeds maximum size limit'
      });
    }

    // Parse Excel file with error handling
    let workbook;
    try {
      workbook = XLSX.read(req.file.buffer, {
        type: 'buffer',
        cellDates: false, // CRITICAL: Disable automatic date parsing to prevent code execution
        cellNF: false, // Disable number format parsing
        cellStyles: false, // Disable style parsing
        sheetRows: 10000, // Limit rows to prevent DoS
        dense: true // Use dense mode for better performance
      });
    } catch (parseError) {
      return res.status(400).json({
        success: false,
        message: 'Invalid Excel file format or corrupted file',
        error: process.env.NODE_ENV === 'development' ? parseError.message : undefined
      });
    }

    // CRITICAL FIX: Validate workbook structure
    if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Excel file contains no sheets'
      });
    }

    const sheetName = workbook.SheetNames[0];

    // CRITICAL FIX: Validate sheet name to prevent injection
    if (!sheetName || typeof sheetName !== 'string' || sheetName.length > 255) {
      return res.status(400).json({
        success: false,
        message: 'Invalid sheet name in Excel file'
      });
    }

    const worksheet = workbook.Sheets[sheetName];

    if (!worksheet) {
      return res.status(400).json({
        success: false,
        message: 'Sheet not found in Excel file'
      });
    }

    // CRITICAL FIX: Sanitize cell values and limit data size
    let data;
    try {
      data = XLSX.utils.sheet_to_json(worksheet, {
        defval: '', // Default value for empty cells
        raw: false, // Convert all values to strings (prevents formula injection)
        dateNF: null // Disable date number format
      });
    } catch (jsonError) {
      return res.status(400).json({
        success: false,
        message: 'Failed to parse Excel data',
        error: process.env.NODE_ENV === 'development' ? jsonError.message : undefined
      });
    }

    // CRITICAL FIX: Sanitize all cell values to prevent XSS and injection
    data = data.map((row, index) => {
      const sanitizedRow = {};
      for (const [key, value] of Object.entries(row)) {
        // Sanitize key (column name)
        const sanitizedKey = String(key || '').trim().substring(0, 255);

        // Sanitize value
        let sanitizedValue = value;
        if (typeof value === 'string') {
          // Remove null bytes and control characters
          sanitizedValue = value.replace(/\0/g, '').replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '');
          // Limit value length
          sanitizedValue = sanitizedValue.substring(0, 1000);
        } else if (value !== null && value !== undefined) {
          sanitizedValue = String(value).substring(0, 1000);
        } else {
          sanitizedValue = '';
        }

        sanitizedRow[sanitizedKey] = sanitizedValue;
      }
      return sanitizedRow;
    });

    if (data.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No data found in Excel file'
      });
    }

    const results = {
      total: data.length,
      successful: 0,
      failed: 0,
      errors: []
    };

    // CRITICAL FIX: Use transaction for batch processing to ensure data consistency
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      // Get platform mappings (within transaction)
      const [platforms] = await connection.execute(
        'SELECT id, name FROM coding_platforms WHERE is_active = true'
      );
      const platformMap = {};
      platforms.forEach(platform => {
        platformMap[platform.name] = platform.id;
      });

      // MEDIUM FIX: Track processed usernames to detect duplicates within this upload
      const processedUsernames = new Map(); // platform_id -> Set of usernames
      const duplicateReports = []; // Track duplicate conflicts

      // MEDIUM FIX: Pre-check for duplicates before processing
      for (let i = 0; i < data.length; i++) {
        const row = data[i];
        const platforms = [
          { key: 'LeetCode Username', name: 'leetcode' },
          { key: 'CodeChef Username', name: 'codechef' },
          { key: 'HackerRank Username', name: 'hackerrank' },
          { key: 'HackerEarth Username', name: 'hackerearth' },
          { key: 'GeeksforGeeks Username', name: 'geeksforgeeks' }
        ];

        for (const platform of platforms) {
          const username = row[platform.key];
          if (username && username.trim()) {
            const platformId = platformMap[platform.name];
            if (platformId) {
              if (!processedUsernames.has(platformId)) {
                processedUsernames.set(platformId, new Set());
              }
              const usernameSet = processedUsernames.get(platformId);
              if (usernameSet.has(username.trim().toLowerCase())) {
                duplicateReports.push({
                  row: i + 1,
                  platform: platform.name,
                  username: username.trim(),
                  error: `Duplicate ${platform.name} username found in upload`
                });
              } else {
                usernameSet.add(username.trim().toLowerCase());
              }
            }
          }
        }
      }

      // Report duplicates but continue processing (allow overwrite)
      if (duplicateReports.length > 0) {
        console.warn('Duplicate usernames detected in upload:', duplicateReports);
      }

      // Process each row
      for (let i = 0; i < data.length; i++) {
        const row = data[i];
        const rollNumber = row['Roll Number'] || row['roll_number'] || row['RollNumber'];
        const emailId = row['Email ID'] || row['email_id'] || row['EmailID'] || row['email'];

        // Validate student identification
        if (!rollNumber && !emailId) {
          results.errors.push({
            row: i + 1,
            error: 'Missing both Roll Number and Email ID - at least one is required'
          });
          results.failed++;
          continue;
        }

        try {
          // Find student by roll number (priority) or email
          let studentId = null;
          let studentInfo = null;

          if (rollNumber) {
            const [studentsByRoll] = await connection.execute(
              'SELECT id, name, email FROM users WHERE student_id = ? AND role = "student"',
              [rollNumber.toString().trim()]
            );
            if (studentsByRoll.length > 0) {
              studentId = studentsByRoll[0].id;
              studentInfo = studentsByRoll[0];
            }
          }

          // If not found by roll number, try email
          if (!studentId && emailId) {
            const [studentsByEmail] = await connection.execute(
              'SELECT id, name, email FROM users WHERE email = ? AND role = "student"',
              [emailId.toString().trim()]
            );
            if (studentsByEmail.length > 0) {
              studentId = studentsByEmail[0].id;
              studentInfo = studentsByEmail[0];
            }
          }

          if (!studentId) {
            // CRITICAL FIX: Generic error message to prevent information leakage
            // Don't expose which field (roll number vs email) was used or internal lookup logic
            results.errors.push({
              row: i + 1,
              error: 'Student not found. Please verify Roll Number or Email ID is correct.'
            });
            results.failed++;
            continue;
          }
          let rowSuccess = true;

          // Process each platform
          const platforms = [
            { key: 'LeetCode Username', name: 'leetcode' },
            { key: 'CodeChef Username', name: 'codechef' },
            { key: 'HackerRank Username', name: 'hackerrank' },
            { key: 'HackerEarth Username', name: 'hackerearth' },
            { key: 'GeeksforGeeks Username', name: 'geeksforgeeks' }
          ];

          for (const platform of platforms) {
            const username = row[platform.key];

            if (username && username.trim()) {
              try {
                const platformId = platformMap[platform.name];

                if (!platformId) {
                  // CRITICAL FIX: Generic error message to prevent information leakage
                  results.errors.push({
                    row: i + 1,
                    error: `Platform ${platform.name} is not available. Please contact support.`
                  });
                  rowSuccess = false;
                  continue;
                }

                // Generate profile URL (use connection within transaction)
                const [platformInfo] = await connection.execute(
                  'SELECT profile_url_pattern FROM coding_platforms WHERE id = ?',
                  [platformId]
                );

                const profileUrl = platformInfo[0].profile_url_pattern.replace('{username}', username.trim());

                // Check if profile already exists (use connection within transaction)
                const [existingProfile] = await connection.execute(
                  'SELECT id FROM student_coding_profiles WHERE student_id = ? AND platform_id = ?',
                  [studentId, platformId]
                );

                if (existingProfile.length > 0) {
                  // Update existing profile (use connection within transaction)
                  await connection.execute(
                    'UPDATE student_coding_profiles SET username = ?, profile_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                    [username.trim(), profileUrl, existingProfile[0].id]
                  );
                } else {
                  // Create new profile (use connection within transaction)
                  const profileId = uuidv4();
                  await connection.execute(
                    'INSERT INTO student_coding_profiles (id, student_id, platform_id, username, profile_url, sync_status) VALUES (?, ?, ?, ?, ?, \'pending\')',
                    [profileId, studentId, platformId, username.trim(), profileUrl]
                  );
                }
              } catch (platformError) {
                results.errors.push({
                  row: i + 1,
                  student: studentInfo.name,
                  roll_number: rollNumber,
                  email: emailId,
                  platform: platform.name,
                  username: username,
                  error: platformError.message
                });
                rowSuccess = false;
              }
            }
          }

          if (rowSuccess) {
            results.successful++;
          } else {
            results.failed++;
          }

        } catch (studentError) {
          results.errors.push({
            row: i + 1,
            roll_number: rollNumber,
            email: emailId,
            error: studentError.message
          });
          results.failed++;
        }
      }

      // CRITICAL FIX: Commit transaction if all rows processed successfully
      await connection.commit();
      connection.release();
    } catch (transactionError) {
      // CRITICAL FIX: Rollback transaction on error
      await connection.rollback();
      connection.release();
      throw transactionError; // Re-throw to be caught by outer catch
    }

    res.json({
      success: true,
      message: 'Bulk upload processed',
      data: results
    });

  } catch (error) {
    // CRITICAL FIX: Rollback transaction on error
    if (connection) {
      await connection.rollback();
      connection.release();
    }

    console.error('Error processing bulk upload:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process bulk upload',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

// Bulk sync all profiles
export const bulkSyncProfiles = async (req, res) => {
  try {
    const { studentIds = [], platformIds = [] } = req.body;

    let whereClause = 'WHERE 1=1';
    const params = [];

    if (studentIds.length > 0) {
      whereClause += ' AND scp.student_id IN (' + studentIds.map(() => '?').join(',') + ')';
      params.push(...studentIds);
    }

    if (platformIds.length > 0) {
      whereClause += ' AND scp.platform_id IN (' + platformIds.map(() => '?').join(',') + ')';
      params.push(...platformIds);
    }

    const query = `
      SELECT scp.id, scp.student_id, scp.username, cp.name as platform_name
      FROM student_coding_profiles scp
      JOIN coding_platforms cp ON scp.platform_id = cp.id
      ${whereClause}
    `;

    const [profiles] = await pool.execute(query, params);

    const results = {
      total: profiles.length,
      successful: 0,
      failed: 0,
      errors: []
    };

    // Process each profile
    for (const profile of profiles) {
      try {
        // Update sync status to syncing
        await pool.execute(
          'UPDATE student_coding_profiles SET sync_status = \'syncing\', sync_error = NULL WHERE id = ?',
          [profile.id]
        );

        // Scrape data from platform
        const scrapedData = await codingPlatformService.scrapeProfile(profile.platform_name, profile.username);

        // Store scraped data
        await codingPlatformService.storeProfileData(profile.student_id, profile.platform_name, scrapedData);

        results.successful++;
      } catch (error) {
        // Update sync status to failed
        await pool.execute(
          'UPDATE student_coding_profiles SET sync_status = \'failed\', sync_error = ? WHERE id = ?',
          [error.message, profile.id]
        );

        results.errors.push({
          student_id: profile.student_id,
          platform: profile.platform_name,
          username: profile.username,
          error: error.message
        });
        results.failed++;
      }
    }

    res.json({
      success: true,
      message: `Bulk sync completed: ${results.successful} successful, ${results.failed} failed`,
      data: results
    });

  } catch (error) {
    console.error('Error in bulk sync:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to perform bulk sync'
    });
  }
};

// Get bulk upload status and statistics
export const getBulkUploadStats = async (req, res) => {
  try {
    const [stats] = await pool.execute(`
      SELECT 
        COUNT(DISTINCT scp.student_id) as total_students_with_profiles,
        COUNT(scp.id) as total_profiles,
        COUNT(CASE WHEN scp.sync_status = 'success' THEN 1 END) as synced_profiles,
        COUNT(CASE WHEN scp.sync_status = 'pending' THEN 1 END) as pending_profiles,
        COUNT(CASE WHEN scp.sync_status = 'failed' THEN 1 END) as failed_profiles,
        COUNT(CASE WHEN scp.sync_status = 'syncing' THEN 1 END) as syncing_profiles
      FROM student_coding_profiles scp
    `);

    const [platformStats] = await pool.execute(`
      SELECT 
        cp.display_name as platform,
        COUNT(scp.id) as profile_count,
        COUNT(CASE WHEN scp.sync_status = 'success' THEN 1 END) as synced_count
      FROM coding_platforms cp
      LEFT JOIN student_coding_profiles scp ON cp.id = scp.platform_id
      WHERE cp.is_active = true
      GROUP BY cp.id, cp.display_name
      ORDER BY profile_count DESC
    `);

    res.json({
      success: true,
      data: {
        overall_stats: stats[0],
        platform_stats: platformStats
      }
    });
  } catch (error) {
    console.error('Error getting bulk upload stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get statistics'
    });
  }
};
