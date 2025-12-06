import axios from 'axios';
import * as cheerio from 'cheerio';
import { pool } from '../config/database.js';
import { randomUUID } from 'crypto';
import browserScraperService from './browserScraperService.js';
import fastScraperService from './fastScraperService.js';

class CodingPlatformService {
  constructor() {
    // CRITICAL FIX: User agent rotation to prevent bot detection
    this.userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0'
    ];
    this.currentUserAgentIndex = 0;
    this.userAgent = this.userAgents[0];
    this.cache = new Map(); // Simple in-memory cache
    this.cacheTimeout = 5 * 60 * 1000; // 5 minutes cache
  }
  
  // CRITICAL FIX: Rotate user agent to prevent bot detection
  getRandomUserAgent() {
    this.currentUserAgentIndex = (this.currentUserAgentIndex + 1) % this.userAgents.length;
    return this.userAgents[this.currentUserAgentIndex];
  }

  // Get cached result if available and not expired
  getCachedResult(platform, username) {
    const key = `${platform}:${username}`;
    const cached = this.cache.get(key);
    
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      console.log(`🎯 Using cached result for ${platform}:${username}`);
      return cached.data;
    }
    
    if (cached) {
      this.cache.delete(key); // Remove expired cache
    }
    
    return null;
  }

  // Cache the result
  setCachedResult(platform, username, data) {
    const key = `${platform}:${username}`;
    this.cache.set(key, {
      data: data,
      timestamp: Date.now()
    });
    console.log(`💾 Cached result for ${platform}:${username}`);
  }

  // Normalize data format from different scrapers
  normalizeData(platform, rawData) {
    if (!rawData) return null;

    const normalized = {
      platform: platform,
      username: rawData.username || rawData.userName || '',
      profile_url: rawData.profile_url || rawData.profileUrl || '',
      problems_solved: {},
      ranking: null,
      last_synced: new Date()
    };

    switch (platform.toLowerCase()) {
      case 'leetcode':
        normalized.problems_solved = {
          total: rawData.problemsSolved || 0,
          easy: rawData.easySolved || 0,
          medium: rawData.mediumSolved || 0,
          hard: rawData.hardSolved || 0
        };
        normalized.ranking = rawData.rank || null;
        break;

      case 'codechef':
        normalized.problems_solved = {
          total: rawData.problemsSolved || 0
        };
        normalized.current_rating = rawData.currentRating || null;
        normalized.highest_rating = rawData.highestRating || null;
        break;

      case 'hackerrank':
        normalized.problems_solved = {
          total: rawData.problemsSolved || 0
        };
        normalized.badges = rawData.badges || [];
        normalized.total_stars = rawData.totalStars || 0;
        break;

      case 'hackerearth':
        normalized.problems_solved = {
          total: rawData.problemsSolved || 0
        };
        normalized.points = rawData.points || 0;
        normalized.contest_ratings = rawData.contestRatings || 0;
        normalized.solutions_submitted = rawData.solutionsSubmitted || 0;
        break;

      case 'geeksforgeeks':
        normalized.problems_solved = {
          total: rawData.problemsSolved || 0,
          easy: rawData.easySolved || 0,
          medium: rawData.mediumSolved || 0,
          hard: rawData.hardSolved || 0
        };
        break;
    }

    return normalized;
  }

  // Generic method to fetch and parse HTML
  async fetchPage(url) {
    try {
      // CRITICAL FIX: Use rotated user agent for each request
      const userAgent = this.getRandomUserAgent();
      const response = await axios.get(url, {
        headers: {
          'User-Agent': userAgent,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate, br',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
        },
        timeout: 10000,
      });
      return cheerio.load(response.data);
    } catch (error) {
      console.error(`Error fetching ${url}:`, error.message);
      // Return a more user-friendly error message
      if (error.response?.status === 404) {
        throw new Error('USER_NOT_FOUND - Please check your username and edit your profile details if needed');
      } else if (error.response?.status === 403) {
        throw new Error('Access denied - profile may be private or blocked');
      } else if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
        throw new Error('Connection failed - platform may be temporarily unavailable');
      } else {
        throw new Error(`Failed to fetch profile data: ${error.message}`);
      }
    }
  }

  // LeetCode scraping
  async scrapeLeetCode(username) {
    const url = `https://leetcode.com/u/${username}/`;
    const $ = await this.fetchPage(url);
    
    const data = {
      platform: 'leetcode',
      username: username,
      profile_url: url,
      problems_solved: {},
      ranking: null,
      last_synced: new Date()
    };

    try {
      // Extract total problems solved
      const totalSolved = $('.text-label-1').first().text().trim();
      data.problems_solved.total = parseInt(totalSolved) || 0;

      // Extract difficulty breakdown
      const difficultyElements = $('.text-difficulty-easy, .text-difficulty-medium, .text-difficulty-hard');
      difficultyElements.each((index, element) => {
        const text = $(element).text().trim();
        const match = text.match(/(\d+)\/(\d+)/);
        if (match) {
          const solved = parseInt(match[1]);
          const total = parseInt(match[2]);
          const difficulty = $(element).hasClass('text-difficulty-easy') ? 'easy' : 
                           $(element).hasClass('text-difficulty-medium') ? 'medium' : 'hard';
          data.problems_solved[difficulty] = { solved, total };
        }
      });

      // Extract ranking
      const rankingElement = $('.ttext-label-1').first();
      if (rankingElement.length) {
        const rankingText = rankingElement.text().trim();
        const rankingMatch = rankingText.match(/(\d+)/);
        if (rankingMatch) {
          data.ranking = parseInt(rankingMatch[1]);
        }
      }

      return data;
    } catch (error) {
      console.error('Error parsing LeetCode data:', error);
      throw error;
    }
  }

  // CodeChef scraping
  async scrapeCodeChef(username) {
    const url = `https://www.codechef.com/users/${username}`;
    const $ = await this.fetchPage(url);
    
    const data = {
      platform: 'codechef',
      username: username,
      profile_url: url,
      problems_solved: {},
      last_synced: new Date()
    };

    try {
      // Extract total problems solved
      const problemsElement = $('h3:contains("Total Problems Solved")');
      if (problemsElement.length) {
        const problemsText = problemsElement.text();
        const match = problemsText.match(/(\d+)/);
        if (match) {
          data.problems_solved.total = parseInt(match[1]);
        }
      }

      return data;
    } catch (error) {
      console.error('Error parsing CodeChef data:', error);
      throw error;
    }
  }

  // HackerEarth scraping
  async scrapeHackerEarth(username) {
    const url = `https://www.hackerearth.com/@${username}`;
    const $ = await this.fetchPage(url);
    
    const data = {
      platform: 'hackerearth',
      username: username,
      profile_url: url,
      metrics: {},
      last_synced: new Date()
    };

    try {
      // Extract metrics from the grid
      const metricCards = $('.rounded-xl.border.bg-card');
      metricCards.each((index, element) => {
        const valueElement = $(element).find('.text-xl.font-semibold');
        const labelElement = $(element).find('.text-sm.text-muted-foreground');
        
        if (valueElement.length && labelElement.length) {
          const value = parseInt(valueElement.text().trim()) || 0;
          const label = labelElement.text().trim().toLowerCase();
          
          if (label.includes('points')) {
            data.metrics.points = value;
          } else if (label.includes('contest')) {
            data.metrics.contest_ratings = value;
          } else if (label.includes('problems solved')) {
            data.metrics.problems_solved = value;
          } else if (label.includes('solutions submitted')) {
            data.metrics.solutions_submitted = value;
          }
        }
      });

      return data;
    } catch (error) {
      console.error('Error parsing HackerEarth data:', error);
      throw error;
    }
  }

  // HackerRank scraping
  async scrapeHackerRank(username) {
    const url = `https://www.hackerrank.com/profile/${username}`;
    const $ = await this.fetchPage(url);
    
    const data = {
      platform: 'hackerrank',
      username: username,
      profile_url: url,
      badges: [],
      last_synced: new Date()
    };

    try {
      // Extract badges
      const badges = $('.hacker-badge');
      badges.each((index, element) => {
        const badgeData = {};
        
        // Extract badge name
        const badgeNameElement = $(element).find('.badge-title');
        if (badgeNameElement.length) {
          badgeData.name = badgeNameElement.text().trim();
        }

        // Extract badge level (bronze, silver, gold)
        const badgeLevel = $(element).find('.ui-badge').attr('class');
        if (badgeLevel) {
          if (badgeLevel.includes('bronze')) badgeData.level = 'bronze';
          else if (badgeLevel.includes('silver')) badgeData.level = 'silver';
          else if (badgeLevel.includes('gold')) badgeData.level = 'gold';
          else if (badgeLevel.includes('platinum')) badgeData.level = 'platinum';
        }

        // Extract stars count
        const stars = $(element).find('.badge-star').length;
        badgeData.stars = stars;

        if (badgeData.name) {
          data.badges.push(badgeData);
        }
      });

      return data;
    } catch (error) {
      console.error('Error parsing HackerRank data:', error);
      throw error;
    }
  }

  // GeeksforGeeks scraping
  async scrapeGeeksforGeeks(username) {
    const url = `https://www.geeksforgeeks.org/user/${username}`;
    const $ = await this.fetchPage(url);
    
    const data = {
      platform: 'geeksforgeeks',
      username: username,
      profile_url: url,
      problems_solved: {},
      last_synced: new Date()
    };

    try {
      // Extract total problems solved
      const totalProblemsElement = $('.scoreCard_head_left--score__oSi_x').first();
      if (totalProblemsElement.length) {
        const totalProblems = parseInt(totalProblemsElement.text().trim()) || 0;
        data.problems_solved.total = totalProblems;
      }

      // Extract difficulty breakdown
      const difficultyNavs = $('.problemNavbar_head_nav--text__UaGCx');
      difficultyNavs.each((index, element) => {
        const text = $(element).text().trim();
        const difficultyMatch = text.match(/(\w+)\s*\((\d+)\)/);
        if (difficultyMatch) {
          const difficulty = difficultyMatch[1].toLowerCase();
          const count = parseInt(difficultyMatch[2]);
          data.problems_solved[difficulty] = count;
        }
      });

      return data;
    } catch (error) {
      console.error('Error parsing GeeksforGeeks data:', error);
      throw error;
    }
  }

  // CRITICAL FIX: Rate limiting for scraping
  async waitForRateLimit(platform) {
    const now = Date.now();
    const lastTime = this.lastRequestTime || {};
    const minInterval = 1000; // Reduced to 1 second for faster batch processing (still prevents rate limiting)
    
    if (lastTime[platform]) {
      const timeSince = now - lastTime[platform];
      if (timeSince < minInterval) {
        const waitTime = minInterval - timeSince;
        // Only log if wait time is significant (>500ms) to reduce console noise
        if (waitTime > 500) {
          console.log(`⏳ Rate limiting: waiting ${waitTime}ms before ${platform} request`);
        }
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
    
    if (!this.lastRequestTime) {
      this.lastRequestTime = {};
    }
    this.lastRequestTime[platform] = Date.now();
  }

  // Main scraping method that calls appropriate platform scraper
  async scrapeProfile(platform, username) {
    // CRITICAL FIX: Rate limiting before scraping
    await this.waitForRateLimit(platform);
    
    // Check cache first for instant results
    const cachedResult = this.getCachedResult(platform, username);
    if (cachedResult) {
      return cachedResult;
    }

    let result = null;

    try {
      // Try fast scraping first (GraphQL APIs, optimized endpoints)
      console.log(`🚀 Trying fast scraping for ${platform}...`);
      const fastResult = await this.scrapeWithFastScraper(platform, username);
      if (fastResult && this.isValidResult(fastResult)) {
        console.log(`✅ Fast scraping successful for ${platform}`);
        result = this.normalizeData(platform, fastResult);
        this.setCachedResult(platform, username, result);
        return result;
      }
    } catch (fastError) {
      console.log(`⚠️ Fast scraping failed for ${platform}:`, fastError.message);
    }

    try {
      // CRITICAL FIX: Rate limiting before regular scraping
      await this.waitForRateLimit(platform);
      // Try regular scraping as fallback
      console.log(`🔄 Trying regular scraping for ${platform}...`);
      const regularResult = await this.scrapeWithRegularScraper(platform, username);
      if (regularResult && this.isValidResult(regularResult)) {
        console.log(`✅ Regular scraping successful for ${platform}`);
        result = this.normalizeData(platform, regularResult);
        this.setCachedResult(platform, username, result);
        return result;
      }
    } catch (regularError) {
      console.log(`⚠️ Regular scraping failed for ${platform}:`, regularError.message);
    }

    try {
      // CRITICAL FIX: Rate limiting before browser scraping
      await this.waitForRateLimit(platform);
      // Try browser scraper as last resort
      console.log(`🌐 Trying browser scraping for ${platform}...`);
      const browserResult = await this.scrapeWithBrowser(platform, username);
      if (browserResult && this.isValidResult(browserResult)) {
        console.log(`✅ Browser scraping successful for ${platform}`);
        result = this.normalizeData(platform, browserResult);
        this.setCachedResult(platform, username, result);
        return result;
      }
    } catch (browserError) {
      console.log(`❌ Browser scraping also failed for ${platform}:`, browserError.message);
    }

    // MEDIUM FIX: Record scraping failure in database for monitoring
    try {
      await this.recordScrapingFailure(platform, username, `All scraping methods failed: ${fastError?.message || regularError?.message || browserError?.message || 'Unknown error'}`);
    } catch (recordError) {
      console.error('Failed to record scraping failure:', recordError);
    }
    
    // If all methods fail, throw the most informative error
    throw new Error(`USER_NOT_FOUND - Please check your username and edit your profile details if needed`);
  }
  
  // MEDIUM FIX: Record scraping failure in database
  async recordScrapingFailure(platform, username, errorMessage) {
    try {
      const [existing] = await pool.execute(
        'SELECT id, failure_count FROM scraping_failures WHERE platform = ? AND username = ?',
        [platform, username]
      );
      
      if (existing.length > 0) {
        // Update existing failure record
        await pool.execute(
          'UPDATE scraping_failures SET failure_count = failure_count + 1, error_message = ?, last_attempted_at = CURRENT_TIMESTAMP WHERE id = ?',
          [errorMessage, existing[0].id]
        );
      } else {
        // Create new failure record
        const failureId = randomUUID();
        await pool.execute(
          'INSERT INTO scraping_failures (id, platform, username, error_message, failure_count) VALUES (?, ?, ?, ?, 1)',
          [failureId, platform, username, errorMessage]
        );
      }
    } catch (error) {
      console.error('Error recording scraping failure:', error);
      // Don't throw - failure recording shouldn't break the main flow
    }
  }

  // CRITICAL FIX: Enhanced validation for scraped data to prevent corrupted/partial data
  isValidResult(result) {
    if (!result) return false;
    
    // Validate result structure
    if (typeof result !== 'object') return false;
    
    // Check for required fields based on platform
    const hasUsername = result.username || result.userName;
    if (!hasUsername || typeof hasUsername !== 'string' || hasUsername.trim().length === 0) {
      return false;
    }
    
    // Validate data types and ranges
    if (result.problems_solved) {
      if (typeof result.problems_solved !== 'object') return false;
      if (result.problems_solved.total !== undefined && 
          (typeof result.problems_solved.total !== 'number' || result.problems_solved.total < 0)) {
        return false;
      }
    }
    
    if (result.problemsSolved !== undefined && 
        (typeof result.problemsSolved !== 'number' || result.problemsSolved < 0)) {
      return false;
    }
    
    // Check if result has meaningful data
    if (result.problems_solved && result.problems_solved.total > 0) return true;
    if (result.problemsSolved && result.problemsSolved > 0) return true;
    if (result.badges && result.badges.length > 0) return true;
    if (result.metrics && Object.values(result.metrics).some(v => v > 0)) return true;
    
    return false;
  }

  // Fast scraping using optimized methods
  async scrapeWithFastScraper(platform, username) {
    switch (platform.toLowerCase()) {
      case 'leetcode':
        return await fastScraperService.scrapeLeetCode(username);
      case 'codechef':
        return await fastScraperService.scrapeCodeChef(username);
      case 'hackerearth':
        return await fastScraperService.scrapeHackerEarth(username);
      case 'hackerrank':
        return await fastScraperService.scrapeHackerRank(username);
      case 'geeksforgeeks':
        return await fastScraperService.scrapeGeeksforGeeks(username);
      default:
        throw new Error(`Unsupported platform for fast scraping: ${platform}`);
    }
  }

  // Regular scraping using standard methods
  async scrapeWithRegularScraper(platform, username) {
    switch (platform.toLowerCase()) {
      case 'leetcode':
        return await this.scrapeLeetCode(username);
      case 'codechef':
        return await this.scrapeCodeChef(username);
      case 'hackerearth':
        return await this.scrapeHackerEarth(username);
      case 'hackerrank':
        return await this.scrapeHackerRank(username);
      case 'geeksforgeeks':
        return await this.scrapeGeeksforGeeks(username);
      default:
        throw new Error(`Unsupported platform: ${platform}`);
    }
  }

  // Browser-based scraping fallback
  async scrapeWithBrowser(platform, username) {
    switch (platform.toLowerCase()) {
      case 'leetcode':
        return await browserScraperService.scrapeLeetCode(username);
      case 'codechef':
        return await browserScraperService.scrapeCodeChef(username);
      case 'hackerearth':
        return await browserScraperService.scrapeHackerEarth(username);
      case 'hackerrank':
        return await browserScraperService.scrapeHackerRank(username);
      case 'geeksforgeeks':
        return await browserScraperService.scrapeGeeksforGeeks(username);
      default:
        throw new Error(`Unsupported platform for browser scraping: ${platform}`);
    }
  }

  // Store scraped data in database
  async storeProfileData(studentId, platform, scrapedData) {
    const connection = await pool.getConnection();
    
    try {
      // CRITICAL FIX: Set transaction isolation level
      await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      await connection.beginTransaction();

      // Get platform ID
      const [platformRows] = await connection.execute(
        'SELECT id FROM coding_platforms WHERE name = ?',
        [platform]
      );

      if (platformRows.length === 0) {
        throw new Error(`Platform ${platform} not found`);
      }

      const platformId = platformRows[0].id;

      // Upsert student coding profile
      const [existingProfile] = await connection.execute(
        'SELECT id FROM student_coding_profiles WHERE student_id = ? AND platform_id = ?',
        [studentId, platformId]
      );

      let profileId;
      if (existingProfile.length > 0) {
        profileId = existingProfile[0].id;
        await connection.execute(
          'UPDATE student_coding_profiles SET username = ?, profile_url = ?, is_verified = true, last_synced_at = NOW(), sync_status = \'success\' WHERE id = ?',
          [scrapedData.username, scrapedData.profile_url, profileId]
        );
      } else {
        const profileUuid = randomUUID();
        await connection.execute(
          'INSERT INTO student_coding_profiles (id, student_id, platform_id, username, profile_url, is_verified, last_synced_at, sync_status) VALUES (?, ?, ?, ?, ?, true, NOW(), \'success\')',
          [profileUuid, studentId, platformId, scrapedData.username, scrapedData.profile_url]
        );
        profileId = profileUuid;
      }

      // Clear existing data for this profile
      await connection.execute(
        'DELETE FROM coding_platform_data WHERE profile_id = ?',
        [profileId]
      );

      // Store platform-specific data
      await this.storePlatformSpecificData(connection, profileId, platformId, platform, scrapedData);

      await connection.commit();
      return profileId;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  // Store platform-specific data
  async storePlatformSpecificData(connection, profileId, platformId, platform, data) {
    const dataUuid = randomUUID();

    // Helper function to convert undefined and 'N/A' to null
    const nullIfUndefined = (value) => {
      if (value === undefined || value === null || value === 'N/A' || value === '') {
        return null;
      }
      return value;
    };

    switch (platform) {
      case 'leetcode':
        // Store problems solved data
        if (data.problems_solved && data.problems_solved.total !== undefined) {
          await connection.execute(
            'INSERT INTO coding_platform_data (id, profile_id, platform_id, data_type, metric_name, numeric_value) VALUES (?, ?, ?, "problems_solved", "total", ?)',
            [dataUuid, profileId, platformId, nullIfUndefined(data.problems_solved.total)]
          );
        }

        // Store difficulty breakdown
        for (const [difficulty, counts] of Object.entries(data.problems_solved)) {
          if (difficulty !== 'total' && counts && counts.solved !== undefined) {
            const diffUuid = randomUUID();
            await connection.execute(
              'INSERT INTO coding_platform_data (id, profile_id, platform_id, data_type, metric_name, numeric_value, difficulty_level, additional_data) VALUES (?, ?, ?, "problems_solved", ?, ?, ?, ?)',
              [diffUuid, profileId, platformId, difficulty, counts.solved, difficulty, JSON.stringify(counts)]
            );
          }
        }

        // Store ranking
        if (data.ranking !== undefined) {
          const rankUuid = randomUUID();
          await connection.execute(
            'INSERT INTO coding_platform_data (id, profile_id, platform_id, data_type, metric_name, numeric_value) VALUES (?, ?, ?, "ranking", "global_rank", ?)',
            [rankUuid, profileId, platformId, nullIfUndefined(data.ranking)]
          );
        }
        break;

      case 'codechef':
        if (data.problems_solved && data.problems_solved.total !== undefined) {
          await connection.execute(
            'INSERT INTO coding_platform_data (id, profile_id, platform_id, data_type, metric_name, numeric_value) VALUES (?, ?, ?, "problems_solved", "total", ?)',
            [dataUuid, profileId, platformId, nullIfUndefined(data.problems_solved.total)]
          );
        }
        break;

      case 'hackerearth':
        if (data.metrics) {
          for (const [metric, value] of Object.entries(data.metrics)) {
            if (value !== undefined) {
              const metricUuid = randomUUID();
              await connection.execute(
                'INSERT INTO coding_platform_data (id, profile_id, platform_id, data_type, metric_name, numeric_value) VALUES (?, ?, ?, "problems_solved", ?, ?)',
                [metricUuid, profileId, platformId, metric, nullIfUndefined(value)]
              );
            }
          }
        }
        break;

      case 'hackerrank':
        // Store badges
        if (data.badges && Array.isArray(data.badges)) {
          for (const badge of data.badges) {
            if (badge && badge.name) {
              const badgeUuid = randomUUID();
              await connection.execute(
                'INSERT INTO coding_achievements (id, profile_id, platform_id, achievement_type, achievement_name, achievement_level, stars_count, achievement_data) VALUES (?, ?, ?, "badge", ?, ?, ?, ?)',
                [badgeUuid, profileId, platformId, badge.name, nullIfUndefined(badge.level), nullIfUndefined(badge.stars), JSON.stringify(badge)]
              );
            }
          }
        }
        break;

      case 'geeksforgeeks':
        // Store total problems
        if (data.problems_solved && data.problems_solved.total !== undefined) {
          await connection.execute(
            'INSERT INTO coding_platform_data (id, profile_id, platform_id, data_type, metric_name, numeric_value) VALUES (?, ?, ?, "problems_solved", "total", ?)',
            [dataUuid, profileId, platformId, nullIfUndefined(data.problems_solved.total)]
          );
        }

        // Store difficulty breakdown
        if (data.problems_solved) {
          for (const [difficulty, count] of Object.entries(data.problems_solved)) {
            if (difficulty !== 'total' && count !== undefined) {
              const diffUuid = randomUUID();
              await connection.execute(
                'INSERT INTO coding_platform_data (id, profile_id, platform_id, data_type, metric_name, numeric_value, difficulty_level) VALUES (?, ?, ?, "problems_solved", ?, ?, ?)',
                [diffUuid, profileId, platformId, difficulty, nullIfUndefined(count), difficulty]
              );
            }
          }
        }
        break;
    }
  }
}

export default new CodingPlatformService();
