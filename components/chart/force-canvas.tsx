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

const endId = (v: string | FNode) => (typeof v === "string" ? v : v.id);

const FOREST = "#163300";
const PAPER = "#FFFFFF";
const PEBBLE = "#868685";
const HAIRLINE = "rgba(14,15,12,0.15)";

/** Canvas renderer. Loaded with next/dynamic (ssr: false) by ChartView. force-graph scales the canvas by devicePixelRatio. */
export default function ForceCanvas({
  data,
  highlight,
  selectedId,
  onSelect,
  verdicts,
}: {
  data: { nodes: FNode[]; links: FLink[] };
  highlight: Set<string> | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Segment verdicts by node id; segments are filled with their verdict color. */
  verdicts?: Record<string, Verdict | undefined>;
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
    fg.current?.d3Force("charge")?.strength?.(-60);
  }, []);

  const dim = (id: string) => highlight !== null && !highlight.has(id);

  return (
    <div ref={wrap} className="absolute inset-0 font-sans">
      <ForceGraph2D<FNode, FLink>
        ref={fg}
        width={size.w}
        height={size.h}
        graphData={data}
        backgroundColor="rgba(0,0,0,0)"
        cooldownTicks={120}
        nodeId="id"
        nodeLabel={(n) => `${n.label}: ${n.name}`}
        nodeRelSize={1}
        nodeVal={(n) => (LABEL_SIZE[n.label] ?? 3) ** 2}
        nodeCanvasObject={(n, ctx, scale) => {
          const r = LABEL_SIZE[n.label] ?? 3;
          const x = n.x ?? 0;
          const y = n.y ?? 0;
          const faded = dim(n.id);
          const verdict = n.label === "Segment" ? verdicts?.[n.id] : undefined;
          // Simulated nodes (personas, unjudged segments) are outlined and dashed, never solid.
          const simulated = n.label === "Persona" || (n.label === "Segment" && (verdict ?? "PENDING") === "PENDING");
          ctx.globalAlpha = faded ? 0.15 : 1;

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
          if (isSelected || (highlight && highlight.has(n.id))) {
            ctx.lineWidth = (isSelected ? 2 : 1.25) / scale;
            ctx.strokeStyle = FOREST;
            ctx.beginPath();
            ctx.arc(x, y, r + 3 / scale + 0.5, 0, 2 * Math.PI);
            ctx.stroke();
          }

          const showLabel = !faded && (n.label === "Segment" || n.label === "Company" || n.label === "Person" || scale > 2.2 || isSelected);
          if (showLabel) {
            const fs = Math.max(12 / scale, 2.6);
            ctx.font = `600 ${fs}px ${fontFamily}`;
            ctx.textAlign = "center";
            ctx.textBaseline = "top";
            const text = n.name.length > 32 ? n.name.slice(0, 31) + "…" : n.name;
            const ty = y + r + 3 / scale + 1;
            ctx.lineJoin = "round";
            ctx.lineWidth = 3 / scale;
            ctx.strokeStyle = PAPER;
            ctx.strokeText(text, x, ty);
            ctx.fillStyle = FOREST;
            ctx.fillText(text, x, ty);
          }
          ctx.globalAlpha = 1;
        }}
        nodePointerAreaPaint={(n, color, ctx) => {
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(n.x ?? 0, n.y ?? 0, (LABEL_SIZE[n.label] ?? 3) + 2, 0, 2 * Math.PI);
          ctx.fill();
        }}
        linkColor={(l) => {
          const lit = highlight && highlight.has(endId(l.source)) && highlight.has(endId(l.target));
          if (lit) return "rgba(22,51,0,0.7)";
          if (highlight) return "rgba(14,15,12,0.05)";
          return l.type === "REFERRED_BY" ? "rgba(22,51,0,0.55)" : HAIRLINE;
        }}
        linkWidth={(l) => (l.type === "REFERRED_BY" ? 1.6 : 0.75)}
        linkLineDash={(l) => (l.type === "CONTRADICTS" ? [2, 2] : null)}
        linkDirectionalParticles={(l) => (l.type === "REFERRED_BY" ? 2 : 0)}
        linkDirectionalParticleColor={() => FOREST}
        linkDirectionalParticleWidth={2}
        onEngineStop={() => {
          if (fitted.current) return;
          fitted.current = true;
          fg.current?.zoomToFit(400, 48);
        }}
        onNodeClick={(n) => onSelect(n.id)}
        onBackgroundClick={() => onSelect(null)}
      />
    </div>
  );
}
