import { Router } from 'express';
import { linkPreview } from '../controllers/link.controller.js';
import { authenticate, requireVerified } from '../middleware/auth.js';
import { apiLimiter } from '../middleware/rateLimit.js';

const router = Router();

// Authenticated only — this endpoint fetches arbitrary URLs on request.
router.get('/preview', authenticate, requireVerified, apiLimiter, linkPreview);

export default router;
