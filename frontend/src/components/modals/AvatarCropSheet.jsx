'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ZoomIn, ZoomOut, RotateCw, Loader2 } from 'lucide-react';
import { Sheet } from '@/components/ui/Sheet';
import { Button } from '@/components/ui/Button';
import { toast } from '@/store/ui';
import { cn } from '@/lib/utils';

/* What the viewer sees while cropping, and what the file ends up as. The two
   are independent: the frame is sized to the screen, the output is sized to
   what an avatar is ever displayed at. */
const OUT = 512;

/**
 * Choosing which part of a photo becomes the avatar.
 *
 * The server has always cropped to a square on its own, picking the region it
 * guesses is most interesting. That is a decent fallback and a poor decision —
 * it reliably cuts the top of somebody's head off in a portrait, and there was
 * no way to argue with it. Here the person doing the cropping is the person in
 * the photograph.
 *
 * The crop is applied in the browser, so what is uploaded is already the
 * square that was chosen; the server's own resize then has nothing left to
 * decide.
 */
export function AvatarCropSheet({ open, onClose, file, onCropped }) {
  const [url, setUrl] = useState(null);
  const [image, setImage] = useState(null);
  const [scale, setScale] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);

  const frameRef = useRef(null);
  const drag = useRef(null);

  /* Decode once per file. The object URL is revoked on the way out — an avatar
     is often a 12 MB phone photo and leaking one per attempt adds up. */
  useEffect(() => {
    if (!open || !file) return undefined;

    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    setImage(null);
    setScale(1);
    setRotation(0);
    setOffset({ x: 0, y: 0 });

    const img = new Image();
    img.onload = () => setImage(img);
    img.onerror = () => {
      toast.error('That image could not be opened');
      onClose?.();
    };
    img.src = objectUrl;

    return () => URL.revokeObjectURL(objectUrl);
  }, [open, file, onClose]);

  /* The frame is square and responsive, so its pixel size is read from the DOM
     rather than assumed. */
  const frameSize = () => frameRef.current?.clientWidth || 320;

  /** Scale at which the image exactly covers the frame — the floor for zoom. */
  const coverScale = useCallback(() => {
    if (!image) return 1;
    const size = frameSize();
    const swapped = rotation % 180 !== 0;
    const w = swapped ? image.naturalHeight : image.naturalWidth;
    const h = swapped ? image.naturalWidth : image.naturalHeight;
    return Math.max(size / w, size / h);
  }, [image, rotation]);

  /**
   * Keeps the frame covered.
   *
   * Without this the photo can be dragged away from under the frame, and the
   * crop comes back with a transparent wedge down one side — which then gets
   * uploaded, because nothing downstream is looking for it.
   */
  const clamp = useCallback(
    (next, atScale = scale) => {
      if (!image) return next;
      const size = frameSize();
      const base = coverScale() * atScale;
      const swapped = rotation % 180 !== 0;
      const w = (swapped ? image.naturalHeight : image.naturalWidth) * base;
      const h = (swapped ? image.naturalWidth : image.naturalHeight) * base;

      const slackX = Math.max(0, (w - size) / 2);
      const slackY = Math.max(0, (h - size) / 2);

      return {
        x: Math.min(slackX, Math.max(-slackX, next.x)),
        y: Math.min(slackY, Math.max(-slackY, next.y)),
      };
    },
    [image, scale, rotation, coverScale]
  );

  useEffect(() => {
    setOffset((current) => clamp(current));
    // Re-clamped whenever the geometry changes under it.
  }, [scale, rotation, clamp]);

  /* ── dragging ──
     Pointer events rather than mouse and touch handlers, so one code path
     covers a finger, a mouse and a trackpad, and setPointerCapture keeps the
     drag alive when the pointer leaves the frame mid-gesture. */

  const onPointerDown = (e) => {
    if (!image) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, from: offset };
  };

  const onPointerMove = (e) => {
    if (!drag.current) return;
    setOffset(
      clamp({
        x: drag.current.from.x + (e.clientX - drag.current.x),
        y: drag.current.from.y + (e.clientY - drag.current.y),
      })
    );
  };

  const endDrag = () => {
    drag.current = null;
  };

  const onWheel = (e) => {
    if (!image) return;
    setScale((s) => Math.min(4, Math.max(1, s - e.deltaY * 0.0016)));
  };

  /**
   * Turns what is under the frame into a square image.
   *
   * The frame is a window onto the photo at some scale, offset and rotation;
   * this maps that window back to source pixels and draws only those. Output
   * is a fixed 512 square, which is what the server stores anyway — so the
   * upload is smaller than the original by a wide margin as a side effect.
   */
  async function apply() {
    if (!image) return;
    setBusy(true);

    try {
      const size = frameSize();
      const base = coverScale() * scale;

      const canvas = document.createElement('canvas');
      canvas.width = OUT;
      canvas.height = OUT;
      const ctx = canvas.getContext('2d');

      // Fill first: a rotated photo can leave a corner uncovered for an instant,
      // and transparent pixels in a JPEG come out black.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, OUT, OUT);

      /* Work in output pixels: everything measured against the on-screen frame
         is scaled by the same factor, so the crop matches what was on screen
         whatever size the frame happened to be. */
      const k = OUT / size;

      ctx.save();
      ctx.translate(OUT / 2 + offset.x * k, OUT / 2 + offset.y * k);
      ctx.rotate((rotation * Math.PI) / 180);
      ctx.drawImage(
        image,
        (-image.naturalWidth * base * k) / 2,
        (-image.naturalHeight * base * k) / 2,
        image.naturalWidth * base * k,
        image.naturalHeight * base * k
      );
      ctx.restore();

      const blob = await new Promise((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', 0.92)
      );
      if (!blob) throw new Error('Could not prepare that image');

      // A File, not a bare Blob: the upload reads `name` off it, and the
      // server's filter reads the type.
      await onCropped(new File([blob], 'avatar.jpg', { type: 'image/jpeg' }));
      onClose?.();
    } catch (err) {
      toast.error(err.message || 'Could not save that photo');
    } finally {
      setBusy(false);
    }
  }

  const base = coverScale() * scale;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Position your photo"
      subtitle="Drag to move, pinch or scroll to zoom."
      size="md"
      dismissible={!busy}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={apply} loading={busy} disabled={!image}>
            Use photo
          </Button>
        </div>
      }
    >
      <div className="px-5 pb-5">
        <div
          ref={frameRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onWheel={onWheel}
          className={cn(
            'relative mx-auto aspect-square w-full max-w-[320px] touch-none select-none',
            'overflow-hidden rounded-2xl bg-surface-3',
            image ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'
          )}
        >
          {!image && (
            <div className="grid h-full w-full place-items-center text-ink-faint">
              <Loader2 size={22} className="animate-spin" />
            </div>
          )}

          {image && url && (
            <img
              src={url}
              alt=""
              draggable={false}
              style={{
                width: image.naturalWidth * base,
                height: image.naturalHeight * base,
                transform:
                  'translate(-50%, -50%) translate(' +
                  offset.x +
                  'px, ' +
                  offset.y +
                  'px) rotate(' +
                  rotation +
                  'deg)',
              }}
              className="pointer-events-none absolute left-1/2 top-1/2 max-w-none"
            />
          )}

          {/* The circle is where the photo will actually be seen, so it is
              drawn on top of it rather than described in a caption. Everything
              outside it is dimmed, not hidden — you still need to see what you
              are dragging. */}
          {image && (
            <div className="pointer-events-none absolute inset-0">
              <div className="absolute inset-0 bg-black/45 [mask-image:radial-gradient(circle_at_center,transparent_49.5%,black_50%)]" />
              <div className="absolute inset-[1px] rounded-full ring-2 ring-white/70" />
            </div>
          )}
        </div>

        {/* ── zoom ── */}
        <div className="mx-auto mt-4 flex max-w-[320px] items-center gap-3">
          <ZoomOut size={17} className="shrink-0 text-ink-faint" />
          <input
            type="range"
            min="1"
            max="4"
            step="0.01"
            value={scale}
            disabled={!image}
            onChange={(e) => setScale(Number(e.target.value))}
            aria-label="Zoom"
            className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-surface-3 accent-brand-strong"
          />
          <ZoomIn size={17} className="shrink-0 text-ink-faint" />

          <button
            type="button"
            disabled={!image}
            onClick={() => setRotation((r) => (r + 90) % 360)}
            aria-label="Rotate"
            title="Rotate"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-40"
          >
            <RotateCw size={17} />
          </button>
        </div>
      </div>
    </Sheet>
  );
}
