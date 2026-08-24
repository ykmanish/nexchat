import { Router, json } from 'express';
import * as sync from '../controllers/sync.controller.js';
import { authenticate, requireVerified } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import * as v from '../validators/index.js';

const router = Router();
router.use(authenticate, requireVerified);

/* The app-wide express.json() limit is 12 MB, which a full snapshot comfortably
   exceeds — so these routes parse with their own, larger ceiling. Without it the
   request is refused before the controller's size check ever runs, and the
   client sees an opaque 413 instead of a message it can act on. */
const bigJson = json({ limit: '52mb' });

router.get('/snapshot', sync.getSnapshot);
router.get('/snapshot/info', sync.getSnapshotInfo);
router.put('/snapshot', bigJson, validate(v.snapshotSchema), sync.putSnapshot);
router.delete('/snapshot', sync.deleteSnapshot);

export default router;
