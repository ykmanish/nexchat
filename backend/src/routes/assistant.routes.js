import { Router } from 'express';
import * as assistant from '../controllers/assistant.controller.js';
import { authenticate, requireVerified } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { assistantHandleSchema } from '../validators/index.js';

const router = Router();
router.use(authenticate, requireVerified);

router.post('/direct', assistant.assistantDirect);
router.post('/conversations/:id/invite', assistant.inviteAssistant);
router.post('/handle', validate(assistantHandleSchema), assistant.handleAssistant);

export default router;
