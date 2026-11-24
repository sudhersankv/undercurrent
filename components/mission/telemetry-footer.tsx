"use client";

import { useRun } from "./run-context";

const fmtTokens = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${Math.round(n)}`);

export function TelemetryFooter() {
  const { runId, store } = useRun();
  const r = store.retrieval;
  const u = store.usage;
  return (
    <footer className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-hairline bg-recessed px-4 py-2 font-mono text-[11px] text-muted">
      <span>
        retrieval: Moss · p50 <span className="text-body">{r ? `${Math.round(r.p50Ms)} ms` : "--"}</span>
      </span>
      <span>
        <span className="text-body">{u ? fmtTokens(u.inputTokens + u.outputTokens) : "0"}</span> tokens ·{" "}
        <span className="text-body">${u ? u.estCostUsd.toFixed(2) : "0.00"}</span>
      </span>
      <span className="ml-auto truncate">run {runId}</span>
    </footer>
  );
}
