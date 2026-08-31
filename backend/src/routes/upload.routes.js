import { Router, raw } from 'express';
import * as up from '../controllers/upload.controller.js';
import * as resumable from '../controllers/resumable.controller.js';
import { authenticate, requireVerified } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { handleUpload, uploadMedia, uploadPost, setBucket } from '../middleware/upload.js';
import { uploadLimiter } from '../middleware/rateLimit.js';
import * as v from '../validators/index.js';

const router = Router();
router.use(authenticate, requireVerified);

router.post('/media', uploadLimiter, setBucket('media'), handleUpload(uploadMedia), up.uploadFiles);
router.post('/voice', uploadLimiter, setBucket('voice'), handleUpload(uploadMedia), up.uploadFiles);
router.post('/story-media', uploadLimiter, setBucket('stories'), handleUpload(uploadMedia), up.uploadFiles);
/* Feed photos are processed server-side rather than parked as-is: they are
   plaintext, so resizing and the blur placeholder can happen here. */
router.post('/post-media', uploadLimiter, setBucket('posts'), handleUpload(uploadPost), up.uploadPostMedia);
/* Resumable uploads. The chunk body is raw bytes, not JSON, so it gets its own
   parser — the app-wide express.json() would reject it and the 12 MB JSON limit
   is unrelated to what a chunk is allowed to be. */
router.post('/resumable', uploadLimiter, resumable.beginUpload);
router.get('/resumable/:id', resumable.uploadStatus);
router.put(
  '/resumable/:id/:index',
  raw({ type: '*/*', limit: '9mb' }),
  resumable.putChunk
);
router.post('/resumable/:id/complete', resumable.completeUpload);
router.delete('/resumable/:id', resumable.abortUpload);

router.delete('/:bucket/:filename', up.deleteUpload);

export default router;
