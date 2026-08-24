'use client';

import { api } from './api';
import { vault } from './vault';

/**
 * Resumable uploads.
 *
 * A single POST is fine for a photo and hopeless for a 40 MB video on a train:
 * one dropped connection and the whole thing starts over. Here the blob is cut
 * into fixed chunks that can go up in any order, so a failure costs only the
 * chunks that were in flight — and because the server can be asked which ones
 * landed, an upload survives a reload, a tunnel, or a closed tab.
 *
 * Sessions are remembered in the vault against a fingerprint of the blob, which
 * is what makes resume-after-reload possible: the same file picked again finds
 * the session it was halfway through instead of starting a second one.
 */

const CHUNK_SIZE = 1024 * 1024;
const CONCURRENCY = 3;
const MAX_ATTEMPTS = 4;
const SESSIONS_KEY = 'uploadSessions';
const SESSION_TTL_MS = 20 * 60 * 60 * 1000; // under the server's 24h sweep

const sha256 = async (bytes) =>
  bytesToB64url(await crypto.subtle.digest('SHA-256', bytes));

function bytesToB64url(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 1) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/* ─────────────────────────── session bookkeeping ─────────────────────────── */

async function loadSessions() {
  const all = (await vault.getMeta(SESSIONS_KEY)) || {};
  const now = Date.now();
  // Prune as we read: a session the server has already swept is worse than no
  // session at all, because resuming it would 404 on every chunk.
  const live = Object.fromEntries(
    Object.entries(all).filter(([, s]) => now - (s.at || 0) < SESSION_TTL_MS)
  );
  if (Object.keys(live).length !== Object.keys(all).length) {
    await vault.setMeta(SESSIONS_KEY, live);
  }
  return live;
}

async function rememberSession(fingerprint, session) {
  const all = await loadSessions();
  all[fingerprint] = { ...session, at: Date.now() };
  await vault.setMeta(SESSIONS_KEY, all);
}

async function forgetSession(fingerprint) {
  const all = await loadSessions();
  delete all[fingerprint];
  await vault.setMeta(SESSIONS_KEY, all);
}

/* ───────────────────────────── the upload ───────────────────────────── */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Retries on anything that looks transient; gives up immediately on a 4xx. */
async function withRetry(fn, { signal } = {}) {
  let lastError;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    if (signal?.aborted) throw new Error('Upload cancelled');
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      // A rejected chunk will be rejected again; only 5xx, timeouts and network
      // failures are worth another go.
      const status = err.status;
      if (status && status >= 400 && status < 500) throw err;
      if (attempt === MAX_ATTEMPTS) break;
      await sleep(Math.min(2 ** attempt * 250, 4000));
    }
  }
  throw lastError;
}

/**
 * Uploads a blob, resuming an interrupted attempt at the same bytes if there is
 * one. `onProgress` is called with a 0–1 fraction.
 *
 * The blob is expected to be *already encrypted* — this layer only moves bytes
 * and has no idea what is in them.
 */
export async function upload(blob, { bucket = 'media', onProgress, signal } = {}) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const checksum = await sha256(bytes);
  // Size is in the fingerprint too: two different files could in principle be
  // handed to us mid-stream, and the digest alone is the expensive half.
  const fingerprint = bucket + ':' + bytes.length + ':' + checksum;

  const session = await resumeOrBegin({ fingerprint, bytes, bucket, checksum });
  const { id, chunkSize, chunks } = session;

  const pending = new Set(
    Array.from({ length: chunks }, (_, i) => i).filter((i) => !session.received.includes(i))
  );
  let done = chunks - pending.size;
  const report = () => onProgress?.(chunks ? done / chunks : 1);
  report();

  const queue = [...pending];
  const worker = async () => {
    while (queue.length) {
      if (signal?.aborted) throw new Error('Upload cancelled');
      const index = queue.shift();
      const part = bytes.slice(index * chunkSize, Math.min((index + 1) * chunkSize, bytes.length));

      await withRetry(
        () =>
          api.put('/uploads/resumable/' + id + '/' + index, part, {
            headers: { 'Content-Type': 'application/octet-stream' },
            // Chunks are small but a bad connection is a bad connection.
            timeout: 60_000,
          }),
        { signal }
      );

      done += 1;
      report();
    }
  };

  try {
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length || 1) }, worker));

    const { data } = await withRetry(
      () => api.post('/uploads/resumable/' + id + '/complete'),
      { signal }
    );
    await forgetSession(fingerprint);
    return data.file;
  } catch (err) {
    // The session is deliberately kept on failure — that is the whole point.
    // Only an explicit cancel tears it down.
    if (signal?.aborted) {
      await api.delete('/uploads/resumable/' + id).catch(() => {});
      await forgetSession(fingerprint);
    }
    throw err;
  }
}

/** Picks up a stored session if the server still has it, else starts fresh. */
async function resumeOrBegin({ fingerprint, bytes, bucket, checksum }) {
  const remembered = (await loadSessions())[fingerprint];

  if (remembered?.id) {
    try {
      const { data } = await api.get('/uploads/resumable/' + remembered.id);
      if (!data.upload.complete) {
        return {
          id: data.upload.id,
          chunkSize: data.upload.chunkSize,
          chunks: data.upload.chunks,
          received: data.upload.received,
        };
      }
    } catch {
      // Expired or swept. Fall through and begin again.
      await forgetSession(fingerprint);
    }
  }

  const { data } = await api.post('/uploads/resumable', {
    size: bytes.length,
    chunkSize: CHUNK_SIZE,
    bucket,
    checksum,
  });

  const session = {
    id: data.upload.id,
    chunkSize: data.upload.chunkSize,
    chunks: data.upload.chunks,
    received: data.upload.received || [],
  };
  await rememberSession(fingerprint, session);
  return session;
}

/**
 * Small blobs skip all of the above.
 *
 * Three round trips to move 40 KB is worse than one, and the failure it protects
 * against — losing a chunk of a file that fits in a single packet burst — is not
 * one worth paying for.
 */
const SINGLE_SHOT_LIMIT = 512 * 1024;

export async function send(blob, { bucket = 'media', onProgress, signal, filename } = {}) {
  if (blob.size <= SINGLE_SHOT_LIMIT) {
    const form = new FormData();
    form.append('files', blob, filename || 'blob.bin');

    const { data } = await api.post('/uploads/' + shortBucket(bucket), form, {
      signal,
      onUploadProgress: (e) => onProgress?.(e.total ? e.loaded / e.total : 0),
    });
    onProgress?.(1);
    return data.files[0];
  }

  return upload(blob, { bucket, onProgress, signal });
}

// The single-shot routes are named for what they carry, not for their bucket.
const shortBucket = (bucket) => (bucket === 'stories' ? 'story-media' : bucket);

/** Uploads that could still be picked up, for a "resume?" prompt. */
export async function pendingUploads() {
  const all = await loadSessions();
  return Object.entries(all).map(([fingerprint, s]) => ({
    fingerprint,
    id: s.id,
    chunks: s.chunks,
    received: (s.received || []).length,
    at: s.at,
  }));
}

export async function cancelAll() {
  const all = await loadSessions();
  await Promise.all(
    Object.values(all).map((s) => api.delete('/uploads/resumable/' + s.id).catch(() => {}))
  );
  await vault.setMeta(SESSIONS_KEY, {});
}
