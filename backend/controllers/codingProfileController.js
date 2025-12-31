import { pool, supabase } from '../config/database.js';
import { randomUUID } from 'crypto';
import crypto from 'crypto';
import codingPlatformService from '../services/codingPlatformService.js';
import platformScraperService from '../services/platformScraperService.js';
import browserScraperService from '../services/browserScraperService.js';
import fastScraperService from '../services/fastScraperService.js';
import { authenticateToken } from '../middleware/auth.js';
import { requireRole } from '../middleware/roleCheck.js';
import LRUCache from 'lru-cache';
import cache from '../utils/cache.js';

// Cache for student roll number to UUID mappings (5 minute TTL, max 1000 entries)
const studentIdCache = new LRUCache({
  max: 1000,
  ttl: 5 * 60 * 1000, // 5 minutes
  updateAgeOnGet: true
});

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
  const debugId = `[DEBUG-${Date.now()}]`;
  console.log(`${debugId} ========== START getAllStudentsCodingProfiles ==========`);
  
  try {
    const { page = 1, limit = 10, search = '', platform = '', college = '', department = '', batch = '' } = req.query;
    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 10;
    const offset = (pageNum - 1) * limitNum;
    
    console.log(`${debugId} Request parameters:`, {
      page, limit, search, platform, college, department, batch,
      pageNum, limitNum, offset
    });

    // PERFORMANCE FIX: Add caching with ETag support for fast 304 responses
    // CACHE VERSION: v2 - Updated to use new field names (id, name, email, roll_number)
    const cacheKey = `students_coding_profiles_v2_${page}_${limit}_${search || 'none'}_${platform || 'all'}_${college || 'all'}_${department || 'all'}_${batch || 'all'}`;
    const etag = `"${crypto.createHash('md5').update(cacheKey).digest('hex').substring(0, 16)}"`;
    
    // Early 304 check - before any processing
    const ifNoneMatch = req.headers['if-none-match'];
    if (ifNoneMatch === etag) {
      res.setHeader('ETag', etag);
      res.setHeader('Cache-Control', 'private, max-age=120');
      return res.status(304).end();
    }
    
    // Check cache (using new v2 cache key to avoid old cached data)
    // TEMPORARILY DISABLED CACHE TO DEBUG - Remove this after fixing
    // const cached = cache.get(cacheKey);
    // if (cached !== null) {
    //   res.setHeader('ETag', etag);
    //   res.setHeader('Cache-Control', 'private, max-age=120');
    //   return res.json(cached);
    // }

    // Convert to Supabase queries
    // Step 1: Get student IDs who have valid profiles for allowed platforms
    const allowedPlatforms = ['leetcode', 'codechef', 'hackerrank', 'hackerearth', 'geeksforgeeks'];
    
    // First, get platform IDs for allowed platforms
    const { data: platformsData } = await supabase
      .from('coding_platforms')
      .select('id, name')
      .in('name', allowedPlatforms)
      .eq('is_active', true);
    
    if (!platformsData || platformsData.length === 0) {
      const response = {
        success: true,
        data: {
          students: [],
          pagination: {
            page: pageNum,
            limit: limitNum,
            total: 0,
            totalPages: 0
          }
        }
      };
      cache.set(cacheKey, response);
      res.setHeader('ETag', etag);
      res.setHeader('Cache-Control', 'private, max-age=120');
      return res.json(response);
    }
    
    const platformIds = platformsData.map(p => p.id);
    
    // Filter by specific platform if requested
    if (platform && platform.trim() && platform !== 'all' && allowedPlatforms.includes(platform.toLowerCase())) {
      const platformData = platformsData.find(p => p.name.toLowerCase() === platform.toLowerCase());
      if (platformData) {
        platformIds.length = 0;
        platformIds.push(platformData.id);
      }
    }
    
    // Get student IDs with valid profiles
    // Get all profiles for these platforms (newly added profiles should have username and profile_url)
    console.log(`${debugId} Fetching profiles for platform IDs:`, platformIds);
    const { data: allProfilesData, error: allProfilesError } = await supabase
      .from('student_coding_profiles')
      .select('student_id, username, profile_url, platform_id')
      .in('platform_id', platformIds);
    
    if (allProfilesError) {
      console.error(`${debugId} Error fetching all profiles:`, allProfilesError);
      console.error(`${debugId} Profiles error details:`, JSON.stringify(allProfilesError, null, 2));
      return res.status(500).json({
        success: false,
        message: 'Error fetching coding profiles'
      });
    }
    
    console.log(`${debugId} Total profiles found:`, allProfilesData?.length || 0);
    console.log(`${debugId} Platform IDs used:`, platformIds);
    
    if (allProfilesData && allProfilesData.length > 0) {
      console.log(`${debugId} Sample profile data:`, JSON.stringify(allProfilesData.slice(0, 3), null, 2));
    } else {
      console.log(`${debugId} WARNING: No profiles found for platform IDs:`, platformIds);
      // Let's also check if there are ANY profiles at all
      const { data: allProfilesCheck } = await supabase
        .from('student_coding_profiles')
        .select('student_id, platform_id')
        .limit(5);
      console.log(`${debugId} Checking if ANY profiles exist in table:`, allProfilesCheck?.length || 0);
      if (allProfilesCheck && allProfilesCheck.length > 0) {
        console.log(`${debugId} Sample of all profiles:`, JSON.stringify(allProfilesCheck, null, 2));
      }
    }
    
    // Extract unique student IDs from all profiles (they should all be valid since we just added them)
    const studentIdsWithProfiles = [...new Set((allProfilesData || []).map(p => p.student_id).filter(Boolean))];
    
    console.log(`${debugId} Found ${studentIdsWithProfiles.length} unique students with profiles`);
    if (studentIdsWithProfiles.length > 0) {
      console.log(`${debugId} Sample student IDs:`, studentIdsWithProfiles.slice(0, 5));
    } else {
      console.log(`${debugId} ERROR: No student IDs extracted from profiles!`);
    }
    
    if (studentIdsWithProfiles.length === 0) {
      // No students with profiles, return empty result
      const response = {
        success: true,
        data: {
          students: [],
          pagination: {
            page: pageNum,
            limit: limitNum,
            total: 0,
            totalPages: 0
          }
        }
      };
      cache.set(cacheKey, response);
      res.setHeader('ETag', etag);
      res.setHeader('Cache-Control', 'private, max-age=120');
      return res.json(response);
    }
    
    // Step 2: Build user query with filters
    console.log(`${debugId} Querying users with ${studentIdsWithProfiles.length} student IDs`);
    if (studentIdsWithProfiles.length === 0) {
      console.log(`${debugId} WARNING: No student IDs to query!`);
    }
    
    let userQuery = supabase
      .from('users')
      .select('id, name, email, student_id, role, batch, college_id, department', { count: 'exact' })
      .eq('role', 'student');
    
    // Only add .in() if we have student IDs
    if (studentIdsWithProfiles.length > 0) {
      userQuery = userQuery.in('id', studentIdsWithProfiles);
    } else {
      // If no student IDs, return empty result
      const response = {
        success: true,
        data: {
          students: [],
          pagination: {
            page: pageNum,
            limit: limitNum,
            total: 0,
            totalPages: 0
          }
        }
      };
      cache.set(cacheKey, response);
      res.setHeader('ETag', etag);
      res.setHeader('Cache-Control', 'private, max-age=120');
      console.log(`${debugId} Returning empty result - no student IDs with profiles`);
      return res.json(response);
    }
    
    // Apply search filter
    if (search && search.trim()) {
      const searchPattern = `%${search.trim()}%`;
      userQuery = userQuery.or(`name.ilike.${searchPattern},email.ilike.${searchPattern},student_id.ilike.${searchPattern}`);
    }
    
    // Apply college filter
    if (college && college.trim() && college !== 'all') {
      userQuery = userQuery.eq('college_id', college);
    }
    
    // Apply department filter
    if (department && department.trim() && department !== 'all') {
      userQuery = userQuery.eq('department', department);
    }
    
    // Apply batch filter
    if (batch && batch.trim() && batch !== 'all') {
      userQuery = userQuery.eq('batch', batch);
    }
    
    // Apply pagination
    userQuery = userQuery
      .order('name', { ascending: true, nullsFirst: false })
      .range(offset, offset + limitNum - 1);
    
    const { data: studentsData, error: studentsError, count } = await userQuery;
    
    if (studentsError) {
      console.error(`${debugId} Error fetching students:`, studentsError);
      return res.status(500).json({
        success: false,
        message: 'Error fetching students'
      });
    }
    
    const studentsArray = studentsData || [];
    const total = count || 0;
    console.log(`${debugId} Found ${studentsArray.length} students after filters (total: ${total})`);
    
    // Extract student IDs for fetching profiles and colleges
    const studentIds = studentsArray.map(s => s.id).filter(Boolean);
    
    // Step 3: Fetch college names and profiles in parallel
    const collegeIds = [...new Set(studentsArray.map(s => s.college_id).filter(Boolean))];
    
    const [collegesData, profilesData] = await Promise.all([
      // Fetch colleges
      collegeIds.length > 0 ? supabase
        .from('colleges')
        .select('id, name')
        .in('id', collegeIds) : Promise.resolve({ data: [] }),
      // Fetch profiles - first get platform IDs for allowed platforms
      studentIds.length > 0 ? (async () => {
        // Get platform IDs for allowed platforms
        const { data: platformsData } = await supabase
          .from('coding_platforms')
          .select('id, name, base_url')
          .in('name', allowedPlatforms)
          .eq('is_active', true);
        
        if (!platformsData || platformsData.length === 0) {
          return { data: [] };
        }
        
        const platformIds = platformsData.map(p => p.id);
        const platformMap = new Map(platformsData.map(p => [p.id, p]));
        
        // Fetch profiles (removed .or() filter since all profiles should be valid)
        const { data: profilesData } = await supabase
          .from('student_coding_profiles')
          .select('student_id, id, username, profile_url, sync_status, last_synced_at, platform_id')
          .in('student_id', studentIds)
          .in('platform_id', platformIds);
        
        // Merge platform data
        return {
          data: (profilesData || []).map(profile => ({
            ...profile,
            coding_platforms: platformMap.get(profile.platform_id)
          }))
        };
      })() : Promise.resolve({ data: [] })
    ]);
    
    // Create college map
    const collegeMap = new Map((collegesData.data || []).map(c => [c.id, c.name]));
    
    // Group profiles by student_id
    const profilesByStudent = {};
    (profilesData.data || []).forEach(profile => {
      const studentId = profile.student_id;
      if (!profilesByStudent[studentId]) {
        profilesByStudent[studentId] = [];
      }
      profilesByStudent[studentId].push({
        id: profile.id,
        username: profile.username,
        profile_url: profile.profile_url,
        sync_status: profile.sync_status,
        last_synced_at: profile.last_synced_at,
        platform_name: profile.coding_platforms?.name,
        platform_url: profile.coding_platforms?.base_url
      });
    });

    // Step 4: Process students with their profiles
    const processedStudents = studentsArray.map((student) => {
      const studentId = student.id;
      const profiles = profilesByStudent[studentId] || [];
      
      // Group profiles by platform name
      const platforms = {};
      profiles.forEach(profile => {
        const platformName = profile.platform_name;
        if (platformName && allowedPlatforms.includes(platformName.toLowerCase())) {
          platforms[platformName.toLowerCase()] = {
            id: profile.id,
            username: profile.username,
            profile_url: profile.profile_url,
            sync_status: profile.sync_status,
            last_synced_at: profile.last_synced_at,
            platform_url: profile.platform_url
          };
        }
      });
      
      // Only return students with valid profiles
      if (Object.keys(platforms).length === 0) {
        return null;
      }
      
      return {
        id: student.id,
        name: student.name,
        email: student.email,
        roll_number: student.student_id,
        role: student.role,
        batch: student.batch,
        college_id: student.college_id,
        college_name: collegeMap.get(student.college_id) || null,
        department: student.department,
        platforms
      };
    }).filter(student => student !== null);
    
    // Build response
    const totalPages = Math.ceil(total / limitNum);
    
    const response = {
      success: true,
      data: {
        students: processedStudents,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: total,
          totalPages: totalPages
        }
      }
    };
    
    // Cache the response
    cache.set(cacheKey, response);
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'private, max-age=120');
    
    console.log(`${debugId} Returning ${processedStudents.length} students (total: ${total})`);
    return res.json(response);
  } catch (error) {
    console.error(`${debugId} Error in getAllStudentsCodingProfiles:`, error);
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

    // OPTIMIZATION: Use direct PostgreSQL connection for JOIN queries (faster than Supabase PostgREST)
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
      INNER JOIN coding_platforms cp ON scp.platform_id = cp.id
      WHERE scp.student_id = ?
      ORDER BY cp.display_name
    `;

    const [profiles] = await pool.execute(query, [studentId]);
    
    // OPTIMIZATION: Add cache headers
    res.set('Cache-Control', 'private, max-age=60'); // 1 minute cache

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
      const { data: studentData, error: studentError } = await supabase
        .from('users')
        .select('id, name')
        .eq('id', studentId)
        .single();

      if (studentError || !studentData) {
        return res.status(400).json({
          success: false,
          message: 'Invalid student ID'
        });
      }
    }

    // Check if platform exists
    const { data: platformData, error: platformError } = await supabase
      .from('coding_platforms')
      .select('id, profile_url_pattern')
      .eq('name', platform)
      .eq('is_active', true)
      .single();

    if (platformError || !platformData) {
      return res.status(400).json({
        success: false,
        message: 'Invalid platform'
      });
    }

    const platformId = platformData.id;

    // Check if profile already exists
    const { data: existingProfile, error: existingError } = await supabase
      .from('student_coding_profiles')
      .select('id')
      .eq('student_id', studentId)
      .eq('platform_id', platformId)
      .maybeSingle();

    if (existingError) {
      console.error('Error checking existing profile:', existingError);
      return res.status(500).json({
        success: false,
        message: 'Error checking for existing profile'
      });
    }

    if (existingProfile) {
      return res.status(400).json({
        success: false,
        message: 'Profile already exists for this platform'
      });
    }

    // Generate profile URL
    const profileUrl = platformData.profile_url_pattern.replace('{username}', username);

    // Insert profile
    const profileId = randomUUID();
    const { data: insertedProfile, error: insertError } = await supabase
      .from('student_coding_profiles')
      .insert({
        id: profileId,
        student_id: studentId,
        platform_id: platformId,
        username: username,
        profile_url: profileUrl,
        sync_status: 'pending'
      })
      .select()
      .single();

    if (insertError) {
      console.error('Error inserting profile:', insertError);
      return res.status(500).json({
        success: false,
        message: 'Error adding coding profile',
        error: insertError.message
      });
    }

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
    console.error('Error in addCodingProfile:', error);
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
      "UPDATE student_coding_profiles SET sync_status = 'syncing', sync_error = NULL WHERE id = ?",
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
  const debugId = `[BATCH-STATS-${Date.now()}]`;
  console.log(`${debugId} ========== START fetchBatchPlatformStatistics ==========`);
  
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

    // CRITICAL FIX: Convert student roll numbers to UUIDs if needed
    // PostgreSQL uses UUIDs for student_id, but frontend may send roll numbers
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const actualStudentIds = [];
    const studentIdMap = new Map(); // Map roll numbers to UUIDs for response mapping
    
    // Check if we need to convert roll numbers to UUIDs
    const needsConversion = studentIds.some(id => !uuidPattern.test(id));
    
    if (needsConversion) {
      // Batch lookup all student UUIDs
      const rollNumberPlaceholders = studentIds.map(() => '?').join(',');
      const [userLookups] = await pool.execute(
        `SELECT id, student_id FROM users WHERE student_id IN (${rollNumberPlaceholders}) AND role = 'student'`,
        studentIds
      );
      
      // Create mapping from roll number to UUID
      userLookups.forEach(user => {
        studentIdMap.set(user.student_id, user.id);
        actualStudentIds.push(user.id);
      });
      
      // If some students weren't found, log warning but continue
      const foundRollNumbers = new Set(userLookups.map(u => u.student_id));
      const notFound = studentIds.filter(id => !foundRollNumbers.has(id));
      if (notFound.length > 0) {
        console.warn(`Some student roll numbers not found: ${notFound.join(', ')}`);
      }
    } else {
      // All are already UUIDs
      actualStudentIds.push(...studentIds);
      studentIds.forEach(id => studentIdMap.set(id, id));
    }

    // Create reverse map from UUID to original ID for response mapping
    const uuidToOriginalId = new Map();
    studentIdMap.forEach((uuid, originalId) => {
      uuidToOriginalId.set(uuid, originalId);
    });

    if (actualStudentIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid student IDs found'
      });
    }

    // OPTIMIZATION: Fetch all profiles for all students in a single query to avoid N+1
    const placeholders = actualStudentIds.map(() => '?').join(',');
    const [allProfiles] = await pool.execute(`
      SELECT
        scp.student_id,
        scp.id, scp.username, scp.profile_url, scp.sync_status, scp.last_synced_at,
        cp.name as platform_name, cp.base_url as platform_url
      FROM student_coding_profiles scp
      LEFT JOIN coding_platforms cp ON scp.platform_id = cp.id
      WHERE scp.student_id IN (${placeholders})
      ORDER BY scp.student_id, cp.name
    `, actualStudentIds);

    // Group profiles by student_id
    const profilesByStudent = {};
    allProfiles.forEach(profile => {
      if (!profilesByStudent[profile.student_id]) {
        profilesByStudent[profile.student_id] = [];
      }
      profilesByStudent[profile.student_id].push(profile);
    });

    // OPTIMIZATION: Fetch all cached statistics in a single query
    // Use actualStudentIds (UUIDs) for the query
    // CRITICAL FIX: Format date properly for PostgreSQL timestamp comparison
    // Ensure all student IDs are valid UUIDs and filter out any invalid ones
    const validStudentIds = actualStudentIds.filter(id => {
      const isValid = typeof id === 'string' && id.length > 0 && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
      if (!isValid) {
        console.warn('[CodingProfiles] Invalid student ID found (not a valid UUID):', id, typeof id);
      }
      return isValid;
    });
    
    let cachedStatsByStudent = {};
    
    if (validStudentIds.length === 0) {
      console.warn('[CodingProfiles] No valid student IDs to fetch cached stats for');
    } else {
      // CRITICAL FIX: Use PostgreSQL-style placeholders ($1, $2, ...) to avoid parameter order issues
      // Build placeholders: $1, $2, ..., $N for student IDs, then $N+1 for timestamp
      const studentIdPlaceholders = validStudentIds.map((_, idx) => `$${idx + 1}`).join(',');
      const timestampPlaceholder = `$${validStudentIds.length + 1}`;
      
      // CRITICAL FIX: Ensure timestamp is properly formatted as ISO string
      const cacheExpiryTimeStr = cacheExpiryTime.toISOString();
      
      // CRITICAL FIX: Build parameters array carefully - student IDs first, then timestamp
      // IMPORTANT: The query uses student_id IN (...) AND last_fetched_at > ?
      // So parameters must be: [studentId1, studentId2, ..., timestamp]
      const queryParams = [...validStudentIds, cacheExpiryTimeStr];
      
      console.log(`${debugId} Fetching cached stats:`, {
        studentCount: validStudentIds.length,
        cacheExpiryTime: cacheExpiryTimeStr,
        paramCount: queryParams.length,
        expectedParams: validStudentIds.length + 1,
        sampleStudentId: validStudentIds[0],
        lastParam: queryParams[queryParams.length - 1],
        lastParamType: typeof queryParams[queryParams.length - 1],
        isTimestamp: queryParams[queryParams.length - 1] instanceof Date || /^\d{4}-\d{2}-\d{2}T/.test(queryParams[queryParams.length - 1] || ''),
        studentIdPlaceholders,
        timestampPlaceholder
      });
      
      try {
        // CRITICAL FIX: Use simpler query to avoid parameter binding issues
        // Query all recent cached stats, then filter by student IDs in JavaScript
        // This avoids the complex IN clause with many parameters
        // Note: cacheExpiryTimeStr is already defined above (line 1701)
        
        console.log(`${debugId} Fetching cached stats (simplified):`, {
          studentCount: validStudentIds.length,
          cacheExpiryTime: cacheExpiryTimeStr
        });
        
        // Query all recent stats (single parameter - timestamp)
        const [allCachedStatsRaw] = await pool.execute(`
          SELECT 
            student_id,
            platform_name,
            username,
            statistics_data,
            last_fetched_at
          FROM platform_statistics_cache
          WHERE last_fetched_at > ?
          ORDER BY student_id, platform_name
        `, [cacheExpiryTimeStr]);
        
        // Filter by student IDs in JavaScript (avoids complex SQL parameter binding)
        const studentIdSet = new Set(validStudentIds);
        const allCachedStats = (allCachedStatsRaw || []).filter(stat => 
          stat.student_id && studentIdSet.has(stat.student_id)
        );
        
        console.log(`${debugId} Cached stats filtered:`, {
          totalFromDB: (allCachedStatsRaw || []).length,
          afterFilter: allCachedStats.length,
          studentIdsSearched: validStudentIds.length
        });

        // Group cached stats by student_id and platform_name
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
      } catch (cacheError) {
        console.error(`${debugId} Error fetching cached stats:`, cacheError);
        console.error(`${debugId} Error details:`, {
          message: cacheError.message,
          stack: cacheError.stack,
          studentIdsCount: validStudentIds ? validStudentIds.length : 0,
          cacheExpiryTime: cacheExpiryTimeStr || 'not defined'
        });
        // Continue with empty cache if there's an error
        cachedStatsByStudent = {};
      }
    }

    // Process students in smaller batches to prevent server overload
    // Note: studentBatch contains UUIDs, but we need to return results with original IDs
    const processStudentBatch = async (studentBatch) => {
      return Promise.all(studentBatch.map(async (studentUuid) => {
        const originalStudentId = uuidToOriginalId.get(studentUuid) || studentUuid;
        try {
          // Get student's coding profiles from pre-fetched data (use UUID)
          const profiles = profilesByStudent[studentUuid] || [];

          if (profiles.length === 0) {
            return { studentId: originalStudentId, platformStatistics: null };
          }

          // Check cache first (unless forceRefresh is true)
          let platformStats = {};
          let needsScraping = false;
          const platformsToScrape = {};

          if (!forceRefresh) {
            // Get cached statistics from pre-fetched data (use UUID)
            const cachedPlatforms = cachedStatsByStudent[studentUuid] || new Map();

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
                      updated_at = NOW()
                  `, [studentUuid, platformName, profile.username, JSON.stringify(stats), currentTime])
                  );

                  // Also save to batch cache
                  dbPromises.push(
                    pool.execute(`
                    INSERT INTO batch_platform_statistics_cache (id, batch_id, student_id, platform_name, username, statistics_data, last_fetched_at)
                    VALUES (gen_random_uuid(), ?, ?, ?, ?, ?, ?)
                  `, [batchId, studentUuid, platformName, profile.username, JSON.stringify(stats), currentTime])
                  );
                }
              }
            }

            // Execute all database writes in parallel
            await Promise.all(dbPromises).catch(dbError => {
              console.error(`Error saving platform statistics for student ${originalStudentId}:`, dbError);
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
                  `, [batchId, studentUuid, platformName, profile.username, JSON.stringify(stats), currentTime])
                  );
                }
              }
            }
            await Promise.all(dbPromises).catch(() => {
              // Ignore errors for batch cache saves
            });
          }

          // Return with original student ID for frontend compatibility
          return { studentId: originalStudentId, platformStatistics: platformStats };
        } catch (error) {
          console.error(`Error processing student ${originalStudentId}:`, error);
          return { studentId: originalStudentId, platformStatistics: null, error: error.message };
        }
      }));
    };

    // Process students in batches to prevent server overload
    // Use actualStudentIds (UUIDs) for processing, but map results back to original IDs
    const allResults = [];
    for (let i = 0; i < actualStudentIds.length; i += MAX_BATCH_SIZE) {
      const batch = actualStudentIds.slice(i, i + MAX_BATCH_SIZE);
      const originalBatch = batch.map(uuid => uuidToOriginalId.get(uuid) || uuid);
      console.log(`Processing batch ${Math.floor(i / MAX_BATCH_SIZE) + 1} of ${Math.ceil(actualStudentIds.length / MAX_BATCH_SIZE)} (${batch.length} students)`);

      try {
        const batchResults = await processStudentBatch(batch);
        allResults.push(...batchResults);

        // OPTIMIZATION: Reduced delay between batches from 1000ms to 100ms for better throughput
        // Only add delay if there are more batches to process
        if (i + MAX_BATCH_SIZE < actualStudentIds.length) {
          await new Promise(resolve => setTimeout(resolve, 100)); // 100ms delay between batches
        }
      } catch (batchError) {
        console.error(`Error processing batch starting at index ${i}:`, batchError);
        // Add error results for this batch using original IDs
        originalBatch.forEach(originalId => {
          allResults.push({ studentId: originalId, platformStatistics: null, error: batchError.message });
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
    console.error(`${debugId} Error in fetchBatchPlatformStatistics:`, error);
    console.error(`${debugId} Error stack:`, error.stack);
    // CRITICAL FIX: Ensure error response is sent
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  } finally {
    console.log(`${debugId} ========== END fetchBatchPlatformStatistics ==========`);
  }
};

// Get cached platform statistics for a student
export const getCachedPlatformStatistics = async (req, res) => {
  try {
    const { studentId } = req.params;

    // CRITICAL FIX: Handle both UUID and student roll number
    // PostgreSQL student_id is UUID, but we might receive roll numbers from frontend
    let actualStudentId = studentId;
    
    // Check if studentId is a UUID format (contains hyphens and is 36 chars) or a roll number
    const studentIdIsUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(studentId);

    if (!studentIdIsUUID) {
      // OPTIMIZATION: Check cache first to avoid database lookup
      const cachedUuid = studentIdCache.get(studentId);
      if (cachedUuid) {
        actualStudentId = cachedUuid;
      } else {
        // It's a roll number, look up the actual UUID from users table
        try {
          const [users] = await pool.execute(
            "SELECT id FROM users WHERE student_id = ? AND role = 'student' LIMIT 1",
            [studentId]
          );
          if (users.length === 0) {
            // Set cache for not found to avoid repeated queries
            studentIdCache.set(studentId, null);
            return res.status(404).json({
              success: false,
              message: 'Student not found',
              data: {
                studentId,
                platformStatistics: {},
                lastUpdated: null,
                cached: false
              }
            });
          }
          actualStudentId = users[0].id;
          // Cache the mapping for future requests
          studentIdCache.set(studentId, actualStudentId);
        } catch (lookupError) {
          console.error('Error looking up student UUID:', lookupError);
          return res.status(500).json({
            success: false,
            message: 'Error looking up student',
            error: lookupError.message
          });
        }
      }
    }

    // OPTIMIZATION: Use direct PostgreSQL connection for faster queries
    // Get cached platform statistics using the actual UUID
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
    `, [actualStudentId]);

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

    // OPTIMIZATION: Add cache headers for client-side caching (5 minutes)
    res.set({
      'Cache-Control': 'private, max-age=300', // 5 minutes
      'ETag': `"${actualStudentId}-${cachedStats[0]?.last_fetched_at || 'empty'}"`
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
