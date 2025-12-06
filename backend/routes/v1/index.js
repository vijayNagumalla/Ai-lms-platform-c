// LOW PRIORITY FIX: API Versioning - v1 routes
// This allows for future API versions without breaking existing clients

import express from 'express';
import authRoutes from '../auth.js';
import assessmentRoutes from '../assessments.js';
import questionBankRoutes from '../questionBank.js';
import userManagementRoutes from '../userManagement.js';
import collegeRoutes from '../colleges.js';
import analyticsRoutes from '../analytics.js';
import emailRoutes from '../email.js';
import codingRoutes from '../coding.js';
import superAdminRoutes from '../superAdmin.js';
import codingProfileRoutes from '../codingProfiles.js';
import bulkUploadRoutes from '../bulkUpload.js';
import batchRoutes from '../batches.js';
import studentAssessmentRoutes from '../studentAssessments.js';
import notificationRoutes from '../notifications.js';
import aiRoutes from '../ai.js';

const router = express.Router();

// Mount all v1 routes
router.use('/auth', authRoutes);
router.use('/assessments', assessmentRoutes);
router.use('/question-bank', questionBankRoutes);
router.use('/users', userManagementRoutes);
router.use('/colleges', collegeRoutes);
router.use('/analytics', analyticsRoutes);
router.use('/email', emailRoutes);
router.use('/coding', codingRoutes);
router.use('/super-admin', superAdminRoutes);
router.use('/coding-profiles', codingProfileRoutes);
router.use('/bulk-upload', bulkUploadRoutes);
router.use('/batches', batchRoutes);
router.use('/student-assessments', studentAssessmentRoutes);
router.use('/notifications', notificationRoutes);
router.use('/ai', aiRoutes);

export default router;

