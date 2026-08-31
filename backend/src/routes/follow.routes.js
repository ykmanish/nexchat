import { Router } from 'express';
import * as follow from '../controllers/follow.controller.js';
import { authenticate, requireVerified } from '../middleware/auth.js';

const router = Router();
router.use(authenticate, requireVerified);

router.get('/suggestions', follow.suggestions);
router.get('/search', follow.searchPeople);

router.get('/:userId/followers', follow.followers);
router.get('/:userId/following', follow.following);
router.post('/:userId', follow.follow);
router.delete('/:userId', follow.unfollow);

export default router;
