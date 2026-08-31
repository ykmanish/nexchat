import { Router } from 'express';
import * as calls from '../controllers/call.controller.js';
import { authenticate, requireVerified } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import * as v from '../validators/index.js';

const router = Router();
router.use(authenticate, requireVerified);

/* Before /links/:code so "ice" is never read as a link code. */
router.get('/ice', calls.iceServers);

router.post('/links', validate(v.callLinkSchema), calls.createLink);
router.get('/links', calls.listLinks);

/* The code is the address, so these sit under it rather than under an id. */
router.get('/links/:code', calls.inspectLink);
router.post('/links/:code/join', calls.joinLink);
router.post('/links/:code/knock', calls.decideKnock);
router.delete('/links/:code', calls.revokeLink);

export default router;
