import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { validateCSRFToken } from '../middleware/csrf.js';
import {
  chatWithGemini,
  fetchConnectorContext,
  getRoleConnectors
} from '../controllers/aiController.js';

const router = express.Router();

router.use(authenticateToken);

router.get('/connectors', getRoleConnectors);
router.post('/context', validateCSRFToken, fetchConnectorContext);
router.post('/chat', validateCSRFToken, chatWithGemini);

export default router;

