"use client";

import * as React from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import * as Switch from "@radix-ui/react-switch";
import { FileText, Radar, Users } from "lucide-react";
import type { Verdict } from "@/lib/contracts";
import { useRunStream, type RunStore, type SegmentView } from "@/lib/client/run-store";
import { VERDICT_COLORS, VerdictChip } from "@/components/ui";
import { SegmentDrawer } from "@/components/segment-drawer";
import { cn } from "@/lib/utils";
import { ORIGIN_LABEL, PAD, QUADRANT_X, QUADRANT_Y, SPRING, bestHiddenMarket, bubbleWeight, fitDomain, makeScales, position } from "./geometry";
import { LABEL_H, LABEL_SIZE, TAG_SIZE, makeMeasure, placeCallout, placeLabels, relax, type Measure, type PlacedLabel, type Rect } from "./layout";

type RoundFilter = "1" | "2" | "all";

export interface MarketMapProps {
  runId: string;
  /** Pass the mission-control store to share one SSE connection. Omit to subscribe here. */
  store?: RunStore;
  /** Override click handling. Default opens the built-in segment drawer. */
  onSelect?: (segmentId: string) => void;
  className?: string;
}

/** Market map hero (SPEC §10.4). Self-subscribes to the run stream unless a store is passed. */
export function MarketMap({ runId, store, ...rest }: MarketMapProps) {
  if (store) return <MarketMapView runId={runId} store={store} {...rest} />;
  return <StreamedMarketMap runId={runId} {...rest} />;
}

function StreamedMarketMap({ runId, ...rest }: Omit<MarketMapProps, "store">) {
  const { store } = useRunStream(runId);
  return <MarketMapView runId={runId} store={store} {...rest} />;
}

