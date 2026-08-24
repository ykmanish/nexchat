import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { uploadRoot } from '../middleware/upload.js';
import { shortId } from '../utils/ids.js';

/**
 * Chunked, resumable uploads.
 *
 * The single-shot POST is fine for a photo and hopeless for a 40 MB video on a
 * train: one dropped connection and the whole thing starts again. Here the
 * client cuts the (already encrypted) blob into fixed chunks, sends them in any
 * order, and can ask at any time which ones landed — so a resume after a
 * reload, a tunnel or a dead battery costs only the chunks that were in flight.
 *
 * Chunks are parked in a per-upload directory and concatenated on completion.
 * Session state lives in a sidecar JSON file rather than the database: it is
 * short-lived, worthless if lost, and belongs next to the bytes it describes.
 */

const SESSION_ROOT = path.join(uploadRoot, 'incomplete');
const BUCKETS = ['media', 'voice', 'stories'];
const MAX_CHUNK = 8 * 1024 * 1024;
const DEFAULT_CHUNK = 1 * 1024 * 1024;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CHUNKS = 4096;

await fs.mkdir(SESSION_ROOT, { recursive: true });

const sessionDir = (id) => path.join(SESSION_ROOT, id);
const metaPath = (id) => path.join(sessionDir(id), 'session.json');

/** Ids are generated here, but they still arrive back over the wire. */
const safeId = (id) => /^[a-z0-9]{8,40}$/.test(String(id || ''));

async function readSession(id, userId) {
  if (!safeId(id)) throw ApiError.badRequest('Bad upload id', 'BAD_ID');

  let meta;
  try {
    meta = JSON.parse(await fs.readFile(metaPath(id), 'utf8'));
  } catch {
    throw ApiError.notFound('That upload has expired — start it again', 'NO_SESSION');
  }

  // Scoped to its owner: an upload id is a bearer token for a directory, and
  // two people uploading at once must not be able to reach each other's parts.
  if (String(meta.user) !== String(userId)) {
    throw ApiError.notFound('That upload has expired — start it again', 'NO_SESSION');
  }
  return meta;
}

const writeSession = (id, meta) =>
  fs.writeFile(metaPath(id), JSON.stringify(meta), 'utf8');

/** Which chunk indices are already on disk. */
async function receivedChunks(id) {
  const entries = await fs.readdir(sessionDir(id)).catch(() => []);
  return entries
    .filter((n) => n.startsWith('chunk.'))
    .map((n) => Number.parseInt(n.slice(6), 10))
    .filter((n) => Number.isInteger(n) && n >= 0)
    .sort((a, b) => a - b);
}

/** Best-effort sweep of abandoned sessions, run when a new one starts. */
async function sweep() {
  const now = Date.now();
  const entries = await fs.readdir(SESSION_ROOT).catch(() => []);
  await Promise.all(
    entries.map(async (name) => {
      try {
        const stat = await fs.stat(path.join(SESSION_ROOT, name));
        if (now - stat.mtimeMs > SESSION_TTL_MS) {
          await fs.rm(path.join(SESSION_ROOT, name), { recursive: true, force: true });
        }
      } catch {
        /* another request may have just removed it */
      }
    })
  );
}

/* ──────────────────────────────── create ──────────────────────────────── */

export const beginUpload = asyncHandler(async (req, res) => {
  const size = Number(req.body.size);
  const bucket = BUCKETS.includes(req.body.bucket) ? req.body.bucket : 'media';
  const chunkSize = Math.min(
    Math.max(Number(req.body.chunkSize) || DEFAULT_CHUNK, 64 * 1024),
    MAX_CHUNK
  );

  const maxBytes = env.upload.maxMb * 1024 * 1024;
  if (!Number.isFinite(size) || size <= 0) {
    throw ApiError.badRequest('A size is required', 'NO_SIZE');
  }
  if (size > maxBytes) {
    throw ApiError.badRequest('Files must be under ' + env.upload.maxMb + ' MB', 'TOO_LARGE');
  }

  const chunks = Math.ceil(size / chunkSize);
  if (chunks > MAX_CHUNKS) throw ApiError.badRequest('Use a larger chunk size', 'TOO_MANY_CHUNKS');

  sweep().catch(() => {});

  const id = shortId() + shortId().slice(0, 4);
  const meta = {
    id,
    user: String(req.user._id),
    bucket,
    size,
    chunkSize,
    chunks,
    /** Optional client-side digest, checked at completion when supplied. */
    checksum: typeof req.body.checksum === 'string' ? req.body.checksum.slice(0, 128) : null,
    createdAt: new Date().toISOString(),
  };

  await fs.mkdir(sessionDir(id), { recursive: true });
  await writeSession(id, meta);

  res.status(201).json({
    success: true,
    upload: { id, chunkSize, chunks, size, bucket, received: [] },
  });
});

