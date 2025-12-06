import { pool } from '../config/database.js';
import { randomUUID } from 'crypto';
import codingPlatformService from '../services/codingPlatformService.js';
import platformScraperService from '../services/platformScraperService.js';
import browserScraperService from '../services/browserScraperService.js';
import fastScraperService from '../services/fastScraperService.js';
import { authenticateToken } from '../middleware/auth.js';
import { requireRole } from '../middleware/roleCheck.js';

// Get all coding platforms
export const getCodingPlatforms = async (req, res) => {
  try {
    const [platforms] = await pool.execute(
      'SELECT id, name, display_name, base_url, profile_url_pattern, is_active FROM coding_platforms WHERE is_active = true ORDER BY display_name'
    );

    res.json({
      success: true,
      data: platforms
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get all students coding profiles (SuperAdmin only)
export const getAllStudentsCodingProfiles = async (req, res) => {
  try {
    const { page = 1, limit = 10, search = '', platform = '', college = '', department = '', batch = '' } = req.query;
    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 10;
    const offset = (pageNum - 1) * limitNum;

    let whereClause = 'WHERE u.role = "student"';
    let params = [];

    if (search && search.trim()) {
      whereClause += ' AND (u.name LIKE ? OR u.email LIKE ? OR u.student_id LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    if (platform && platform.trim()) {
      whereClause += ' AND cp.name = ?';
      params.push(platform);
    }

    if (college && college.trim() && college !== 'all') {
      whereClause += ' AND u.college_id = ?';
      params.push(college);
    }

    if (department && department.trim() && department !== 'all') {
      whereClause += ' AND u.department = ?';
      params.push(department);
    }

    if (batch && batch.trim() && batch !== 'all') {
      whereClause += ' AND u.batch = ?';
      params.push(batch);
    }

    // Basic query to get only students who have coding profiles
    const query = `
      SELECT DISTINCT
        u.id as student_id,
        u.name as student_name,
        u.email as student_email,
        u.student_id as student_roll_number,
        u.role as user_role,
        u.batch,
        u.college_id,
        c.name as college_name,
        u.department
      FROM users u
      LEFT JOIN colleges c ON u.college_id = c.id
      INNER JOIN student_coding_profiles scp ON u.id = scp.student_id
      LEFT JOIN coding_platforms cp ON scp.platform_id = cp.id
      ${whereClause}
      ORDER BY u.name
      LIMIT ? OFFSET ?
    `;

    // Add pagination parameters
    params.push(limitNum, offset);


    const [students] = await pool.query(query, params);

    // Simplified count query
    const countQuery = `
      SELECT COUNT(DISTINCT u.id) as total
      FROM users u
      LEFT JOIN colleges c ON u.college_id = c.id
      INNER JOIN student_coding_profiles scp ON u.id = scp.student_id
      LEFT JOIN coding_platforms cp ON scp.platform_id = cp.id
      ${whereClause}
    `;

    // Remove pagination params for count query
    const countParams = params.slice(0, -2);
    const [countResult] = await pool.query(countQuery, countParams);
    const total = countResult[0].total;

    // Optimized: Fetch all coding profiles in a single query instead of N+1 queries
    const studentIds = students.map(s => s.student_id);
    let allProfiles = [];

    // Only fetch profiles if there are students
    if (studentIds.length > 0) {
      [allProfiles] = await pool.query(`
        SELECT 
          scp.student_id,
          scp.id,
          scp.username,
          scp.profile_url,
          scp.sync_status,
          scp.last_synced_at,
          cp.name as platform_name,
          cp.base_url as platform_url
        FROM student_coding_profiles scp
        LEFT JOIN coding_platforms cp ON scp.platform_id = cp.id
        WHERE scp.student_id IN (${studentIds.map(() => '?').join(',')})
        ORDER BY scp.student_id, cp.name
      `, studentIds);
    }

    // Group profiles by student_id
    const profilesByStudent = {};
    allProfiles.forEach(profile => {
      if (!profilesByStudent[profile.student_id]) {
        profilesByStudent[profile.student_id] = [];
      }
      profilesByStudent[profile.student_id].push(profile);
    });

    // Process students with their profiles
    const processedStudents = students.map(student => {
      const profiles = profilesByStudent[student.student_id] || [];

      // Group profiles by platform name
      const platforms = {};
      profiles.forEach(profile => {
        platforms[profile.platform_name] = {
          id: profile.id,
          username: profile.username,
          profile_url: profile.profile_url,
          sync_status: profile.sync_status,
          last_synced_at: profile.last_synced_at,
          platform_url: profile.platform_url
        };
      });

      return {
        ...student,
        platforms
      };
    });

    res.json({
      success: true,
      data: {
        students: processedStudents,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get student's own cached platform statistics (for students)
export const getStudentCachedPlatformStatistics = async (req, res) => {
  try {
    const studentId = req.user.id;

    // Get cached platform statistics
    const [cachedStats] = await pool.execute(`
      SELECT 
        platform_name,
        username,
        statistics_data,
        last_fetched_at,
        created_at,
        updated_at
      FROM platform_statistics_cache
      WHERE student_id = ?
      ORDER BY last_fetched_at DESC
    `, [studentId]);

    if (cachedStats.length === 0) {
      // Return 200 with empty data instead of 404 - no cached data is a valid state
      return res.status(200).json({
        success: false,
        message: 'No cached platform statistics found for this student',
        data: {
          studentId,
          platformStatistics: {},
          lastUpdated: null,
          cached: false
        }
      });
    }

    // Convert JSON data back to objects
    const platformStatistics = {};
    cachedStats.forEach(stat => {
      // Handle both string and object data from MySQL
      let statisticsData;
      if (typeof stat.statistics_data === 'string') {
        statisticsData = JSON.parse(stat.statistics_data);
      } else {
        statisticsData = stat.statistics_data; // Already an object
      }

      platformStatistics[stat.platform_name] = {
        ...statisticsData,
        username: stat.username,
        lastFetched: stat.last_fetched_at,
        cached: true
      };
    });

    res.json({
      success: true,
      data: {
        studentId,
        platformStatistics,
        lastUpdated: cachedStats[0].last_fetched_at,
        cached: true
      }
    });
  } catch (error) {
    console.error('Error in getStudentCachedPlatformStatistics:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get student's own platform statistics (for students)
export const getStudentPlatformStatistics = async (req, res) => {
  try {
    const studentId = req.user.id;

    // Get student's coding profiles
    const [profiles] = await pool.execute(`
      SELECT
        scp.id, scp.username, scp.profile_url, scp.sync_status, scp.last_synced_at,
        cp.name as platform_name, cp.base_url as platform_url
      FROM student_coding_profiles scp
      LEFT JOIN coding_platforms cp ON scp.platform_id = cp.id
      WHERE scp.student_id = ?
      ORDER BY cp.name
    `, [studentId]);

    if (profiles.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No coding profiles found for this student'
      });
    }

    // Organize profiles by platform
    const profilesByPlatform = {};
    profiles.forEach(profile => {
      profilesByPlatform[profile.platform_name] = {
        username: profile.username,
        profile_url: profile.profile_url
      };
    });

    // Try fast HTTP scraper first, fallback to browser if needed
    let platformStats = await fastScraperService.scrapeAllPlatforms(profilesByPlatform);

    // Check if any platform failed and needs browser fallback
    const failedPlatforms = Object.entries(platformStats).filter(([platform, data]) =>
      !data || data.error || (data.problemsSolved === 0 && platform !== 'hackerrank' && platform !== 'hackerearth')
    );

    if (failedPlatforms.length > 0) {
      // Use browser scraper for failed platforms
      const browserStats = await browserScraperService.scrapeAllPlatforms(profilesByPlatform);

      // Merge results, preferring browser data for failed platforms
      Object.keys(platformStats).forEach(platform => {
        if (platformStats[platform]?.error || (platformStats[platform]?.problemsSolved === 0 && platform !== 'hackerrank' && platform !== 'hackerearth')) {
          if (browserStats[platform] && !browserStats[platform].error) {
            platformStats[platform] = browserStats[platform];
          }
        }
      });
    }

    // Save fetched data to database cache
    const currentTime = new Date();
    for (const [platformName, stats] of Object.entries(platformStats)) {
      if (stats && !stats.error) {
        const profile = profiles.find(p => p.platform_name === platformName);
        if (profile) {
          try {
            // Insert or update platform statistics cache
            await pool.execute(`
              INSERT INTO platform_statistics_cache (id, student_id, platform_name, username, statistics_data, last_fetched_at)
              VALUES (gen_random_uuid(), ?, ?, ?, ?, ?)
              ON CONFLICT (student_id, platform_name) DO UPDATE SET
                statistics_data = EXCLUDED.statistics_data,
                last_fetched_at = EXCLUDED.last_fetched_at,
                updated_at = CURRENT_TIMESTAMP
            `, [studentId, platformName, profile.username, JSON.stringify(stats), currentTime]);
          } catch (dbError) {
            console.error(`Error saving platform statistics for ${platformName}:`, dbError);
            // Continue with other platforms even if one fails to save
          }
        }
      }
    }

    res.json({
      success: true,
      data: {
        studentId,
        platformStatistics: platformStats,
        lastUpdated: currentTime.toISOString(),
        cached: true
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get student's own coding profiles
export const getStudentCodingProfiles = async (req, res) => {
  try {
    const studentId = req.user.id;

    const query = `
      SELECT 
        scp.id,
        scp.username,
        scp.profile_url,
        scp.is_verified,
        scp.last_synced_at,
        scp.sync_status,
        scp.sync_error,
        cp.name as platform_name,
        cp.display_name as platform_display_name,
        cp.profile_url_pattern
      FROM student_coding_profiles scp
      JOIN coding_platforms cp ON scp.platform_id = cp.id
      WHERE scp.student_id = ?
      ORDER BY cp.display_name
    `;

    const [profiles] = await pool.execute(query, [studentId]);

    // OPTIMIZATION: Fetch all performance data and achievements in single queries to avoid N+1
    const profileIds = profiles.map(p => p.id);
    const performanceByProfile = {};
    const achievementsByProfile = {};

    if (profileIds.length > 0) {
      const profilePlaceholders = profileIds.map(() => '?').join(',');
      
      // Fetch all performance data in one query
      const [performanceRows] = await pool.execute(
        `SELECT profile_id, data_type, metric_name, numeric_value, difficulty_level, additional_data, recorded_at 
         FROM coding_platform_data 
         WHERE profile_id IN (${profilePlaceholders}) 
         ORDER BY profile_id, recorded_at DESC`,
        profileIds
      );

      // Fetch all achievements in one query
      const [achievementRows] = await pool.execute(
        `SELECT profile_id, achievement_type, achievement_name, achievement_level, stars_count, earned_at 
         FROM coding_achievements 
         WHERE profile_id IN (${profilePlaceholders}) 
         ORDER BY profile_id, earned_at DESC`,
        profileIds
      );

      // Group by profile_id
      performanceRows.forEach(row => {
        if (!performanceByProfile[row.profile_id]) {
          performanceByProfile[row.profile_id] = [];
        }
        performanceByProfile[row.profile_id].push({
          data_type: row.data_type,
          metric_name: row.metric_name,
          numeric_value: row.numeric_value,
          difficulty_level: row.difficulty_level,
          additional_data: row.additional_data,
          recorded_at: row.recorded_at
        });
      });

      achievementRows.forEach(row => {
        if (!achievementsByProfile[row.profile_id]) {
          achievementsByProfile[row.profile_id] = [];
        }
        achievementsByProfile[row.profile_id].push({
          achievement_type: row.achievement_type,
          achievement_name: row.achievement_name,
          achievement_level: row.achievement_level,
          stars_count: row.stars_count,
          earned_at: row.earned_at
        });
      });
    }

    // Map profiles with their data
    const profilesWithData = profiles.map(profile => ({
      ...profile,
      performance_data: performanceByProfile[profile.id] || [],
      achievements: achievementsByProfile[profile.id] || []
    }));

    res.json({
      success: true,
      data: profilesWithData
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Add coding profile for student
export const addCodingProfile = async (req, res) => {
  try {
    const { platform, username, student_id } = req.body;
    // Use student_id from request body if provided (admin adding for another user), otherwise use logged-in user's ID
    const studentId = student_id || req.user.id;

    if (!platform || !username) {
      return res.status(400).json({
        success: false,
        message: 'Platform and username are required'
      });
    }

    // If student_id is provided, validate that the student exists
    if (student_id) {
      const [studentRows] = await pool.execute(
        'SELECT id, name FROM users WHERE id = ?',
        [studentId]
      );

      if (studentRows.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Invalid student ID'
        });
      }
    }

    // Check if platform exists
    const [platformRows] = await pool.execute(
      'SELECT id FROM coding_platforms WHERE name = ? AND is_active = true',
      [platform]
    );

    if (platformRows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid platform'
      });
    }

    const platformId = platformRows[0].id;

    // Check if profile already exists
    const [existingProfile] = await pool.execute(
      'SELECT id FROM student_coding_profiles WHERE student_id = ? AND platform_id = ?',
      [studentId, platformId]
    );

    if (existingProfile.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Profile already exists for this platform'
      });
    }

    // Generate profile URL
    const [platformInfo] = await pool.execute(
      'SELECT profile_url_pattern FROM coding_platforms WHERE id = ?',
      [platformId]
    );

    const profileUrl = platformInfo[0].profile_url_pattern.replace('{username}', username);

    // Insert profile
    const profileId = randomUUID();
    await pool.execute(
      'INSERT INTO student_coding_profiles (id, student_id, platform_id, username, profile_url, sync_status) VALUES (?, ?, ?, ?, ?, \'pending\')',
      [profileId, studentId, platformId, username, profileUrl]
    );

    res.json({
      success: true,
      message: 'Coding profile added successfully',
      data: {
        id: profileId,
        platform,
        username,
        profile_url: profileUrl
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Update a coding profile
export const updateCodingProfile = async (req, res) => {
  try {
    const { profileId } = req.params;
    const { platform, username } = req.body;
    const userId = req.user.id;

    if (!platform || !username) {
      return res.status(400).json({
        success: false,
        message: 'Platform and username are required'
      });
    }

    // Get platform ID
    const [platformRows] = await pool.execute(
      'SELECT id FROM coding_platforms WHERE name = ? AND is_active = true',
      [platform]
    );

    if (platformRows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid platform'
      });
    }

    const platformId = platformRows[0].id;

    // Check if profile exists and user has access
    const [profileRows] = await pool.execute(
      'SELECT id FROM student_coding_profiles WHERE id = ? AND student_id = ?',
      [profileId, userId]
    );

    if (profileRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Profile not found'
      });
    }

    // Check for duplicate username on the same platform
    const [duplicateRows] = await pool.execute(
      'SELECT id FROM student_coding_profiles WHERE platform_id = ? AND username = ? AND student_id = ? AND id != ?',
      [platformId, username, userId, profileId]
    );

    if (duplicateRows.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Username already exists for this platform'
      });
    }

    // Generate profile URL
    const [platformInfo] = await pool.execute(
      'SELECT profile_url_pattern FROM coding_platforms WHERE id = ?',
      [platformId]
    );

    const profileUrl = platformInfo[0].profile_url_pattern.replace('{username}', username);

    // Update profile
    await pool.execute(
      'UPDATE student_coding_profiles SET platform_id = ?, username = ?, profile_url = ?, updated_at = NOW() WHERE id = ?',
      [platformId, username, profileUrl, profileId]
    );

    res.json({
      success: true,
      message: 'Profile updated successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Sync coding profile data
export const syncCodingProfile = async (req, res) => {
  try {
    const { profileId } = req.params;
    const userId = req.user.id;

    // Check if profile exists and user has access
    const [profileRows] = await pool.execute(
      'SELECT scp.*, cp.name as platform_name FROM student_coding_profiles scp JOIN coding_platforms cp ON scp.platform_id = cp.id WHERE scp.id = ? AND scp.student_id = ?',
      [profileId, userId]
    );

    if (profileRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Profile not found'
      });
    }

    const profile = profileRows[0];

    // Update sync status to syncing
    await pool.execute(
      'UPDATE student_coding_profiles SET sync_status = "syncing", sync_error = NULL WHERE id = ?',
      [profileId]
    );

    try {
      // Scrape data from platform
      const scrapedData = await codingPlatformService.scrapeProfile(profile.platform_name, profile.username);

      // Store scraped data
      await codingPlatformService.storeProfileData(userId, profile.platform_name, scrapedData);

      res.json({
        success: true,
        message: 'Profile synced successfully',
        data: scrapedData
      });
    } catch (syncError) {
      // Update sync status to failed
      await pool.execute(
        'UPDATE student_coding_profiles SET sync_status = \'failed\', sync_error = ? WHERE id = ?',
        [syncError.message, profileId]
      );

      res.status(400).json({
        success: false,
        message: 'Failed to sync profile',
        error: syncError.message
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Bulk sync all profiles for a student
export const syncAllProfiles = async (req, res) => {
  try {
    const userId = req.user.id;

    // Get all profiles for the student
    const [profiles] = await pool.execute(
      'SELECT scp.*, cp.name as platform_name FROM student_coding_profiles scp JOIN coding_platforms cp ON scp.platform_id = cp.id WHERE scp.student_id = ?',
      [userId]
    );

    if (profiles.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No profiles found'
      });
    }

    console.log(`🚀 Starting parallel sync for ${profiles.length} profiles...`);
    const startTime = Date.now();

    // Process all profiles in parallel for maximum speed
    const syncPromises = profiles.map(async (profile) => {
      try {
        // Update sync status to syncing
        await pool.execute(
          'UPDATE student_coding_profiles SET sync_status = \'syncing\', sync_error = NULL WHERE id = ?',
          [profile.id]
        );

        console.log(`🔄 Syncing ${profile.platform_name} profile...`);

        // Scrape data from platform using optimized methods
        const scrapedData = await codingPlatformService.scrapeProfile(profile.platform_name, profile.username);

        // Store scraped data
        await codingPlatformService.storeProfileData(userId, profile.platform_name, scrapedData);

        console.log(`✅ Successfully synced ${profile.platform_name}`);

        return {
          platform: profile.platform_name,
          status: 'success',
          data: scrapedData,
          profileId: profile.id
        };
      } catch (error) {
        console.error(`❌ Failed to sync ${profile.platform_name}:`, error.message);

        // Update sync status to failed
        await pool.execute(
          'UPDATE student_coding_profiles SET sync_status = \'failed\', sync_error = ? WHERE id = ?',
          [error.message, profile.id]
        );

        return {
          platform: profile.platform_name,
          status: 'failed',
          error: error.message,
          profileId: profile.id
        };
      }
    });

    // Wait for all sync operations to complete
    const results = await Promise.all(syncPromises);

    const endTime = Date.now();
    const duration = endTime - startTime;

    const successCount = results.filter(r => r.status === 'success').length;
    const failCount = results.filter(r => r.status === 'failed').length;

    console.log(`🎉 Parallel sync completed in ${duration}ms - ${successCount} success, ${failCount} failed`);

    res.json({
      success: true,
      message: `Synced ${successCount} profiles successfully, ${failCount} failed`,
      results: results,
      summary: {
        total: profiles.length,
        success: successCount,
        failed: failCount,
        duration: `${duration}ms`
      }
    });
  } catch (error) {
    console.error('Error in syncAllProfiles:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error during sync',
      error: error.message
    });
  }
};

// Delete coding profile
export const deleteCodingProfile = async (req, res) => {
  try {
    const { profileId } = req.params;
    const userId = req.user.id;

    // Check if profile exists and user has access
    const [profileRows] = await pool.execute(
      'SELECT id FROM student_coding_profiles WHERE id = ? AND student_id = ?',
      [profileId, userId]
    );

    if (profileRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Profile not found'
      });
    }

    // Delete profile (cascade will handle related data)
    await pool.execute(
      'DELETE FROM student_coding_profiles WHERE id = ?',
      [profileId]
    );

    res.json({
      success: true,
      message: 'Coding profile deleted successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Delete all coding profiles for a student (Admin function)
export const deleteAllStudentProfiles = async (req, res) => {
  try {
    const { studentId } = req.params;

    // Check if student exists
    const [studentRows] = await pool.execute(
      'SELECT id, name FROM users WHERE id = ?',
      [studentId]
    );

    if (studentRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Student not found'
      });
    }

    // Get count of profiles to be deleted
    const [profileCount] = await pool.execute(
      'SELECT COUNT(*) as count FROM student_coding_profiles WHERE student_id = ?',
      [studentId]
    );

    // Delete all profiles for this student
    await pool.execute(
      'DELETE FROM student_coding_profiles WHERE student_id = ?',
      [studentId]
    );

    res.json({
      success: true,
      message: `Deleted ${profileCount[0].count} coding profiles for ${studentRows[0].name}`,
      data: {
        deletedCount: profileCount[0].count,
        studentName: studentRows[0].name
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Fetch real platform statistics for a student
export const fetchPlatformStatistics = async (req, res) => {
  try {
    const { studentId } = req.params;

    // Get student's coding profiles
    const [profiles] = await pool.execute(`
      SELECT
        scp.id, scp.username, scp.profile_url, scp.sync_status, scp.last_synced_at,
        cp.name as platform_name, cp.base_url as platform_url
      FROM student_coding_profiles scp
      LEFT JOIN coding_platforms cp ON scp.platform_id = cp.id
      WHERE scp.student_id = ?
      ORDER BY cp.name
    `, [studentId]);

    if (profiles.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No coding profiles found for this student'
      });
    }

    // Organize profiles by platform
    const profilesByPlatform = {};
    profiles.forEach(profile => {
      profilesByPlatform[profile.platform_name] = {
        username: profile.username,
        profile_url: profile.profile_url
      };
    });

    // Try fast HTTP scraper first, fallback to browser if needed
    let platformStats = await fastScraperService.scrapeAllPlatforms(profilesByPlatform);

    // Check if any platform failed and needs browser fallback
    const failedPlatforms = Object.entries(platformStats).filter(([platform, data]) =>
      !data || data.error || (data.problemsSolved === 0 && platform !== 'hackerrank' && platform !== 'hackerearth')
    );

    if (failedPlatforms.length > 0) {
      // Use browser scraper for failed platforms
      const browserStats = await browserScraperService.scrapeAllPlatforms(profilesByPlatform);

      // Merge results, preferring browser data for failed platforms
      Object.keys(platformStats).forEach(platform => {
        if (platformStats[platform]?.error || (platformStats[platform]?.problemsSolved === 0 && platform !== 'hackerrank' && platform !== 'hackerearth')) {
          if (browserStats[platform] && !browserStats[platform].error) {
            platformStats[platform] = browserStats[platform];
          }
        }
      });
    }

    // Save fetched data to database cache
    const currentTime = new Date();
    for (const [platformName, stats] of Object.entries(platformStats)) {
      if (stats && !stats.error) {
        const profile = profiles.find(p => p.platform_name === platformName);
        if (profile) {
          try {
            // Insert or update platform statistics cache
            await pool.execute(`
              INSERT INTO platform_statistics_cache (id, student_id, platform_name, username, statistics_data, last_fetched_at)
              VALUES (gen_random_uuid(), ?, ?, ?, ?, ?)
              ON CONFLICT (student_id, platform_name) DO UPDATE SET
                statistics_data = EXCLUDED.statistics_data,
                last_fetched_at = EXCLUDED.last_fetched_at,
                updated_at = CURRENT_TIMESTAMP
            `, [studentId, platformName, profile.username, JSON.stringify(stats), currentTime]);
          } catch (dbError) {
            console.error(`Error saving platform statistics for ${platformName}:`, dbError);
            // Continue with other platforms even if one fails to save
          }
        }
      }
    }

    res.json({
      success: true,
      data: {
        studentId,
        platformStatistics: platformStats,
        lastUpdated: currentTime.toISOString(),
        cached: true
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Batch fetch platform statistics for multiple students
export const fetchBatchPlatformStatistics = async (req, res) => {
  // Set a longer timeout for this endpoint
  req.setTimeout(300000); // 5 minutes

  try {
    const { studentIds, forceRefresh = false } = req.body;

    if (!studentIds || !Array.isArray(studentIds) || studentIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Student IDs array is required'
      });
    }

    // CRITICAL FIX: Limit batch size to prevent server overload
    const MAX_BATCH_SIZE = 20; // Increased from 10 to 20 for better throughput
    const results = {};
    const batchId = randomUUID();
    const currentTime = new Date();
    // Cache TTL: 1 hour (3600000 ms) - only use cache if data is less than 1 hour old
    const cacheTTL = 60 * 60 * 1000; // 1 hour in milliseconds
    const cacheExpiryTime = new Date(currentTime.getTime() - cacheTTL);

    // OPTIMIZATION: Fetch all profiles for all students in a single query to avoid N+1
    const placeholders = studentIds.map(() => '?').join(',');
    const [allProfiles] = await pool.execute(`
      SELECT
        scp.student_id,
        scp.id, scp.username, scp.profile_url, scp.sync_status, scp.last_synced_at,
        cp.name as platform_name, cp.base_url as platform_url
      FROM student_coding_profiles scp
      LEFT JOIN coding_platforms cp ON scp.platform_id = cp.id
      WHERE scp.student_id IN (${placeholders})
      ORDER BY scp.student_id, cp.name
    `, studentIds);

    // Group profiles by student_id
    const profilesByStudent = {};
    allProfiles.forEach(profile => {
      if (!profilesByStudent[profile.student_id]) {
        profilesByStudent[profile.student_id] = [];
      }
      profilesByStudent[profile.student_id].push(profile);
    });

    // OPTIMIZATION: Fetch all cached statistics in a single query
    const [allCachedStats] = await pool.execute(`
      SELECT 
        student_id,
        platform_name,
        username,
        statistics_data,
        last_fetched_at
      FROM platform_statistics_cache
      WHERE student_id IN (${placeholders}) AND last_fetched_at > ?
      ORDER BY student_id, platform_name
    `, [...studentIds, cacheExpiryTime]);

    // Group cached stats by student_id and platform_name
    const cachedStatsByStudent = {};
    allCachedStats.forEach(stat => {
      if (!cachedStatsByStudent[stat.student_id]) {
        cachedStatsByStudent[stat.student_id] = new Map();
      }
      let statisticsData;
      if (typeof stat.statistics_data === 'string') {
        statisticsData = JSON.parse(stat.statistics_data);
      } else {
        statisticsData = stat.statistics_data;
      }
      cachedStatsByStudent[stat.student_id].set(stat.platform_name, {
        ...statisticsData,
        username: stat.username,
        lastFetched: stat.last_fetched_at,
        cached: true
      });
    });

    // Process students in smaller batches to prevent server overload
    const processStudentBatch = async (studentBatch) => {
      return Promise.all(studentBatch.map(async (studentId) => {
        try {
          // Get student's coding profiles from pre-fetched data
          const profiles = profilesByStudent[studentId] || [];

          if (profiles.length === 0) {
            return { studentId, platformStatistics: null };
          }

          // Check cache first (unless forceRefresh is true)
          let platformStats = {};
          let needsScraping = false;
          const platformsToScrape = {};

          if (!forceRefresh) {
            // Get cached statistics from pre-fetched data
            const cachedPlatforms = cachedStatsByStudent[studentId] || new Map();

            // Check which platforms need scraping
            profiles.forEach(profile => {
              const cached = cachedPlatforms.get(profile.platform_name);
              if (cached) {
                platformStats[profile.platform_name] = cached;
              } else {
                needsScraping = true;
                platformsToScrape[profile.platform_name] = {
                  username: profile.username,
                  profile_url: profile.profile_url
                };
              }
            });
          } else {
            // Force refresh: scrape all platforms
            needsScraping = true;
            profiles.forEach(profile => {
              platformsToScrape[profile.platform_name] = {
                username: profile.username,
                profile_url: profile.profile_url
              };
            });
          }

          // Only scrape platforms that need it
          if (needsScraping && Object.keys(platformsToScrape).length > 0) {
            // Try fast HTTP scraper first, fallback to browser if needed
            let scrapedStats = await fastScraperService.scrapeAllPlatforms(platformsToScrape);

            // Check if any platform failed and needs browser fallback
            const failedPlatforms = Object.entries(scrapedStats).filter(([platform, data]) =>
              !data || data.error || (data.problemsSolved === 0 && platform !== 'hackerrank' && platform !== 'hackerearth')
            );

            if (failedPlatforms.length > 0) {
              // Use browser scraper for failed platforms
              const browserStats = await browserScraperService.scrapeAllPlatforms(platformsToScrape);

              // Merge results, preferring browser data for failed platforms
              Object.keys(scrapedStats).forEach(platform => {
                if (scrapedStats[platform]?.error || (scrapedStats[platform]?.problemsSolved === 0 && platform !== 'hackerrank' && platform !== 'hackerearth')) {
                  if (browserStats[platform] && !browserStats[platform].error) {
                    scrapedStats[platform] = browserStats[platform];
                  }
                }
              });
            }

            // Merge scraped stats with cached stats
            Object.assign(platformStats, scrapedStats);

            // Save fetched data to database cache for scraped platforms only
            const dbPromises = [];
            for (const [platformName, stats] of Object.entries(scrapedStats)) {
              if (stats && !stats.error) {
                const profile = profiles.find(p => p.platform_name === platformName);
                if (profile) {
                  // Insert or update platform statistics cache
                  dbPromises.push(
                    pool.execute(`
                    INSERT INTO platform_statistics_cache (id, student_id, platform_name, username, statistics_data, last_fetched_at)
                    VALUES (gen_random_uuid(), ?, ?, ?, ?, ?)
                    ON CONFLICT (student_id, platform_name) DO UPDATE SET
                      statistics_data = EXCLUDED.statistics_data,
                      last_fetched_at = EXCLUDED.last_fetched_at,
                      updated_at = CURRENT_TIMESTAMP
                  `, [studentId, platformName, profile.username, JSON.stringify(stats), currentTime])
                  );

                  // Also save to batch cache
                  dbPromises.push(
                    pool.execute(`
                    INSERT INTO batch_platform_statistics_cache (id, batch_id, student_id, platform_name, username, statistics_data, last_fetched_at)
                    VALUES (gen_random_uuid(), ?, ?, ?, ?, ?, ?)
                  `, [batchId, studentId, platformName, profile.username, JSON.stringify(stats), currentTime])
                  );
                }
              }
            }

            // Execute all database writes in parallel
            await Promise.all(dbPromises).catch(dbError => {
              console.error(`Error saving platform statistics for student ${studentId}:`, dbError);
              // Continue even if some saves fail
            });
          } else {
            // All data was from cache, still save to batch cache for consistency
            const dbPromises = [];
            for (const [platformName, stats] of Object.entries(platformStats)) {
              if (stats && !stats.error) {
                const profile = profiles.find(p => p.platform_name === platformName);
                if (profile) {
                  dbPromises.push(
                    pool.execute(`
                    INSERT INTO batch_platform_statistics_cache (id, batch_id, student_id, platform_name, username, statistics_data, last_fetched_at)
                    VALUES (gen_random_uuid(), ?, ?, ?, ?, ?, ?)
                  `, [batchId, studentId, platformName, profile.username, JSON.stringify(stats), currentTime])
                  );
                }
              }
            }
            await Promise.all(dbPromises).catch(() => {
              // Ignore errors for batch cache saves
            });
          }

          return { studentId, platformStatistics: platformStats };
        } catch (error) {
          console.error(`Error processing student ${studentId}:`, error);
          return { studentId, platformStatistics: null, error: error.message };
        }
      }));
    };

    // Process students in batches to prevent server overload
    const allResults = [];
    for (let i = 0; i < studentIds.length; i += MAX_BATCH_SIZE) {
      const batch = studentIds.slice(i, i + MAX_BATCH_SIZE);
      console.log(`Processing batch ${Math.floor(i / MAX_BATCH_SIZE) + 1} of ${Math.ceil(studentIds.length / MAX_BATCH_SIZE)} (${batch.length} students)`);

      try {
        const batchResults = await processStudentBatch(batch);
        allResults.push(...batchResults);

        // OPTIMIZATION: Reduced delay between batches from 1000ms to 100ms for better throughput
        // Only add delay if there are more batches to process
        if (i + MAX_BATCH_SIZE < studentIds.length) {
          await new Promise(resolve => setTimeout(resolve, 100)); // 100ms delay between batches
        }
      } catch (batchError) {
        console.error(`Error processing batch starting at index ${i}:`, batchError);
        // Add error results for this batch
        batch.forEach(studentId => {
          allResults.push({ studentId, platformStatistics: null, error: batchError.message });
        });
      }
    }

    // Add results to main results object
    allResults.forEach(result => {
      results[result.studentId] = result.platformStatistics;
    });

    const processedCount = Object.keys(results).filter(id => results[id] !== null).length;

    // CRITICAL FIX: Ensure response is sent even if there are errors
    if (!res.headersSent) {
      res.json({
        success: true,
        data: {
          results,
          processedCount,
          totalRequested: studentIds.length,
          lastUpdated: currentTime.toISOString(),
          batchId,
          cached: !forceRefresh
        }
      });
    }
  } catch (error) {
    console.error('Error in fetchBatchPlatformStatistics:', error);
    // CRITICAL FIX: Ensure error response is sent
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  }
};

// Get cached platform statistics for a student
export const getCachedPlatformStatistics = async (req, res) => {
  try {
    const { studentId } = req.params;

    // Get cached platform statistics
    const [cachedStats] = await pool.execute(`
      SELECT 
        platform_name,
        username,
        statistics_data,
        last_fetched_at,
        created_at,
        updated_at
      FROM platform_statistics_cache
      WHERE student_id = ?
      ORDER BY last_fetched_at DESC
    `, [studentId]);

    if (cachedStats.length === 0) {
      // Return 200 with empty data instead of 404 - no cached data is a valid state
      return res.status(200).json({
        success: false,
        message: 'No cached platform statistics found for this student',
        data: {
          studentId,
          platformStatistics: {},
          lastUpdated: null,
          cached: false
        }
      });
    }

    // Convert JSON data back to objects
    const platformStatistics = {};
    cachedStats.forEach(stat => {
      // Handle both string and object data from MySQL
      let statisticsData;
      if (typeof stat.statistics_data === 'string') {
        statisticsData = JSON.parse(stat.statistics_data);
      } else {
        statisticsData = stat.statistics_data; // Already an object
      }

      platformStatistics[stat.platform_name] = {
        ...statisticsData,
        username: stat.username,
        lastFetched: stat.last_fetched_at,
        cached: true
      };
    });

    res.json({
      success: true,
      data: {
        studentId,
        platformStatistics,
        lastUpdated: cachedStats[0].last_fetched_at,
        cached: true
      }
    });
  } catch (error) {
    console.error('Error in getCachedPlatformStatistics:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get cached batch platform statistics
export const getCachedBatchPlatformStatistics = async (req, res) => {
  try {
    const { batchId } = req.params;

    // Get cached batch platform statistics
    const [cachedStats] = await pool.execute(`
      SELECT 
        student_id,
        platform_name,
        username,
        statistics_data,
        last_fetched_at
      FROM batch_platform_statistics_cache
      WHERE batch_id = ?
      ORDER BY student_id, platform_name
    `, [batchId]);

    if (cachedStats.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No cached batch platform statistics found'
      });
    }

    // Group by student ID
    const results = {};
    cachedStats.forEach(stat => {
      if (!results[stat.student_id]) {
        results[stat.student_id] = {};
      }

      // Handle both string and object data from MySQL
      let statisticsData;
      if (typeof stat.statistics_data === 'string') {
        statisticsData = JSON.parse(stat.statistics_data);
      } else {
        statisticsData = stat.statistics_data; // Already an object
      }

      results[stat.student_id][stat.platform_name] = {
        ...statisticsData,
        username: stat.username,
        lastFetched: stat.last_fetched_at,
        cached: true
      };
    });

    res.json({
      success: true,
      data: {
        results,
        batchId,
        lastUpdated: cachedStats[0].last_fetched_at,
        cached: true
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get coding profile analytics (SuperAdmin only)
export const getCodingProfileAnalytics = async (req, res) => {
  try {
    // Total students with coding profiles
    const [totalStudents] = await pool.execute(
      'SELECT COUNT(DISTINCT student_id) as total FROM student_coding_profiles'
    );

    // Platform distribution
    const [platformStats] = await pool.execute(`
      SELECT 
        cp.display_name as platform,
        COUNT(scp.id) as profile_count,
        COUNT(CASE WHEN scp.is_verified = true THEN 1 END) as verified_count
      FROM coding_platforms cp
      LEFT JOIN student_coding_profiles scp ON cp.id = scp.platform_id
      WHERE cp.is_active = true
      GROUP BY cp.id, cp.display_name
      ORDER BY profile_count DESC
    `);

    // Top performers by platform
    const [topPerformers] = await pool.execute(`
      SELECT 
        u.name as student_name,
        c.name as college_name,
        cp.display_name as platform,
        cpd.numeric_value as problems_solved,
        cpd.recorded_at
      FROM coding_platform_data cpd
      JOIN student_coding_profiles scp ON cpd.profile_id = scp.id
      JOIN users u ON scp.student_id = u.id
      LEFT JOIN colleges c ON u.college_id = c.id
      JOIN coding_platforms cp ON scp.platform_id = cp.id
      WHERE cpd.data_type = 'problems_solved' 
      AND cpd.metric_name = 'total'
      ORDER BY cpd.numeric_value DESC
      LIMIT 20
    `);

    res.json({
      success: true,
      data: {
        total_students: totalStudents[0].total,
        platform_statistics: platformStats,
        top_performers: topPerformers
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Super Admin specific function to update any student's coding profile
export const updateStudentCodingProfile = async (req, res) => {
  try {
    const { studentId, profileId } = req.params;
    const { platform, username } = req.body;

    if (!platform || !username) {
      return res.status(400).json({
        success: false,
        message: 'Platform and username are required'
      });
    }

    // Get platform ID
    const [platformRows] = await pool.execute(
      'SELECT id FROM coding_platforms WHERE name = ? AND is_active = true',
      [platform]
    );

    if (platformRows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid platform'
      });
    }

    const platformId = platformRows[0].id;

    // Check if profile exists for the specified student
    const [profileRows] = await pool.execute(
      'SELECT id FROM student_coding_profiles WHERE id = ? AND student_id = ?',
      [profileId, studentId]
    );

    if (profileRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Profile not found for this student'
      });
    }

    // Check for duplicate username on the same platform for the same student
    const [duplicateRows] = await pool.execute(
      'SELECT id FROM student_coding_profiles WHERE platform_id = ? AND username = ? AND student_id = ? AND id != ?',
      [platformId, username, studentId, profileId]
    );

    if (duplicateRows.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Username already exists for this platform'
      });
    }

    // Update the profile
    const [result] = await pool.execute(
      'UPDATE student_coding_profiles SET platform_id = ?, username = ?, profile_url = CONCAT(?, ?), updated_at = NOW() WHERE id = ?',
      [platformId, username, platformRows[0].profile_url_pattern?.replace('{username}', username) || '', username, profileId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: 'Profile not found'
      });
    }

    res.json({
      success: true,
      message: 'Profile updated successfully'
    });

  } catch (error) {
    console.error('Error updating student coding profile:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};
