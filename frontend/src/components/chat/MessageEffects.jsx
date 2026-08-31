'use client';

import { useEffect, useRef } from 'react';
import { useUI } from '@/store/ui';
import { useAuth } from '@/store/auth';

/**
 * The full-screen flourish a message like "Happy birthday" sets off.
 *
 * Drawn on one canvas rather than as DOM nodes. Two hundred confetti pieces as
 * absolutely-positioned divs is two hundred elements the compositor has to lay
 * out and paint every frame, on top of a thread that is already scrolling; on
 * a canvas it is one element and a loop, and the whole thing costs about as
 * much as a single image.
 *
 * The overlay never takes pointer events and never blocks the thread — you can
 * keep typing straight through it. It removes itself when the last particle
 * dies, and refuses to run at all when the reader has asked for less motion.
 */

const DURATION = 2600;

export function MessageEffects() {
  const effect = useUI((s) => s.effect);
  const clearEffect = useUI((s) => s.clearEffect);
  const reduceMotion = useAuth((s) => s.user?.settings?.reduceMotion);
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!effect) return undefined;

    const systemReduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    if (reduceMotion || systemReduced) {
      clearEffect();
      return undefined;
    }

    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const ctx = canvas.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);

    const particles = build(effect.id, w, h);
    const started = performance.now();
    let raf = 0;

    const frame = (now) => {
      const elapsed = now - started;
      ctx.clearRect(0, 0, w, h);

      let alive = 0;
      for (const p of particles) {
        if (p.delay > elapsed) { alive += 1; continue; }
        step(p, effect.id, w, h);
        if (p.life > 0) { alive += 1; draw(ctx, p, effect.id); }
      }

      if (alive > 0 && elapsed < DURATION + 1200) {
        raf = requestAnimationFrame(frame);
      } else {
        ctx.clearRect(0, 0, w, h);
        clearEffect();
      }
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [effect, clearEffect, reduceMotion]);

  if (!effect) return null;

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[200]"
      style={{ width: '100%', height: '100%' }}
    />
  );
}

/* ────────────────────────────── the particles ──────────────────────────────
   Each effect is a starting arrangement plus a per-frame rule. Keeping them in
   plain functions rather than classes means the whole system is one array of
   objects and one switch, which is all it needs to be. */

const rand = (min, max) => min + Math.random() * (max - min);
const pick = (list) => list[Math.floor(Math.random() * list.length)];

const CONFETTI = ['#c1ff72', '#21c063', '#ffd166', '#ef476f', '#4cc9f0', '#f78c6b'];
const SPARK = ['#ffd166', '#ff9f1c', '#ef476f', '#4cc9f0', '#c1ff72', '#ffffff'];

function build(id, w, h) {
  const out = [];

  if (id === 'confetti') {
    for (let i = 0; i < 140; i += 1) {
      out.push({
        x: rand(0, w), y: rand(-h * 0.4, -10),
        vx: rand(-0.6, 0.6), vy: rand(2.2, 5),
        size: rand(5, 11), spin: rand(-0.22, 0.22), angle: rand(0, Math.PI * 2),
        colour: pick(CONFETTI), life: 1, delay: rand(0, 500),
      });
    }
    return out;
  }

  if (id === 'fireworks') {
    /* Three bursts, staggered, from points across the upper half — one burst
       in the middle reads as a mistake rather than as fireworks. */
    for (let b = 0; b < 3; b += 1) {
      const cx = rand(w * 0.2, w * 0.8);
      const cy = rand(h * 0.18, h * 0.45);
      const hue = pick(SPARK);
      for (let i = 0; i < 46; i += 1) {
        const a = (Math.PI * 2 * i) / 46 + rand(-0.05, 0.05);
        const speed = rand(2.4, 6.2);
        out.push({
          x: cx, y: cy,
          vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
          size: rand(2, 3.6), colour: hue, life: 1,
          delay: b * 420 + rand(0, 90), spin: 0, angle: 0,
        });
      }
    }
    return out;
  }

  if (id === 'hearts') {
    for (let i = 0; i < 34; i += 1) {
      out.push({
        x: rand(w * 0.1, w * 0.9), y: h + rand(10, 200),
        vx: rand(-0.35, 0.35), vy: rand(-1.9, -3.4),
        size: rand(16, 34), colour: pick(['#ef476f', '#ff6b9d', '#ff8fab', '#e63946']),
        life: 1, delay: rand(0, 900), spin: rand(-0.03, 0.03), angle: rand(-0.3, 0.3),
        sway: rand(0.01, 0.035), seed: rand(0, Math.PI * 2),
      });
    }
    return out;
  }

  if (id === 'stars') {
    for (let i = 0; i < 70; i += 1) {
      out.push({
        x: rand(0, w), y: rand(-40, h * 0.9),
        vx: rand(-0.15, 0.15), vy: rand(0.25, 0.9),
        size: rand(2, 5), colour: pick(['#ffe66d', '#fff3b0', '#ffffff', '#cdb4db']),
        life: 1, delay: rand(0, 800), spin: 0, angle: 0,
        seed: rand(0, Math.PI * 2), twinkle: rand(0.05, 0.14),
      });
    }
    return out;
  }

  // snow
  for (let i = 0; i < 90; i += 1) {
    out.push({
      x: rand(0, w), y: rand(-h * 0.5, -10),
      vx: rand(-0.3, 0.3), vy: rand(0.7, 2),
      size: rand(2, 5.5), colour: '#ffffff', life: 1, delay: rand(0, 700),
      spin: 0, angle: 0, sway: rand(0.008, 0.025), seed: rand(0, Math.PI * 2),
    });
  }
  return out;
}

function step(p, id, w, h) {
  p.age = (p.age || 0) + 1;

  if (id === 'fireworks') {
    p.vy += 0.055;          // gravity
    p.vx *= 0.985;          // drag
    p.vy *= 0.985;
    p.life -= 0.013;
  } else if (id === 'hearts') {
    p.x += Math.sin(p.age * p.sway + p.seed) * 0.8;
    p.vy *= 0.995;
    if (p.y < h * 0.12) p.life -= 0.02;
  } else if (id === 'stars') {
    p.life -= 0.004;
  } else if (id === 'snow') {
    p.x += Math.sin(p.age * p.sway + p.seed) * 0.5;
  } else {
    p.vy += 0.045;          // confetti falls under gravity
    p.angle += p.spin;
  }

  p.x += p.vx;
  p.y += p.vy;

  // Off the bottom is dead for anything that falls.
  if (p.y > h + 60) p.life = 0;
  if (p.y < -120) p.life = 0;
  if (p.x < -80 || p.x > w + 80) p.life = 0;
}

function draw(ctx, p, id) {
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, p.life));

  if (id === 'hearts') {
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle);
    heart(ctx, p.size, p.colour);
  } else if (id === 'stars') {
    // Twinkle: the alpha breathes rather than only fading out.
    ctx.globalAlpha *= 0.55 + 0.45 * Math.sin(p.age * p.twinkle + p.seed);
    ctx.fillStyle = p.colour;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
  } else if (id === 'confetti') {
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle);
    ctx.fillStyle = p.colour;
    ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
  } else {
    ctx.fillStyle = p.colour;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function heart(ctx, size, colour) {
  const s = size / 16;
  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.moveTo(0, 4 * s);
  ctx.bezierCurveTo(-8 * s, -4 * s, -4 * s, -10 * s, 0, -5 * s);
  ctx.bezierCurveTo(4 * s, -10 * s, 8 * s, -4 * s, 0, 4 * s);
  ctx.closePath();
  ctx.fill();
}