/* ──────────────────────────────── status ──────────────────────────────── */

/** Lets a client that has just come back from the dead ask what it still owes. */
export const uploadStatus = asyncHandler(async (req, res) => {
  const meta = await readSession(req.params.id, req.user._id);
  const received = await receivedChunks(meta.id);

  res.json({
    success: true,
    upload: {
      id: meta.id,
      size: meta.size,
      chunkSize: meta.chunkSize,
      chunks: meta.chunks,
      bucket: meta.bucket,
      received,
      missing: Array.from({ length: meta.chunks }, (_, i) => i).filter(
        (i) => !received.includes(i)
      ),
      complete: received.length === meta.chunks,
    },
  });
});

/* ──────────────────────────────── chunks ──────────────────────────────── */

export const putChunk = asyncHandler(async (req, res) => {
  const meta = await readSession(req.params.id, req.user._id);
  const index = Number.parseInt(req.params.index, 10);

  if (!Number.isInteger(index) || index < 0 || index >= meta.chunks) {
    throw ApiError.badRequest('Chunk index out of range', 'BAD_INDEX');
  }

  const body = req.body;
  if (!Buffer.isBuffer(body) || !body.length) {
    throw ApiError.badRequest('Empty chunk', 'NO_CHUNK');
  }

  // Every chunk but the last has to be exactly chunkSize, or the offsets that
  // concatenation relies on stop lining up.
  const isLast = index === meta.chunks - 1;
  const expected = isLast ? meta.size - index * meta.chunkSize : meta.chunkSize;
  if (body.length !== expected) {
    throw ApiError.badRequest(
      'Chunk ' + index + ' should be ' + expected + ' bytes, got ' + body.length,
      'BAD_CHUNK_SIZE'
    );
  }

  // Written to a temp name and renamed, so a connection that dies mid-write
  // cannot leave a short chunk looking like a complete one.
  const target = path.join(sessionDir(meta.id), 'chunk.' + index);
  const temp = target + '.part';
  await fs.writeFile(temp, body);
  await fs.rename(temp, target);

  const received = await receivedChunks(meta.id);
  res.json({
    success: true,
    index,
    received: received.length,
    chunks: meta.chunks,
    complete: received.length === meta.chunks,
  });
});

/* ─────────────────────────────── complete ─────────────────────────────── */

export const completeUpload = asyncHandler(async (req, res) => {
  const meta = await readSession(req.params.id, req.user._id);
  const received = await receivedChunks(meta.id);

  if (received.length !== meta.chunks) {
    const missing = Array.from({ length: meta.chunks }, (_, i) => i).filter(
      (i) => !received.includes(i)
    );
    throw ApiError.badRequest('Still missing ' + missing.length + ' chunk(s)', 'INCOMPLETE', {
      missing: missing.slice(0, 64),
    });
  }

  const filename = Date.now().toString(36) + '-' + shortId() + '.bin';
  const finalPath = path.join(uploadRoot, meta.bucket, filename);

  const out = await fs.open(finalPath, 'w');
  const hash = crypto.createHash('sha256');
  try {
    for (let i = 0; i < meta.chunks; i += 1) {
      const part = await fs.readFile(path.join(sessionDir(meta.id), 'chunk.' + i));
      hash.update(part);
      await out.write(part);
    }
  } finally {
    await out.close();
  }

  const digest = hash.digest('base64url');
  if (meta.checksum && meta.checksum !== digest) {
    // A mismatch means the bytes on disk are not the bytes the client sent, so
    // the assembled file is thrown away rather than handed back as good.
    await fs.unlink(finalPath).catch(() => {});
    await fs.rm(sessionDir(meta.id), { recursive: true, force: true }).catch(() => {});
    throw ApiError.badRequest('The upload did not verify — send it again', 'CHECKSUM_MISMATCH');
  }

  const stat = await fs.stat(finalPath);
  await fs.rm(sessionDir(meta.id), { recursive: true, force: true }).catch(() => {});

  res.status(201).json({
    success: true,
    file: {
      id: path.basename(filename, '.bin'),
      url: '/uploads/' + meta.bucket + '/' + filename,
      size: stat.size,
      checksum: digest,
    },
  });
});

export const abortUpload = asyncHandler(async (req, res) => {
  const meta = await readSession(req.params.id, req.user._id);
  await fs.rm(sessionDir(meta.id), { recursive: true, force: true }).catch(() => {});
  res.json({ success: true });
});
