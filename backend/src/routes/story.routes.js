import { Router } from 'express';
import * as story from '../controllers/upload.controller.js';
import { authenticate, requireVerified } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import * as v from '../validators/index.js';

const router = Router();
router.use(authenticate, requireVerified);

router.get('/', story.listStories);
router.post('/', validate(v.storySchema), story.createStory);
router.post('/:id/view', story.viewStory);
router.post('/:id/react', story.reactToStory);
router.get('/:id/viewers', story.storyViewers);
router.delete('/:id', story.deleteStory);

export default router;
