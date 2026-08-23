import { Router } from 'express';
import * as up from '../controllers/upload.controller.js';
import { authenticate, requireVerified } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { handleUpload, uploadMedia, setBucket } from '../middleware/upload.js';
import { uploadLimiter } from '../middleware/rateLimit.js';
import * as v from '../validators/index.js';

const router = Router();
router.use(authenticate, requireVerified);

router.post('/media', uploadLimiter, setBucket('media'), handleUpload(uploadMedia), up.uploadFiles);
router.post('/voice', uploadLimiter, setBucket('voice'), handleUpload(uploadMedia), up.uploadFiles);
router.post('/story-media', uploadLimiter, setBucket('stories'), handleUpload(uploadMedia), up.uploadFiles);
router.delete('/:bucket/:filename', up.deleteUpload);

export default router;
