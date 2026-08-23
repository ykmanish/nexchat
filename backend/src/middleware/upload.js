import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { env, rootDir } from '../config/env.js';
import { shortId } from '../utils/ids.js';
import { ApiError } from '../utils/ApiError.js';

const uploadRoot = path.resolve(rootDir, env.upload.dir);
for (const sub of ['media', 'avatars', 'stories', 'voice']) {
  fs.mkdirSync(path.join(uploadRoot, sub), { recursive: true });
}

const storage = multer.diskStorage({
  destination(req, _file, cb) {
    const bucket = req.uploadBucket || 'media';
    cb(null, path.join(uploadRoot, bucket));
  },
  filename(_req, file, cb) {
    // Encrypted blobs carry no meaningful extension — keep the original one
    // only for avatars, which are stored unencrypted by design.
    const ext = path.extname(file.originalname).slice(0, 10) || '.bin';
    cb(null, `${Date.now().toString(36)}-${shortId()}${ext}`);
  },
});

const limits = { fileSize: env.upload.maxMb * 1024 * 1024, files: 10 };

export const uploadMedia = multer({ storage, limits }).array('files', 10);

export const uploadAvatar = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter(_req, file, cb) {
    if (!/^image\/(png|jpe?g|webp|gif|avif)$/.test(file.mimetype)) {
      return cb(ApiError.badRequest('Avatars must be a PNG, JPEG, WebP or GIF', 'BAD_MIME'));
    }
    cb(null, true);
  },
}).single('avatar');

export const setBucket = (bucket) => (req, _res, next) => {
  req.uploadBucket = bucket;
  next();
};

/** Wraps a multer handler so its errors flow into our ApiError shape. */
export const handleUpload = (mw) => (req, res, next) =>
  mw(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      const map = {
        LIMIT_FILE_SIZE: `Files must be under ${env.upload.maxMb} MB`,
        LIMIT_FILE_COUNT: 'Too many files at once',
        LIMIT_UNEXPECTED_FILE: 'Unexpected file field',
      };
      return next(ApiError.badRequest(map[err.code] || 'Upload failed', err.code));
    }
    next(err);
  });

export { uploadRoot };
