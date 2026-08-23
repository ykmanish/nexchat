import { Router } from 'express';
import * as device from '../controllers/device.controller.js';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { authLimiter } from '../middleware/rateLimit.js';
import * as v from '../validators/index.js';

const router = Router();

// The new device has no session yet, so these three are deliberately open.
router.post('/link/init', authLimiter, validate(v.initLinkSchema), device.initLink);
router.get('/vapid-public-key', device.vapidKey);
router.get('/link/:code/status', device.linkStatus);
router.post('/link/claim', validate(v.claimLinkSchema), device.claimLink);

router.use(authenticate);

router.get('/', device.listDevices);
router.patch('/:deviceId', device.renameDevice);
router.delete('/:deviceId', device.revokeDevice);
router.post('/revoke-others', device.revokeAllOtherDevices);
router.post('/push-subscription', device.updatePushSubscription);

router.post('/link/scan', validate(v.linkCodeSchema), device.scanLink);
router.post('/link/approve', validate(v.approveLinkSchema), device.approveLink);
router.post('/link/reject', validate(v.linkCodeSchema), device.rejectLink);

export default router;
