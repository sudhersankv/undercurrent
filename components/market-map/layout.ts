/** Pixel-space layout for the market map: node de-overlap, callout and label placement with collision avoidance. */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LayoutNode {
  id: string;
  /** True data position in px. */
  ox: number;
  oy: number;
  r: number;
  /** Higher places its label first. */
  priority: number;
  name: string;
  tag?: string;
}

export interface PlacedNode extends LayoutNode {
  /** Displayed position after de-overlap. */
  x: number;
  y: number;
}

export interface PlacedLabel {
  id: string;
  /** Text box (tag + text). */
  box: Rect;
  text: string;
  truncated: boolean;
  tagW: number;
  leader: { x1: number; y1: number; x2: number; y2: number } | null;
}

export interface PlacedCallout {
  box: Rect;
  leader: { x1: number; y1: number; x2: number; y2: number };
}

export type Measure = (text: string, size: number) => number;

const overlap = (a: Rect, b: Rect, pad = 0) => a.x < b.x + b.w + pad && a.x + a.w + pad > b.x && a.y < b.y + b.h + pad && a.y + a.h + pad > b.y;
const inside = (a: Rect, b: Rect) => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;
const circleRect = (n: { x: number; y: number; r: number }, pad = 0): Rect => ({ x: n.x - n.r - pad, y: n.y - n.r - pad, w: (n.r + pad) * 2, h: (n.r + pad) * 2 });

