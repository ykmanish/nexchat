import { Router } from 'express';
import * as keys from '../controllers/keys.controller.js';
import { authenticate, requireVerified } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import * as v from '../validators/index.js';

const router = Router();
router.use(authenticate, requireVerified);

router.get('/bundles', keys.getBundles);
router.get('/roster', keys.getDeviceRoster);
router.get('/count', keys.preKeyCount);
router.get('/:userId', keys.getBundle);

router.post('/prekeys', validate(v.preKeysSchema), keys.uploadPreKeys);
router.post('/rotate-identity', validate(v.rotateIdentitySchema), keys.rotateIdentity);

export default router;
