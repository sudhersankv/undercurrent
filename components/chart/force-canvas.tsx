"use client";

import { useEffect, useRef, useState } from "react";
import ForceGraph2D, { type ForceGraphMethods } from "react-force-graph-2d";
import type { Verdict } from "@/lib/contracts";
import type { NodeLabel } from "@/lib/graph/types";
import { VERDICT_COLORS } from "@/components/ui/verdict-chip";
import { LABEL_COLOR, LABEL_SIZE } from "./derive";

export interface FNode {
  id: string;
  label: NodeLabel;
  name: string;
  x?: number;
  y?: number;
}
export interface FLink {
  id: string;
  type: string;
  source: string | FNode;
  target: string | FNode;
}

/** Imperative camera controls, filled in once the canvas mounts. */
export interface ChartApi {
  zoomIn: () => void;
  zoomOut: () => void;
  fit: () => void;
}

/** 0 = key nodes only, 1 = more, 2 = every label. Zooming in reveals more regardless. */
export type LabelDensity = 0 | 1 | 2;

const endId = (v: string | FNode) => (typeof v === "string" ? v : v.id);

const FOREST = "#163300";
const PAPER = "#FFFFFF";
const PEBBLE = "#868685";
const HAIRLINE = "rgba(14,15,12,0.15)";

const LABEL_RANK: Partial<Record<NodeLabel, number>> = { Company: 100, Segment: 80, Person: 60, Competitor: 50, Capability: 40, Outcome: 35, Draft: 30, Repo: 20, Evidence: 15, Persona: 10, Tech: 5, Product: 90 };

function wantsLabel(n: FNode, density: LabelDensity, scale: number, verdict: Verdict | undefined): boolean {
  if (density === 2) return true;
  if (n.label === "Company" || n.label === "Product") return true;
  if (n.label === "Segment") return density >= 1 || verdict === "VERIFIED" || verdict === "PROMISING" || scale > 1.6;
  if (density === 1) return n.label === "Person" || n.label === "Competitor" || n.label === "Outcome" || scale > 2.2;
  return scale > 3.2 && n.label !== "Persona" ? true : scale > 5;
}

