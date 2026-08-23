import { Router } from 'express';
import * as msg from '../controllers/message.controller.js';
import { authenticate, requireVerified } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import * as v from '../validators/index.js';

const router = Router();
router.use(authenticate, requireVerified);

router.get('/starred', msg.listStarred);
router.get('/search-window', msg.searchWindow);
router.get('/conversation/:conversationId', msg.listMessages);
router.get('/conversation/:conversationId/media', msg.listMedia);

router.post('/', validate(v.sendMessageSchema), msg.sendMessage);
router.post('/forward', validate(v.forwardSchema), msg.forwardMessages);
router.post('/delivered', validate(v.receiptSchema), msg.markDelivered);
router.post('/delete-many', validate(v.deleteManySchema), msg.deleteMany);

router.get('/:id', msg.getMessage);
router.patch('/:id', validate(v.editMessageSchema), msg.editMessage);
router.delete('/:id', msg.deleteMessage);
router.post('/:id/reactions', validate(v.reactionSchema), msg.toggleReaction);
router.post('/:id/star', msg.toggleStar);
router.post('/:id/view-once', msg.openViewOnce);
router.post('/:id/vote', validate(v.voteSchema), msg.votePoll);
router.post('/:id/close-poll', msg.closePoll);
router.post('/:id/pin', msg.togglePin);

export default router;