function useSize<T extends HTMLElement>() {
  const ref = React.useRef<T | null>(null);
  const [size, setSize] = React.useState({ w: 0, h: 0 });
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      const h = el.clientHeight || Math.round(w * 0.6);
      setSize((s) => (s.w === w && s.h === h ? s : { w, h }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, ...size };
}

function useMeasure(ref: React.RefObject<HTMLElement | null>): Measure {
  const [family, setFamily] = React.useState("Inter, ui-sans-serif, system-ui, sans-serif");
  React.useLayoutEffect(() => {
    const ff = ref.current ? getComputedStyle(ref.current).fontFamily : "";
    if (ff) setFamily(ff);
  }, [ref]);
  return React.useMemo(() => makeMeasure(family), [family]);
}

const VERDICT_ORDER: Verdict[] = ["VERIFIED", "PROMISING", "HYPE", "KILLED", "PENDING"];

const VERDICT_LABEL: Record<Verdict, string> = {
  VERIFIED: "Verified",
  PROMISING: "Promising",
  HYPE: "Hype",
  KILLED: "Killed",
  PENDING: "Simulated only",
};

const PRIORITY: Record<Verdict, number> = { VERIFIED: 60, PROMISING: 50, HYPE: 40, PENDING: 30, KILLED: 20 };

/** Hairline ink for frames, edges and node outlines on the white canvas. */
const EDGE = "rgba(14,15,12,0.15)";
const FOREST = "#163300";
const PAPER = "#FFFFFF";
const LINEN = "#E2F6D5";
const LIME = "#9FE870";
const PEBBLE = "#868685";
const MUTED = "#6a6c6a";
const CALLOUT_TEXT = "Your best hidden market";

export function MarketMapView({ runId, store, onSelect, className }: MarketMapProps & { store: RunStore }) {
  const [round, setRound] = React.useState<RoundFilter>("all");
  const [showControls, setShowControls] = React.useState(false);
  const [hidden, setHidden] = React.useState<Set<Verdict>>(() => new Set());
  const [hovered, setHovered] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<string | null>(null);
  const { ref, w, h } = useSize<HTMLDivElement>();
  const svgRef = React.useRef<SVGSVGElement | null>(null);
  const measure = useMeasure(ref);
  const reduce = useReducedMotion() ?? false;

  const all = Object.values(store.segments);
  const hasR2 = all.some((s) => s.round >= 2);
  const markets = all.filter((s) => s.origin !== "control_negative");
  const controlCount = all.length - markets.length;
  const inScope = all.filter((s) => showControls || s.origin !== "control_negative").filter((s) => round === "all" || String(s.round) === round);
  const shown = inScope.filter((s) => !hidden.has(s.verdict));
  // Proposed segments have no coordinates yet: they wait in a tray instead of piling up at the origin.
  const waiting = shown.filter((s) => s.simInterest == null);
  const visible = shown
    .filter((s) => s.simInterest != null)
    // big bubbles behind small ones
    .sort((a, b) => bubbleWeight(b) - bubbleWeight(a));

  const domain = fitDomain(inScope);
  const { x, y, r } = makeScales(w, h, domain);
  const ready = w > 0 && h > 0;
  const frame: Rect = { x: PAD.left, y: PAD.top, w: Math.max(0, w - PAD.left - PAD.right), h: Math.max(0, h - PAD.top - PAD.bottom) };
  const captions = ready ? captionLayout(frame, measure) : [];
  const best = bestHiddenMarket(visible);

  const posKey = visible.map((s) => `${s.id}:${(s.simInterest ?? 0).toFixed(3)}:${(s.runningStrength ?? 0).toFixed(3)}:${bubbleWeight(s)}:${s.verdict}`).join("|");
  const layout = React.useMemo(() => {
    if (!ready) return null;
    const nodes = relax(
      visible.map((s) => {
        const p = position(s);
        return {
          id: s.id,
          ox: x(p.sx),
          oy: y(p.sy),
          r: r(bubbleWeight(s)),
          name: s.name,
          tag: s.origin === "stated" ? "Your ICP" : undefined,
          priority: PRIORITY[s.verdict] + (s.id === best?.id ? 40 : 0) + (s.origin === "stated" ? 15 : 0) + Math.min(9, bubbleWeight(s) / 4),
        };
      }),
      frame,
    );
    const capRects = captions.map((c) => c.box);
    const bestNode = best ? nodes.find((n) => n.id === best.id) : undefined;
    const calloutW = Math.ceil(measure(CALLOUT_TEXT, 12) + 40);
    const callout = bestNode ? placeCallout(bestNode, calloutW, 26, nodes, capRects, frame) : null;
    const labels = placeLabels(nodes, [...capRects, ...(callout ? [callout.box] : [])], frame, measure);
    return { nodes, callout, labels, byId: new Map(nodes.map((n) => [n.id, n])) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, w, h, posKey, best?.id, measure, domain.x[0], domain.x[1], domain.y[1]]);

  const select = (id: string) => {
    setSelected(id);
    onSelect?.(id);
  };
  const hov = hovered ? store.segments[hovered] : null;
  const related = React.useMemo(() => {
    if (!hovered) return null;
    const s = new Set([hovered]);
    const h = store.segments[hovered];
    if (h?.parentId) s.add(h.parentId);
    for (const v of Object.values(store.segments)) if (v.parentId === hovered) s.add(v.id);
    return s;
  }, [hovered, store.segments]);
  const dimmed = (id: string) => related !== null && !related.has(id);

  const counts = Object.fromEntries(VERDICT_ORDER.map((v) => [v, markets.filter((s) => s.verdict === v).length])) as Record<Verdict, number>;
  const solo = (v: Verdict | null) =>
    setHidden((cur) => {
      if (v === null) return new Set();
      const only = new Set(VERDICT_ORDER.filter((k) => k !== v));
      const isSolo = cur.size === only.size && [...only].every((k) => cur.has(k));
      return isSolo ? new Set() : only;
    });
  const toggle = (v: Verdict) =>
    setHidden((cur) => {
      const next = new Set(cur);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      return next;
    });

  // Arrow keys walk the nodes left to right, like reading the map.
  const order = layout ? [...layout.nodes].sort((a, b) => a.x - b.x || a.y - b.y).map((n) => n.id) : [];
  const focusStep = (id: string, step: number) => {
    const i = order.indexOf(id);
    const next = order[(i + step + order.length) % order.length];
    svgRef.current?.querySelector<SVGGElement>(`[data-node="${CSS.escape(next)}"]`)?.focus();
  };

  return (
    <div className={cn("flex h-full min-h-0 flex-col gap-3", className)}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <StoryRow total={markets.length} counts={counts} hidden={hidden} onSolo={solo} />
        <MapControls round={round} setRound={setRound} hasR2={hasR2} />
      </div>

      <div ref={ref} className="relative min-h-[320px] flex-1 overflow-hidden rounded-card border border-hairline bg-paper font-sans" onMouseLeave={() => setHovered(null)}>
        {ready ? (
          <svg ref={svgRef} width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="group" aria-label="Market map: simulated interest against evidence strength" className="block select-none">
            <Frame x={x} y={y} w={w} h={h} domain={domain} captions={captions} />
            <g aria-hidden>
              {visible.map((s) => {
                const parent = s.parentId ? layout?.byId.get(s.parentId) : undefined;
                const me = layout?.byId.get(s.id);
                if (!parent || !me) return null;
                const t = reduce ? { duration: 0 } : SPRING;
                return (
                  <motion.line
                    key={`edge-${s.id}`}
                    initial={false}
                    animate={{ x1: parent.x, y1: parent.y, x2: me.x, y2: me.y, opacity: dimmed(s.id) && dimmed(parent.id) ? 0.3 : 1 }}
                    transition={{ x1: t, y1: t, x2: t, y2: t, opacity: { duration: 0.2 } }}
                    stroke={EDGE}
                    strokeWidth={1}
                    strokeDasharray="2 3"
                  />
                );
              })}
              {layout?.nodes.map((n) =>
                Math.hypot(n.x - n.ox, n.y - n.oy) > 6 ? (
                  <g key={`tether-${n.id}`} opacity={dimmed(n.id) ? 0.3 : 1}>
                    <line x1={n.ox} y1={n.oy} x2={n.x} y2={n.y} stroke={EDGE} />
                    <circle cx={n.ox} cy={n.oy} r={2} fill={PEBBLE} />
                  </g>
                ) : null,
              )}
            </g>
            <AnimatePresence>
              {visible.map((s) => {
                const me = layout?.byId.get(s.id);
                if (!me) return null;
                const parent = s.parentId ? layout?.byId.get(s.parentId) : undefined;
                return (
                  <Bubble
                    key={s.id}
                    s={s}
                    fromPx={parent ? { x: parent.x, y: parent.y } : { x: me.x, y: me.y }}
                    toPx={{ x: me.x, y: me.y }}
                    radius={me.r}
                    reduce={reduce}
                    hovered={hovered === s.id}
                    selected={selected === s.id}
                    dim={dimmed(s.id)}
                    onHover={setHovered}
                    onSelect={select}
                    onStep={(step) => focusStep(s.id, step)}
                  />
                );
              })}
            </AnimatePresence>
            <g aria-hidden className="pointer-events-none">
              <AnimatePresence>
                {layout?.labels.map((l) => (
                  <NodeLabel key={`label-${l.id}`} l={l} dim={dimmed(l.id)} active={hovered === l.id || selected === l.id} reduce={reduce} />
                ))}
              </AnimatePresence>
            </g>
            <AnimatePresence>
              {layout?.callout && best ? <Callout key={`callout-${best.id}`} c={layout.callout} reduce={reduce} onClick={() => select(best.id)} /> : null}
            </AnimatePresence>
          </svg>
        ) : null}
        {ready && visible.length === 0 ? <EmptyMap filtered={inScope.length > 0 && shown.length === 0} waiting={waiting.length} onReset={() => solo(null)} /> : null}
        {ready && waiting.length > 0 && visible.length > 0 ? (
          <div className="pointer-events-none absolute top-3 left-1/2 flex -translate-x-1/2 animate-in items-center gap-2 rounded-pill border border-dashed border-hairline-strong bg-paper px-3 py-1.5 text-xs text-muted duration-200 fade-in-0">
            <span className="flex -space-x-1" aria-hidden>
              {waiting.slice(0, 4).map((s) => (
                <span key={s.id} className="size-3 animate-pulse rounded-full border border-dashed border-pebble bg-paper" />
              ))}
            </span>
            <span>
              <span className="tabular font-semibold text-charcoal">{waiting.length}</span> waiting for personas
            </span>
          </div>
        ) : null}
        {hov && ready && layout?.byId.get(hov.id) ? <HoverCard s={hov} store={store} node={layout.byId.get(hov.id)!} w={w} h={h} best={best?.id === hov.id} /> : null}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Legend counts={counts} hidden={hidden} onToggle={toggle} />
        <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-semibold text-charcoal" title="Negative-control segments test whether the swarm says yes to everything">
          <Switch.Root
            checked={showControls}
            onCheckedChange={setShowControls}
            className="relative h-4 w-7 cursor-pointer rounded-pill bg-hairline-strong transition-colors duration-150 ease-out-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest data-[state=checked]:bg-forest"
          >
            <Switch.Thumb className="block size-3 translate-x-0.5 rounded-full bg-paper transition-transform duration-150 ease-out-soft data-[state=checked]:translate-x-[14px]" />
          </Switch.Root>
          Controls
          {controlCount ? <span className="tabular text-muted">{controlCount}</span> : null}
        </label>
        <span className="ml-auto hidden items-center gap-1.5 text-xs text-muted min-[1400px]:inline-flex">
          <span className="inline-flex items-end gap-0.5" aria-hidden>
            <span className="size-1.5 rounded-full border border-pebble" />
            <span className="size-2.5 rounded-full border border-pebble" />
          </span>
          Size = evidence + personas
        </span>
      </div>

      {!onSelect ? <SegmentDrawer runId={runId} store={store} segmentId={selected} onClose={() => setSelected(null)} /> : null}
    </div>
  );
}

function MapControls({ round, setRound, hasR2 }: { round: RoundFilter; setRound: (r: RoundFilter) => void; hasR2: boolean }) {
  return (
        <div className="ml-auto flex items-center">
          {/* Lime is reserved for Verified nodes on this surface, so the active round is a white pill. */}
          <div role="group" aria-label="Round" className="flex items-center gap-0.5 rounded-pill bg-raised p-1">
            {(
              [
                ["1", "Round 1"],
                ["2", "Round 2"],
                ["all", "All"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                aria-pressed={round === k}
                disabled={k === "2" && !hasR2}
                onClick={() => setRound(k)}
                className={cn(
                  "h-7 cursor-pointer rounded-pill px-3 text-[13px] font-semibold transition-colors duration-150 ease-out-soft disabled:cursor-not-allowed disabled:opacity-40",
                  round === k ? "bg-paper text-forest shadow-hairline" : "text-charcoal hover:bg-paper/70 hover:text-forest",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
  );
}

/* ------------------------------------------------------------------------------------------------ */

function StoryRow({ total, counts, hidden, onSolo }: { total: number; counts: Record<Verdict, number>; hidden: Set<Verdict>; onSolo: (v: Verdict | null) => void }) {
  const soloed = hidden.size === VERDICT_ORDER.length - 1 ? VERDICT_ORDER.find((v) => !hidden.has(v)) ?? null : null;
  const items = (["VERIFIED", "PROMISING", "HYPE", "KILLED", "PENDING"] as Verdict[]).filter((v) => counts[v] > 0);
  const word: Record<Verdict, string> = { VERIFIED: "verified", PROMISING: "promising", HYPE: "hype", KILLED: "killed", PENDING: "simulated only" };
  const tested = total - counts.PENDING;
  const headline = tested > 0 ? tested : total;
  const noun = tested > 0 ? (tested === 1 ? "market tested" : "markets tested") : total === 1 ? "market proposed" : "markets proposed";
  return (
    <div role="toolbar" aria-label="Filter by verdict" className="flex flex-wrap items-center gap-1">
      <button
        type="button"
        onClick={() => onSolo(null)}
        aria-pressed={hidden.size === 0}
        className={cn(
          "group inline-flex h-10 cursor-pointer items-baseline gap-2 rounded-pill pr-4 pl-1 transition-colors duration-150 ease-out-soft hover:text-forest",
          hidden.size === 0 ? "text-strong" : "text-muted",
        )}
      >
        <span className="tabular text-[28px] leading-none font-bold tracking-[-0.03em]">{headline}</span>
        <span className="text-[14px] font-semibold">{noun}</span>
      </button>
      {items.map((v) => {
        const on = soloed === v;
        const off = hidden.has(v) && !on;
        return (
          <button
            key={v}
            type="button"
            onClick={() => onSolo(v)}
            aria-pressed={on}
            title={on ? "Show all markets" : `Show only ${VERDICT_LABEL[v].toLowerCase()}`}
            className={cn(
              "inline-flex h-8 cursor-pointer items-center gap-2 rounded-pill border px-3 text-[13px] font-semibold transition-[background-color,border-color,color,opacity] duration-150 ease-out-soft",
              on ? "border-forest bg-linen text-forest" : "border-hairline bg-paper text-charcoal hover:border-hairline-strong hover:bg-linen/50",
              off && "opacity-50",
            )}
          >
            <Dot v={v} />
            <span className="tabular text-strong">{counts[v]}</span>{" "}
            {word[v]}
          </button>
        );
      })}
    </div>
  );
}

function Dot({ v, className }: { v: Verdict; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("size-2.5 shrink-0 rounded-full", v === "PENDING" ? "border border-dashed border-pebble bg-paper" : "border border-black/10", className)}
      style={v === "PENDING" ? undefined : { background: VERDICT_COLORS[v] }}
    />
  );
}

function Legend({ counts, hidden, onToggle }: { counts: Record<Verdict, number>; hidden: Set<Verdict>; onToggle: (v: Verdict) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs" role="group" aria-label="Verdict legend">
      {VERDICT_ORDER.map((v) => {
        const off = hidden.has(v);
        return (
          <button
            key={v}
            type="button"
            aria-pressed={!off}
            onClick={() => onToggle(v)}
            title={off ? `Show ${VERDICT_LABEL[v].toLowerCase()}` : `Hide ${VERDICT_LABEL[v].toLowerCase()}`}
            className={cn(
              "inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-pill border px-2.5 font-semibold transition-[background-color,border-color,color] duration-150 ease-out-soft",
              off ? "border-dashed border-hairline-strong bg-transparent text-muted line-through decoration-1" : "border-hairline bg-paper text-charcoal hover:bg-linen/60",
            )}
          >
            <Dot v={v} className={cn("size-2", off && "opacity-40")} />
            {VERDICT_LABEL[v]}
            {counts[v] ? <span className="tabular text-muted">{counts[v]}</span> : null}
          </button>
        );
      })}
      <span className="ml-1 inline-flex h-7 items-center gap-1.5 px-1 font-semibold text-charcoal">
        <span className="size-2.5 rounded-full border border-dotted border-forest" aria-hidden />
        Your ICP
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------ */

type Scale = ReturnType<typeof makeScales>["x"];

interface Caption {
  key: string;
  title: string;
  desc: string;
  anchor: "start" | "end";
  tx: number;
  ty: number;
  box: Rect;
  accent?: boolean;
}

const QUADRANTS = [
  { key: "accidental", title: "Accidental markets", desc: "Personas want it and the world agrees.", right: true, top: true, accent: true },
  { key: "underhyped", title: "Under-hyped", desc: "Real demand the swarm underrated.", right: false, top: true },
  { key: "hype", title: "LLM hype", desc: "Personas like it. Nobody is asking.", right: true, top: false },
  { key: "none", title: "Not a market", desc: "No pull in either view.", right: false, top: false },
] as const;

function captionLayout(f: Rect, measure: Measure): Caption[] {
  const pad = 12;
  return QUADRANTS.map((q) => {
    const bw = Math.ceil(Math.max(measure(q.title, 12), measure(q.desc, 11) * 0.93)) + 2;
    const bh = 32;
    const left = q.right ? f.x + f.w - pad - bw : f.x + pad;
    const top = q.top ? f.y + pad : f.y + f.h - pad - bh;
    return { key: q.key, title: q.title, desc: q.desc, anchor: q.right ? "end" : "start", tx: q.right ? left + bw : left, ty: top, box: { x: left - 4, y: top - 2, w: bw + 8, h: bh + 4 }, accent: "accent" in q };
  });
}

function Frame({ x, y, w, h, domain, captions }: { x: Scale; y: Scale; w: number; h: number; domain: { x: [number, number]; y: [number, number] }; captions: Caption[] }) {
  const qx = x(QUADRANT_X);
  const qy = y(QUADRANT_Y);
  const x0 = PAD.left;
  const x1 = w - PAD.right;
  const y0 = PAD.top;
  const y1 = h - PAD.bottom;
  const xt = [...new Set([domain.x[0], QUADRANT_X, domain.x[1]])];
  const yt = [...new Set([domain.y[0], QUADRANT_Y, domain.y[1]])];
  return (
    <g aria-hidden>
      {/* The quadrant that matters gets a quiet linen wash. */}
      <rect x={qx} y={y0} width={Math.max(0, x1 - qx)} height={Math.max(0, qy - y0)} fill={LINEN} opacity={0.5} />
      <rect x={x0} y={y0} width={Math.max(0, x1 - x0)} height={Math.max(0, y1 - y0)} fill="none" stroke="rgba(14,15,12,0.08)" />
      <line x1={qx} x2={qx} y1={y0} y2={y1} stroke={EDGE} strokeDasharray="3 4" />
      <line x1={x0} x2={x1} y1={qy} y2={qy} stroke={EDGE} strokeDasharray="3 4" />
      {captions.map((c) => (
        <text key={c.key} x={c.tx} y={c.ty} textAnchor={c.anchor} className="font-sans">
          <tspan x={c.tx} dy={12} fontSize={12} fontWeight={600} fill={c.accent ? FOREST : "#454745"}>
            {c.title}
          </tspan>
          <tspan x={c.tx} dy={15} fontSize={11} fontWeight={500} fill={MUTED}>
            {c.desc}
          </tspan>
        </text>
      ))}
      {xt.map((t) => (
        <text key={`x${t}`} x={x(t)} y={y1 + 15} textAnchor="middle" className="fill-muted font-mono text-[10px]">
          {t.toFixed(t === QUADRANT_X ? 1 : 2).replace(/0$/, "")}
        </text>
      ))}
      {yt.map((t) => (
        <text key={`y${t}`} x={x0 - 8} y={y(t) + 3} textAnchor="end" className="fill-muted font-mono text-[10px]">
          {t === 0 ? "0" : t.toFixed(2).replace(/0$/, "")}
        </text>
      ))}
      <text x={(x0 + x1) / 2} y={h - 8} textAnchor="middle" className="text-[12px]">
        <tspan className="fill-charcoal font-semibold">Swarm says</tspan>
        <tspan className="fill-muted"> (simulated interest) →</tspan>
      </text>
      <text transform={`translate(16 ${(y0 + y1) / 2}) rotate(-90)`} textAnchor="middle" className="text-[12px]">
        <tspan className="fill-charcoal font-semibold">World says</tspan>
        <tspan className="fill-muted"> (evidence) →</tspan>
      </text>
    </g>
  );
}

/* ------------------------------------------------------------------------------------------------ */

interface BubbleProps {
  s: SegmentView;
  fromPx: { x: number; y: number };
  toPx: { x: number; y: number };
  radius: number;
  reduce: boolean;
  hovered: boolean;
  selected: boolean;
  dim: boolean;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
  onStep: (step: number) => void;
}

/**
 * Judged segments are solid flat fills in their verdict color; only Sounding-verified ones are lime.
 * Pending segments have simulated signal only, so they render as a dashed outline on white.
 */
function Bubble({ s, fromPx, toPx, radius, reduce, hovered, selected, dim, onHover, onSelect, onStep }: BubbleProps) {
  const pending = s.verdict === "PENDING";
  const fill = pending ? PAPER : VERDICT_COLORS[s.verdict];
  const stroke = pending ? PEBBLE : EDGE;
  const unscored = s.simInterest == null;
  const killed = s.verdict === "KILLED";
  const control = s.origin === "control_negative";
  const transition = reduce ? { duration: 0 } : SPRING;
  const base = unscored ? 0.5 : killed ? 0.8 : 1;
  const opacity = dim ? Math.min(base, 0.3) : base;

  return (
    <motion.g
      data-node={s.id}
      initial={reduce ? { x: toPx.x, y: toPx.y, opacity } : { x: fromPx.x, y: fromPx.y, opacity: 0 }}
      animate={{ x: toPx.x, y: toPx.y, opacity }}
      exit={{ opacity: 0, transition: { duration: 0.15 } }}
      transition={{ x: transition, y: transition, opacity: { duration: reduce ? 0 : 0.25 } }}
      role="button"
      tabIndex={0}
      aria-label={`${s.name}, ${VERDICT_LABEL[s.verdict].toLowerCase()}${pending ? ", simulated only" : ""}`}
      aria-pressed={selected}
      className="cursor-pointer outline-none [&:focus-visible_.focus-ring]:opacity-100"
      onMouseEnter={() => onHover(s.id)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(s.id)}
      onBlur={() => onHover(null)}
      onClick={() => onSelect(s.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(s.id);
        } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
          e.preventDefault();
          onStep(1);
        } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
          e.preventDefault();
          onStep(-1);
        } else if (e.key === "Escape") {
          (e.currentTarget as SVGGElement).blur();
        }
      }}
    >
      <motion.g initial={reduce ? false : { scale: 0.3 }} animate={{ scale: hovered ? 1.08 : 1 }} transition={{ type: "spring", stiffness: 260, damping: 20 }}>
        <circle r={radius + 8} fill={LINEN} opacity={hovered || selected ? 1 : 0} style={{ transition: "opacity 150ms" }} />
        {!pending && !reduce ? (
          <motion.circle
            key={`pulse-${s.verdict}`}
            r={radius}
            fill="none"
            stroke={FOREST}
            strokeWidth={1.5}
            initial={{ r: radius, opacity: 0.55 }}
            animate={{ r: radius * 2.3, opacity: 0 }}
            transition={{ duration: 1.4, ease: [0.22, 1, 0.36, 1] }}
          />
        ) : null}
        {s.origin === "stated" ? <circle r={radius + 4.5} fill="none" stroke={FOREST} strokeOpacity={0.7} strokeWidth={1.4} strokeLinecap="round" strokeDasharray="0.5 3.5" /> : null}
        {control ? <circle r={radius + 4} fill="none" stroke="rgba(14,15,12,0.4)" strokeWidth={1} strokeDasharray="4 3" /> : null}
        <motion.circle
          initial={false}
          animate={{ r: radius, fill, stroke }}
          transition={{ r: transition, fill: { duration: reduce ? 0 : 0.6 }, stroke: { duration: reduce ? 0 : 0.6 } }}
          strokeWidth={pending ? 1.5 : 1}
          strokeDasharray={pending ? "3 3" : undefined}
        />
        {killed ? <line x1={-radius * 0.5} x2={radius * 0.5} y1={0} y2={0} stroke="#454745" strokeWidth={1.25} strokeLinecap="round" /> : null}
        <circle className="focus-ring" r={radius + 4} fill="none" stroke={FOREST} strokeWidth={2} opacity={selected ? 1 : 0} />
      </motion.g>
    </motion.g>
  );
}

/** White knockout behind labels so they stay legible over edges and the linen wash. */
const TEXT_HALO: React.CSSProperties = { paintOrder: "stroke", stroke: PAPER, strokeWidth: 3, strokeLinejoin: "round" };

function NodeLabel({ l, dim, active, reduce }: { l: PlacedLabel; dim: boolean; active: boolean; reduce: boolean }) {
  const cy = l.box.y + LABEL_H / 2;
  return (
    <motion.g
      initial={reduce ? false : { opacity: 0 }}
      animate={{ opacity: dim ? 0.25 : 1 }}
      exit={{ opacity: 0, transition: { duration: 0.1 } }}
      transition={{ duration: 0.2, delay: reduce ? 0 : 0.15 }}
    >
      {l.leader ? <line x1={l.leader.x1} y1={l.leader.y1} x2={l.leader.x2} y2={l.leader.y2} stroke="rgba(22,51,0,0.35)" strokeWidth={1} /> : null}
      {l.tagW ? (
        <g>
          <rect x={l.box.x} y={cy - 8} width={l.tagW - 6} height={16} rx={8} fill={LINEN} />
          <text x={l.box.x + (l.tagW - 6) / 2} y={cy + 3.5} textAnchor="middle" fontSize={TAG_SIZE} fontWeight={600} fill={FOREST}>
            Your ICP
          </text>
        </g>
      ) : null}
      <text x={l.box.x + l.tagW} y={cy + 4} fontSize={LABEL_SIZE} fontWeight={600} fill={active ? FOREST : "#0e0f0c"} style={TEXT_HALO}>
        {l.text}
      </text>
    </motion.g>
  );
}

function Callout({ c, reduce, onClick }: { c: NonNullable<ReturnType<typeof placeCallout>>; reduce: boolean; onClick: () => void }) {
  const { box, leader } = c;
  return (
    <motion.g
      initial={reduce ? false : { opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3, delay: reduce ? 0 : 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="cursor-pointer"
      onClick={onClick}
    >
      <line x1={leader.x1} y1={leader.y1} x2={leader.x2} y2={leader.y2} stroke={FOREST} strokeWidth={1.25} />
      <circle cx={leader.x1} cy={leader.y1} r={2.5} fill={FOREST} />
      <rect x={box.x} y={box.y} width={box.w} height={box.h} rx={box.h / 2} fill={FOREST} />
      <circle cx={box.x + 14} cy={box.y + box.h / 2} r={4} fill={LIME} />
      <text x={box.x + 26} y={box.y + box.h / 2 + 4} fontSize={12} fontWeight={600} fill={PAPER}>
        {CALLOUT_TEXT}
      </text>
    </motion.g>
  );
}

/* ------------------------------------------------------------------------------------------------ */

function host(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function HoverCard({ s, store, node, w, h, best }: { s: SegmentView; store: RunStore; node: { x: number; y: number; r: number }; w: number; h: number; best: boolean }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [ch, setCh] = React.useState(220);
  React.useLayoutEffect(() => {
    if (ref.current) setCh(ref.current.offsetHeight);
  }, [s.id]);
  const cw = 296;
  const left = node.x + node.r + 16 + cw > w - 8 ? node.x - node.r - 16 - cw : node.x + node.r + 16;
  const top = Math.min(h - ch - 8, Math.max(8, node.y - 36));
  const ev = s.evidenceStrength ?? s.runningStrength;
  const quote = [...(store.evidence[s.id] ?? [])].filter((e) => e.stance === "supports").sort((a, b) => b.strength - a.strength)[0];
  const personas = s.personaCount || Object.values(store.personas).filter((p) => p.segmentId === s.id).length;

  return (
    <div
      ref={ref}
      role="tooltip"
      className="pointer-events-none absolute z-10 animate-in rounded-card border border-hairline bg-paper p-4 text-xs shadow-float duration-150 fade-in-0 zoom-in-95"
      style={{ top, left: Math.max(8, left), width: cw }}
    >
      {best ? <p className="mb-2 inline-flex items-center gap-1.5 rounded-pill bg-forest px-2 py-0.5 text-[11px] font-semibold text-paper"><span className="size-1.5 rounded-full bg-lime" />Best hidden market</p> : null}
      <div className="flex items-start justify-between gap-3">
        <p className="text-[14px] leading-snug font-semibold text-strong">{s.name}</p>
        <VerdictChip verdict={s.verdict} className="shrink-0" />
      </div>
      <p className="mt-0.5 text-muted">
        {ORIGIN_LABEL[s.origin]} · Round {s.round}
      </p>
      <div className="mt-3 space-y-2">
        <Meter label="Real" sub="evidence" value={ev} />
        <Meter label="Simulated" sub="swarm" value={s.simInterest} simulated />
      </div>
      <div className="mt-3 flex items-center gap-4 text-muted">
        <span className="inline-flex items-center gap-1.5">
          <Users className="size-3.5 text-forest" />
          <span className="tabular font-semibold text-strong">{personas}</span> {personas === 1 ? "persona" : "personas"}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <FileText className="size-3.5 text-forest" />
          <span className="tabular font-semibold text-strong">{s.evidenceCount}</span> evidence
        </span>
      </div>
      {quote ? (
        <figure className="mt-3 border-t border-hairline pt-3">
          <blockquote className="line-clamp-3 text-[12.5px] leading-relaxed text-body">“{quote.quote}”</blockquote>
          <figcaption className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`https://www.google.com/s2/favicons?domain=${host(quote.url)}&sz=32`} alt="" className="size-3.5 rounded-sm" />
            <span className="truncate">{host(quote.url)}</span>
          </figcaption>
        </figure>
      ) : s.topObjections?.[0] ? (
        <p className="mt-3 border-t border-hairline pt-3 text-[12.5px] leading-relaxed text-body">
          <span className="text-muted">Top objection (simulated): </span>“{s.topObjections[0]}”
        </p>
      ) : null}
      <p className="mt-3 flex items-center gap-1.5 text-[11px] text-muted">
        Click or press <kbd className="rounded border border-hairline bg-recessed px-1 font-sans text-[10px] font-semibold text-charcoal">Enter</kbd> to open
      </p>
    </div>
  );
}

function Meter({ label, sub, value, simulated }: { label: string; sub: string; value: number | null | undefined; simulated?: boolean }) {
  const v = value == null ? 0 : Math.max(0, Math.min(1, value));
  return (
    <div className="grid grid-cols-[112px_1fr_32px] items-center gap-2">
      <span className="truncate">
        <span className="font-semibold text-strong">{label}</span> <span className="text-muted">{sub}</span>
      </span>
      <span className={cn("relative h-2 overflow-hidden rounded-pill", simulated ? "border border-dashed border-pebble bg-paper" : "bg-raised")}>
        <span
          className={cn("absolute inset-y-0 left-0 rounded-pill transition-[width] duration-300 ease-out-soft", simulated ? "bg-pebble/50" : "bg-forest")}
          style={{ width: `${v * 100}%` }}
        />
      </span>
      <span className="tabular text-right font-semibold text-strong">{value == null ? "–" : value.toFixed(2)}</span>
    </div>
  );
}

function EmptyMap({ filtered, waiting, onReset }: { filtered: boolean; waiting: number; onReset: () => void }) {
  return (
    <div className="absolute inset-0 grid place-items-center">
      <div className="flex max-w-xs animate-in flex-col items-center rounded-card bg-paper/90 p-4 text-center duration-200 fade-in-0">
        <span className={cn("grid size-10 place-items-center rounded-full bg-raised text-forest", !filtered && "animate-pulse")}>
          <Radar className="size-5" />
        </span>
        <p className="mt-3 text-[14px] font-semibold text-strong">
          {filtered ? "No markets match this filter" : waiting ? `${waiting} ${waiting === 1 ? "market" : "markets"} proposed` : "Swarm is proposing markets"}
        </p>
        <p className="mt-1 text-[13px] text-muted">
          {filtered ? "Turn a verdict back on to see them." : "Each one lands here as personas react. Then Sounding checks it against real evidence."}
        </p>
        {filtered ? (
          <button type="button" onClick={onReset} className="link-underline mt-3 cursor-pointer text-[13px] font-semibold">
            Show all
          </button>
        ) : null}
      </div>
    </div>
  );
}

export default MarketMap;
