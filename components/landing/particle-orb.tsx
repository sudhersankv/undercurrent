"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * The persona swarm as a sphere of points. Canvas 2D, depth-shaded, slow rotation.
 * Reduced motion: renders one still frame. Pauses when off-screen or the tab is hidden.
 */

const COUNT = 2600;
const LICHEN: [number, number, number] = [216, 245, 162];
const WHITE: [number, number, number] = [244, 250, 245];

interface Pt {
  x: number;
  y: number;
  z: number;
  phase: number;
  amp: number;
  lichen: boolean;
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
    pts.push({
      x: (x / len) * shell,
      y: (yy / len) * shell,
      z: (z / len) * shell,
      phase: rand() * Math.PI * 2,
      amp: 0.008 + rand() * 0.02,
      lichen: rand() < 0.28,
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
      const R = Math.min(w, h) * 0.42;
      const cx = w / 2;
      const cy = h / 2;
      const a = angleAtPause + t * 0.00006;
      const cosA = Math.cos(a);
      const sinA = Math.sin(a);
      const breathe = t * 0.0011;

      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const s = 1 + Math.sin(breathe + p.phase) * p.amp;
        // rotate around Y, then tilt around X
        const x1 = (p.x * cosA + p.z * sinA) * s;
        const z1 = (-p.x * sinA + p.z * cosA) * s;
        const y1 = p.y * s;
        const y2 = y1 * cosT - z1 * sinT;
        const z2 = y1 * sinT + z1 * cosT;

        const depth = (z2 + 1.2) / 2.4; // 0 back → 1 front
        const persp = 0.78 + depth * 0.32;
        const sx = cx + x1 * R * persp;
        const sy = cy + y2 * R * persp;
        const size = (0.6 + depth * 1.5) * (p.lichen ? 1.1 : 1);
        const alpha = 0.06 + depth * depth * (p.lichen ? 0.92 : 0.72);
        const c = p.lichen ? LICHEN : WHITE;
        ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${alpha.toFixed(3)})`;
        ctx.fillRect(sx - size / 2, sy - size / 2, size, size);
      }
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
