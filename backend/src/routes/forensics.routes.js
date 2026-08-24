import { Router } from 'express';
import * as forensics from '../controllers/forensics.controller.js';
import { authenticate, requireVerified } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import * as v from '../validators/index.js';

const router = Router();

/* Public, and that is the point: an examiner holding an export has no account
   here, and evidence only checkable from inside the system under examination is
   not independently verifiable. */
router.get('/authority', forensics.getAuthority);
router.get('/attestation/:exportId', forensics.lookupAttestation);

router.post(
  '/attest',
  authenticate,
  requireVerified,
  validate(v.attestSchema),
  forensics.createAttestation
);
router.get('/exports', authenticate, requireVerified, forensics.listMine);

export default router;
