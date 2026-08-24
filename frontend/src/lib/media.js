'use client';

/**
 * Client-side media preparation, before anything is encrypted or uploaded.
 *
 * A phone camera produces 4–12 MB per photo, almost none of which survives being
 * displayed in a chat bubble. Shrinking here rather than on the server is not
 * just polite about bandwidth — it is the only place it *can* happen, because by
 * the time the bytes leave the browser they are ciphertext and the server could
 * not resize them if it wanted to.
 *
 * Rules that matter:
 *   - Never enlarge. An image already smaller than the target is left alone.
 *   - Never re-encode when it would not help; a 200 KB photo does not need it.
 *   - Never touch animation. Canvas flattens a GIF to its first frame, so
 *     animated formats are passed through untouched.
 *   - Never silently degrade a document. Compression is for images sent *as*
 *     images; a PNG attached as a file keeps every byte.
 */

const PRESETS = {
  // Long edge, roughly two retina-widths of a chat bubble.
  photo: { maxEdge: 1920, quality: 0.82 },
  // What a story is displayed at, full-bleed on a tall screen.
  story: { maxEdge: 1440, quality: 0.85 },
  avatar: { maxEdge: 512, quality: 0.9 },
};

const THUMB_EDGE = 32; // deliberately tiny: it is a blur, not a preview
const SKIP_BELOW_BYTES = 128 * 1024;
const ANIMATED = /^image\/(gif|apng)$/;

export const isImage = (file) => /^image\//.test(file?.type || '');
export const isVideo = (file) => /^video\//.test(file?.type || '');

/** WebP where the browser will take it, JPEG otherwise. */
let preferredType = null;
function outputType() {
  if (preferredType) return preferredType;
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const webp = canvas.toDataURL('image/webp').startsWith('data:image/webp');
  preferredType = webp ? 'image/webp' : 'image/jpeg';
  return preferredType;
}

/** Scaled dimensions that fit inside `maxEdge`, or the originals if smaller. */
function fit(width, height, maxEdge) {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height, scaled: false };
  const ratio = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
    scaled: true,
  };
}

/** OffscreenCanvas where available; a detached <canvas> elsewhere (Safari). */
async function draw(bitmap, width, height, type, quality) {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, width, height);
    return canvas.convertToBlob({ type, quality });
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Shrinks an image and reports its dimensions.
 *
 * Always resolves to something usable: if anything in the pipeline fails —
 * an exotic codec, a canvas the browser refuses to read — the original file is
 * returned rather than the send being lost.
 */
export async function compressImage(file, preset = 'photo') {
  const { maxEdge, quality } = PRESETS[preset] || PRESETS.photo;
  const fallback = { blob: file, width: null, height: null, compressed: false };

  if (!isImage(file) || ANIMATED.test(file.type)) return fallback;

  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return fallback;
  }

  try {
    const target = fit(bitmap.width, bitmap.height, maxEdge);

    // Nothing to gain: already small enough in both bytes and pixels.
    if (!target.scaled && file.size < SKIP_BELOW_BYTES) {
      return { blob: file, width: bitmap.width, height: bitmap.height, compressed: false };
    }

    const type = outputType();
    const blob = await draw(bitmap, target.width, target.height, type, quality);

    // Re-encoding can make a small PNG *bigger*. Keep whichever won.
    if (!blob || blob.size >= file.size) {
      return { blob: file, width: bitmap.width, height: bitmap.height, compressed: false };
    }

    return {
      blob: new File([blob], renamed(file.name, type), { type }),
      width: target.width,
      height: target.height,
      compressed: true,
      savedBytes: file.size - blob.size,
    };
  } catch {
    return fallback;
  } finally {
    bitmap.close?.();
  }
}

const renamed = (name, type) =>
  (name || 'image').replace(/\.[^.]+$/, '') + (type === 'image/webp' ? '.webp' : '.jpg');

/**
 * A 32px blur placeholder, as a data URL.
 *
 * Small enough to ride along inside the encrypted message envelope, which is
 * why it is worth having at all: the bubble can show something immediately
 * without a second round trip for the real bytes.
 */
export async function makeThumbnail(file) {
  try {
    const bitmap = await createImageBitmap(file);
    const target = fit(bitmap.width, bitmap.height, THUMB_EDGE);
    const blob = await draw(bitmap, target.width, target.height, 'image/jpeg', 0.5);
    bitmap.close?.();
    if (!blob) return null;

    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/**
 * Grabs a still from a video, for the bubble and the thumbnail.
 *
 * Seeks a little way in rather than to zero: the first frame of a phone
 * recording is very often black.
 */
export async function videoPoster(file, { at = 0.5 } = {}) {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'metadata';
  video.src = url;

  try {
    await new Promise((resolve, reject) => {
      const fail = () => reject(new Error('Could not read that video'));
      video.onloadedmetadata = () => {
        video.currentTime = Math.min(at, (video.duration || 1) / 2);
      };
      video.onseeked = resolve;
      video.onerror = fail;
      setTimeout(fail, 8000);
    });

    const target = fit(video.videoWidth, video.videoHeight, PRESETS.photo.maxEdge);
    const canvas = document.createElement('canvas');
    canvas.width = target.width;
    canvas.height = target.height;
    canvas.getContext('2d').drawImage(video, 0, 0, target.width, target.height);

    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.8));
    return {
      poster: blob,
      width: video.videoWidth,
      height: video.videoHeight,
      duration: Math.round(video.duration || 0),
    };
  } catch {
    return { poster: null, width: null, height: null, duration: null };
  } finally {
    URL.revokeObjectURL(url);
    video.src = '';
  }
}

/**
 * One call for the whole preparation step: shrink what benefits from it, read
 * dimensions, and produce the blur placeholder.
 *
 * `asDocument` is the escape hatch — the user chose "file", so the bytes are the
 * point and nothing is touched.
 */
export async function prepare(file, { preset = 'photo', asDocument = false } = {}) {
  if (asDocument) {
    return { blob: file, kind: 'file', width: null, height: null, thumbnail: null };
  }

  if (isImage(file)) {
    const { blob, width, height, compressed, savedBytes } = await compressImage(file, preset);
    return {
      blob,
      kind: ANIMATED.test(file.type) ? 'gif' : 'image',
      width,
      height,
      thumbnail: await makeThumbnail(blob),
      compressed,
      savedBytes,
      originalSize: file.size,
    };
  }

  if (isVideo(file)) {
    const { poster, width, height, duration } = await videoPoster(file);
    return {
      blob: file, // transcoding video in a browser is not worth what it costs
      kind: 'video',
      width,
      height,
      duration,
      thumbnail: poster ? await makeThumbnail(poster) : null,
      originalSize: file.size,
    };
  }

  return {
    blob: file,
    kind: /^audio\//.test(file.type) ? 'audio' : 'file',
    width: null,
    height: null,
    thumbnail: null,
    originalSize: file.size,
  };
}

export const formatBytes = (n) => {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  return (n / 1024 ** i).toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
};
