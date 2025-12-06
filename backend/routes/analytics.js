import express from 'express';
import {
  getAnalyticsData,
  getCollegesForAnalytics,
  getDepartmentsForAnalytics,
  getStudentsForAnalytics,
  exportAnalyticsData,
  testAnalyticsConnection,
  // New course analytics endpoints
  getCourseAnalyticsData,
  getFacultyForAnalytics,
  getCourseCategories,
  // Save view functionality
  saveAnalyticsView,
  getSavedAnalyticsViews,
  getSavedAnalyticsView,
  // Chart annotations
  addChartAnnotation,
  getChartAnnotations,
  // Assessment details
  getAssessmentDetails,
  // Student submissions
  getAssessmentStudentSubmissions,
  getPublicStats
} from '../controllers/analyticsController.js';
import { authenticateToken } from '../middleware/auth.js';
import { validateCSRFToken } from '../middleware/csrf.js';

const router = express.Router();

// Test connection (no authentication required)
router.get('/test', testAnalyticsConnection);
router.get('/public-stats', getPublicStats);


// Apply authentication middleware to all other routes
router.use(authenticateToken);

// Assessment analytics
router.get('/data', getAnalyticsData);
router.get('/assessment/:assessmentId', getAssessmentDetails);
router.get('/assessment/:assessmentId/submissions', getAssessmentStudentSubmissions);



// Course analytics
router.get('/course-data', getCourseAnalyticsData);

// Filter data endpoints
router.get('/colleges', getCollegesForAnalytics);
router.get('/departments', getDepartmentsForAnalytics);
router.get('/students', getStudentsForAnalytics);
router.get('/faculty', getFacultyForAnalytics);
// Assessment types route removed since assessment_type column no longer exists
router.get('/course-categories', getCourseCategories);

// Export functionality
router.post('/export', validateCSRFToken, exportAnalyticsData);

// MEDIUM FIX: Export progress tracking endpoint
router.get('/export/progress/:exportId', async (req, res) => {
  try {
    const { exportId } = req.params;
    const exportProgressService = (await import('../services/exportProgressService.js')).default;
    const progress = exportProgressService.getProgress(exportId);
    res.json({
      success: true,
      data: progress
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get export progress'
    });
  }
});

// Save view functionality
router.post('/views', validateCSRFToken, saveAnalyticsView);
router.get('/views', getSavedAnalyticsViews);
router.get('/views/:viewId', getSavedAnalyticsView);

// Chart annotations
router.post('/annotations', validateCSRFToken, addChartAnnotation);
router.get('/annotations', getChartAnnotations);

export default router; 