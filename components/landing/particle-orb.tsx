"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * The persona swarm as a sphere of points on a light canvas. Canvas 2D, depth-shaded, slow rotation.
 * Forest/spruce points with lime accents on the front face; flat fills, no glow.
 * Reduced motion: renders one still frame. Pauses when off-screen or the tab is hidden.
 */

const COUNT = 2400;
// canvas code may use hex (DESIGN.md): forest, spruce, lime
const FOREST = "#163300";
const SPRUCE = "#054d28";
const LIME = "#9fe870";

type Tone = 0 | 1 | 2; // forest | spruce | lime
const FILL: Record<Tone, string> = { 0: FOREST, 1: SPRUCE, 2: LIME };

interface Pt {
  x: number;
  y: number;
  z: number;
  phase: number;
  amp: number;
  tone: Tone;
}

function makePoints(): Pt[] {
  const pts: Pt[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  // seeded PRNG so server/client and reloads look the same
  let seed = 7;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  for (let i = 0; i < COUNT; i++) {
    const y = 1 - (i / (COUNT - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const th = golden * i;
    // jitter off the perfect lattice so it reads as a crowd, not a mesh
    const j = 0.035;
    const x = Math.cos(th) * r + (rand() - 0.5) * j;
    const z = Math.sin(th) * r + (rand() - 0.5) * j;
    const yy = y + (rand() - 0.5) * j;
    const len = Math.hypot(x, yy, z);
    // a few stragglers drift outside the shell
    const shell = rand() < 0.06 ? 1 + rand() * 0.18 : 1;
    const roll = rand();
    pts.push({
      x: (x / len) * shell,
      y: (yy / len) * shell,
      z: (z / len) * shell,
      phase: rand() * Math.PI * 2,
      amp: 0.008 + rand() * 0.02,
      tone: roll < 0.22 ? 2 : roll < 0.5 ? 1 : 0,
    });
  }
  return pts;
}

export function ParticleOrb({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const pts = makePoints();
    const n = pts.length;
    // projected positions, reused every frame
    const sx = new Float32Array(n);
    const sy = new Float32Array(n);
    const dz = new Float32Array(n);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    let w = 0;
    let h = 0;
    let dpr = 1;
    let raf = 0;
    let visible = true;
    let start = performance.now();
    let angleAtPause = 0.6;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = rect.width;
      h = rect.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const tilt = 0.38;
    const cosT = Math.cos(tilt);
    const sinT = Math.sin(tilt);

    const draw = (t: number) => {
      ctx.clearRect(0, 0, w, h);
      const R = Math.min(w, h) * 0.44;
      const cx = w / 2;
      const cy = h / 2;
      const a = angleAtPause + t * 0.00006;
      const cosA = Math.cos(a);
      const sinA = Math.sin(a);
      const breathe = t * 0.0011;
      const unit = Math.max(1, R / 220); // scale dot size with the orb

      for (let i = 0; i < n; i++) {
        const p = pts[i];
        const s = 1 + Math.sin(breathe + p.phase) * p.amp;
        // rotate around Y, then tilt around X
        const x1 = (p.x * cosA + p.z * sinA) * s;
        const z1 = (-p.x * sinA + p.z * cosA) * s;
        const y1 = p.y * s;
        const y2 = y1 * cosT - z1 * sinT;
        const z2 = y1 * sinT + z1 * cosT;
        const depth = (z2 + 1.2) / 2.4; // 0 back → 1 front
        const persp = 0.8 + depth * 0.3;
        sx[i] = cx + x1 * R * persp;
        sy[i] = cy + y2 * R * persp;
        dz[i] = depth;
      }

      // back face first, then front, so front dots sit on top
      for (let pass = 0; pass < 2; pass++) {
        for (let i = 0; i < n; i++) {
          const depth = dz[i];
          if ((depth >= 0.5) !== (pass === 1)) continue;
          const tone = pts[i].tone;
          // lime only reads on the front face; at the back it becomes a pale forest speck
          const lime = tone === 2 && depth >= 0.5;
          const size = (0.9 + depth * 1.9) * unit * (lime ? 1.25 : 1);
          ctx.globalAlpha = lime ? 0.55 + depth * 0.45 : 0.05 + depth * depth * 0.8;
          ctx.fillStyle = lime ? LIME : FILL[tone === 2 ? 0 : tone];
          ctx.fillRect(sx[i] - size / 2, sy[i] - size / 2, size, size);
        }
      }
      ctx.globalAlpha = 1;
    };

    const loop = (now: number) => {
      draw(now - start);
      raf = requestAnimationFrame(loop);
    };

    const play = () => {
      cancelAnimationFrame(raf);
      if (reduce.matches || !visible || document.hidden) {
        draw(0);
        return;
      }
      raf = requestAnimationFrame(loop);
    };

    const pause = () => {
      angleAtPause += (performance.now() - start) * 0.00006;
      start = performance.now();
      cancelAnimationFrame(raf);
    };

    resize();
    play();

    const ro = new ResizeObserver(() => {
      resize();
      if (reduce.matches || !visible) draw(0);
    });
    ro.observe(canvas);

    const io = new IntersectionObserver(([entry]) => {
      const was = visible;
      visible = entry.isIntersecting;
      if (was && !visible) pause();
      if (!was && visible) play();
    });
    io.observe(canvas);

    const onVis = () => (document.hidden ? pause() : play());
    document.addEventListener("visibilitychange", onVis);
    const onMotion = () => play();
    reduce.addEventListener("change", onMotion);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      reduce.removeEventListener("change", onMotion);
    };
  }, []);

  return <canvas ref={canvasRef} aria-hidden className={cn("block h-full w-full", className)} />;
}
