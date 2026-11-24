"use client";

import { useEffect, useRef, useState } from "react";
import ForceGraph2D, { type ForceGraphMethods } from "react-force-graph-2d";
import type { NodeLabel } from "@/lib/graph/types";
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

/** Canvas renderer. Loaded with next/dynamic (ssr: false) by ChartView. */
export default function ForceCanvas({
  data,
  highlight,
  selectedId,
  onSelect,
}: {
  data: { nodes: FNode[]; links: FLink[] };
  highlight: Set<string> | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const fg = useRef<ForceGraphMethods<FNode, FLink> | undefined>(undefined);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const fitted = useRef(false);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.floor(e.contentRect.width), h: Math.floor(e.contentRect.height) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    fg.current?.d3Force("charge")?.strength?.(-60);
  }, []);

  const dim = (id: string) => highlight !== null && !highlight.has(id);

  return (
    <div ref={wrap} className="absolute inset-0">
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
          const faded = dim(n.id);
          ctx.globalAlpha = faded ? 0.12 : 1;
          ctx.beginPath();
          ctx.arc(n.x ?? 0, n.y ?? 0, r, 0, 2 * Math.PI);
          ctx.fillStyle = LABEL_COLOR[n.label] ?? "#B3C4B8";
          ctx.fill();
          if (n.id === selectedId || (highlight && highlight.has(n.id))) {
            ctx.lineWidth = 1.5 / scale;
            ctx.strokeStyle = "#F4FAF5";
            ctx.beginPath();
            ctx.arc(n.x ?? 0, n.y ?? 0, r + 2.5, 0, 2 * Math.PI);
            ctx.stroke();
          }
          const showLabel = !faded && (n.label === "Segment" || n.label === "Company" || n.label === "Person" || scale > 2.2 || n.id === selectedId);
          if (showLabel) {
            const fs = Math.max(10 / scale, 2.2);
            ctx.font = `${fs}px var(--font-geist-sans), sans-serif`;
            ctx.fillStyle = "#B3C4B8";
            ctx.textAlign = "center";
            ctx.textBaseline = "top";
            const text = n.name.length > 32 ? n.name.slice(0, 31) + "…" : n.name;
            ctx.fillText(text, n.x ?? 0, (n.y ?? 0) + r + 2);
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
          if (lit) return "rgba(216,245,162,0.8)";
          if (highlight) return "rgba(244,250,245,0.03)";
          return l.type === "REFERRED_BY" ? "rgba(216,245,162,0.7)" : "rgba(244,250,245,0.12)";
        }}
        linkWidth={(l) => (l.type === "REFERRED_BY" ? 1.6 : 0.6)}
        linkLineDash={(l) => (l.type === "CONTRADICTS" ? [2, 2] : null)}
        linkDirectionalParticles={(l) => (l.type === "REFERRED_BY" ? 2 : 0)}
        linkDirectionalParticleColor={() => "#D8F5A2"}
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
