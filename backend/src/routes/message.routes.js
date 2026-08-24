import { Router } from 'express';
import * as msg from '../controllers/message.controller.js';
import * as receipts from '../controllers/receipt.controller.js';
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
router.get('/:id/thread', msg.listThread);

/* Deletion receipts. The chain tip has to be readable before a device can sign
   its next receipt, so that route sits under the conversation rather than the
   message. */
router.get('/deletion-chain/:conversationId/tip', receipts.chainTip);
router.get('/deletion-chain/:conversationId/:deviceId', receipts.listChain);
router.get('/:id/deletion-receipts', receipts.listForMessage);
router.post('/:id/deletion-receipts', validate(v.deletionReceiptSchema), receipts.submitReceipt);
router.patch('/:id', validate(v.editMessageSchema), msg.editMessage);
router.delete('/:id', msg.deleteMessage);
router.post('/:id/reactions', validate(v.reactionSchema), msg.toggleReaction);
router.post('/:id/star', msg.toggleStar);
router.post('/:id/view-once', msg.openViewOnce);
router.post('/:id/vote', validate(v.voteSchema), msg.votePoll);
router.post('/:id/close-poll', msg.closePoll);
router.post('/:id/pin', msg.togglePin);

export default router;
