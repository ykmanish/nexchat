import { Router } from 'express';
import * as transparency from '../controllers/transparency.controller.js';
import { authenticate, requireVerified } from '../middleware/auth.js';

const router = Router();
router.use(authenticate, requireVerified);

/* Scoped to the caller by construction — there is no route to anyone else's
   footprint, and no admin view. */
router.get('/me', transparency.whatWeKnow);

export default router;
