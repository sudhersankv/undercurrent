"use client";

import { motion, useReducedMotion } from "framer-motion";
import { VERDICT_COLORS } from "@/components/ui";
import { useRun } from "./run-context";

/**
 * ─── MARKET MAP SLOT ───────────────────────────────────────────────────────────
 * Ticket #14 owns the real map (components/market-map). When it lands, replace the body of
 * <MapSlot/> with `<MarketMap runId={runId} />` (or whatever it exports). Everything below is a
 * stand-in preview so mission control reads well before #14 merges.
 * ───────────────────────────────────────────────────────────────────────────────
 */
export function MapSlot() {
  const { store } = useRun();
  const reduce = useReducedMotion();
  const segs = Object.values(store.segments);
  const W = 100;
  const H = 70;
  const px = (x: number) => 6 + x * (W - 10);
  const py = (y: number) => H - 6 - y * (H - 12);

  return (
    <section aria-label="Market map" className="relative flex h-full min-h-[320px] flex-col rounded-card border border-hairline bg-recessed">
      <div className="flex items-center justify-between px-4 pt-3">
        <h2 className="eyebrow">Market map</h2>
        <span className="font-mono text-[11px] text-muted tabular">{segs.length} segments</span>
      </div>
      <div className="relative min-h-0 flex-1 p-2">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-2 h-[calc(100%-16px)] w-[calc(100%-16px)]" role="img" aria-label="Segments by simulated interest and evidence strength">
          <line x1={px(0.5)} x2={px(0.5)} y1={py(0)} y2={py(1)} stroke="rgba(244,250,245,0.12)" strokeDasharray="0.8 0.8" strokeWidth="0.2" vectorEffect="non-scaling-stroke" />
          <line x1={px(0)} x2={px(1)} y1={py(0.3)} y2={py(0.3)} stroke="rgba(244,250,245,0.12)" strokeDasharray="0.8 0.8" strokeWidth="0.2" vectorEffect="non-scaling-stroke" />
        </svg>
        <div className="pointer-events-none absolute inset-4 text-[11px] text-muted">
          <span className="absolute right-0 top-0">Accidental markets</span>
          <span className="absolute left-0 top-0">Under-hyped</span>
          <span className="absolute bottom-6 right-0">LLM hype</span>
          <span className="absolute bottom-6 left-0">Not a market</span>
          <span className="absolute bottom-0 left-1/2 -translate-x-1/2 font-mono text-[10.5px]">Swarm says →</span>
        </div>
        {segs.map((s) => {
          const x = s.simInterest ?? 0;
          const y = s.runningStrength ?? 0;
          const color = VERDICT_COLORS[s.verdict ?? "PENDING"];
          const r = 8 + Math.sqrt(s.evidenceCount + (s.personaCount ?? 0)) * 3;
          return (
            <motion.div
              key={s.id}
              className="absolute -translate-x-1/2 translate-y-1/2 rounded-full border"
              title={s.name}
              style={{ width: r * 2, height: r * 2, borderColor: color, background: `${color}55`, borderStyle: s.origin === "control_negative" ? "dashed" : "solid" }}
              initial={false}
              animate={{ left: `${(px(x) / W) * 100}%`, bottom: `${((H - py(y)) / H) * 100}%`, opacity: s.verdict === "KILLED" ? 0.45 : 1 }}
              transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 120, damping: 18 }}
            />
          );
        })}
      </div>
    </section>
  );
}
