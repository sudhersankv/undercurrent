"use client";

import * as React from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import * as Switch from "@radix-ui/react-switch";
import { useRunStream, type RunStore, type SegmentView } from "@/lib/client/run-store";
import { VERDICT_COLORS } from "@/components/ui";
import { SegmentDrawer } from "@/components/segment-drawer";
import { cn } from "@/lib/utils";
import { ORIGIN_LABEL, PAD, QUADRANT_X, QUADRANT_Y, SPRING, bubbleWeight, makeScales, position } from "./geometry";

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

export function MarketMapView({ runId, store, onSelect, className }: MarketMapProps & { store: RunStore }) {
  const [round, setRound] = React.useState<RoundFilter>("all");
  const [showControls, setShowControls] = React.useState(false);
  const [hovered, setHovered] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<string | null>(null);
  const { ref, w, h } = useSize<HTMLDivElement>();
  const reduce = useReducedMotion() ?? false;

  const all = Object.values(store.segments);
  const hasR2 = all.some((s) => s.round >= 2);
  const controlCount = all.filter((s) => s.origin === "control_negative").length;
  const visible = all
    .filter((s) => showControls || s.origin !== "control_negative")
    .filter((s) => round === "all" || String(s.round) === round)
    // big bubbles behind small ones
    .sort((a, b) => bubbleWeight(b) - bubbleWeight(a));

  const { x, y, r } = makeScales(w, h);
  const ready = w > 0 && h > 0;

  const select = (id: string) => (onSelect ? onSelect(id) : setSelected(id));
  const hov = hovered ? store.segments[hovered] : null;

  return (
    <div className={cn("flex h-full min-h-0 flex-col gap-3", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Round" className="flex items-center gap-1">
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
                "h-7 rounded-full border px-3 text-xs transition-colors disabled:opacity-40",
                round === k ? "border-lichen/50 bg-raised text-strong" : "border-hairline text-body hover:bg-raised hover:text-strong",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="ml-auto flex cursor-pointer items-center gap-2 text-xs text-body">
          <Switch.Root
            checked={showControls}
            onCheckedChange={setShowControls}
            className="relative h-4 w-7 rounded-full border border-hairline-strong bg-recessed transition-colors data-[state=checked]:bg-raised-hover"
          >
            <Switch.Thumb className="block size-3 translate-x-0.5 rounded-full bg-muted transition-transform data-[state=checked]:translate-x-[13px] data-[state=checked]:bg-lichen" />
          </Switch.Root>
          Show controls
          {controlCount ? <span className="font-mono text-muted">{controlCount}</span> : null}
        </label>
      </div>

      <div ref={ref} className="relative min-h-[320px] flex-1 overflow-hidden rounded-card border border-hairline bg-recessed">
        {ready ? (
          <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Market map: simulated interest against evidence strength" className="block select-none">
            <Frame x={x} y={y} w={w} h={h} />
            {visible.length === 0 ? (
              <text x={w / 2} y={h / 2} textAnchor="middle" className="fill-muted text-[13px]">
                Waiting for Swarm
              </text>
            ) : null}
            <AnimatePresence>
              {visible.map((s) => {
                const parent = s.parentId ? store.segments[s.parentId] : undefined;
                const from = parent ? position(parent) : { sx: 0, sy: 0 };
                const to = position(s);
                return (
                  <Bubble
                    key={s.id}
                    s={s}
                    fromPx={{ x: x(from.sx), y: y(from.sy) }}
                    toPx={{ x: x(to.sx), y: y(to.sy) }}
                    radius={r(bubbleWeight(s))}
                    reduce={reduce}
                    active={hovered === s.id || selected === s.id}
                    onHover={setHovered}
                    onSelect={select}
                  />
                );
              })}
            </AnimatePresence>
          </svg>
        ) : null}
        {hov && ready ? <Tooltip s={hov} px={x(position(hov).sx)} py={y(position(hov).sy)} w={w} radius={r(bubbleWeight(hov))} /> : null}
      </div>

      <Legend />

      {!onSelect ? <SegmentDrawer runId={runId} store={store} segmentId={selected} onClose={() => setSelected(null)} /> : null}
    </div>
  );
}

type Scale = ReturnType<typeof makeScales>["x"];

function Frame({ x, y, w, h }: { x: Scale; y: Scale; w: number; h: number }) {
  const qx = x(QUADRANT_X);
  const qy = y(QUADRANT_Y);
  const x0 = PAD.left;
  const x1 = w - PAD.right;
  const y0 = PAD.top;
  const y1 = h - PAD.bottom;
  const label = "fill-muted text-[11px] uppercase tracking-[0.12em]";
  return (
    <g aria-hidden>
      <rect x={x0} y={y0} width={Math.max(0, x1 - x0)} height={Math.max(0, y1 - y0)} fill="none" stroke="rgba(244,250,245,0.08)" />
      <line x1={qx} x2={qx} y1={y0} y2={y1} stroke="rgba(244,250,245,0.16)" strokeDasharray="3 4" />
      <line x1={x0} x2={x1} y1={qy} y2={qy} stroke="rgba(244,250,245,0.16)" strokeDasharray="3 4" />
      <text x={x1 - 10} y={y0 + 18} textAnchor="end" className={label}>
        Accidental markets
      </text>
      <text x={x1 - 10} y={y1 - 10} textAnchor="end" className={label}>
        LLM hype
      </text>
      <text x={x0 + 10} y={y0 + 18} className={label}>
        Under-hyped
      </text>
      <text x={x0 + 10} y={y1 - 10} className={label}>
        Not a market
      </text>
      {[0, 0.5, 1].map((t) => (
        <text key={`x${t}`} x={x(t)} y={y1 + 16} textAnchor="middle" className="fill-muted font-mono text-[10px]">
          {t.toFixed(1)}
        </text>
      ))}
      {[0, 0.3, 1].map((t) => (
        <text key={`y${t}`} x={x0 - 8} y={y(t) + 3} textAnchor="end" className="fill-muted font-mono text-[10px]">
          {t.toFixed(1)}
        </text>
      ))}
      <text x={(x0 + x1) / 2} y={h - 6} textAnchor="middle" className="fill-body text-[11px] uppercase tracking-[0.12em]">
        Swarm says →
      </text>
      <text transform={`translate(12 ${(y0 + y1) / 2}) rotate(-90)`} textAnchor="middle" className="fill-body text-[11px] uppercase tracking-[0.12em]">
        World says →
      </text>
    </g>
  );
}

interface BubbleProps {
  s: SegmentView;
  fromPx: { x: number; y: number };
  toPx: { x: number; y: number };
  radius: number;
  reduce: boolean;
  active: boolean;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
}

function Bubble({ s, fromPx, toPx, radius, reduce, active, onHover, onSelect }: BubbleProps) {
  const color = VERDICT_COLORS[s.verdict];
  const unscored = s.simInterest == null;
  const killed = s.verdict === "KILLED";
  const control = s.origin === "control_negative";
  const transition = reduce ? { duration: 0 } : SPRING;
  const groupOpacity = unscored ? 0.4 : killed ? 0.55 : 1;
  const showLabel = active || s.verdict === "VERIFIED";

  return (
    <motion.g
      initial={reduce ? { x: toPx.x, y: toPx.y, opacity: groupOpacity } : { x: fromPx.x, y: fromPx.y, opacity: 0 }}
      animate={{ x: toPx.x, y: toPx.y, opacity: groupOpacity }}
      exit={{ opacity: 0, transition: { duration: 0.15 } }}
      transition={{ x: transition, y: transition, opacity: { duration: reduce ? 0 : 0.4 } }}
      role="button"
      tabIndex={0}
      aria-label={`${s.name}, ${s.verdict.toLowerCase()}`}
      className="cursor-pointer outline-none [&:focus-visible>circle.bubble]:stroke-[2.5]"
      onMouseEnter={() => onHover(s.id)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(s.id)}
      onBlur={() => onHover(null)}
      onClick={() => onSelect(s.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(s.id);
        }
      }}
    >
      {s.verdict === "VERIFIED" && !reduce ? (
        <motion.circle
          key="pulse"
          r={radius}
          fill="none"
          stroke={color}
          initial={{ r: radius, opacity: 0.8 }}
          animate={{ r: radius * 2.4, opacity: 0 }}
          transition={{ duration: 1.4, ease: [0.22, 1, 0.36, 1] }}
        />
      ) : null}
      {s.origin === "stated" ? <circle r={radius + 5} fill="none" stroke="#F4FAF5" strokeOpacity={0.5} strokeWidth={1} strokeDasharray="1 3" /> : null}
      <motion.circle
        className="bubble"
        initial={false}
        animate={{ r: radius, fill: color, stroke: color }}
        transition={{ r: transition, fill: { duration: reduce ? 0 : 0.6 }, stroke: { duration: reduce ? 0 : 0.6 } }}
        fillOpacity={0.35}
        strokeWidth={active ? 2.5 : 1.25}
        strokeDasharray={control ? "3 3" : undefined}
      />
      {s.origin === "stated" ? (
        <text y={-radius - 9} textAnchor="middle" className="pointer-events-none fill-strong font-mono text-[9px] uppercase tracking-[0.12em]" opacity={0.7}>
          your ICP
        </text>
      ) : null}
      {showLabel ? (
        <text x={radius + 6} y={4} className="pointer-events-none fill-strong text-[11px]">
          {s.name.length > 30 ? `${s.name.slice(0, 29)}…` : s.name}
        </text>
      ) : null}
    </motion.g>
  );
}

function Tooltip({ s, px, py, w, radius }: { s: SegmentView; px: number; py: number; w: number; radius: number }) {
  const left = px > w - 260;
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-10 w-60 rounded-control border border-hairline-strong bg-raised p-3 text-xs"
      style={{ top: Math.max(8, py - 12), left: left ? px - radius - 248 : px + radius + 12 }}
    >
      <p className="text-[13px] font-medium leading-snug text-strong">{s.name}</p>
      <p className="mt-0.5 text-muted">
        {ORIGIN_LABEL[s.origin]} · Round {s.round}
      </p>
      <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
        <dt className="text-muted">Swarm says</dt>
        <dd className="font-mono text-strong">{s.simInterest == null ? "–" : s.simInterest.toFixed(2)}</dd>
        <dt className="text-muted">World says</dt>
        <dd className="font-mono text-strong">{(s.evidenceStrength ?? s.runningStrength).toFixed(2)}</dd>
        <dt className="text-muted">Evidence</dt>
        <dd className="font-mono text-strong">{s.evidenceCount}</dd>
        <dt className="text-muted">Verdict</dt>
        <dd className="font-mono" style={{ color: VERDICT_COLORS[s.verdict] === VERDICT_COLORS.KILLED ? "#6F7F74" : VERDICT_COLORS[s.verdict] }}>
          {s.verdict}
        </dd>
      </dl>
      {s.topObjections?.[0] ? <p className="mt-2 border-t border-hairline pt-2 text-body">“{s.topObjections[0]}”</p> : null}
    </div>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted">
      {(Object.keys(VERDICT_COLORS) as (keyof typeof VERDICT_COLORS)[]).map((v) => (
        <span key={v} className="inline-flex items-center gap-1.5 font-mono uppercase tracking-[0.08em]">
          <span className="size-2 rounded-full border" style={{ background: `${VERDICT_COLORS[v]}59`, borderColor: VERDICT_COLORS[v] }} aria-hidden />
          {v.toLowerCase()}
        </span>
      ))}
      <span className="ml-auto">Size: evidence + personas</span>
    </div>
  );
}

export default MarketMap;
