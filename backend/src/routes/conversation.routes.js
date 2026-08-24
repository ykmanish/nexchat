import { Router } from 'express';
import * as conv from '../controllers/conversation.controller.js';
import { authenticate, requireVerified } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import * as v from '../validators/index.js';

const router = Router();
router.use(authenticate, requireVerified);

router.get('/', conv.listConversations);
router.post('/direct', validate(v.directSchema), conv.createDirect);
router.post('/group', validate(v.groupSchema), conv.createGroup);
router.post('/community', validate(v.communitySchema), conv.createCommunity);
router.post('/join/:code', conv.joinByInvite);

router.get('/:id', conv.getConversation);
router.patch('/:id', validate(v.updateConversationSchema), conv.updateConversation);
router.delete('/:id', conv.deleteConversation);

router.post('/:id/members', conv.addMembers);
router.delete('/:id/members/:userId', conv.removeMember);
router.post('/:id/leave', conv.leaveConversation);

router.get('/:id/bans', conv.listBans);
router.post('/:id/bans/:userId', validate(v.banSchema), conv.banMember);
router.delete('/:id/bans/:userId', conv.unbanMember);
router.patch('/:id/members/:userId/role', conv.setRole);

router.patch('/:id/state', validate(v.stateSchema), conv.updateState);
router.post('/:id/read', conv.markRead);
router.post('/:id/clear', conv.clearHistory);
router.get('/:id/invite', conv.getInvite);

export default router;