/** Canvas renderer. Loaded with next/dynamic (ssr: false) by ChartView. force-graph scales the canvas by devicePixelRatio. */
export default function ForceCanvas({
  data,
  highlight,
  selectedId,
  hoverId,
  onSelect,
  onHover,
  verdicts,
  density = 0,
  apiRef,
}: {
  data: { nodes: FNode[]; links: FLink[] };
  highlight: Set<string> | null;
  selectedId: string | null;
  hoverId?: string | null;
  onSelect: (id: string | null) => void;
  onHover?: (id: string | null) => void;
  /** Segment verdicts by node id; segments are filled with their verdict color. */
  verdicts?: Record<string, Verdict | undefined>;
  density?: LabelDensity;
  apiRef?: React.MutableRefObject<ChartApi | null>;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const fg = useRef<ForceGraphMethods<FNode, FLink> | undefined>(undefined);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [fontFamily, setFontFamily] = useState("Inter, ui-sans-serif, system-ui, sans-serif");
  const fitted = useRef(false);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    // Canvas can't resolve CSS variables, so read the resolved Inter family once.
    const ff = getComputedStyle(el).fontFamily;
    if (ff) setFontFamily(ff);
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.floor(e.contentRect.width), h: Math.floor(e.contentRect.height) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    fg.current?.d3Force("charge")?.strength?.(-70);
    if (!apiRef) return;
    apiRef.current = {
      zoomIn: () => fg.current && fg.current.zoom(fg.current.zoom() * 1.5, 250),
      zoomOut: () => fg.current && fg.current.zoom(fg.current.zoom() / 1.5, 250),
      fit: () => fg.current?.zoomToFit(400, 56),
    };
    return () => {
      apiRef.current = null;
    };
  }, [apiRef]);

  useEffect(() => {
    if (!selectedId) return;
    const n = data.nodes.find((d) => d.id === selectedId);
    if (n?.x != null && n.y != null) fg.current?.centerAt(n.x, n.y, 500);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const dim = (id: string) => highlight !== null && !highlight.has(id);
  const radius = (n: FNode) => (LABEL_SIZE[n.label] ?? 3) * 1.35;

  return (
    <div ref={wrap} className="absolute inset-0 font-sans">
      <ForceGraph2D<FNode, FLink>
        ref={fg}
        width={size.w}
        height={size.h}
        graphData={data}
        backgroundColor="rgba(0,0,0,0)"
        cooldownTicks={120}
        minZoom={0.3}
        maxZoom={12}
        nodeId="id"
        nodeLabel={() => ""}
        nodeRelSize={1}
        nodeVal={(n) => radius(n) ** 2}
        nodeCanvasObject={(n, ctx, scale) => {
          const r = radius(n);
          const x = n.x ?? 0;
          const y = n.y ?? 0;
          const faded = dim(n.id);
          const verdict = n.label === "Segment" ? verdicts?.[n.id] : undefined;
          // Simulated nodes (personas, unjudged segments) are outlined and dashed, never solid.
          const simulated = n.label === "Persona" || (n.label === "Segment" && (verdict ?? "PENDING") === "PENDING");
          ctx.globalAlpha = faded ? 0.12 : 1;

          if (n.id === hoverId && !faded) {
            ctx.beginPath();
            ctx.arc(x, y, r + 6 / scale + 1.5, 0, 2 * Math.PI);
            ctx.fillStyle = "#E2F6D5";
            ctx.fill();
          }

          ctx.beginPath();
          ctx.arc(x, y, r, 0, 2 * Math.PI);
          ctx.fillStyle = simulated ? PAPER : verdict ? VERDICT_COLORS[verdict] : (LABEL_COLOR[n.label] ?? PEBBLE);
          ctx.fill();
          ctx.lineWidth = (simulated || n.label === "Segment" ? 1.5 : 1) / scale;
          ctx.strokeStyle = simulated ? PEBBLE : n.label === "Segment" ? LABEL_COLOR.Segment : HAIRLINE;
          ctx.setLineDash(simulated ? [3 / scale, 2 / scale] : []);
          ctx.stroke();
          ctx.setLineDash([]);

          const isSelected = n.id === selectedId;
          if (isSelected) {
            ctx.lineWidth = 2 / scale;
            ctx.strokeStyle = FOREST;
            ctx.beginPath();
            ctx.arc(x, y, r + 3 / scale + 0.5, 0, 2 * Math.PI);
            ctx.stroke();
          }
          ctx.globalAlpha = 1;
        }}
        onRenderFramePost={(ctx, scale) => {
          // Labels go last, in priority order. Each tries below, above, right, left and skips if all collide.
          const fs = 12 / scale;
          ctx.font = `600 ${fs}px ${fontFamily}`;
          ctx.textAlign = "left";
          ctx.textBaseline = "top";
          ctx.lineJoin = "round";
          type Box = [number, number, number, number];
          const placed: Box[] = [];
          const overlaps = (a: Box, b: Box) => a[0] < b[0] + b[2] && a[0] + a[2] > b[0] && a[1] < b[1] + b[3] && a[1] + a[3] > b[1];
          const visibleNodes = data.nodes.filter((n) => n.x != null && !dim(n.id));
          const onNode = (s: Box, self: FNode) =>
            visibleNodes.some((m) => {
              if (m === self) return false;
              const r = radius(m);
              return overlaps(s, [(m.x ?? 0) - r, (m.y ?? 0) - r, r * 2, r * 2]);
            });
          const focusSet = highlight && highlight.size <= 40 ? highlight : null;
          // Keep labels inside the visible canvas (shift them in rather than clip at the edge).
          const tl = fg.current?.screen2GraphCoords(0, 0);
          const br = fg.current?.screen2GraphCoords(size.w, size.h);
          const inView = (s: Box): Box => {
            if (!tl || !br) return s;
            const pad = 4 / scale;
            const nx = Math.min(br.x - s[2] - pad, Math.max(tl.x + pad, s[0]));
            const ny = Math.min(br.y - s[3] - pad, Math.max(tl.y + pad, s[1]));
            return [nx, ny, s[2], s[3]];
          };
          // Same name on two nodes (the company and its product): say which is which.
          const names = new Map<string, number>();
          for (const n of visibleNodes) names.set(n.name, (names.get(n.name) ?? 0) + 1);
          const ranked = visibleNodes
            .map((n) => {
              const forced = n.id === selectedId || n.id === hoverId || (focusSet?.has(n.id) ?? false);
              return { n, forced, rank: (forced ? 1000 : 0) + (n.id === hoverId ? 500 : 0) + (n.id === selectedId ? 400 : 0) + (LABEL_RANK[n.label] ?? 0) };
            })
            .filter(({ n, forced }) => forced || wantsLabel(n, density, scale, verdicts?.[n.id]))
            .sort((a, b) => b.rank - a.rank);
          for (const { n, forced } of ranked) {
            const max = forced ? 48 : 28;
            const full = (names.get(n.name) ?? 0) > 1 && n.label !== "Company" ? `${n.name} (${n.label.toLowerCase()})` : n.name;
            const text = full.length > max ? `${full.slice(0, max - 1).trimEnd()}…` : full;
            const w = ctx.measureText(text).width + 4 / scale;
            const h = fs * 1.25;
            const x = n.x ?? 0;
            const y = n.y ?? 0;
            const g = radius(n) + 3 / scale + 1;
            const slots: Box[] = (
              [
                [x - w / 2, y + g, w, h],
                [x - w / 2, y - g - h, w, h],
                [x + g, y - h / 2, w, h],
                [x - g - w, y - h / 2, w, h],
              ] as Box[]
            ).map(inView);
            const free = slots.filter((s) => !placed.some((b) => overlaps(s, b)));
            let slot = free.find((s) => !onNode(s, n)) ?? free[0];
            if (!slot && n.id === hoverId) slot = slots[0];
            if (!slot) continue;
            placed.push(slot);
            ctx.lineWidth = 3.5 / scale;
            ctx.strokeStyle = PAPER;
            ctx.strokeText(text, slot[0] + 2 / scale, slot[1]);
            ctx.fillStyle = n.label === "Persona" ? "#6a6c6a" : n.id === hoverId || n.id === selectedId ? FOREST : "#0e0f0c";
            ctx.fillText(text, slot[0] + 2 / scale, slot[1]);
          }
        }}
        nodePointerAreaPaint={(n, color, ctx) => {
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(n.x ?? 0, n.y ?? 0, radius(n) + 2, 0, 2 * Math.PI);
          ctx.fill();
        }}
        linkColor={(l) => {
          const lit = highlight && highlight.has(endId(l.source)) && highlight.has(endId(l.target));
          if (lit) return "rgba(22,51,0,0.7)";
          if (highlight) return "rgba(14,15,12,0.04)";
          return l.type === "REFERRED_BY" ? "rgba(22,51,0,0.55)" : HAIRLINE;
        }}
        linkWidth={(l) => {
          const lit = highlight && highlight.has(endId(l.source)) && highlight.has(endId(l.target));
          return l.type === "REFERRED_BY" ? 1.6 : lit ? 1.25 : 0.75;
        }}
        linkLineDash={(l) => (l.type === "CONTRADICTS" ? [2, 2] : null)}
        linkDirectionalParticles={(l) => (l.type === "REFERRED_BY" ? 2 : 0)}
        linkDirectionalParticleColor={() => FOREST}
        linkDirectionalParticleWidth={2}
        onEngineStop={() => {
          if (fitted.current) return;
          fitted.current = true;
          fg.current?.zoomToFit(400, 56);
        }}
        onNodeHover={(n) => {
          onHover?.(n?.id ?? null);
          if (wrap.current) wrap.current.style.cursor = n ? "pointer" : "";
        }}
        onNodeClick={(n) => onSelect(n.id)}
        onBackgroundClick={() => onSelect(null)}
      />
    </div>
  );
}