/** Push overlapping bubbles apart while a weak spring keeps each near its true position. Deterministic. */
export function relax(nodes: LayoutNode[], bounds: Rect, gap = 4): PlacedNode[] {
  const out: PlacedNode[] = nodes.map((n) => ({ ...n, x: n.ox, y: n.oy }));
  for (let it = 0; it < 160; it++) {
    let moved = false;
    for (let i = 0; i < out.length; i++)
      for (let j = i + 1; j < out.length; j++) {
        const a = out[i];
        const b = out[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d = Math.hypot(dx, dy);
        const min = a.r + b.r + gap;
        if (d >= min) continue;
        if (d < 0.01) {
          // Identical points: split along a stable diagonal.
          const t = ((i * 7 + j * 13) % 8) * (Math.PI / 4);
          dx = Math.cos(t);
          dy = Math.sin(t);
          d = 1;
        }
        const push = (min - d) / 2;
        const ux = dx / d;
        const uy = dy / d;
        a.x -= ux * push;
        a.y -= uy * push;
        b.x += ux * push;
        b.y += uy * push;
        moved = true;
      }
    for (const n of out) {
      n.x += (n.ox - n.x) * 0.04;
      n.y += (n.oy - n.y) * 0.04;
      n.x = Math.min(bounds.x + bounds.w - n.r, Math.max(bounds.x + n.r, n.x));
      n.y = Math.min(bounds.y + bounds.h - n.r, Math.max(bounds.y + n.r, n.y));
    }
    if (!moved && it > 4) break;
  }
  return out;
}

export const LABEL_SIZE = 12;
export const LABEL_H = 18;
export const TAG_SIZE = 10;

function truncate(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** Place a forest callout pill near `target`, away from nodes and other obstacles. */
export function placeCallout(target: PlacedNode, w: number, h: number, nodes: PlacedNode[], obstacles: Rect[], bounds: Rect): PlacedCallout | null {
  const d = target.r + 34;
  const cands: [number, number][] = [
    [-1, -1],
    [1, -1],
    [0, -1.2],
    [-1.2, 0],
    [-1, 1],
    [1, 1],
    [0, 1.2],
    [1.2, 0],
  ];
  for (const scale of [1, 1.6, 2.3]) {
    for (const [cx, cy] of cands) {
      const ax = target.x + cx * d * scale;
      const ay = target.y + cy * d * scale * 0.8;
      const box: Rect = { x: cx < 0 ? ax - w : cx > 0 ? ax : ax - w / 2, y: cy < 0 ? ay - h : cy > 0 ? ay : ay - h / 2, w, h };
      if (!inside(box, bounds)) continue;
      if (nodes.some((n) => overlap(box, circleRect(n), 4))) continue;
      if (obstacles.some((o) => overlap(box, o, 4))) continue;
      const px = Math.min(box.x + box.w, Math.max(box.x, target.x));
      const py = Math.min(box.y + box.h, Math.max(box.y, target.y));
      const ang = Math.atan2(py - target.y, px - target.x);
      return { box, leader: { x1: target.x + Math.cos(ang) * (target.r + 4), y1: target.y + Math.sin(ang) * (target.r + 4), x2: px, y2: py } };
    }
  }
  return null;
}

/**
 * Greedy label placement. Tries adjacent slots first, then offset slots with a leader line,
 * then a shorter truncation. Labels that still collide are dropped (the hover card names them).
 */
export function placeLabels(nodes: PlacedNode[], obstacles: Rect[], bounds: Rect, measure: Measure, opts: { force?: Set<string>; maxChars?: number } = {}): PlacedLabel[] {
  const placed: PlacedLabel[] = [];
  const taken: Rect[] = [...obstacles];
  const order = [...nodes].sort((a, b) => b.priority - a.priority);
  const maxChars = opts.maxChars ?? 30;

  for (const n of order) {
    const forced = opts.force?.has(n.id) ?? false;
    const lengths = forced ? [Math.max(maxChars, 44), maxChars] : [maxChars, 20, 14];
    let done = false;
    for (const max of lengths) {
      const text = truncate(n.name, max);
      const tagW = n.tag ? measure(n.tag, TAG_SIZE) + 12 + 6 : 0;
      const w = Math.ceil(measure(text, LABEL_SIZE) + tagW + 4);
      const h = LABEL_H;
      const g = 6;
      const off = 14;
      const slots: { box: Rect; leader: boolean }[] = [
        { box: { x: n.x + n.r + g, y: n.y - h / 2, w, h }, leader: false },
        { box: { x: n.x - n.r - g - w, y: n.y - h / 2, w, h }, leader: false },
        { box: { x: n.x - w / 2, y: n.y - n.r - 3 - h, w, h }, leader: false },
        { box: { x: n.x - w / 2, y: n.y + n.r + 3, w, h }, leader: false },
        { box: { x: n.x + n.r + off, y: n.y - n.r - off - h / 2, w, h }, leader: true },
        { box: { x: n.x + n.r + off, y: n.y + n.r + off - h / 2, w, h }, leader: true },
        { box: { x: n.x - n.r - off - w, y: n.y - n.r - off - h / 2, w, h }, leader: true },
        { box: { x: n.x - n.r - off - w, y: n.y + n.r + off - h / 2, w, h }, leader: true },
        { box: { x: n.x + n.r + off * 2, y: n.y - h / 2 - h * 1.4, w, h }, leader: true },
        { box: { x: n.x + n.r + off * 2, y: n.y - h / 2 + h * 1.4, w, h }, leader: true },
        { box: { x: n.x - n.r - off * 2 - w, y: n.y - h / 2 - h * 1.4, w, h }, leader: true },
        { box: { x: n.x - n.r - off * 2 - w, y: n.y - h / 2 + h * 1.4, w, h }, leader: true },
      ];
      for (const s of slots) {
        if (!inside(s.box, bounds)) continue;
        if (taken.some((t) => overlap(s.box, t, 2))) continue;
        if (nodes.some((m) => overlap(s.box, circleRect(m), 1))) continue;
        let leader: PlacedLabel["leader"] = null;
        if (s.leader) {
          const px = Math.min(s.box.x + s.box.w, Math.max(s.box.x, n.x));
          const py = s.box.y + s.box.h / 2;
          const ang = Math.atan2(py - n.y, px - n.x);
          leader = { x1: n.x + Math.cos(ang) * (n.r + 2), y1: n.y + Math.sin(ang) * (n.r + 2), x2: px + (px === s.box.x ? -2 : px === s.box.x + s.box.w ? 2 : 0), y2: py };
        }
        placed.push({ id: n.id, box: s.box, text, truncated: text !== n.name, tagW, leader });
        taken.push(s.box);
        done = true;
        break;
      }
      if (done) break;
    }
  }
  return placed;
}

let ctx: CanvasRenderingContext2D | null = null;

/** Text measurer backed by a canvas, with a char-width fallback for SSR/tests. */
export function makeMeasure(fontFamily: string): Measure {
  const cache = new Map<string, number>();
  return (text, size) => {
    const key = `${size}|${text}`;
    const hit = cache.get(key);
    if (hit != null) return hit;
    let w = text.length * size * 0.56;
    if (typeof document !== "undefined") {
      ctx ??= document.createElement("canvas").getContext("2d");
      if (ctx) {
        ctx.font = `600 ${size}px ${fontFamily}`;
        w = ctx.measureText(text).width;
      }
    }
    cache.set(key, w);
    return w;
  };
}
